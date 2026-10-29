-- Pruebas de open_order_items_store_isolation.sql. Corre en una transacción que termina en ROLLBACK.
-- Crea dos locales sintéticos (A y B) con una mesa e ítem cada uno, hace a un usuario existente miembro solo de A y
-- ejecuta las consultas como ese usuario (rol authenticated + su identidad), con las políticas RLS reales.
-- Ejecutar como postgres, solo en un entorno de pruebas, con la migración aplicada.

begin;

do $$
declare
  v_user uuid;
  v_a uuid; v_b uuid;
  v_oa uuid; v_ob uuid;
  v_ia uuid; v_ib uuid;
  v_vb bigint; v_va bigint;
  n int;
  r jsonb;
  bloqueado boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'hace falta un usuario existente';

  insert into public.stores (name, slug) values ('Aislamiento A', 'aislamiento-a-' || gen_random_uuid()) returning id into v_a;
  insert into public.stores (name, slug) values ('Aislamiento B', 'aislamiento-b-' || gen_random_uuid()) returning id into v_b;
  insert into public.store_users (store_id, user_id, role, active) values (v_a, v_user, 'operator', true);
  insert into public.open_orders (store_id, label) values (v_a, 'Mesa A') returning id into v_oa;
  insert into public.open_orders (store_id, label) values (v_b, 'Mesa B') returning id into v_ob;
  insert into public.open_order_items (store_id, open_order_id, product_name, quantity, unit_price, line_total)
    values (v_a, v_oa, 'Item A', 1, 100, 100) returning id into v_ia;
  insert into public.open_order_items (store_id, open_order_id, product_name, quantity, unit_price, line_total)
    values (v_b, v_ob, 'Item B', 1, 100, 100) returning id into v_ib;
  select items_version into v_vb from public.open_orders where id = v_ob;

  -- Desde acá, como el usuario (miembro solo del local A).
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- Entre locales: todo rechazado.
  bloqueado := false;
  begin
    insert into public.open_order_items (store_id, open_order_id, product_name, quantity, unit_price, line_total)
      values (v_a, v_ob, 'Intruso', 1, 1, 1);
  exception when foreign_key_violation or insufficient_privilege then bloqueado := true;
  end;
  assert bloqueado, 'ítem del local A en una mesa del local B: debe rechazarse';

  bloqueado := false;
  begin
    insert into public.open_order_items (store_id, open_order_id, product_name, quantity, unit_price, line_total)
      values (v_b, v_ob, 'Intruso', 1, 1, 1);
  exception when insufficient_privilege then bloqueado := true;
  end;
  assert bloqueado, 'ítem del local B en una mesa del local B: debe rechazarse';

  select count(*) into n from public.open_order_items where open_order_id = v_ob or id = v_ib;
  assert n = 0, 'no se leen ítems de mesas del local B';

  update public.open_order_items set quantity = 9 where id = v_ib;
  get diagnostics n = row_count;
  assert n = 0, 'no se modifican ítems del local B';

  delete from public.open_order_items where id = v_ib;
  get diagnostics n = row_count;
  assert n = 0, 'no se borran ítems del local B';

  bloqueado := false;
  begin
    update public.open_order_items set open_order_id = v_ob where id = v_ia;
  exception when foreign_key_violation or insufficient_privilege then bloqueado := true;
  end;
  assert bloqueado, 'mover un ítem propio a una mesa del local B: debe rechazarse';

  r := public.replace_open_order_items(v_ob, v_vb, '[{"product_name":"Intruso","quantity":1,"unit_price":1}]');
  assert r->>'reason' = 'not_found', 'replace_open_order_items no alcanza mesas del local B: ' || r::text;

  -- Dentro del mismo local: todo permitido.
  insert into public.open_order_items (store_id, open_order_id, product_name, quantity, unit_price, line_total)
    values (v_a, v_oa, 'Item A2', 2, 50, 100);
  select count(*) into n from public.open_order_items where open_order_id = v_oa;
  assert n = 2, 'se leen los ítems propios';
  update public.open_order_items set quantity = 3 where id = v_ia;
  get diagnostics n = row_count;
  assert n = 1, 'se modifican los ítems propios';
  select items_version into v_va from public.open_orders where id = v_oa;
  r := public.replace_open_order_items(v_oa, v_va, '[{"product_name":"Espresso","quantity":2,"unit_price":2700}]');
  assert (r->>'ok')::boolean and (r->>'version')::bigint > v_va, 'replace_open_order_items en la mesa propia: ' || r::text;
  delete from public.open_order_items where open_order_id = v_oa;
  get diagnostics n = row_count;
  assert n = 1, 'se borran los ítems propios';

  -- De vuelta como postgres: la mesa del local B quedó intacta.
  execute 'reset role';
  select count(*) into n from public.open_order_items where open_order_id = v_ob;
  assert n = 1, 'la mesa del local B conserva su único ítem';
  assert (select quantity from public.open_order_items where id = v_ib) = 1, 'el ítem del local B no cambió';
  assert (select items_version from public.open_orders where id = v_ob) = v_vb, 'la versión de la mesa del local B no cambió';

  raise notice 'open_order_items_store_isolation_test: OK';
end;
$$;

rollback;
