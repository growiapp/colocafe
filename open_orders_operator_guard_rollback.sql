-- Colo Café · B5 (servidor) · REVERSA de open_orders_operator_guard.sql. Quita solo lo que ese script agregó; no toca ninguna otra política ni dato.
begin;
drop policy if exists open_orders_update_guard_operador on public.open_orders;
drop policy if exists open_orders_delete_guard_operador on public.open_orders;
drop function if exists public.open_order_operador_puede_cerrar(uuid);
notify pgrst, 'reload schema';
commit;
