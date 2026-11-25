-- Colo Café · auditoría ola 1 · PARIDAD DE STOCK DURABILITY (SOLO LECTURA). UNA sola sentencia SELECT.
-- Inventaría qué objetos de stock_durability.sql existen realmente (2 tablas, 1 columna, 1 índice, 10 funciones, 9 triggers), cualquier otro objeto «stock» y el estado de activación.
-- Lee catálogos del sistema y, de dos tablas de configuración de Stock Durability, SOLO agregados (cantidad de filas y estados): no devuelve ids, ventas ni datos de clientes.
select 'TABLA' as tipo, c.relname::text as detalle, 'existe' as valor
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('stock_store_activation', 'stock_ledger')
union all
select 'COLUMNA', 'products.stock_counted_at', 'existe' from pg_attribute where attrelid = 'public.products'::regclass and attname = 'stock_counted_at' and not attisdropped
union all
select 'INDICE', indexname::text, 'existe' from pg_indexes where schemaname = 'public' and indexname = 'sale_items_stock_incidents_idx'
union all
select 'FUNCION_ESPERADA', proname::text, 'existe' from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('stock_store_activation_guard', 'sale_items_stock_prepare', 'sale_items_stock_apply', 'sale_items_stock_compensate', 'sale_items_stock_guard', 'sales_stock_guard', 'sales_stock_gate', 'products_stock_gate', 'products_stock_guard', 'stock_apply_adjustment')
union all
select 'TRIGGER_ESPERADO', c.relname::text || ' · ' || t.tgname::text, case when t.tgenabled = 'O' then 'habilitado' else 'estado=' || t.tgenabled::text end
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
   and t.tgname in ('sale_items_stock_prepare', 'sale_items_stock_apply', 'sale_items_stock_compensate', 'sale_items_stock_guard', 'stock_store_activation_guard', 'sales_stock_guard', 'sales_stock_gate', 'products_stock_gate', 'products_stock_guard')
union all
select 'OTRO_TRIGGER_STOCK', n.nspname::text || '.' || c.relname::text || ' · ' || t.tgname::text, 'existe'
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and (t.tgname ilike '%stock%' or c.relname ilike '%stock%')
   and t.tgname not in ('sale_items_stock_prepare', 'sale_items_stock_apply', 'sale_items_stock_compensate', 'sale_items_stock_guard', 'stock_store_activation_guard', 'sales_stock_guard', 'sales_stock_gate', 'products_stock_gate', 'products_stock_guard')
union all
select 'OTRA_FUNCION_STOCK', n.nspname::text || '.' || p.proname::text, 'existe'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname ilike '%stock%' and n.nspname not in ('pg_catalog', 'information_schema')
   and p.proname not in ('stock_store_activation_guard', 'sale_items_stock_prepare', 'sale_items_stock_apply', 'sale_items_stock_compensate', 'sale_items_stock_guard', 'sales_stock_guard', 'sales_stock_gate', 'products_stock_gate', 'products_stock_guard', 'stock_apply_adjustment')
union all
select 'ACTIVACION_ESTADO', coalesce(status::text, '(nulo)'), count(*)::text from public.stock_store_activation group by status
union all
select 'ACTIVACION_FILAS_TOTAL', 'stock_store_activation', count(*)::text from public.stock_store_activation
union all
select 'LEDGER_FILAS_TOTAL', 'stock_ledger', count(*)::text from public.stock_ledger
order by 1, 2;
