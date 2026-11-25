-- Colo Café · auditoría ola 1 · COLUMNAS DE LAS TABLAS QUE INSERTA fixtures.sql (SOLO LECTURA). UNA sola sentencia SELECT sobre catálogos (pg_attribute, pg_class, pg_attrdef).
-- No lee filas de ninguna tabla: solo la estructura (nombre, tipo, si es obligatoria y si tiene valor por defecto). Sirve para comprobar, sin escribir, que fixtures.sql
-- informa todas las columnas obligatorias sin valor por defecto.
select c.relname::text as tabla, a.attname::text as columna, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull as obligatoria,
       (d.adbin is not null or a.attidentity <> '' or a.attgenerated <> '') as tiene_valor_por_defecto
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where c.relnamespace = 'public'::regnamespace and c.relname in ('stores', 'store_users', 'categories', 'operators', 'products')
   and a.attnum > 0 and not a.attisdropped
 order by 1, a.attnum;
