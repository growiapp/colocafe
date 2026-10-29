-- Reversión de open_order_dispatches.sql. Las mesas y sus ítems no se tocan.
-- En ambos casos el frontend deja de ver la tabla y vuelve a imprimir la comanda completa.
--
-- Sin registros: borra la tabla.
-- Con registros (comandas reales): NO se borran. La tabla, con sus datos, pasa al esquema privado colocafe_respaldo
-- (fuera de la API) con nombre open_order_dispatches_<fecha>, sin claves foráneas: borrar una mesa ya no la vacía.
-- La consulta final muestra qué respaldo quedó.
--
-- Recuperar las comandas después de reaplicar open_order_dispatches.sql (solo vuelven las de mesas que siguen
-- existiendo; el resto queda en el respaldo):
--   insert into public.open_order_dispatches
--   select d.* from colocafe_respaldo.open_order_dispatches_<fecha> d
--   where exists (select 1 from public.open_orders o where o.id = d.open_order_id and o.store_id = d.store_id);

begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare
  v_filas bigint;
  v_destino text := 'open_order_dispatches_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
  v_fk record;
begin
  if to_regclass('public.open_order_dispatches') is null then
    return;
  end if;

  lock table public.open_order_dispatches in access exclusive mode;
  select count(*) into v_filas from public.open_order_dispatches;

  if v_filas = 0 then
    drop table public.open_order_dispatches;
    return;
  end if;

  create schema if not exists colocafe_respaldo;
  revoke all on schema colocafe_respaldo from public, anon, authenticated;
  for v_fk in
    select conname from pg_constraint
    where conrelid = 'public.open_order_dispatches'::regclass and contype = 'f'
  loop
    execute format('alter table public.open_order_dispatches drop constraint %I', v_fk.conname);
  end loop;
  revoke all on public.open_order_dispatches from public, anon, authenticated;
  alter table public.open_order_dispatches set schema colocafe_respaldo;
  execute format('alter table colocafe_respaldo.open_order_dispatches rename to %I', v_destino);
end $$;

notify pgrst, 'reload schema';

select
  to_regclass('public.open_order_dispatches') is null as tabla_retirada,
  (select string_agg(c.relname, ', ' order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'colocafe_respaldo' and c.relkind = 'r') as respaldos;

commit;
