-- Colo Café · B5 (servidor) · el OPERADOR no puede cerrar ni borrar una mesa con productos que no fue cobrada.
-- Regla comercial aprobada: operador = solo mesas vacías; dueño y administrador = también con productos (con confirmación en la app).
-- Qué hace (aditivo, idempotente, SIN tocar ninguna política existente): agrega dos políticas RESTRICTIVAS (se combinan con AND con las vigentes, sin depender de sus nombres)
-- y una función auxiliar de solo lectura.
--   * UPDATE de public.open_orders: si el cambio deja la mesa fuera de 'open' (cerrar/cancelar), solo owner/admin, o una mesa sin ítems, o una mesa YA COBRADA (existe una venta con ese open_order_id).
--   * DELETE de public.open_orders: solo owner/admin, o una mesa que ya no está 'open', o una mesa sin ítems, o ya cobrada.
-- No afecta: el cobro (el trigger trg_close_open_order_after_sale es SECURITY DEFINER y además la venta ya existe), la edición de ítems (replace_open_order_items sigue igual),
-- comandas (open_order_dispatches), historial (sales/sale_items/sale_payments) ni Stock Durability (no se toca nada de stock_*).
-- LÍMITE CONOCIDO: un operador puede quitar los productos uno a uno (edición normal) y luego eliminar la mesa ya vacía; eso es indistinguible de editar el pedido.
-- Reversa: open_orders_operator_guard_rollback.sql. Ejecutar PRIMERO en staging; producción solo con autorización expresa.
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.open_orders') is null or to_regclass('public.open_order_items') is null or to_regclass('public.sales') is null then raise exception 'B5_GUARD_ESQUEMA: faltan tablas'; end if;
  if to_regprocedure('public.has_store_role(uuid,public.store_user_role[])') is null then raise exception 'B5_GUARD_ESQUEMA: falta public.has_store_role(uuid, store_user_role[])'; end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.sales'::regclass and attname = 'open_order_id' and not attisdropped) then raise exception 'B5_GUARD_ESQUEMA: sales.open_order_id no existe'; end if;
end $$;

-- ¿Se puede cerrar/borrar esta mesa siendo operador? Sin ítems, o ya cobrada. SECURITY DEFINER para que el resultado no dependa de lo que el rol pueda leer (p. ej. sales).
create or replace function public.open_order_operador_puede_cerrar(p_open_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.open_order_items i where i.open_order_id = p_open_order_id)
      -- la venta debe ser DEL MISMO LOCAL que la mesa: una venta de otro local que apunte a esta mesa no cuenta como cobro
      or exists (select 1 from public.sales s join public.open_orders o on o.id = s.open_order_id and o.store_id = s.store_id where s.open_order_id = p_open_order_id);
$$;
revoke all on function public.open_order_operador_puede_cerrar(uuid) from public, anon;
grant execute on function public.open_order_operador_puede_cerrar(uuid) to authenticated, service_role;

drop policy if exists open_orders_update_guard_operador on public.open_orders;
create policy open_orders_update_guard_operador on public.open_orders
  as restrictive for update to authenticated
  using (true)
  with check (
    status::text = 'open'
    or public.has_store_role(store_id, array['owner','admin']::public.store_user_role[])
    or public.open_order_operador_puede_cerrar(id)
  );

drop policy if exists open_orders_delete_guard_operador on public.open_orders;
create policy open_orders_delete_guard_operador on public.open_orders
  as restrictive for delete to authenticated
  using (
    status::text <> 'open'
    or public.has_store_role(store_id, array['owner','admin']::public.store_user_role[])
    or public.open_order_operador_puede_cerrar(id)
  );

notify pgrst, 'reload schema';
commit;
