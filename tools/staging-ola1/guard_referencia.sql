-- Colo Café · B5 (servidor) · DEFINICIONES REALES para validar el guard (SOLO LECTURA). UNA sola sentencia SELECT sobre catálogos del sistema (pg_policies, pg_class, pg_proc, pg_trigger).
-- No lee tablas de negocio ni auth.*. Devuelve TEXTO de definiciones (políticas, funciones, triggers, permisos), nunca datos. Sirve para que la copia aislada use las definiciones de staging y no las del repo.
select 'POLITICA' tipo, tablename::text || ' · ' || policyname::text as detalle, cmd::text || ' · ' || permissive::text || ' · roles=' || roles::text || ' · USING ' || coalesce(qual, '-') || ' · CHECK ' || coalesce(with_check, '-') as definicion
  from pg_policies
 where schemaname = 'public' and tablename in ('open_orders', 'open_order_items', 'open_order_dispatches', 'sales', 'sale_items', 'sale_payments', 'store_users')
union all
select 'RLS_Y_PERMISOS', c.relname::text, 'rls=' || c.relrowsecurity::text || ' forzado=' || c.relforcerowsecurity::text || ' dueño=' || c.relowner::regrole::text || ' acl=' || coalesce(c.relacl::text, '-')
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('open_orders', 'open_order_items', 'open_order_dispatches', 'sales', 'sale_items', 'sale_payments', 'store_users')
union all
select 'FUNCION', p.oid::regprocedure::text, 'secdef=' || p.prosecdef::text || ' dueño=' || p.proowner::regrole::text || ' config=' || coalesce(p.proconfig::text, '-') || ' acl=' || coalesce(p.proacl::text, '-') || ' · ' || left(pg_get_functiondef(p.oid), 2500)
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and (p.proname = 'has_store_role' or p.prosrc ilike '%open_order%')
union all
select 'TRIGGER', c.relname::text || ' · ' || t.tgname::text, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname in ('open_orders', 'open_order_items', 'open_order_dispatches', 'sales', 'sale_items', 'sale_payments')
order by 1, 2;
