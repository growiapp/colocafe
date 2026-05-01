-- Colo Cafe - Caja / Mesas abiertas schema alignment
-- Idempotente. Ejecutar completo en Supabase SQL Editor.
-- Alcance: public.open_orders y public.open_order_items.

begin;

-- =========================
-- 1) Columnas base
-- =========================
alter table public.open_orders
  add column if not exists label text,
  add column if not exists table_label text,
  add column if not exists business_date date,
  add column if not exists opened_at timestamptz,
  add column if not exists service_type text,
  add column if not exists shift_id uuid,
  add column if not exists operator_name text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'open_orders'
      and column_name = 'status'
  ) then
    if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'open_order_status') then
      alter table public.open_orders
        add column status public.open_order_status default 'open'::public.open_order_status;
    else
      alter table public.open_orders
        add column status text default 'open';
    end if;
  end if;
end $$;

alter table public.open_order_items
  add column if not exists store_id uuid,
  add column if not exists open_order_id uuid,
  add column if not exists product_id uuid,
  add column if not exists product_legacy_id text,
  add column if not exists product_name text,
  add column if not exists quantity numeric default 1,
  add column if not exists unit_price numeric default 0,
  add column if not exists line_total numeric default 0,
  add column if not exists variants jsonb default '[]'::jsonb,
  add column if not exists note text,
  add column if not exists sort_order integer default 0,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- =========================
-- 2) Backfill seguro
-- =========================
update public.open_orders
set
  label = coalesce(nullif(label, ''), nullif(table_label, ''), nullif(metadata->>'label', ''), nullif(metadata->>'table_label', ''), 'Mesa'),
  table_label = coalesce(nullif(table_label, ''), nullif(label, ''), nullif(metadata->>'table_label', ''), nullif(metadata->>'label', ''), 'Mesa'),
  opened_at = coalesce(opened_at, created_at, now()),
  business_date = coalesce(business_date, (coalesce(opened_at, created_at, now()) at time zone 'America/Argentina/Buenos_Aires')::date),
  metadata = coalesce(metadata, '{}'::jsonb);

do $$
declare
  status_udt text;
  service_data_type text;
  service_udt_schema text;
  service_udt text;
  service_default text;
begin
  select udt_name into status_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'open_orders'
    and column_name = 'status';

  if status_udt = 'open_order_status' then
    update public.open_orders
    set status = coalesce(nullif(status::text, ''), 'open')::public.open_order_status;
  else
    update public.open_orders
    set status = coalesce(nullif(status::text, ''), 'open');
  end if;

  select data_type, udt_schema, udt_name
    into service_data_type, service_udt_schema, service_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'open_orders'
    and column_name = 'service_type';

  if service_data_type = 'USER-DEFINED' and exists (
    select 1
    from pg_type t
    where t.typnamespace = service_udt_schema::regnamespace
      and t.typname = service_udt
      and t.typtype = 'e'
  ) then
    select coalesce(
      (
        select e.enumlabel
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typnamespace = service_udt_schema::regnamespace
          and t.typname = service_udt
          and e.enumlabel = 'salon'
        limit 1
      ),
      (
        select e.enumlabel
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typnamespace = service_udt_schema::regnamespace
          and t.typname = service_udt
        order by e.enumsortorder
        limit 1
      ),
      'salon'
    ) into service_default;
  else
    service_default := 'salon';
  end if;

  if service_data_type = 'USER-DEFINED' and exists (
    select 1
    from pg_type t
    where t.typnamespace = service_udt_schema::regnamespace
      and t.typname = service_udt
      and t.typtype = 'e'
  ) then
    execute format($sql$
      update public.open_orders o
      set service_type = (
        case
          when nullif(o.service_type::text, '') in (
            select e.enumlabel
            from pg_enum e
            join pg_type t on t.oid = e.enumtypid
            where t.typnamespace = %L::regnamespace
              and t.typname = %L
          ) then nullif(o.service_type::text, '')
          when nullif(o.metadata->>'service_type', '') in (
            select e.enumlabel
            from pg_enum e
            join pg_type t on t.oid = e.enumtypid
            where t.typnamespace = %L::regnamespace
              and t.typname = %L
          ) then nullif(o.metadata->>'service_type', '')
          else %L
        end
      )::%I.%I
    $sql$, service_udt_schema, service_udt, service_udt_schema, service_udt, service_default, service_udt_schema, service_udt);
  else
    update public.open_orders
    set service_type = coalesce(nullif(service_type::text, ''), nullif(metadata->>'service_type', ''), service_default);
  end if;
end $$;

update public.open_order_items
set
  quantity = coalesce(quantity, 1),
  unit_price = coalesce(unit_price, 0),
  line_total = coalesce(line_total, coalesce(quantity, 1) * coalesce(unit_price, 0), 0),
  variants = coalesce(variants, '[]'::jsonb),
  metadata = coalesce(metadata, '{}'::jsonb),
  product_legacy_id = coalesce(nullif(product_legacy_id, ''), nullif(metadata->>'product_legacy_id', ''), nullif(metadata->>'prodId', ''));

-- =========================
-- 3) Defaults y NOT NULL necesarios
-- =========================
alter table public.open_orders
  alter column label set default 'Mesa',
  alter column label set not null,
  alter column table_label set default 'Mesa',
  alter column business_date set default current_date,
  alter column business_date set not null,
  alter column opened_at set default now(),
  alter column opened_at set not null,
  alter column metadata set default '{}'::jsonb;

do $$
declare
  status_udt text;
begin
  select udt_name into status_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'open_orders'
    and column_name = 'status';

  if status_udt = 'open_order_status' then
    alter table public.open_orders
      alter column status set default 'open'::public.open_order_status;
  else
    alter table public.open_orders
      alter column status set default 'open';
  end if;
end $$;

do $$
declare
  service_data_type text;
  service_udt_schema text;
  service_udt text;
  service_default text;
begin
  select data_type, udt_schema, udt_name
    into service_data_type, service_udt_schema, service_udt
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'open_orders'
    and column_name = 'service_type';

  if service_data_type = 'USER-DEFINED' and exists (
    select 1
    from pg_type t
    where t.typnamespace = service_udt_schema::regnamespace
      and t.typname = service_udt
      and t.typtype = 'e'
  ) then
    select coalesce(
      (
        select e.enumlabel
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typnamespace = service_udt_schema::regnamespace
          and t.typname = service_udt
          and e.enumlabel = 'salon'
        limit 1
      ),
      (
        select e.enumlabel
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        where t.typnamespace = service_udt_schema::regnamespace
          and t.typname = service_udt
        order by e.enumsortorder
        limit 1
      ),
      'salon'
    ) into service_default;
  else
    service_default := 'salon';
  end if;

  if service_data_type = 'USER-DEFINED' and exists (
    select 1
    from pg_type t
    where t.typnamespace = service_udt_schema::regnamespace
      and t.typname = service_udt
      and t.typtype = 'e'
  ) then
    execute format(
      'alter table public.open_orders alter column service_type set default %L::%I.%I',
      service_default,
      service_udt_schema,
      service_udt
    );
  else
    execute format(
      'alter table public.open_orders alter column service_type set default %L',
      service_default
    );
  end if;
end $$;

alter table public.open_order_items
  alter column quantity set default 1,
  alter column quantity set not null,
  alter column unit_price set default 0,
  alter column unit_price set not null,
  alter column line_total set default 0,
  alter column line_total set not null,
  alter column variants set default '[]'::jsonb,
  alter column metadata set default '{}'::jsonb;

-- =========================
-- 4) Triggers de compatibilidad
-- =========================
create or replace function public.sync_open_order_labels()
returns trigger
language plpgsql
as $$
declare
  next_status text;
  next_service_type text;
begin
  new.label := coalesce(nullif(new.label, ''), nullif(new.table_label, ''), nullif(new.metadata->>'label', ''), nullif(new.metadata->>'table_label', ''), 'Mesa');
  new.table_label := coalesce(nullif(new.table_label, ''), nullif(new.label, ''), 'Mesa');
  new.opened_at := coalesce(new.opened_at, now());
  new.business_date := coalesce(new.business_date, (new.opened_at at time zone 'America/Argentina/Buenos_Aires')::date, current_date);
  next_status := coalesce(nullif(new.status::text, ''), 'open');
  next_service_type := coalesce(nullif(new.service_type::text, ''), 'salon');
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'label', new.label,
      'table_label', new.table_label,
      'business_date', new.business_date,
      'opened_at', new.opened_at,
      'status', next_status,
      'service_type', next_service_type
    );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_open_order_labels on public.open_orders;
create trigger trg_sync_open_order_labels
before insert or update on public.open_orders
for each row execute function public.sync_open_order_labels();

create or replace function public.sync_open_order_item_totals()
returns trigger
language plpgsql
as $$
begin
  new.quantity := coalesce(new.quantity, 1);
  new.unit_price := coalesce(new.unit_price, 0);
  new.line_total := coalesce(new.line_total, new.quantity * new.unit_price, 0);
  new.variants := coalesce(new.variants, '[]'::jsonb);
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'line_total', new.line_total,
      'product_legacy_id', new.product_legacy_id
    );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_open_order_item_totals on public.open_order_items;
create trigger trg_sync_open_order_item_totals
before insert or update on public.open_order_items
for each row execute function public.sync_open_order_item_totals();

-- =========================
-- 5) Indices
-- =========================
create index if not exists idx_open_orders_store_status
  on public.open_orders(store_id, status);

create index if not exists idx_open_orders_store_business_date
  on public.open_orders(store_id, business_date);

create index if not exists idx_open_order_items_store_order
  on public.open_order_items(store_id, open_order_id);

create index if not exists idx_open_order_items_order
  on public.open_order_items(open_order_id);

-- =========================
-- 6) RLS policies con patron real del proyecto
-- =========================
alter table public.open_orders enable row level security;
alter table public.open_order_items enable row level security;

drop policy if exists open_orders_select_members on public.open_orders;
create policy open_orders_select_members on public.open_orders
for select using (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
);

drop policy if exists open_orders_insert_ops on public.open_orders;
create policy open_orders_insert_ops on public.open_orders
for insert with check (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
);

drop policy if exists open_orders_update_ops on public.open_orders;
create policy open_orders_update_ops on public.open_orders
for update using (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
) with check (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
);

drop policy if exists open_orders_delete_ops on public.open_orders;
create policy open_orders_delete_ops on public.open_orders
for delete using (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
);

drop policy if exists open_order_items_select_members on public.open_order_items;
create policy open_order_items_select_members on public.open_order_items
for select using (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
);

drop policy if exists open_order_items_insert_ops on public.open_order_items;
create policy open_order_items_insert_ops on public.open_order_items
for insert with check (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
);

drop policy if exists open_order_items_update_ops on public.open_order_items;
create policy open_order_items_update_ops on public.open_order_items
for update using (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
) with check (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
);

drop policy if exists open_order_items_delete_ops on public.open_order_items;
create policy open_order_items_delete_ops on public.open_order_items
for delete using (
  public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])
);

-- =========================
-- 7) Grants y PostgREST schema cache
-- =========================
grant select, insert, update, delete on public.open_orders to authenticated;
grant select, insert, update, delete on public.open_order_items to authenticated;

notify pgrst, 'reload schema';

commit;
