-- Pruebas de open_orders_items_version.sql. Corre en una transacción que termina en ROLLBACK:
-- crea un local y una mesa sintéticos, ejercita la función y no deja nada guardado.
-- Ejecutar como postgres, solo en un entorno de pruebas con la migración aplicada.

begin;

do $$
declare
  v_store uuid;
  v_order uuid;
  v_closed uuid;
  v_otro uuid;
  r jsonb;
  v1 bigint;
  v2 bigint;
  v3 bigint;
begin
  insert into public.stores (name, slug) values ('Prueba versionado', 'prueba-versionado-' || gen_random_uuid())
    returning id into v_store;
  insert into public.open_orders (store_id, label) values (v_store, 'Mesa prueba') returning id into v_order;
  insert into public.open_orders (store_id, label) values (v_store, 'Mesa cerrada') returning id into v_closed;
  update public.open_orders set status = 'closed', closed_at = now() where id = v_closed;

  assert (select items_version from public.open_orders where id = v_order) = 0, 'una mesa nueva arranca en versión 0';

  -- Reemplazo con la versión correcta.
  r := public.replace_open_order_items(v_order, 0,
    '[{"product_name":"Espresso","quantity":1,"unit_price":2700},{"product_name":"Medialuna","quantity":2,"unit_price":1200}]');
  assert (r->>'ok')::boolean, 'reemplazo con versión 0: ' || r::text;
  v1 := (r->>'version')::bigint;
  assert v1 > 0, 'la versión sube después del reemplazo';
  assert (select count(*) from public.open_order_items where open_order_id = v_order) = 2, 'quedan 2 ítems';
  assert (select store_id from public.open_order_items where open_order_id = v_order limit 1) = v_store,
    'el local de los ítems sale de la mesa';

  -- Un reintento con la versión vieja no escribe y devuelve lo actual.
  r := public.replace_open_order_items(v_order, 0, '[{"product_name":"Agua","quantity":1,"unit_price":1800}]');
  assert not (r->>'ok')::boolean and r->>'reason' = 'conflict', 'versión vieja = conflicto: ' || r::text;
  assert (r->>'version')::bigint = v1, 'el conflicto informa la versión actual';
  assert jsonb_array_length(r->'items') = 2, 'el conflicto devuelve los 2 ítems actuales';
  assert (select count(*) from public.open_order_items where open_order_id = v_order) = 2, 'el conflicto no tocó los ítems';
  assert (select items_version from public.open_orders where id = v_order) = v1, 'el conflicto no cambió la versión';

  -- Con la versión actual, reemplaza y sigue subiendo.
  r := public.replace_open_order_items(v_order, v1, '[{"product_name":"Agua","quantity":1,"unit_price":1800}]');
  assert (r->>'ok')::boolean, 'reemplazo con la versión actual: ' || r::text;
  v2 := (r->>'version')::bigint;
  assert v2 > v1, 'la versión sigue subiendo';
  assert (select count(*) from public.open_order_items where open_order_id = v_order) = 1, 'queda 1 ítem';

  -- Una escritura directa (cliente con la versión anterior) también sube la versión.
  insert into public.open_order_items (store_id, open_order_id, product_name, quantity, unit_price, line_total)
    values (v_store, v_order, 'Tostado', 1, 5500, 5500);
  v3 := (select items_version from public.open_orders where id = v_order);
  assert v3 > v2, 'una inserción directa sube la versión';
  r := public.replace_open_order_items(v_order, v2, '[]');
  assert r->>'reason' = 'conflict', 'tras una escritura directa, la versión anterior queda en conflicto';

  -- Una fila de otro local que apunta a esta mesa no mueve su versión.
  insert into public.stores (name, slug) values ('Prueba ajeno', 'prueba-ajeno-' || gen_random_uuid()) returning id into v_otro;
  insert into public.open_order_items (store_id, open_order_id, product_name, quantity, unit_price, line_total)
    values (v_otro, v_order, 'Ajeno', 1, 1, 1);
  assert (select items_version from public.open_orders where id = v_order) = v3, 'un ítem de otro local no sube la versión';
  delete from public.open_order_items where store_id = v_otro;
  assert (select items_version from public.open_orders where id = v_order) = v3, 'borrarlo tampoco';

  -- Lista vacía con la versión correcta: deja la mesa sin ítems.
  r := public.replace_open_order_items(v_order, v3, '[]');
  assert (r->>'ok')::boolean and (select count(*) from public.open_order_items where open_order_id = v_order) = 0,
    'lista vacía deja la mesa sin ítems';

  -- Mesa cerrada e inexistente: no se escribe nada.
  r := public.replace_open_order_items(v_closed, 0, '[{"product_name":"X","quantity":1,"unit_price":1}]');
  assert r->>'reason' = 'closed', 'mesa cerrada: ' || r::text;
  assert (select count(*) from public.open_order_items where open_order_id = v_closed) = 0, 'mesa cerrada sin ítems';
  r := public.replace_open_order_items(gen_random_uuid(), 0, '[]');
  assert r->>'reason' = 'not_found', 'mesa inexistente: ' || r::text;

  raise notice 'open_orders_items_version_test: OK';
end;
$$;

rollback;
