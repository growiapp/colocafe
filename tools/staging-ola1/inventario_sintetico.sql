-- Colo Café · auditoría ola 1 · INVENTARIO DEL LOCAL SINTÉTICO ZZ_E2E_OLA1 (SOLO LECTURA). UNA sola sentencia SELECT; devuelve SOLO cantidades (count), nunca filas ni ids.
-- Sirve para identificar, tras una interrupción, exactamente qué hay del local sintético (id e2e02026-1123-4122-8000-000000000001, legacy_id ZZE2E-STORE) en cada tabla,
-- si existe otro local ZZ_E2E%, y que las tres cuentas de prueba (7cd84c4f, eef11ffb, 48075b31) conservan su membresía en el local PREEXISTENTE (89401a44…).
select 'LOCAL_SINTETICO' as tipo, 'stores' as detalle, count(*)::text as valor from public.stores where id = 'e2e02026-1123-4122-8000-000000000001' and legacy_id = 'ZZE2E-STORE' and name like 'ZZ_E2E%'
union all
select 'OTRO_LOCAL_ZZ_E2E', 'stores', count(*)::text from public.stores where (legacy_id = 'ZZE2E-STORE' or name like 'ZZ_E2E%') and id <> 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'audit_logs', count(*)::text from public.audit_logs where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'categories', count(*)::text from public.categories where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'customers', count(*)::text from public.customers where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'expenses', count(*)::text from public.expenses where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'open_order_dispatches', count(*)::text from public.open_order_dispatches where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'open_order_items', count(*)::text from public.open_order_items where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'open_orders', count(*)::text from public.open_orders where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'operators', count(*)::text from public.operators where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'products', count(*)::text from public.products where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'reservations', count(*)::text from public.reservations where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'sale_items', count(*)::text from public.sale_items where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'sale_payments', count(*)::text from public.sale_payments where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'sales', count(*)::text from public.sales where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'shifts', count(*)::text from public.shifts where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'stock_ledger', count(*)::text from public.stock_ledger where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'stock_store_activation', count(*)::text from public.stock_store_activation where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'FILAS_DEL_SINTETICO', 'store_users', count(*)::text from public.store_users where store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'MEMBRESIA_EN_LOCAL_PREEXISTENTE', '7cd84c4f (owner)', count(*)::text from public.store_users where user_id::text like '7cd84c4f%' and store_id::text like '89401a44%'
union all
select 'MEMBRESIA_EN_LOCAL_PREEXISTENTE', 'eef11ffb (admin)', count(*)::text from public.store_users where user_id::text like 'eef11ffb%' and store_id::text like '89401a44%'
union all
select 'MEMBRESIA_EN_LOCAL_PREEXISTENTE', '48075b31 (operator)', count(*)::text from public.store_users where user_id::text like '48075b31%' and store_id::text like '89401a44%'
order by 1, 2;
