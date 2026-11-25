-- Colo Café · auditoría ola 1 · TRIGGERS DEL ESQUEMA auth (SOLO LECTURA). UNA sola sentencia SELECT sobre catálogos (pg_trigger, pg_class, pg_namespace). Devuelve nombres y definición
-- de triggers, nunca filas de auth.users. Sirve para saber si una sesión (inicio o refresco) puede provocar una actualización en public.profiles.
select n.nspname::text || '.' || c.relname::text as tabla, t.tgname::text as trigger, left(pg_get_triggerdef(t.oid), 220) as definicion
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname = 'auth'
 order by 1, 2;
