-- Reversión de open_order_items_store_isolation.sql. No toca datos: quita la clave compuesta y su índice único.

begin;

alter table public.open_order_items drop constraint if exists open_order_items_order_store_fkey;
alter table public.open_orders drop constraint if exists open_orders_id_store_id_key;

commit;
