-- Colo Café · auditoría ola 1 · ESQUEMA (SOLO LECTURA). Derivado sin cambios de 00_schema_gate.sql, salvo que se quitó el envoltorio begin/rollback:
-- es UNA sola sentencia SELECT sobre catálogos del sistema (pg_class, pg_attribute, pg_constraint, pg_roles). No lee tablas de negocio, ni auth.*, ni credenciales.
-- Se quitó la transacción para que el SQL Editor muestre el resultado (muestra la última sentencia). Que no escribe lo garantiza tests/staging_sql_solo_lectura.test.cjs.
-- Qué mirar: filas STOP_* (detener y avisar), ADVERTENCIA_* (revisar) y ROL (debe decir bypassrls=true o super=true).
-- 00_schema_gate.sql · PREFLIGHT DE SOLO LECTURA (futuro, con autorización nueva). NO EJECUTADO: no hay Postgres local; solo se revisó leyéndolo.
-- Estado de validación: SQL_RUNTIME_VALIDATED = NO. Ver SQL_REVISION.md.
-- STOP GATE explícito. Antes de crear fixtures hay que ejecutarlo y revisar TODAS las filas:
--   * 'STOP_HIJO_SIN_STORE_ID'  : tabla descendiente (por FK, transitivamente) de stores o de una tabla con store_id que NO tiene store_id: su limpieza no
--                                 se puede verificar por local. No se asume cascada: detener y decidir con la persona.
--   * 'STOP_RESERVATIONS_AUSENTE': F4 asume public.reservations.
--   * 'STOP_ROL_SIN_BYPASSRLS'  : con RLS forzado, los conteos de residuos del cleanup podrían ser parciales y dar un falso "0".
--   * 'ADVERTENCIA_*'           : acción de borrado que BLOQUEA (NO ACTION/RESTRICT) o que deja huérfanos (SET NULL/SET DEFAULT). Revisar antes del cleanup.
-- Usa pg_catalog (information_schema oculta las tablas sobre las que el rol no tiene privilegios).
with recursive
raices as (
  select 'public.stores'::regclass::oid as rel
  union
  select a.attrelid
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where a.attname = 'store_id' and not a.attisdropped and c.relkind in ('r', 'p') and c.relnamespace = 'public'::regnamespace
),
fks as (
  select c.conname, c.conrelid as hijo, c.confrelid as padre, c.confdeltype as accion
    from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace
),
arbol(rel, prof) as (
  select rel, 0 from raices
  union
  select f.hijo, a.prof + 1 from fks f join arbol a on f.padre = a.rel where a.prof < 6
),
enarbol as (
  select f.*, exists (select 1 from pg_attribute a where a.attrelid = f.hijo and a.attname = 'store_id' and not a.attisdropped) as hijo_tiene_store_id
    from fks f where f.padre in (select rel from arbol)
)
select 'TABLA_CON_STORE_ID' as tipo, rel::regclass::text as detalle from raices where rel <> 'public.stores'::regclass::oid
union all
select 'FK_EN_EL_ARBOL', format('%s -> %s (%s) borrado=%s hijo_con_store_id=%s', hijo::regclass, padre::regclass, conname, accion, hijo_tiene_store_id) from enarbol
union all
select 'STOP_HIJO_SIN_STORE_ID', format('%s -> %s (%s)', hijo::regclass, padre::regclass, conname) from enarbol where not hijo_tiene_store_id
union all
select 'ADVERTENCIA_BORRADO_BLOQUEA', format('%s -> %s (%s)', hijo::regclass, padre::regclass, conname) from enarbol where accion in ('a', 'r')
union all
select 'ADVERTENCIA_DEJA_HUERFANOS', format('%s -> %s (%s)', hijo::regclass, padre::regclass, conname) from enarbol where accion in ('n', 'd')
union all
select 'STOP_RESERVATIONS_AUSENTE', 'public.reservations no existe' where to_regclass('public.reservations') is null
union all
select 'RESERVATIONS_COLUMNA', a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod)
  from pg_attribute a where a.attrelid = to_regclass('public.reservations') and a.attnum > 0 and not a.attisdropped
union all
select 'ROL', format('%s super=%s bypassrls=%s', rolname, rolsuper, rolbypassrls) from pg_roles where rolname = current_user
union all
select 'STOP_ROL_SIN_BYPASSRLS', current_user::text from pg_roles where rolname = current_user and not (rolsuper or rolbypassrls)
order by 1, 2;
