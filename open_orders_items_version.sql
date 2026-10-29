-- Versión de los ítems de cada mesa abierta y reemplazo atómico con control de versión.
--
-- Problema: el frontend reemplazaba los ítems de una mesa con borrar + insertar desde cada dispositivo.
-- Un reintento viejo o una edición simultánea desde otro dispositivo sobrescribía en silencio una versión
-- más reciente (y entre el borrado y la inserción la mesa quedaba vacía).
--
-- Solución:
--   1. open_orders.items_version: sube con CUALQUIER escritura sobre open_order_items de esa mesa
--      (también las de clientes con la versión anterior, que siguen haciendo borrar + insertar).
--   2. replace_open_order_items(orden, versión_base, ítems): bloquea la mesa, compara la versión y reemplaza
--      los ítems en una sola transacción. Si la versión no coincide, no escribe nada y devuelve la versión
--      e ítems actuales para que el operador resuelva el conflicto.
--
-- La función corre con los permisos de quien la llama (RLS de open_orders y open_order_items intactas) y toma
-- el local (store_id) de la propia mesa, nunca del cliente.
-- Reversión: open_orders_items_version_rollback.sql. Pruebas: open_orders_items_version_test.sql.

begin;

alter table public.open_orders
  add column if not exists items_version bigint not null default 0;

create or replace function public.bump_open_order_items_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- En DELETE, NEW es null; en UPDATE que cambia de mesa, suben las dos.
  -- Solo la mesa del mismo local que el ítem: una fila de otro local no mueve la versión de esta mesa.
  update public.open_orders o set items_version = o.items_version + 1
   where (o.id = new.open_order_id and o.store_id = new.store_id)
      or (o.id = old.open_order_id and o.store_id = old.store_id);
  return null;
end;
$$;

revoke all on function public.bump_open_order_items_version() from public, anon, authenticated;

drop trigger if exists trg_open_order_items_version on public.open_order_items;
create trigger trg_open_order_items_version
  after insert or update or delete on public.open_order_items
  for each row execute function public.bump_open_order_items_version();

create or replace function public.replace_open_order_items(
  p_open_order_id uuid,
  p_base_version bigint,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_store_id uuid;
  v_status text;
  v_version bigint;
begin
  -- FOR UPDATE: dos reemplazos de la misma mesa no se intercalan. Con RLS, una mesa ajena no aparece.
  select o.store_id, o.status::text, o.items_version
    into v_store_id, v_status, v_version
    from public.open_orders o
   where o.id = p_open_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'closed', 'version', v_version);
  end if;
  if p_base_version is distinct from v_version then
    return jsonb_build_object(
      'ok', false,
      'reason', 'conflict',
      'version', v_version,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name,
                 'quantity', i.quantity, 'unit_price', i.unit_price, 'variants', i.variants,
                 'note', i.note, 'sort_order', i.sort_order, 'metadata', i.metadata)
               order by i.sort_order, i.created_at)
          from public.open_order_items i
         where i.open_order_id = p_open_order_id), '[]'::jsonb));
  end if;

  delete from public.open_order_items where open_order_id = p_open_order_id;

  insert into public.open_order_items
    (id, store_id, open_order_id, product_id, product_name, quantity, unit_price, line_total,
     variants, note, sort_order, metadata)
  select coalesce(nullif(x->>'id', '')::uuid, gen_random_uuid()),
         v_store_id,
         p_open_order_id,
         nullif(x->>'product_id', '')::uuid,
         coalesce(nullif(x->>'product_name', ''), '?'),
         coalesce((x->>'quantity')::numeric, 1),
         coalesce((x->>'unit_price')::numeric, 0),
         coalesce((x->>'line_total')::numeric, 0),
         coalesce(x->'variants', '[]'::jsonb),
         coalesce(x->>'note', ''),
         coalesce((x->>'sort_order')::integer, (t.n - 1)::integer),
         coalesce(x->'metadata', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(x, n);

  select items_version into v_version from public.open_orders where id = p_open_order_id;
  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke all on function public.replace_open_order_items(uuid, bigint, jsonb) from public, anon;
grant execute on function public.replace_open_order_items(uuid, bigint, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
