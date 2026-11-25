-- Colo Café · auditoría ola 1 · LÍNEA BASE DEL CONTENIDO AJENO AL LOCAL SINTÉTICO (SOLO LECTURA). UNA sola sentencia SELECT; devuelve SOLO cantidad y huella md5, nunca filas.
-- Se ejecuta ANTES de crear el local sintético y de nuevo DESPUÉS de limpiar: si las huellas coinciden, nada ajeno fue tocado. Si difieren, comprobar si hubo actividad
-- real en el local de staging entre una y otra (los timestamps de las filas cambian si alguien trabajó); la limpieza además verifica por su cuenta, dentro de su transacción.
select 'BASE' as tipo, 'stores' as detalle, count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as valor from public.stores x where x.id <> 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'audit_logs', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.audit_logs x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'categories', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.categories x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'customers', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.customers x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'expenses', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.expenses x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'open_order_dispatches', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.open_order_dispatches x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'open_order_items', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.open_order_items x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'open_orders', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.open_orders x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'operators', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.operators x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'products', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.products x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'reservations', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.reservations x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'sale_items', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.sale_items x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'sale_payments', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.sale_payments x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'sales', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.sales x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'shifts', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.shifts x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'stock_ledger', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.stock_ledger x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'stock_store_activation', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.stock_store_activation x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'store_users', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.store_users x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001'
union all
select 'BASE', 'profiles', count(*)::text || ' · ' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from public.profiles x where true
order by 1, 2;
