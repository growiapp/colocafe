-- Pruebas de concurrencia de stock_durability.sql. Dos sesiones reales, a mano, en un entorno de pruebas. NO EJECUTADAS todavía.
-- Una transacción sola no puede demostrar esto. :store, :sale y :product son fixtures sintéticas de ese entorno, con stock 10,
-- el local activado en stock_store_activation y :sale creada después de la activación. Sesión C = dos ventanas como rol authenticated
-- con request.jwt.claims de un owner del local, para poder llamar a stock_apply_adjustment.

-- :sale tiene created_at = sold_at = clock_timestamp() + '10 min' como postgres, para clasificar 'applied' sin esperar el margen.

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
--   Sesión A: insert ... sale_id de una cabecera con created_at y sold_at anteriores al conteo, legacy_id 'c6', quantity 1;   -- espera
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

-- Caso 8b: la pausa contra una venta en vuelo. Lo que entró antes del commit de la pausa queda bajo el régimen activo.
--   Sesión A: begin; insert ... legacy_id 'c8b', quantity 1;     -- leyó 'active' y descontó
--   Sesión D: update public.stock_store_activation set status = 'sales_paused' where store_id = :store; -- commit, sin esperar a A
--   Sesión A: commit;
--   Esperado: 'c8b' aplicado y descontado una vez. Un ítem nuevo ya recibe 55000 STOCK_SALES_PAUSED, y un reintento posterior a la pausa no queda a medias.

-- Caso 8c: desactivar contra una venta en vuelo.
--   Sesión D: begin; update public.stock_store_activation set status = 'deactivated' where store_id = :store;  -- en sales_paused
--   Sesión A: insert ... legacy_id 'c8c', metadata {"stock_client_mode":"server"};   -- rechazada: todavía lee sales_paused
--   Sesión D: commit;
--   Sesión A: reintento del mismo legacy_id.
--   Esperado: 'transition_review', applied 0. La venta no se perdió, no descontó dos veces y queda a conciliar.

-- Caso 9: un cliente viejo en un local activado. Rol authenticated, owner del local.
--   update public.products set stock = 999 where id = :product;
--   Esperado: STOCK_DIRECT_WRITE, stock sin cambios. El mismo UPDATE con el mismo saldo, o de name, sí pasa.

-- ORDEN DE MOVIMIENTOS. Estos casos son la única prueba real del hallazgo: requieren transacciones superpuestas, y now() queda fijo en el begin.
-- Las cabeceras usan created_at y sold_at explícitos, varios minutos después del conteo, para que la venta clasifique como 'applied'.

-- Caso 10: la venta empieza antes que el conteo y toma el lock después.
--   Sesión A: begin; select now();                          -- fija el now() de A antes del conteo
--   Sesión C: select public.stock_apply_adjustment(:store, :product, 'count', <saldo>, 50);          -- commit inmediato
--   Sesión A: insert ... sale_id de una cabecera con created_at = sold_at = clock_timestamp() + '10 min', legacy_id 'c10', quantity 1;
--   Sesión A: commit;
--   Esperado: stock_applied_at > stock_counted_at, aunque el now() de A sea anterior. stock = 49.
--   Sesión C: delete from public.sale_items where store_id = :store and legacy_id = 'c10';
--   Esperado: stock = 50 y 'delete_compensation'. Con now() habría quedado 49 y 'delete_no_compensation': un movimiento real sin devolver.

-- Caso 11: el conteo empieza antes que la venta y toma el lock después.
--   Sesión C: begin; select now();
--   Sesión A: begin; insert ... legacy_id 'c11', quantity 1;   -- toma el lock; el saldo pasa a <s>
--   Sesión C: select public.stock_apply_adjustment(:store, :product, 'count', <s>, 70);              -- espera
--   Sesión A: commit;
--   Sesión C: commit;
--   Esperado: stock_counted_at > stock_applied_at de 'c11'. Borrar 'c11' deja stock = 70 y 'delete_no_compensation'.
--   Con now() la marca del conteo sería anterior y el borrado inventaría una unidad.

-- Caso 12: una compensación esperando detrás de un conteo. Lee el corte ya bajo el lock.
--   Partiendo de un ítem 'c12' aplicado:
--   Sesión C: begin; select public.stock_apply_adjustment(:store, :product, 'count', <saldo>, 80);
--   Sesión D: delete from public.sale_items where store_id = :store and legacy_id = 'c12';           -- espera
--   Sesión C: commit;
--   Esperado: stock = 80 y 'delete_no_compensation'.

-- CRUCE TEMPORAL. Con el corte ya confirmado por otra sesión, antes de sincronizar el ítem.

-- Caso 13: cabecera anterior, venta declarada posterior. El escenario 12:00, 12:01, 12:02 del hallazgo.
--   Sesión A: insert into public.sales (store_id, business_date, sold_at) values (:store, current_date, clock_timestamp() + '2 min'); commit;   -- venta parcial
--   Sesión C: select public.stock_apply_adjustment(:store, :product, 'count', <saldo>, 50);
--   Sesión A: insert ... sale_id de esa cabecera, legacy_id 'c13', quantity 1;
--   Esperado: 'count_review', applied 0, stock = 50 y la incidencia visible.

-- Caso 14: cabecera posterior, venta declarada anterior.
--   Sesión C: select public.stock_apply_adjustment(:store, :product, 'count', <saldo>, 50);
--   Sesión A: insert into public.sales (store_id, business_date, sold_at) values (:store, current_date, clock_timestamp() - '1 min'); commit;
--   Sesión A: insert ... sale_id de esa cabecera, legacy_id 'c14', quantity 1;
--   Esperado: 'count_review', applied 0, stock = 50.

-- Caso 15: cabecera parcial, con cabecera y sold_at antes del conteo, y el ítem después. Es el caso seguro que se conserva.
--   Sesión A: insert into public.sales (store_id, business_date, sold_at) values (:store, current_date, clock_timestamp()); commit;
--   Sesión C: select public.stock_apply_adjustment(:store, :product, 'count', <saldo>, 50);
--   Sesión A: insert ... sale_id de esa cabecera, legacy_id 'c15', quantity 1;
--   Esperado: 'before_count', applied 0, stock = 50.

select 'Guion manual: ejecutar los casos con dos sesiones' as stock_durability_concurrency_test;
