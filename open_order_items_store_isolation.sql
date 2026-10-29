-- Aislamiento entre locales en los ítems de mesa.
--
-- Nada obligaba a que el local (store_id) de un ítem fuera el mismo que el de su mesa.
--
-- Solución: clave foránea compuesta (open_order_id, store_id) -> open_orders (id, store_id). Cada ítem queda en el mismo
-- local que su mesa, en la base y para cualquier cliente, y las políticas existentes por local alcanzan para aislarlo.
-- No cambia políticas ni datos. Si hubiera ítems desalineados, la migración se detiene sin tocar nada.
-- Reversión: open_order_items_store_isolation_rollback.sql. Pruebas: open_order_items_store_isolation_test.sql.

begin;

do $$
begin
  if exists (select 1 from public.open_order_items i join public.open_orders o on o.id = i.open_order_id
             where o.store_id <> i.store_id) then
    raise exception 'Hay ítems de mesa con un local distinto al de su mesa: revisarlos antes de aplicar.';
  end if;
end;
$$;

alter table public.open_orders
  add constraint open_orders_id_store_id_key unique (id, store_id);

alter table public.open_order_items
  add constraint open_order_items_order_store_fkey
  foreign key (open_order_id, store_id) references public.open_orders (id, store_id) on delete cascade;

commit;
