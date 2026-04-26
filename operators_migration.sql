-- ================================================================
--  MIGRACIÓN INCREMENTAL: tabla operators
--  Gestiq / Colo Café
--  Reejecutable: usa DROP POLICY IF EXISTS + CREATE TABLE IF NOT EXISTS.
--  RLS usa public.has_store_role() y public.store_user_role enum,
--  igual que el resto del schema existente.
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
comment on column public.operators.normalized_name
  is 'Nombre en minúsculas sin acentos, para deduplicar "Pepe" vs "pepe".';
comment on column public.operators.pin_hash
  is 'Hash del PIN opcional; nunca se expone en la UI normal.';

-- ── 2. Índices ───────────────────────────────────────────────────
create index if not exists idx_operators_store_id
  on public.operators(store_id);
create index if not exists idx_operators_active
  on public.operators(store_id, active);

-- ── 3. Trigger updated_at ─────────────────────────────────────────
-- Reutiliza set_updated_at() si ya existe en el schema (lo tiene el resto
-- de las tablas); si no existe, la crea mínimamente.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname        = 'set_updated_at'
      and pronamespace   = (select oid from pg_namespace where nspname = 'public')
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

-- El trigger es idempotente: lo droppea antes de recrear.
drop trigger if exists trg_operators_updated_at on public.operators;
create trigger trg_operators_updated_at
  before update on public.operators
  for each row execute function public.set_updated_at();

-- ── 4. RLS ────────────────────────────────────────────────────────
alter table public.operators enable row level security;

-- Usar has_store_role() igual que el resto del schema.
-- Cast explícito al enum real: public.store_user_role[]

-- SELECT: owner / admin / operator pueden leer operadores de su tienda
drop policy if exists operators_select on public.operators;
create policy operators_select on public.operators
  for select
  using (
    public.has_store_role(
      store_id,
      array['owner','admin','operator']::public.store_user_role[]
    )
  );

-- INSERT: solo owner / admin pueden crear operadores
drop policy if exists operators_insert on public.operators;
create policy operators_insert on public.operators
  for insert
  with check (
    public.has_store_role(
      store_id,
      array['owner','admin']::public.store_user_role[]
    )
  );

-- UPDATE: solo owner / admin pueden modificar (activar/desactivar, etc.)
drop policy if exists operators_update on public.operators;
create policy operators_update on public.operators
  for update
  using (
    public.has_store_role(
      store_id,
      array['owner','admin']::public.store_user_role[]
    )
  );

-- DELETE: solo owner / admin
drop policy if exists operators_delete on public.operators;
create policy operators_delete on public.operators
  for delete
  using (
    public.has_store_role(
      store_id,
      array['owner','admin']::public.store_user_role[]
    )
  );

-- ── 5. Grant a authenticated ──────────────────────────────────────
-- Necesario para que los clientes autenticados puedan operar sobre la tabla.
grant select, insert, update, delete on public.operators to authenticated;

-- ── 6. Verificación sugerida ──────────────────────────────────────
-- Después de ejecutar, corré estas queries como verificación:
--
--   -- Tabla creada:
--   select count(*) from public.operators;
--
--   -- Policies existentes:
--   select policyname, cmd from pg_policies where tablename = 'operators';
--
--   -- Trigger activo:
--   select trigger_name from information_schema.triggers
--   where event_object_table = 'operators';
--
-- Para probar permisos:
--   1. Iniciá sesión como usuario con role='operator':
--      → debe poder SELECT, no puede INSERT.
--   2. Iniciá sesión como usuario con role='owner' o 'admin':
--      → puede SELECT, INSERT, UPDATE, DELETE.
-- ================================================================
