-- ================================================================
--  MIGRACIÓN INCREMENTAL: tabla operators
--  Gestiq / Colo Café
--  Ejecutar UNA SOLA VEZ en Supabase SQL Editor.
--  No toca schema existente (sales, shifts, expenses, products, etc.)
-- ================================================================

-- ── 1. Tabla principal ──────────────────────────────────────────
create table if not exists public.operators (
  id               uuid        primary key default gen_random_uuid(),
  store_id         uuid        not null references public.stores(id) on delete cascade,
  name             text        not null,
  normalized_name  text        not null,
  active           boolean     not null default true,
  role             text        null      default 'operator',
  pin_hash         text        null,
  metadata         jsonb       not null  default '{}'::jsonb,
  created_at       timestamptz not null  default now(),
  updated_at       timestamptz not null  default now(),
  constraint uq_operators_store_normalized unique (store_id, normalized_name)
);

comment on table public.operators is 'Staff / operadores por tienda.';
comment on column public.operators.normalized_name is 'Nombre en minúsculas sin acentos, para deduplicar "Pepe" vs "pepe".';
comment on column public.operators.pin_hash is 'Hash del PIN opcional; nunca se expone en la UI normal.';

-- ── 2. Índices ───────────────────────────────────────────────────
create index if not exists idx_operators_store_id   on public.operators(store_id);
create index if not exists idx_operators_active      on public.operators(store_id, active);

-- ── 3. Trigger updated_at ─────────────────────────────────────────
-- Usa set_updated_at() si ya existe en el schema; si no, la crea.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'set_updated_at'
      and pronamespace = (select oid from pg_namespace where nspname = 'public')
  ) then
    execute $func$
      create or replace function public.set_updated_at()
      returns trigger language plpgsql as $inner$
      begin
        new.updated_at := now();
        return new;
      end;
      $inner$;
    $func$;
  end if;
end;
$$;

create trigger trg_operators_updated_at
  before update on public.operators
  for each row execute function public.set_updated_at();

-- ── 4. RLS ────────────────────────────────────────────────────────
alter table public.operators enable row level security;

-- Helper: ¿el usuario autenticado tiene un rol en esta tienda?
-- Reutiliza has_store_role si ya existe; si no, usa store_members directamente.
do $$
begin
  -- SELECT: cualquier miembro activo de la tienda puede leer operadores
  if not exists (
    select 1 from pg_policies
    where tablename = 'operators' and policyname = 'operators_select'
  ) then
    execute $pol$
      create policy operators_select on public.operators
        for select
        using (
          exists (
            select 1 from public.store_members sm
            where sm.store_id = operators.store_id
              and sm.user_id  = auth.uid()
              and sm.role     in ('owner','admin','operator')
          )
        );
    $pol$;
  end if;

  -- INSERT: solo owner/admin
  if not exists (
    select 1 from pg_policies
    where tablename = 'operators' and policyname = 'operators_insert'
  ) then
    execute $pol$
      create policy operators_insert on public.operators
        for insert
        with check (
          exists (
            select 1 from public.store_members sm
            where sm.store_id = operators.store_id
              and sm.user_id  = auth.uid()
              and sm.role     in ('owner','admin')
          )
        );
    $pol$;
  end if;

  -- UPDATE: solo owner/admin
  if not exists (
    select 1 from pg_policies
    where tablename = 'operators' and policyname = 'operators_update'
  ) then
    execute $pol$
      create policy operators_update on public.operators
        for update
        using (
          exists (
            select 1 from public.store_members sm
            where sm.store_id = operators.store_id
              and sm.user_id  = auth.uid()
              and sm.role     in ('owner','admin')
          )
        );
    $pol$;
  end if;

  -- DELETE: solo owner/admin
  if not exists (
    select 1 from pg_policies
    where tablename = 'operators' and policyname = 'operators_delete'
  ) then
    execute $pol$
      create policy operators_delete on public.operators
        for delete
        using (
          exists (
            select 1 from public.store_members sm
            where sm.store_id = operators.store_id
              and sm.user_id  = auth.uid()
              and sm.role     in ('owner','admin')
          )
        );
    $pol$;
  end if;
end;
$$;

-- ── 5. Verificación ───────────────────────────────────────────────
-- Después de ejecutar, deberías ver la tabla en Table Editor > operators.
-- Para probar, insertá manualmente un operador y verificá que:
--   1. Un miembro con role='operator' puede hacer SELECT pero no INSERT.
--   2. Un miembro con role='owner' puede hacer INSERT y UPDATE.
-- ================================================================
