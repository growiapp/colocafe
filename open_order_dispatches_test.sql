-- Pruebas de open_order_dispatches.sql. Corre en una transacción que termina en ROLLBACK.
-- Dos locales sintéticos (A y B) con una mesa cada uno; un usuario existente, miembro solo de A, opera con las políticas
-- RLS reales (rol authenticated + su identidad). Ejecutar como postgres, solo en un entorno de pruebas.

begin;

do $$
declare
  v_user uuid;
  v_a uuid; v_b uuid; v_oa uuid; v_ob uuid; v_db uuid;
  n int;
  bloqueado boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  assert v_user is not null, 'hace falta un usuario existente';
  insert into public.stores (name, slug) values ('Comandas A', 'comandas-a-' || gen_random_uuid()) returning id into v_a;
  insert into public.stores (name, slug) values ('Comandas B', 'comandas-b-' || gen_random_uuid()) returning id into v_b;
  insert into public.store_users (store_id, user_id, role, active) values (v_a, v_user, 'operator', true);
  insert into public.open_orders (store_id, label) values (v_a, 'Mesa A') returning id into v_oa;
  insert into public.open_orders (store_id, label) values (v_b, 'Mesa B') returning id into v_ob;
  insert into public.open_order_dispatches (store_id, open_order_id, sector, seq, lines)
    values (v_b, v_ob, 'cocina', 1, '[{"firma":"x","cantidad":1}]') returning id into v_db;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- Mismo local: registrar comandas por sector, correlativas.
  insert into public.open_order_dispatches (store_id, open_order_id, sector, seq, lines, operator_name)
    values (v_a, v_oa, 'cocina', 1, '[{"firma":"tostado||","producto":"Tostado","cantidad":2}]', 'Prueba');
  insert into public.open_order_dispatches (store_id, open_order_id, sector, seq, lines)
    values (v_a, v_oa, 'cafeteria', 1, '[{"firma":"espresso||","producto":"Espresso","cantidad":1}]');
  insert into public.open_order_dispatches (store_id, open_order_id, sector, seq, lines)
    values (v_a, v_oa, 'cocina', 2, '[{"firma":"tostado||","producto":"Tostado","cantidad":-1}]');
  select count(*) into n from public.open_order_dispatches where open_order_id = v_oa;
  assert n = 3, 'se leen las comandas propias';
  assert (select created_by from public.open_order_dispatches where open_order_id = v_oa and seq = 1 and sector = 'cocina') = v_user,
    'queda quién la registró';

  -- Dos dispositivos confirmando la misma comanda: el segundo choca.
  bloqueado := false;
  begin
    insert into public.open_order_dispatches (store_id, open_order_id, sector, seq, lines) values (v_a, v_oa, 'cocina', 2, '[]');
  exception when unique_violation then bloqueado := true;
  end;
  assert bloqueado, 'una segunda comanda con el mismo número debe rechazarse';

  -- Son un registro: no se modifican ni se borran.
  bloqueado := false;
  begin
    update public.open_order_dispatches set lines = '[]' where open_order_id = v_oa;
  exception when insufficient_privilege then bloqueado := true;
  end;
  assert bloqueado, 'no se modifican comandas enviadas';
  bloqueado := false;
  begin
    delete from public.open_order_dispatches where open_order_id = v_oa;
  exception when insufficient_privilege then bloqueado := true;
  end;
  assert bloqueado, 'no se borran comandas enviadas';

  -- Otro local: ni se lee ni se escribe, tampoco colgando una comanda propia de una mesa ajena.
  select count(*) into n from public.open_order_dispatches where open_order_id = v_ob or id = v_db;
  assert n = 0, 'no se leen comandas de otro local';
  bloqueado := false;
  begin
    insert into public.open_order_dispatches (store_id, open_order_id, sector, seq, lines) values (v_b, v_ob, 'cocina', 2, '[]');
  exception when insufficient_privilege then bloqueado := true;
  end;
  assert bloqueado, 'no se registran comandas en otro local';
  bloqueado := false;
  begin
    insert into public.open_order_dispatches (store_id, open_order_id, sector, seq, lines) values (v_a, v_ob, 'cocina', 9, '[]');
  exception when foreign_key_violation or insufficient_privilege then bloqueado := true;
  end;
  assert bloqueado, 'una comanda del local A no puede colgar de una mesa del local B';

  bloqueado := false;
  begin
    insert into public.open_order_dispatches (store_id, open_order_id, sector, seq, lines) values (v_a, v_oa, 'cocina', 0, '[]');
  exception when check_violation then bloqueado := true;
  end;
  assert bloqueado, 'el número de comanda arranca en 1';

  execute 'reset role';
  assert (select count(*) from public.open_order_dispatches where open_order_id = v_ob) = 1, 'la comanda del local B quedó intacta';

  -- Borrar la mesa borra sus comandas.
  delete from public.open_orders where id = v_oa;
  assert not exists (select 1 from public.open_order_dispatches where open_order_id = v_oa), 'las comandas se van con su mesa';

  raise notice 'open_order_dispatches_test: OK';
end;
$$;

rollback;
