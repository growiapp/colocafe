-- Pruebas de stock_durability.sql. Corre en una transacción que termina en ROLLBACK: crea dos locales sintéticos y no deja nada.
-- Ejecutar como postgres, solo en un entorno de pruebas con la migración aplicada. NO EJECUTADAS todavía.

begin;

do $$
declare
  v_user uuid;
  v_a uuid; v_b uuid;
  v_sale uuid; v_sale_b uuid;
  v_p uuid; v_otro uuid; v_ilim uuid; v_leg uuid; v_borrar uuid; v_pb uuid;
  v_item uuid; v_hist uuid;
  v_ts timestamptz;
  n int;
  bloqueado boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'hace falta un usuario existente';

  insert into public.stores (name, slug) values ('Stock A', 'stock-a-' || gen_random_uuid()) returning id into v_a;
  insert into public.stores (name, slug) values ('Stock B', 'stock-b-' || gen_random_uuid()) returning id into v_b;
  insert into public.store_users (store_id, user_id, role, active) values (v_a, v_user, 'operator', true);
  insert into public.sales (store_id, business_date, sold_at) values (v_a, current_date, now()) returning id into v_sale;
  insert into public.sales (store_id, business_date, sold_at) values (v_b, current_date, now()) returning id into v_sale_b;
  insert into public.products (store_id, name, stock) values (v_a, 'P', 10) returning id into v_p;
  insert into public.products (store_id, name, stock) values (v_a, 'Otro', 10) returning id into v_otro;
  insert into public.products (store_id, name, stock, unlimited) values (v_a, 'Ilimitado', 7, true) returning id into v_ilim;
  insert into public.products (store_id, name, stock, legacy_id) values (v_a, 'Legacy', 10, 'prod_legacy') returning id into v_leg;
  insert into public.products (store_id, name, stock) values (v_a, 'Borrar', 10) returning id into v_borrar;
  insert into public.products (store_id, name, stock) values (v_b, 'De B', 10) returning id into v_pb;

  -- Descuento atómico y registro de lo aplicado.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i1', v_p, 'P', 2) returning id into v_item;
  assert (select stock from public.products where id = v_p) = 8, 'descuenta 2';
  assert (select stock_applied_qty = 2 and stock_applied_reason = 'applied' and stock_applied_at is not null
            from public.sale_items where id = v_item), 'registra lo aplicado';

  -- Dos ítems del mismo producto.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i2', v_p, 'P', 1), (v_a, v_sale, 'i3', v_p, 'P', 2);
  assert (select stock from public.products where id = v_p) = 5, 'dos ítems: se suman los dos descuentos';

  -- Idempotencia de legacy_id: conflicto de unicidad.
  bloqueado := false;
  begin
    insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
      values (v_a, v_sale, 'i1', v_p, 'P', 2);
  exception when unique_violation then bloqueado := true;
  end;
  assert bloqueado and (select stock from public.products where id = v_p) = 5, 'un duplicado es 23505 y no descuenta';

  -- ON CONFLICT DO NOTHING: el INSERT se omite y no hay descuento.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i1', v_p, 'P', 2)
    on conflict (store_id, legacy_id) where legacy_id is not null do nothing;
  assert (select stock from public.products where id = v_p) = 5, 'ON CONFLICT DO NOTHING no descuenta';

  -- ON CONFLICT DO UPDATE tampoco descuenta otra vez.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i1', v_p, 'P', 2)
    on conflict (store_id, legacy_id) where legacy_id is not null do update set note = 'nota';
  assert (select stock from public.products where id = v_p) = 5, 'ON CONFLICT DO UPDATE no descuenta';
  assert (select stock_applied_qty from public.sale_items where id = v_item) = 2, 'lo aplicado sigue igual';

  -- Saldo negativo: sin clamp.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i4', v_p, 'P', 8);
  assert (select stock from public.products where id = v_p) = -3, 'el faltante queda como saldo negativo';

  -- Valores no numéricos: rechazados.
  bloqueado := false;
  begin
    update public.products set stock = 'NaN' where id = v_p;
  exception when check_violation then bloqueado := true;
  end;
  assert bloqueado, 'stock NaN: rechazado';

  -- Ilimitado.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i5', v_ilim, 'Ilimitado', 3);
  assert (select stock from public.products where id = v_ilim) = 7, 'ilimitado no descuenta';
  assert (select stock_applied_qty = 0 and stock_applied_reason = 'unlimited' from public.sale_items
           where store_id = v_a and legacy_id = 'i5'), 'ilimitado: motivo';

  -- legacy_id NULL o vacío: sin identidad, sin descuento.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, null, v_otro, 'Otro', 1) returning id into v_hist;
  assert (select stock from public.products where id = v_otro) = 10, 'legacy_id NULL no descuenta';
  assert (select stock_applied_reason from public.sale_items where id = v_hist) = 'no_identity', 'legacy_id NULL: motivo';

  -- Producto sin resolver.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_name, quantity)
    values (v_a, v_sale, 'i6', 'Sin producto', 1);
  assert (select stock_applied_qty = 0 and stock_applied_reason = 'unresolved' from public.sale_items
           where store_id = v_a and legacy_id = 'i6'), 'sin producto: motivo';

  -- Resolución en el servidor dentro del mismo local.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_name, quantity, metadata)
    values (v_a, v_sale, 'i7', 'Legacy', 1, '{"product_legacy_id":"prod_legacy"}');
  insert into public.sale_items (store_id, sale_id, legacy_id, product_name, quantity, metadata)
    values (v_a, v_sale, 'i8', 'Legacy', 1, '{"prodId":"prod_legacy"}');
  assert (select stock from public.products where id = v_leg) = 8, 'resuelve por product_legacy_id y por prodId';

  -- Aislamiento por local: nunca toca un producto de otro.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i9', v_pb, 'De B', 1);
  assert (select stock from public.products where id = v_pb) = 10, 'producto de otro local: no descuenta';
  assert (select stock_applied_reason from public.sale_items where store_id = v_a and legacy_id = 'i9') = 'store_mismatch', 'motivo';
  insert into public.sale_items (store_id, sale_id, legacy_id, product_name, quantity, metadata)
    values (v_b, v_sale_b, 'i10', 'Legacy', 1, '{"prodId":"prod_legacy"}');
  assert (select product_id from public.sale_items where store_id = v_b and legacy_id = 'i10') is null,
    'la resolución no cruza de local';

  -- Campos del servidor: lo que mande el cliente se descarta.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity, stock_applied_qty, stock_applied_reason)
    values (v_a, v_sale, 'i11', v_otro, 'Otro', 1, 999, 'unlimited');
  assert (select stock_applied_qty = 1 and stock_applied_reason = 'applied' from public.sale_items
           where store_id = v_a and legacy_id = 'i11'), 'un valor falsificado se reemplaza';
  assert (select stock from public.products where id = v_otro) = 9, 'descuenta la cantidad real';

  -- Inmutabilidad.
  bloqueado := false;
  begin update public.sale_items set quantity = 1 where id = v_item;
  exception when raise_exception then bloqueado := true; end;
  assert bloqueado, 'quantity es inmutable';
  bloqueado := false;
  begin update public.sale_items set product_id = v_otro where id = v_item;
  exception when raise_exception then bloqueado := true; end;
  assert bloqueado, 'product_id es inmutable';
  bloqueado := false;
  begin update public.sale_items set legacy_id = 'otro' where id = v_item;
  exception when raise_exception then bloqueado := true; end;
  assert bloqueado, 'legacy_id es inmutable';
  bloqueado := false;
  begin update public.sale_items set stock_applied_qty = 0 where id = v_item;
  exception when raise_exception then bloqueado := true; end;
  assert bloqueado, 'stock_applied_qty es inmutable';
  update public.sale_items set metadata = metadata || '{"manual_test":true}' where id = v_item;
  assert (select metadata->>'manual_test' from public.sale_items where id = v_item) = 'true', 'metadata sigue editable';

  -- Ítem anterior al modelo: sin movimiento y sin cambios de comportamiento.
  alter table public.sale_items disable trigger sale_items_stock_apply;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'hist', v_otro, 'Otro', 1) returning id into v_hist;
  alter table public.sale_items enable trigger sale_items_stock_apply;
  update public.sale_items set quantity = 5 where id = v_hist;
  assert (select stock from public.products where id = v_otro) = 9, 'un ítem histórico no mueve stock';

  -- FK: borrar el producto deja el ítem con product_id NULL y conserva lo aplicado.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i12', v_borrar, 'Borrar', 1) returning id into v_hist;
  delete from public.products where id = v_borrar;
  assert (select product_id is null and stock_applied_qty = 1 from public.sale_items where id = v_hist), 'SET NULL permitido';

  -- Compensación: decisión C pendiente. Hoy un DELETE no restaura unidades, directo ni en cascada.
  update public.products set stock = 10 where id = v_otro;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i13', v_otro, 'Otro', 2) returning id into v_hist;
  delete from public.sale_items where id = v_hist;
  assert (select stock from public.products where id = v_otro) = 8, 'DELETE no restaura unidades';
  delete from public.sales where id = v_sale;
  assert (select stock from public.products where id = v_otro) = 8, 'la cascada no restaura unidades';
  insert into public.sales (store_id, business_date, sold_at) values (v_a, current_date, now()) returning id into v_sale;

  -- Conteo físico: la hora es siempre la del servidor, y un movimiento no la cambia.
  update public.products set stock_counted_at = '2000-01-01' where id = v_otro;
  select stock_counted_at into v_ts from public.products where id = v_otro;
  assert v_ts = now(), 'el conteo se sella con la hora del servidor';
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i14', v_otro, 'Otro', 1);
  assert (select stock_counted_at from public.products where id = v_otro) = v_ts, 'un movimiento no mueve el conteo';

  -- Fallos transaccionales: ni ítem ni descuento.
  n := (select stock from public.products where id = v_otro);
  bloqueado := false;
  begin
    insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
      values (v_a, gen_random_uuid(), 'i15', v_otro, 'Otro', 1);
  exception when foreign_key_violation then bloqueado := true;
  end;
  assert bloqueado and (select stock from public.products where id = v_otro) = n, 'FK inválida: no descuenta';
  assert not exists (select 1 from public.sale_items where store_id = v_a and legacy_id = 'i15'), 'FK inválida: sin ítem';

  -- Rol operador: inserta y descuenta sin permiso de UPDATE sobre products.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i16', v_otro, 'Otro', 1);
  execute 'reset role';
  assert (select stock from public.products where id = v_otro) = n - 1, 'el operador descuenta por el trigger';
  execute 'set local role authenticated';
  update public.products set stock = 999 where id = v_otro;
  get diagnostics n = row_count;
  assert n = 0, 'el operador no puede escribir products: RLS devuelve 0 filas';
  bloqueado := false;
  begin update public.sale_items set quantity = 9 where store_id = v_a and legacy_id = 'i16';
  exception when raise_exception then bloqueado := true; end;
  assert bloqueado, 'el operador no puede cambiar la cantidad';
  execute 'reset role';

  raise notice 'stock_durability_test: OK';
end;
$$;

rollback;
