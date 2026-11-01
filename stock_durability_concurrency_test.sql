-- Pruebas de concurrencia de stock_durability.sql. Dos sesiones reales, a mano, en un entorno de pruebas. NO EJECUTADAS todavía.
-- Una transacción sola no puede demostrar esto. :store, :sale y :product son fixtures sintéticas de ese entorno, con stock 10,
-- el local activado en stock_store_activation y :sale creada después de la activación. Sesión C = dos ventanas como rol authenticated
-- con request.jwt.claims de un owner del local, para poder llamar a stock_apply_adjustment.

-- Caso 1: dos ventas simultáneas se suman.
--   Sesión A: begin;
--   Sesión A: insert into public.sale_items (store_id, sale_id, legacy_id, product_id, product_name, quantity)
--             values (:store, :sale, 'c1', :product, 'P', 2);
--   Sesión B: insert ... legacy_id 'c2', quantity 3;      -- espera el lock de la fila del producto
--   Sesión A: commit;
--   Esperado: B termina y stock = 5.

-- Caso 2: el mismo legacy_id en paralelo descuenta una vez.
--   Sesión A: begin; insert ... legacy_id 'c3', quantity 1;
--   Sesión B: insert ... legacy_id 'c3', quantity 1;      -- espera el índice único
--   Sesión A: commit;
--   Esperado: B recibe 23505 y el stock baja solo 1.

-- Caso 3: fallo por lock_timeout, sin estado intermedio.
--   Sesión A: begin; select 1 from public.products where id = :product for update;
--   Sesión B: insert ... legacy_id 'c4', quantity 1;      -- a los 3 s: 55P03
--   Sesión A: rollback;
--   Esperado: B falla, no existe el ítem 'c4' y el stock no cambió. Un reintento de B descuenta una sola vez.

-- Caso 4: una venta contra un ajuste. El compare-and-set ocurre bajo el lock.
--   Sesión A: begin; insert ... legacy_id 'c5', quantity 1;
--   Sesión C: select public.stock_apply_adjustment(:store, :product, 'adjust', <saldo leído>, 1);   -- espera
--   Sesión A: commit;
--   Esperado: C devuelve {ok:false, code:'conflict', stock:<saldo nuevo>}: no escribe y la venta no se pierde.

-- Caso 5: dos conteos simultáneos con el mismo saldo leído.
--   Sesión C1: begin; select public.stock_apply_adjustment(:store, :product, 'count', <saldo>, 50);
--   Sesión C2: select public.stock_apply_adjustment(:store, :product, 'count', <saldo>, 60);        -- espera
--   Sesión C1: commit;
--   Esperado: C2 devuelve conflict con stock 50. En stock_ledger, un solo 'count'.

-- Caso 6: venta tardía esperando detrás de un conteo. Lee el corte ya bajo el lock.
--   Sesión C: begin; select public.stock_apply_adjustment(:store, :product, 'count', <saldo>, 50);
--   Sesión A: insert ... sale_id de una cabecera creada ANTES del conteo, legacy_id 'c6', quantity 1;   -- espera
--   Sesión C: commit;
--   Esperado: 'c6' queda before_count con applied 0 y stock = 50.

-- Caso 7: borrar un ítem contra una venta: compensación y descuento se suman.
--   Sesión A: begin; delete from public.sale_items where store_id = :store and legacy_id = 'c1';   -- +2
--   Sesión B: insert ... legacy_id 'c7', quantity 1;                                               -- espera
--   Sesión A: commit;
--   Esperado: stock = anterior + 2 - 1, y un 'delete_compensation' en stock_ledger.

-- Caso 8: el corte de activación contra una venta en vuelo.
--   Con otro local sin activar. Sesión A: begin; insert del ítem;   -- queda 'inactive', sin lock de producto
--   Sesión D (postgres): insert into public.stock_store_activation (store_id) values (:store); commit;
--   Sesión A: commit;
--   Esperado: el ítem queda 'inactive' y no descuenta: es anterior al corte y el conteo inicial lo refleja. Sin doble descuento.

-- Caso 9: un cliente viejo en un local activado. Rol authenticated, owner del local.
--   update public.products set stock = 999 where id = :product;
--   Esperado: STOCK_DIRECT_WRITE, stock sin cambios. El mismo UPDATE con el mismo saldo, o de name, sí pasa.

select 'Guion manual: ejecutar los casos con dos sesiones' as stock_durability_concurrency_test;
