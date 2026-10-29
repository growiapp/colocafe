-- Reversión de open_orders_items_version.sql.
-- El frontend detecta que la función ya no existe y vuelve solo al reemplazo anterior (borrar + insertar).
-- Se pierde únicamente el contador items_version; los ítems de las mesas no se tocan.

begin;

drop function if exists public.replace_open_order_items(uuid, bigint, jsonb);
drop trigger if exists trg_open_order_items_version on public.open_order_items;
drop function if exists public.bump_open_order_items_version();
alter table public.open_orders drop column if exists items_version;

notify pgrst, 'reload schema';

commit;
