-- Pruebas de concurrencia de stock_durability.sql. Dos sesiones reales, a mano, en un entorno de pruebas. NO EJECUTADAS todavía.
-- Una transacción sola no puede demostrar esto. :store, :sale y :product son fixtures sintéticas de ese entorno, con stock 10.

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

-- Caso 4: una venta contra un ajuste con compare-and-set del cliente.
--   Sesión A: begin; insert ... legacy_id 'c5', quantity 1;
--   Sesión B: update public.products set stock = 50 where id = :product and stock = <saldo leído>;   -- espera
--   Sesión A: commit;
--   Esperado: READ COMMITTED reevalúa el filtro, B actualiza 0 filas y la venta no se pierde.

select 'Guion manual: ejecutar los casos con dos sesiones' as stock_durability_concurrency_test;
