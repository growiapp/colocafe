-- Colo Café · auditoría ola 1 · RESTRICCIONES CHECK/UNIQUE/PK/EXCLUDE DE LAS TABLAS QUE INSERTA fixtures.sql (SOLO LECTURA). UNA sola sentencia SELECT sobre pg_constraint y pg_indexes.
-- No lee filas de ninguna tabla. Sirve para comprobar, sin escribir, que los valores de fixtures.sql no chocan con restricciones únicas ni de validación.
select 'CONSTRAINT' as tipo, conrelid::regclass::text || ' · ' || conname::text as detalle, left(pg_get_constraintdef(oid), 200) as definicion
  from pg_constraint
 where conrelid in ('public.stores'::regclass, 'public.store_users'::regclass, 'public.categories'::regclass, 'public.operators'::regclass, 'public.products'::regclass)
   and contype in ('c', 'u', 'x')
union all
select 'INDICE_UNICO', tablename::text || ' · ' || indexname::text, left(indexdef, 200)
  from pg_indexes
 where schemaname = 'public' and tablename in ('stores', 'store_users', 'categories', 'operators', 'products') and indexdef ilike '%unique%'
order by 1, 2;
