-- Colo Café · auditoría ola 1 · TRIGGERS Y TABLA DE AUDITORÍA (SOLO LECTURA). UNA sola sentencia SELECT sobre catálogos del sistema
-- (pg_trigger, pg_class, pg_attribute, pg_constraint, pg_policies). No lee tablas de negocio ni audit_logs: muestra su ESTRUCTURA, no sus filas.
-- Responde: ¿qué triggers existen en el esquema public (¿escriben en audit_logs al insertar/borrar?), cómo es audit_logs y qué FKs apuntan a stores?
select 'TRIGGER' as tipo, c.relname::text || ' · ' || t.tgname::text as detalle, left(pg_get_triggerdef(t.oid), 260) as definicion
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
union all
select 'AUDIT_LOGS_COLUMNA', a.attname::text, format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
  from pg_attribute a where a.attrelid = to_regclass('public.audit_logs') and a.attnum > 0 and not a.attisdropped
union all
select 'AUDIT_LOGS_RESTRICCION', conname::text, pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.audit_logs') and contype in ('f', 'c', 'u')
union all
select 'AUDIT_LOGS_POLITICA', policyname::text || ' · ' || cmd, left(coalesce(qual, '') || ' | ' || coalesce(with_check, ''), 200) from pg_policies where schemaname = 'public' and tablename = 'audit_logs'
union all
select 'FK_HACIA_STORES', conrelid::regclass::text || ' · ' || conname::text, pg_get_constraintdef(oid) from pg_constraint where confrelid = 'public.stores'::regclass and contype = 'f'
order by 1, 2;
