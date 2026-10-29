-- Comandas enviadas por mesa y sector.
--
-- Cada comanda que el operador confirma como enviada queda registrada (no se edita ni se borra): qué unidades de cada
-- línea (producto + variantes + nota) se mandaron a cafetería o cocina, en negativo si se anularon. Lo pendiente de una
-- mesa es su pedido actual menos lo ya enviado, igual en todos los dispositivos.
-- seq es correlativo por mesa y sector: si dos dispositivos confirman la misma comanda, el segundo choca con la clave única.
-- Requiere open_orders_id_store_id_key (open_order_items_store_isolation.sql): la comanda queda en el local de su mesa.
-- Reversión: open_order_dispatches_rollback.sql. Pruebas: open_order_dispatches_test.sql.

begin;

create table public.open_order_dispatches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  open_order_id uuid not null,
  sector public.product_section not null,
  seq integer not null check (seq > 0),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  operator_name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint open_order_dispatches_order_store_fkey
    foreign key (open_order_id, store_id) references public.open_orders (id, store_id) on delete cascade,
  constraint open_order_dispatches_order_sector_seq_key unique (open_order_id, sector, seq)
);

alter table public.open_order_dispatches enable row level security;
alter table public.open_order_dispatches force row level security;

create policy open_order_dispatches_select on public.open_order_dispatches
  for select to authenticated
  using (public.has_store_role(store_id, array['owner', 'admin', 'operator']::public.store_user_role[]));

create policy open_order_dispatches_insert on public.open_order_dispatches
  for insert to authenticated
  with check (public.has_store_role(store_id, array['owner', 'admin', 'operator']::public.store_user_role[]));

revoke all on public.open_order_dispatches from public, anon, authenticated;
grant select, insert on public.open_order_dispatches to authenticated;
grant all on public.open_order_dispatches to service_role;

notify pgrst, 'reload schema';

commit;
