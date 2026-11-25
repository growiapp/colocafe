-- Colo Café · auditoría ola 1 · POLÍTICAS Y RESTRICCIONES DESPLEGADAS (SOLO LECTURA). UNA sola sentencia SELECT sobre catálogos del sistema
-- (pg_policies, pg_class, pg_constraint, pg_attribute, pg_indexes, pg_proc); no lee tablas de negocio ni auth.*. Muestra la DEFINICIÓN (texto) de las políticas y de has_store_role (máx. 300 caracteres), no datos.
-- Sin begin/rollback para que el SQL Editor muestre el resultado. Que no escribe lo garantiza tests/staging_sql_solo_lectura.test.cjs. Ejecutar en staging.
-- Responde: ¿qué roles pueden borrar/escribir mesas y notas (B1, B5)?, ¿hay restricción de precio en products (B2)?, ¿existe el índice único de ventas?
select 'POLITICA' tipo, tablename || ' · ' || policyname || ' · ' || cmd as detalle, left(coalesce(qual, '') || ' | ' || coalesce(with_check, ''), 240) as definicion
  from pg_policies
 where schemaname = 'public' and tablename in ('open_orders', 'open_order_items', 'open_order_dispatches', 'sales', 'sale_items', 'sale_payments', 'products', 'categories', 'customers', 'reservations')
union all
select 'RLS_ACTIVO', c.relname::text, c.relrowsecurity::text || ' (forzado=' || c.relforcerowsecurity::text || ')'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('open_orders', 'open_order_items', 'sales', 'sale_items', 'sale_payments', 'products', 'customers', 'reservations')
union all
select 'RESTRICCION_PRODUCTS', conname::text, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.products'::regclass and contype in ('c', 'u')
union all
select 'COLUMNA_PRECIO', attname::text, format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.products'::regclass and attname in ('price', 'name') and not attisdropped
union all
select 'INDICE_UNICO_VENTAS', indexname::text, indexdef from pg_indexes where schemaname = 'public' and tablename = 'sales' and indexdef ilike '%unique%'
union all
select 'FUNCION_ROL', proname::text, left(pg_get_functiondef(oid), 300) from pg_proc where proname = 'has_store_role' and pronamespace = 'public'::regnamespace
order by 1, 2;
