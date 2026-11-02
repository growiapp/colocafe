-- Pruebas de concurrencia de stock_durability.sql. Dos sesiones reales, a mano, en un entorno de pruebas. NO EJECUTADAS todavía.
-- En un mensaje con varias sentencias, now() queda fijo al inicio del mensaje y las sentencias fuera de begin forman una transacción implícita: usar begin y commit explícitos.
-- Los casos de espera necesitan un hold menor a 3 s, o los corta el lock_timeout.
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

-- Caso 3: fallo por lock_timeout, sin estado intermedio. El lock lo tiene que sostener otra venta o un ajuste.
--   Sesión A: begin; insert ... legacy_id 'c4a', quantity 1; select pg_sleep(5);
--   Sesión B: insert ... legacy_id 'c4', quantity 1;      -- a los 3 s: 55P03
--   Sesión A: commit;
--   Esperado: B falla, no existe el ítem 'c4' y el stock bajó solo por 'c4a'. Un reintento de B descuenta una sola vez.
--   Observado en staging: un FOR UPDATE externo sobre el producto no da 55P03: la venta espera en la FK, fuera del lock_timeout de la función.

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

-- TRANSICIONES. La regla: un cambio de estado espera a lo que está en vuelo, y lo que llega después espera al cambio.

-- Caso 8b: INSERT iniciado antes de la pausa y confirmado después de pedirla.
--   Sesión A: begin; insert ... legacy_id 'c8b', quantity 1;     -- leyó 'active', descontó y sostiene FOR SHARE
--   Sesión D: update public.stock_store_activation set status = 'sales_paused' where store_id = :store;   -- ESPERA a A
--   Sesión A: commit;
--   Esperado: D termina recién ahora, con paused_at posterior a stock_applied_at de 'c8b'. Descontó una vez. Un ítem nuevo recibe 55000.
--   Con un SELECT sin lock, D habría confirmado antes y 'c8b' habría llegado después de deactivated.

-- Caso 8c: lo mismo con una cabecera.
--   Sesión A: begin; insert into public.sales (store_id, business_date, sold_at) values (:store, current_date, clock_timestamp());
--   Sesión D: update ... set status = 'sales_paused' ...;   -- ESPERA a A
--   Sesión A: commit;
--   Esperado: D termina. La cabecera queda sin ítems y el ítem recibe 55000: es una venta parcial, ver el caso 8h.

-- Caso 8d: una venta llega durante el cambio de estado.
--   Sesión D: begin; update ... set status = 'sales_paused' ...;
--   Sesión A: insert ... legacy_id 'c8d', quantity 1;      -- ESPERA a D. Si D tarda más de 3 s: 55P03, sin ítem y sin descuento
--   Sesión D: commit;
--   Esperado: A recibe 55000, no 'applied': el FOR SHARE relee la fila ya cambiada.

-- Caso 8e: DELETE con compensación durante la pausa.
--   Con 'c8e' aplicado y posterior al corte, y el local en sales_paused:
--   Sesión C: delete from public.sale_items where store_id = :store and legacy_id = 'c8e';
--   Esperado: 55000, el ítem sigue, stock igual y nada en stock_ledger. Abortada la pausa, el mismo DELETE devuelve y registra.

-- Caso 8f: DELETE en cascada durante la pausa.
--   Con la cabecera de 'c8e' y el local en sales_paused:
--   Sesión C: delete from public.sales where id = <cabecera>;
--   Esperado: 55000 y la cabecera con todos sus ítems y pagos sigue. Lo mismo para delete from public.stores.

-- Caso 8g: DELETE en vuelo contra la pausa.
--   Sesión C: begin; delete ... legacy_id 'c8g';           -- devolvió y sostiene FOR SHARE
--   Sesión D: update ... set status = 'sales_paused' ...;  -- ESPERA a C
--   Sesión C: commit;
--   Esperado: devolución aplicada y registrada antes de la pausa. Con rollback de C en lugar de commit: ni devolución ni ledger, y el ítem sigue.

-- Caso 8h: operaciones parcialmente persistidas, los tres finales posibles. Cabecera confirmada mientras el local estaba activo, 10 min después de la activación.
--   Pausar. Sesión A: insert del ítem 'c8h';                -- 55000; R-B2a deja partial_error
--   a) Abortar la pausa: update ... set status = 'active'. Reintento de 'c8h': clasifica normal y descuenta una vez.
--   b) En cambio, desactivar. Reintento de 'c8h': 'transition_review', applied 0: la cabecera es anterior a la desactivación.
--   c) En cambio, con la app: R-B2a adopta la cabecera e inserta solo lo que falta. Una sola cabecera y un solo ítem por legacy_id.

-- Caso 8i: reintentos de R-B2a después de levantar la pausa, con la app real y dos dispositivos.
--   Vender con el local en pausa: la venta queda en error en el dispositivo y "Ventas pendientes" la cuenta. Abortar la pausa. retryPendingSalesSync.
--   Esperado: synced, un descuento. Repetir el reintento no cambia el saldo. Un segundo intento concurrente recibe 23505 y no descuenta.

-- Caso 8j: reactivación concurrente con rollback. Los dos órdenes.
--   Con todos los locales en 'deactivated'.
--   a) Sesión R: begin; hasta justo después del precheck de stock_durability_rollback.sql.
--      Sesión D: update ... set status = 'active' ...;     -- ESPERA a R
--      Sesión R: commit;
--      Esperado: D falla con 23514 stock_store_activation_rolled_back. Sin triggers y sin modo servidor.
--   b) Sesión D: begin; update ... set status = 'active' ...;
--      Sesión R: correr el rollback;                        -- espera en el primer LOCK
--      Sesión D: commit;
--      Esperado: R aborta con STOCK_ROLLBACK, o con 55P03 si pasaron los 10 s. Triggers, funciones y saldos intactos.

-- Caso 8k: orden de locks. Dos ventas simultáneas del mismo producto no se bloquean entre sí.
--   Sesión A: begin; insert ... legacy_id 'c8k1', quantity 1;
--   Sesión B: begin; insert ... legacy_id 'c8k2', quantity 1;   -- su FK toma FOR KEY SHARE y su trigger espera a A
--   Sesión A: commit;  Sesión B: commit;
--   Esperado: sin 40P01, y los dos descuentos. Con FOR UPDATE en lugar de FOR NO KEY UPDATE, según el orden de las sentencias, aquí hay deadlock.

-- Caso 8l: una escritura directa, en orden inverso, no espera una transición.
--   Con el local en 'deactivated'. Sesión D: begin; update ... set status = 'active' ...;
--   Sesión C (authenticated, owner): update public.products set stock = 5 where id = :product;
--   Esperado: 55P03 inmediato por el NOWAIT. D confirma sin deadlock.

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
