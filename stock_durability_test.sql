-- Pruebas de stock_durability.sql. Corre en una transacción que termina en ROLLBACK: crea dos locales sintéticos y no deja nada.
-- Ejecutar como postgres, solo en un entorno de pruebas con la migración aplicada. NO EJECUTADAS todavía.
-- now() es fijo dentro de la transacción: los casos de tiempo fijan el corte y las cabeceras con valores relativos a now().

begin;

do $$
declare
  v_user uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_pd uuid; v_sd uuid; v_item_d uuid;
  v_sale uuid; v_sale_b uuid;
  v_p uuid; v_otro uuid; v_ilim uuid; v_leg uuid; v_borrar uuid; v_pb uuid;
  v_item uuid; v_hist uuid;
  v_ts timestamptz;
  v_old_sale uuid; v_ctid tid; v_res jsonb;
  n int;
  bloqueado boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'hace falta un usuario existente';

  insert into public.stores (name, slug) values ('Stock A', 'stock-a-' || gen_random_uuid()) returning id into v_a;
  insert into public.stores (name, slug) values ('Stock B', 'stock-b-' || gen_random_uuid()) returning id into v_b;
  insert into public.stores (name, slug) values ('Stock C', 'stock-c-' || gen_random_uuid()) returning id into v_c;
  insert into public.store_users (store_id, user_id, role, active) values (v_a, v_user, 'operator', true);
  insert into public.stock_store_activation (store_id, activated_at) values (v_a, now() - interval '1 day'), (v_b, now() - interval '1 day');
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

  -- C. Compensación: devuelve lo aplicado si el movimiento es posterior al corte, directo y en cascada, y deja registro.
  update public.products set stock = 10 where id = v_otro;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i13', v_otro, 'Otro', 2) returning id into v_hist;
  assert (select stock from public.products where id = v_otro) = 8, 'descuenta antes de borrar';
  delete from public.sale_items where id = v_hist;
  assert (select stock from public.products where id = v_otro) = 10, 'DELETE devuelve lo aplicado';
  assert (select delta = 2 and balance_after = 10 and kind = 'delete_compensation' from public.stock_ledger
           where store_id = v_a and sale_item_legacy_id = 'i13'), 'la compensación queda registrada';
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i13b', v_otro, 'Otro', 3);
  assert (select stock from public.products where id = v_otro) = 7, 'descuenta 3';
  delete from public.sales where id = v_sale;
  assert (select stock from public.products where id = v_otro) >= 10, 'la cascada también devuelve';
  update public.products set stock = 10 where id = v_otro;
  insert into public.sales (store_id, business_date, sold_at) values (v_a, current_date, now()) returning id into v_sale;

  -- C. Movimiento anterior al corte: un conteo posterior ya lo reflejó, devolverlo inventaría unidades.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i13c', v_otro, 'Otro', 1) returning id into v_hist;
  update public.products set stock_counted_at = now() + interval '1 hour', stock = 50 where id = v_otro;
  delete from public.sale_items where id = v_hist;
  assert (select stock from public.products where id = v_otro) = 50, 'anterior al conteo: no devuelve';
  assert (select kind = 'delete_no_compensation' and delta = 0 from public.stock_ledger
           where store_id = v_a and sale_item_legacy_id = 'i13c'), 'la no compensación también queda registrada';
  update public.products set stock_counted_at = null, stock = 10 where id = v_otro;

  -- C. Producto borrado: el ítem pierde el producto y su borrado no falla ni toca nada.
  insert into public.products (store_id, name, stock) values (v_a, 'Borrar2', 10) returning id into v_borrar;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'i13d', v_borrar, 'Borrar2', 1) returning id into v_hist;
  delete from public.products where id = v_borrar;
  delete from public.sale_items where id = v_hist;

  -- B. Ilimitado: ni saldo ni UPDATE sobre el producto, tampoco al borrar. La huella de R-B2a (stock, updated_at) no se mueve.
  select ctid into v_ctid from public.products where id = v_ilim;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_sale, 'b1', v_ilim, 'Ilimitado', 3) returning id into v_hist;
  delete from public.sale_items where id = v_hist;
  assert (select ctid from public.products where id = v_ilim) = v_ctid, 'ilimitado: el producto no recibió ningún UPDATE';
  -- B. Forma del ejecutor congelado: sin producto. Tampoco lo toca, y sin stock_ledger.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_name, quantity, metadata)
    values (v_a, v_sale, 'b2', 'R2A fixture', 1, '{"prodId":null,"product_legacy_id":null}') returning id into v_hist;
  assert (select stock_applied_reason from public.sale_items where id = v_hist) = 'unresolved', 'fixture sin producto: sin movimiento';
  delete from public.sale_items where id = v_hist;
  assert not exists (select 1 from public.stock_ledger where sale_item_legacy_id = 'b2'), 'fixture sin producto: sin registro';

  -- A. Venta tardía respecto del conteo. Corte: hace una hora. Como postgres, created_at se puede fijar; un cliente no (ver abajo).
  update public.products set stock = 100, stock_counted_at = now() - interval '1 hour' where id = v_otro;
  select stock_counted_at into v_ts from public.products where id = v_otro;
  -- En línea y con el reloj sano, después del corte: descuenta.
  insert into public.sales (store_id, business_date, sold_at) values (v_a, current_date, now()) returning id into v_old_sale;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_old_sale, 'a1', v_otro, 'Otro', 1);
  assert (select stock_applied_reason from public.sale_items where store_id = v_a and legacy_id = 'a1') = 'applied', 'en línea y después: descuenta';
  -- Venta parcial que cruza el conteo: cabecera antes, ítem después, y el reloj coincide. Ya estaba vendida.
  insert into public.sales (store_id, business_date, sold_at, created_at)
    values (v_a, current_date, now() - interval '2 hours', now() - interval '2 hours') returning id into v_old_sale;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_old_sale, 'a2', v_otro, 'Otro', 1);
  assert (select stock_applied_reason = 'before_count' and stock_applied_qty = 0 from public.sale_items
           where store_id = v_a and legacy_id = 'a2'), 'parcial que cruza, con reloj coherente: anterior';
  -- La misma parcial con el reloj adelantado o atrasado: la cabecera sola no prueba nada.
  insert into public.sales (store_id, business_date, sold_at, created_at)
    values (v_a, current_date, now(), now() - interval '2 hours') returning id into v_old_sale;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_old_sale, 'a3', v_otro, 'Otro', 1);
  assert (select stock_applied_reason from public.sale_items where store_id = v_a and legacy_id = 'a3') = 'count_review', 'parcial, reloj adelantado';
  insert into public.sales (store_id, business_date, sold_at, created_at)
    values (v_a, current_date, now() - interval '5 hours', now() - interval '2 hours') returning id into v_old_sale;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_old_sale, 'a4', v_otro, 'Otro', 1);
  assert (select stock_applied_reason from public.sale_items where store_id = v_a and legacy_id = 'a4') = 'count_review', 'parcial, reloj atrasado';
  -- Recibida después del corte con un reloj que no coincide: venta sin conexión o reloj desviado. sold_at solo no decide, en ninguna dirección.
  insert into public.sales (store_id, business_date, sold_at) values (v_a, current_date, now() - interval '3 hours') returning id into v_old_sale;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_old_sale, 'a5', v_otro, 'Otro', 1);
  assert (select stock_applied_reason = 'count_review' and stock_applied_qty = 0 from public.sale_items
           where store_id = v_a and legacy_id = 'a5'), 'reloj atrasado o sin conexión: a revisar, no anterior';
  insert into public.sales (store_id, business_date, sold_at) values (v_a, current_date, now() + interval '3 hours') returning id into v_old_sale;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_old_sale, 'a6', v_otro, 'Otro', 1);
  assert (select stock_applied_reason from public.sale_items where store_id = v_a and legacy_id = 'a6') = 'count_review', 'reloj adelantado: a revisar, no aplicado';
  -- La metadata no es evidencia: declarar un corte visto no cambia el resultado.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity, metadata)
    values (v_a, v_old_sale, 'a7', v_otro, 'Otro', 1, jsonb_build_object('stock_cut_seen', v_ts, 'stock_client_mode', 'server'));
  assert (select stock_applied_reason from public.sale_items where store_id = v_a and legacy_id = 'a7') = 'count_review', 'metadata ignorada';
  -- Coherente, pero recibida en los 5 minutos que siguen al corte.
  insert into public.sales (store_id, business_date, sold_at, created_at)
    values (v_a, current_date, v_ts + interval '1 minute', v_ts + interval '1 minute') returning id into v_old_sale;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_old_sale, 'a8', v_otro, 'Otro', 1);
  assert (select stock_applied_reason = 'count_review' and stock_applied_qty = 0 from public.sale_items
           where store_id = v_a and legacy_id = 'a8'), 'dentro del margen: no descuenta y queda para revisar';
  assert (select stock from public.products where id = v_otro) = 99, 'solo descontó a1: sin doble descuento';
  -- La activación es un corte aunque el producto nunca se haya contado. Sigue siendo la misma regla.
  insert into public.sales (store_id, business_date, sold_at, created_at)
    values (v_a, current_date, now() - interval '2 days', now() - interval '2 days') returning id into v_old_sale;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_a, v_old_sale, 'a9', v_leg, 'Legacy', 1);
  assert (select stock_applied_reason from public.sale_items where store_id = v_a and legacy_id = 'a9') = 'before_count', 'anterior a la activación';
  -- Un cliente no elige la recepción, ni al insertar ni después.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.sales (store_id, business_date, sold_at, created_at)
    values (v_a, current_date, now(), now() - interval '10 days') returning id into v_old_sale;
  execute 'reset role';
  assert (select created_at >= now() from public.sales where id = v_old_sale), 'INSERT: created_at lo pone el servidor';
  execute 'set local role authenticated';
  update public.sales set created_at = now() - interval '10 days' where id = v_old_sale;
  execute 'reset role';
  assert (select created_at >= now() from public.sales where id = v_old_sale), 'UPDATE: created_at no cambia';

  -- G. Local sin activar: registra y no descuenta. Los clientes de hoy siguen funcionando.
  insert into public.products (store_id, name, stock) values (v_c, 'C', 10) returning id into v_pb;
  insert into public.sales (store_id, business_date, sold_at) values (v_c, current_date, now()) returning id into v_sale_b;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_c, v_sale_b, 'g1', v_pb, 'C', 2);
  assert (select stock_applied_reason = 'inactive' and stock_applied_qty = 0 from public.sale_items
           where store_id = v_c and legacy_id = 'g1'), 'sin activar: motivo';
  assert (select stock from public.products where id = v_pb) = 10, 'sin activar: no descuenta';

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

  -- D/F. Vía única de ajuste. El operador no puede.
  update public.products set stock = 10, stock_counted_at = null where id = v_otro;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  bloqueado := false;
  begin perform public.stock_apply_adjustment(v_a, v_otro, 'count', 10, 5);
  exception when insufficient_privilege then bloqueado := true; end;
  assert bloqueado, 'el operador no puede contar';
  execute 'reset role';
  update public.store_users set role = 'owner' where store_id = v_a and user_id = v_user;
  insert into public.store_users (store_id, user_id, role, active) values (v_c, v_user, 'owner', true);
  execute 'set local role authenticated';
  -- Conteo: fija el saldo y mueve el corte, con la hora del servidor.
  v_res := public.stock_apply_adjustment(v_a, v_otro, 'count', 10, 20);
  assert (v_res->>'ok')::boolean and (v_res->>'stock')::numeric = 20, 'conteo aplicado';
  assert (select stock = 20 and stock_counted_at >= now() from public.products where id = v_otro), 'el conteo mueve el corte';
  -- Ajuste ±: relativo, no mueve el corte.
  execute 'reset role';
  update public.products set stock_counted_at = now() - interval '1 hour' where id = v_otro;
  select stock_counted_at into v_ts from public.products where id = v_otro;
  execute 'set local role authenticated';
  v_res := public.stock_apply_adjustment(v_a, v_otro, 'adjust', 20, -3);
  assert (v_res->>'stock')::numeric = 17, 'ajuste aplicado';
  assert (select stock_counted_at from public.products where id = v_otro) = v_ts, 'el ajuste no mueve el corte';
  -- Compare-and-set.
  v_res := public.stock_apply_adjustment(v_a, v_otro, 'adjust', 20, 1);
  assert v_res->>'code' = 'conflict' and (v_res->>'stock')::numeric = 17, 'saldo cambiado: conflicto';
  assert (select stock from public.products where id = v_otro) = 17, 'el conflicto no escribe';
  -- Entradas inválidas y estados que no admiten ajuste.
  bloqueado := false;
  begin perform public.stock_apply_adjustment(v_a, v_otro, 'count', 17, -1);
  exception when invalid_parameter_value then bloqueado := true; end;
  assert bloqueado, 'un conteo no puede ser negativo';
  bloqueado := false;
  begin perform public.stock_apply_adjustment(v_a, v_otro, 'adjust', 17, 'NaN');
  exception when invalid_parameter_value then bloqueado := true; end;
  assert bloqueado, 'NaN rechazado';
  assert public.stock_apply_adjustment(v_a, v_ilim, 'count', 7, 8)->>'code' = 'unlimited', 'ilimitado no se ajusta';
  assert public.stock_apply_adjustment(v_a, v_pb, 'count', 10, 8)->>'code' = 'not_found', 'producto de otro local';
  assert public.stock_apply_adjustment(v_c, v_pb, 'count', 10, 8)->>'code' = 'inactive', 'local sin activar';
  -- G. Cliente viejo con un local activado: su escritura directa falla. Lo demás sigue.
  bloqueado := false;
  begin update public.products set stock = 999 where id = v_otro;
  exception when raise_exception then bloqueado := sqlerrm like 'STOCK_DIRECT_WRITE%'; end;
  assert bloqueado, 'escritura directa rechazada en un local activado';
  bloqueado := false;
  begin update public.products set stock_counted_at = '2000-01-01' where id = v_otro;
  exception when raise_exception then bloqueado := sqlerrm like 'STOCK_DIRECT_WRITE%'; end;
  assert bloqueado, 'el corte no se escribe desde un cliente';
  update public.products set name = 'Otro nombre', stock = 17 where id = v_otro;
  get diagnostics n = row_count;
  assert n = 1, 'editar con el mismo saldo pasa: eso manda un cliente viejo al renombrar';
  -- G. Local sin activar: el cliente de hoy sigue escribiendo.
  update public.products set stock = 11 where id = v_pb;
  get diagnostics n = row_count;
  assert n = 1, 'sin activar: la escritura directa sigue';
  -- Un producto nuevo no trae corte de un cliente.
  insert into public.products (store_id, name, stock, stock_counted_at) values (v_a, 'Nuevo', 4, '2000-01-01') returning id into v_p;
  assert (select stock = 4 and stock_counted_at is null from public.products where id = v_p), 'INSERT: stock inicial sí, corte no';
  -- Ni el registro ni la activación se escriben desde un cliente; se pueden leer.
  bloqueado := false;
  begin insert into public.stock_store_activation (store_id) values (v_c);
  exception when insufficient_privilege then bloqueado := true; end;
  assert bloqueado, 'un cliente no activa';
  bloqueado := false;
  begin delete from public.stock_ledger;
  exception when insufficient_privilege then bloqueado := true; end;
  assert bloqueado, 'un cliente no borra el registro';
  assert exists (select 1 from public.stock_ledger where store_id = v_a and kind = 'count'), 'un miembro lee el registro';
  execute 'reset role';
  -- E. Incidencias: el motivo se puede listar por local.
  assert (select count(*) from public.sale_items where store_id = v_a
           and stock_applied_reason in ('unresolved', 'store_mismatch', 'count_review', 'no_identity')) >= 3, 'incidencias visibles';

  -- Evasión: owner de los dos locales intenta sacar el producto del activado, escribir el saldo y devolverlo.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  n := (select stock from public.products where id = v_otro);
  bloqueado := false;
  begin update public.products set store_id = v_c where id = v_otro;
  exception when raise_exception then bloqueado := sqlerrm like 'STOCK_STORE_IMMUTABLE%'; end;
  assert bloqueado, 'activado a inactivo: rechazado';
  bloqueado := false;
  begin update public.products set store_id = v_c, stock = 999 where id = v_otro;
  exception when raise_exception then bloqueado := sqlerrm like 'STOCK_STORE_IMMUTABLE%'; end;
  assert bloqueado, 'traslado junto con el saldo: rechazado';
  bloqueado := false;
  begin update public.products set store_id = v_a where id = v_pb;
  exception when raise_exception then bloqueado := sqlerrm like 'STOCK_STORE_IMMUTABLE%'; end;
  assert bloqueado, 'inactivo a activado: rechazado también';
  assert (select store_id = v_a and stock = n from public.products where id = v_otro), 'el producto no se movió y el saldo sigue igual';
  update public.products set name = 'Sin traslado', store_id = v_a where id = v_otro;
  get diagnostics n = row_count;
  assert n = 1, 'mandar el mismo store_id, como hace el cliente al guardar, sigue pasando';
  execute 'reset role';
  -- Una operación interna legítima no es un cliente.
  update public.products set store_id = v_c where id = v_otro;
  update public.products set store_id = v_a where id = v_otro;

  -- G. Transición. Local propio, con el usuario como owner.
  insert into public.stores (name, slug) values ('Stock D', 'stock-d-' || gen_random_uuid()) returning id into v_d;
  insert into public.store_users (store_id, user_id, role, active) values (v_d, v_user, 'owner', true);
  insert into public.stock_store_activation (store_id) values (v_d);
  insert into public.products (store_id, name, stock) values (v_d, 'D', 10) returning id into v_pd;
  select activated_at into v_ts from public.stock_store_activation where store_id = v_d;
  -- Una venta aplicada, anterior a la transición: la cabecera 10 minutos después de la activación para que descuente.
  insert into public.sales (store_id, business_date, sold_at, created_at)
    values (v_d, current_date, clock_timestamp() + interval '10 minutes', clock_timestamp() + interval '10 minutes') returning id into v_sd;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_d, v_sd, 'd1', v_pd, 'D', 1) returning id into v_item_d;
  assert (select stock from public.products where id = v_pd) = 9, 'activo: descuenta';
  -- No hay atajo para apagar el modelo.
  bloqueado := false;
  begin update public.stock_store_activation set status = 'deactivated' where store_id = v_d;
  exception when raise_exception then bloqueado := sqlerrm like 'STOCK_TRANSITION%'; end;
  assert bloqueado, 'de active a deactivated no se puede';
  bloqueado := false;
  begin delete from public.stock_store_activation where store_id = v_d;
  exception when raise_exception then bloqueado := sqlerrm like 'STOCK_TRANSITION%'; end;
  assert bloqueado, 'borrar la fila no desactiva';
  -- Pausa: nada entra, y sigue sin haber escrituras de stock.
  update public.stock_store_activation set status = 'sales_paused' where store_id = v_d;
  assert (select paused_at is not null from public.stock_store_activation where store_id = v_d), 'pausa sellada';
  bloqueado := false;
  begin insert into public.sales (store_id, business_date, sold_at) values (v_d, current_date, now());
  exception when object_not_in_prerequisite_state then bloqueado := sqlerrm like 'STOCK_SALES_PAUSED%'; end;
  assert bloqueado, 'pausa: una cabecera nueva se rechaza';
  bloqueado := false;
  begin insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
          values (v_d, v_sd, 'd2', v_pd, 'D', 1);
  exception when object_not_in_prerequisite_state then bloqueado := sqlerrm like 'STOCK_SALES_PAUSED%'; end;
  assert bloqueado, 'pausa: el ítem de una venta parcial se rechaza';
  assert not exists (select 1 from public.sale_items where store_id = v_d and legacy_id = 'd2'), 'pausa: sin ítem';
  assert (select stock from public.products where id = v_pd) = 9, 'pausa: sin movimiento';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert public.stock_apply_adjustment(v_d, v_pd, 'adjust', 9, 1)->>'code' = 'inactive', 'pausa: sin ajustes';
  bloqueado := false;
  begin update public.products set stock = 1 where id = v_pd;
  exception when raise_exception then bloqueado := sqlerrm like 'STOCK_DIRECT_WRITE%'; end;
  assert bloqueado, 'pausa: sin escritura directa';
  execute 'reset role';
  -- Abortar la pausa no mueve el corte.
  update public.stock_store_activation set status = 'active' where store_id = v_d;
  assert (select status = 'active' and paused_at is null and activated_at = v_ts from public.stock_store_activation where store_id = v_d), 'pausa abortada';
  update public.stock_store_activation set status = 'sales_paused' where store_id = v_d;
  update public.stock_store_activation set status = 'deactivated' where store_id = v_d;
  select deactivated_at into v_ts from public.stock_store_activation where store_id = v_d;
  assert v_ts is not null, 'desactivación sellada';
  -- Desactivado: un cliente que se cree en modo servidor deja incidencia, nunca un descuento perdido en silencio.
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity, metadata)
    values (v_d, v_sd, 'd3', v_pd, 'D', 1, '{"stock_client_mode":"server"}');
  assert (select stock_applied_reason = 'transition_review' and stock_applied_qty = 0 from public.sale_items
           where store_id = v_d and legacy_id = 'd3'), 'cliente en modo anterior: a conciliar';
  -- Venta del régimen anterior que llega después, aunque no declare nada.
  insert into public.sales (store_id, business_date, sold_at, created_at) values (v_d, current_date, now() - interval '1 hour', now() - interval '1 hour') returning id into v_sd;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_d, v_sd, 'd4', v_pd, 'D', 1);
  assert (select stock_applied_reason from public.sale_items where store_id = v_d and legacy_id = 'd4') = 'transition_review', 'venta anterior: a conciliar';
  -- Venta de modo local, posterior: el dispositivo descontó. Sin incidencia.
  insert into public.sales (store_id, business_date, sold_at, created_at) values (v_d, current_date, v_ts + interval '1 minute', v_ts + interval '1 minute') returning id into v_sd;
  insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
    values (v_d, v_sd, 'd5', v_pd, 'D', 1);
  assert (select stock_applied_reason from public.sale_items where store_id = v_d and legacy_id = 'd5') = 'inactive', 'modo local: sin incidencia';
  assert (select stock from public.products where id = v_pd) = 9, 'desactivado: el servidor no mueve el saldo';
  -- Desactivado: borrar no compensa, pero queda en el registro. Las escrituras directas vuelven a estar permitidas.
  delete from public.sale_items where id = v_item_d;
  assert (select stock from public.products where id = v_pd) = 9 and (select kind = 'delete_no_compensation' from public.stock_ledger
           where store_id = v_d and sale_item_legacy_id = 'd1'), 'desactivado: sin compensación y con registro';
  execute 'set local role authenticated';
  update public.products set stock = 8 where id = v_pd;
  get diagnostics n = row_count;
  assert n = 1, 'desactivado: el cliente en modo local escribe';
  assert exists (select 1 from public.stock_store_activation where store_id = v_d and status = 'deactivated'), 'un miembro ve el estado';
  -- E. Las incidencias siguen consultables después de desactivar, sin importar su antigüedad.
  assert (select count(*) from public.sale_items where store_id = v_d and stock_applied_reason = 'transition_review') = 2, 'incidencias tras desactivar';
  bloqueado := false;
  begin update public.stock_store_activation set status = 'active' where store_id = v_d;
  exception when insufficient_privilege then bloqueado := true; end;
  assert bloqueado, 'un cliente no cambia el estado';
  execute 'reset role';
  -- Reactivar marca un corte nuevo.
  update public.stock_store_activation set status = 'active' where store_id = v_d;
  assert (select status = 'active' and deactivated_at is null and activated_at > v_ts from public.stock_store_activation where store_id = v_d), 'reactivación con corte nuevo';
  -- Una cascada desde stores sí puede llevarse la fila.
  update public.stock_store_activation set activated_by = 'prueba' where store_id = v_d;
  delete from public.stores where id = v_d;
  assert not exists (select 1 from public.stock_store_activation where store_id = v_d), 'cascada permitida';

  raise notice 'stock_durability_test: OK';
end;
$$;

rollback;
