-- Stock Durability v0.2: products.stock como saldo teórico confirmado, movido por el servidor al insertar un ítem de venta.
-- PREPARADA, NO APLICADA. Parte del esquema observado en staging (evidencia 20261101T201021Z) y aborta si no lo encuentra.
--
-- Aplicarla NO cambia ningún saldo: el modelo se enciende por local, con una fila en stock_store_activation (stock_activation.sql).
-- Mientras un local no esté activado, sus ítems quedan con motivo 'inactive' y sus clientes, viejos o nuevos, siguen como hasta hoy.
--
-- Contrato:
--   * Saldo teórico positivo, cero o negativo (D1). Sin clamps: el faltante queda como número negativo.
--   * Identidad del movimiento = la fila de sale_items, única por (store_id, legacy_id).
--   * BEFORE INSERT no tiene efectos fuera de la fila: un INSERT omitido por ON CONFLICT no descuenta nada.
--   * AFTER INSERT solo corre si la fila se insertó: descuenta y registra lo aplicado, en la misma transacción.
--   * Cualquier error aborta el INSERT completo: no quedan ni ítem ni descuento, y R-B2a reintenta.
--   * A. Venta tardía: el corte es el último conteo o la activación. Ver la clasificación en sale_items_stock_apply.
--   * B. Un producto ilimitado no recibe UPDATE: ni saldo ni updated_at cambian. Las fixtures técnicas de R-B2a usan ilimitados o nada.
--   * C. Un DELETE devuelve stock_applied_qty solo si el movimiento es posterior al corte. Siempre deja registro en stock_ledger.
--   * D. Conteo (fija el saldo y mueve el corte) y ajuste ± (relativo, no lo mueve) van por stock_apply_adjustment, solo owner/admin.
--   * E. Lo que no descuenta queda con motivo en el ítem; unresolved, store_mismatch, count_review y no_identity se muestran como incidencia.
--   * F. El ajuste compara contra el saldo leído bajo lock y devuelve conflict. En un local activado no hay otra vía de escritura.
--   * G. Activado el local, un cliente viejo ya no puede escribir stock: su UPDATE directo falla con STOCK_DIRECT_WRITE.
--
-- Reversión: stock_durability_rollback.sql. Pruebas: stock_durability_test.sql, stock_durability_concurrency_test.sql y stock_durability_rollback_test.sql.

begin;

do $$
begin
  -- Después de un rollback con saldos negativos el CHECK original no vuelve: reaplicar también tiene que poder pasar.
  if not exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass
                  and conname in ('products_stock_check', 'products_stock_finite_check')) then
    raise exception 'STOCK_PRECHECK: falta products_stock_check; el esquema no es el observado';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.sale_items'::regclass and conname = 'sale_items_product_id_fkey'
                  and confrelid = 'public.products'::regclass and confdeltype = 'n') then
    raise exception 'STOCK_PRECHECK: falta sale_items_product_id_fkey ON DELETE SET NULL';
  end if;
  if not exists (select 1 from pg_index x join pg_class i on i.oid = x.indexrelid
                  where x.indrelid = 'public.sale_items'::regclass and i.relname = 'sale_items_store_legacy_unique_idx'
                    and x.indisunique and x.indisvalid) then
    raise exception 'STOCK_PRECHECK: falta el índice único válido sale_items_store_legacy_unique_idx';
  end if;
  if to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.has_store_role(uuid,public.store_user_role[])') is null
     or to_regprocedure('public.is_store_member(uuid)') is null then
    raise exception 'STOCK_PRECHECK: faltan auth.uid, has_store_role o is_store_member';
  end if;
end;
$$;

-- D1: saldo negativo permitido. Lo que sigue prohibido es un valor no numérico, que rompería la aritmética.
alter table public.products drop constraint if exists products_stock_check;
alter table public.products drop constraint if exists products_stock_finite_check;
alter table public.products add constraint products_stock_finite_check
  check (stock not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric));

alter table public.products add column if not exists stock_counted_at timestamptz;

-- NULL en los tres = ítem anterior a este modelo: nunca movió stock.
alter table public.sale_items
  add column if not exists stock_applied_qty numeric,
  add column if not exists stock_applied_reason text,
  add column if not exists stock_applied_at timestamptz;
alter table public.sale_items drop constraint if exists sale_items_stock_applied_reason_check;
alter table public.sale_items add constraint sale_items_stock_applied_reason_check
  check (stock_applied_reason is null
         or stock_applied_reason in ('applied', 'inactive', 'unlimited', 'unresolved', 'store_mismatch', 'no_identity', 'before_count', 'count_review'));

-- Una fila = el local usa este modelo. Solo se escribe desde el SQL Editor: ningún cliente puede encenderlo ni apagarlo.
create table public.stock_store_activation (
  store_id uuid primary key references public.stores(id) on delete cascade,
  activated_at timestamptz not null default now(),
  activated_by text
);
alter table public.stock_store_activation enable row level security;
alter table public.stock_store_activation force row level security;
create policy stock_store_activation_select_members on public.stock_store_activation for select
  using (public.is_store_member(store_id));
revoke all on table public.stock_store_activation from public, anon, authenticated;
grant select on table public.stock_store_activation to authenticated;

-- Registro de conteos, ajustes y borrados: al borrar un ítem su fila desaparece, y esto es lo que queda. Sin FK: tiene que
-- poder escribirse durante la cascada de un local o producto que se está borrando, y sobrevivirle. Sobrevive también al rollback.
create table if not exists public.stock_ledger (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  product_id uuid,
  kind text not null check (kind in ('count', 'adjust', 'delete_compensation', 'delete_no_compensation')),
  delta numeric not null,
  balance_after numeric,
  sale_item_legacy_id text,
  actor uuid,
  created_at timestamptz not null default now()
);
alter table public.stock_ledger enable row level security;
alter table public.stock_ledger force row level security;
drop policy if exists stock_ledger_select_members on public.stock_ledger;
create policy stock_ledger_select_members on public.stock_ledger for select
  using (public.is_store_member(store_id));
revoke all on table public.stock_ledger from public, anon, authenticated;
grant select on table public.stock_ledger to authenticated;

-- Sin efectos fuera de la fila. Descarta lo que mande el cliente en los campos del servidor y resuelve el producto dentro del
-- mismo local con las referencias que el cliente ya guarda en metadata.
create or replace function public.sale_items_stock_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
begin
  new.stock_applied_qty := null;
  new.stock_applied_reason := null;
  new.stock_applied_at := null;
  if new.product_id is null then
    foreach v_ref in array array[new.metadata->>'product_legacy_id', new.metadata->>'prodId'] loop
      if nullif(btrim(v_ref), '') is not null then
        select p.id into new.product_id from public.products p
         where p.store_id = new.store_id and p.legacy_id = v_ref;
        exit when new.product_id is not null;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- Corre solo si la fila existe. El lock de la fila del producto serializa ventas y conteos: el corte se lee ya bajo ese lock.
-- lock_timeout: si el producto está bloqueado demasiado tiempo, el INSERT falla entero y R-B2a lo reintenta.
--
-- A. Corte = último conteo o activación, el más reciente. ¿La venta es anterior? De más fuerte a más débil:
--   1. La cabecera ya estaba en el servidor antes del corte (reloj del servidor): anterior, no descuenta.
--   2. El dispositivo ya había visto ese corte al vender (metadata.stock_cut_seen, un valor que emitió el servidor): posterior, descuenta.
--      Ni un reloj atrasado ni uno adelantado cambian este caso.
--   3. Dispositivo que no vio el corte: solo queda sold_at, su reloj. Con un margen de 5 minutos a cada lado decide; dentro del margen
--      no descuenta y queda count_review, visible como incidencia. El conteo es la última verdad física y un ajuste ± lo corrige.
-- ponytail: margen fijo. Con un reloj desviado más de 5 min y sin haber visto el corte, el caso 3 puede errar; subir el margen si pasa.
create or replace function public.sale_items_stock_apply()
returns trigger
language plpgsql
security definer
set search_path = public
set lock_timeout = '3s'
as $$
declare
  v_qty numeric := 0;
  v_reason text;
  v_activated timestamptz;
  v_counted timestamptz;
  v_unlimited boolean;
  v_cut timestamptz;
  v_seen timestamptz;
  v_created timestamptz;
  v_sold timestamptz;
begin
  select a.activated_at into v_activated from public.stock_store_activation a where a.store_id = new.store_id;
  if v_activated is null then
    v_reason := 'inactive';
  elsif nullif(btrim(new.legacy_id), '') is null then
    v_reason := 'no_identity'; -- sin identidad, un reintento no se puede reconocer: no se descuenta
  elsif new.product_id is null then
    v_reason := 'unresolved';
  else
    select p.stock_counted_at, p.unlimited into v_counted, v_unlimited
      from public.products p where p.id = new.product_id and p.store_id = new.store_id for update;
    if not found then
      v_reason := 'store_mismatch';
    elsif v_unlimited then
      v_reason := 'unlimited';
    else
      v_cut := greatest(v_counted, v_activated);
      select s.created_at, s.sold_at into v_created, v_sold from public.sales s where s.id = new.sale_id;
      begin
        v_seen := (new.metadata->>'stock_cut_seen')::timestamptz;
      exception when others then
        v_seen := null; -- un valor ilegible no puede hacer fallar una venta
      end;
      if v_created < v_cut then
        v_reason := 'before_count';
      elsif v_seen >= v_cut then
        v_reason := 'applied';
      elsif v_sold < v_cut - interval '5 minutes' then
        v_reason := 'before_count';
      elsif v_sold > v_cut + interval '5 minutes' then
        v_reason := 'applied';
      else
        v_reason := 'count_review';
      end if;
      if v_reason = 'applied' then
        update public.products set stock = stock - new.quantity where id = new.product_id and store_id = new.store_id;
        v_qty := new.quantity;
      end if;
    end if;
  end if;
  update public.sale_items
     set stock_applied_qty = v_qty, stock_applied_reason = v_reason, stock_applied_at = now()
   where id = new.id;
  return null;
end;
$$;

-- C. Devuelve lo realmente aplicado, nunca quantity. Un movimiento anterior al corte no se devuelve: el conteo ya reflejó la realidad y
-- devolverlo inventaría unidades. Compara relojes del servidor, sin leer sales (en una cascada ya no está). Quién borra lo decide RLS.
create or replace function public.sale_items_stock_compensate()
returns trigger
language plpgsql
security definer
set search_path = public
set lock_timeout = '3s'
as $$
declare
  v_activated timestamptz;
  v_counted timestamptz;
  v_balance numeric;
begin
  if coalesce(old.stock_applied_qty, 0) = 0 then return null; end if; -- no movió nada: sin UPDATE y sin registro
  select a.activated_at into v_activated from public.stock_store_activation a where a.store_id = old.store_id;
  select p.stock_counted_at into v_counted from public.products p
   where p.id = old.product_id and p.store_id = old.store_id for update;
  if not found or v_activated is null or old.stock_applied_at <= greatest(v_counted, v_activated) then
    insert into public.stock_ledger (store_id, product_id, kind, delta, sale_item_legacy_id, actor)
      values (old.store_id, old.product_id, 'delete_no_compensation', 0, old.legacy_id, auth.uid());
    return null;
  end if;
  update public.products set stock = stock + old.stock_applied_qty where id = old.product_id returning stock into v_balance;
  insert into public.stock_ledger (store_id, product_id, kind, delta, balance_after, sale_item_legacy_id, actor)
    values (old.store_id, old.product_id, 'delete_compensation', old.stock_applied_qty, v_balance, old.legacy_id, auth.uid());
  return null;
end;
$$;

-- Profundidad > 1 = UPDATE lanzado por otro trigger (el registro de arriba o la acción SET NULL de la FK), nunca por un cliente.
create or replace function public.sale_items_stock_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_commercial_same boolean := new.quantity is not distinct from old.quantity
    and new.store_id is not distinct from old.store_id
    and new.sale_id is not distinct from old.sale_id
    and new.legacy_id is not distinct from old.legacy_id;
  v_applied_same boolean := new.stock_applied_qty is not distinct from old.stock_applied_qty
    and new.stock_applied_reason is not distinct from old.stock_applied_reason
    and new.stock_applied_at is not distinct from old.stock_applied_at;
  v_product_same boolean := new.product_id is not distinct from old.product_id;
begin
  if pg_trigger_depth() > 1 then
    if v_commercial_same and v_product_same and old.stock_applied_at is null then return new; end if; -- registro inicial
    if v_commercial_same and v_applied_same and new.product_id is null then return new; end if;       -- FK ON DELETE SET NULL
    raise exception 'STOCK_ITEM_IMMUTABLE: cambio interno no reconocido en el ítem %', old.id;
  end if;
  if not v_applied_same then
    raise exception 'STOCK_ITEM_IMMUTABLE: los campos stock_applied_* los escribe solo el servidor';
  end if;
  -- Un ítem anterior al modelo no movió stock: se mantiene como estaba.
  if old.stock_applied_at is not null and not (v_commercial_same and v_product_same) then
    raise exception 'STOCK_ITEM_IMMUTABLE: el ítem % ya movió stock', old.id;
  end if;
  return new;
end;
$$;

-- G/F. Sin SECURITY DEFINER a propósito: un cliente llega como anon/authenticated, y los triggers y la función de ajuste corren como su
-- dueño. current_user no se puede falsificar desde PostgREST. Sale de esta guarda todo lo que no es un cliente.
create or replace function public.products_stock_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if tg_op = 'INSERT' then
    new.stock_counted_at := null;
    return new;
  end if;
  if new.stock_counted_at is distinct from old.stock_counted_at then
    raise exception 'STOCK_DIRECT_WRITE: stock_counted_at lo escribe solo el servidor';
  end if;
  if new.stock is distinct from old.stock
     and exists (select 1 from public.stock_store_activation a where a.store_id = old.store_id) then
    raise exception 'STOCK_DIRECT_WRITE: el stock de este local lo gestiona el servidor; actualizá la app';
  end if;
  return new;
end;
$$;

-- D/F. Única vía de escritura de un cliente en un local activado. Compara bajo el lock de la fila: si cambió, no escribe.
create or replace function public.stock_apply_adjustment(p_store uuid, p_product uuid, p_kind text, p_expected numeric, p_value numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '3s'
as $$
declare
  v_stock numeric;
  v_unlimited boolean;
  v_balance numeric;
  v_counted timestamptz;
begin
  if p_kind is null or p_kind not in ('count', 'adjust') or p_expected is null or p_value is null
     or p_expected in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or p_value in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     or (p_kind = 'count' and p_value < 0) or (p_kind = 'adjust' and p_value = 0) then
    raise exception 'STOCK_BAD_INPUT' using errcode = '22023';
  end if;
  if not public.has_store_role(p_store, array['owner', 'admin']::public.store_user_role[]) then
    raise exception 'STOCK_FORBIDDEN' using errcode = '42501'; -- SECURITY DEFINER saltea RLS: el rol se comprueba acá
  end if;
  if not exists (select 1 from public.stock_store_activation a where a.store_id = p_store) then
    return jsonb_build_object('ok', false, 'code', 'inactive');
  end if;
  select p.stock, p.unlimited into v_stock, v_unlimited from public.products p
   where p.id = p_product and p.store_id = p_store for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_unlimited then return jsonb_build_object('ok', false, 'code', 'unlimited'); end if;
  if v_stock <> p_expected then return jsonb_build_object('ok', false, 'code', 'conflict', 'stock', v_stock); end if;
  update public.products
     set stock = case when p_kind = 'count' then p_value else stock + p_value end,
         stock_counted_at = case when p_kind = 'count' then now() else stock_counted_at end
   where id = p_product
   returning stock, stock_counted_at into v_balance, v_counted;
  insert into public.stock_ledger (store_id, product_id, kind, delta, balance_after, actor)
    values (p_store, p_product, p_kind, v_balance - v_stock, v_balance, auth.uid());
  return jsonb_build_object('ok', true, 'stock', v_balance, 'counted_at', v_counted);
end;
$$;

revoke all on function public.sale_items_stock_prepare() from public, anon, authenticated;
revoke all on function public.sale_items_stock_apply() from public, anon, authenticated;
revoke all on function public.sale_items_stock_compensate() from public, anon, authenticated;
revoke all on function public.sale_items_stock_guard() from public, anon, authenticated;
revoke all on function public.products_stock_guard() from public, anon, authenticated;
revoke all on function public.stock_apply_adjustment(uuid, uuid, text, numeric, numeric) from public, anon;
grant execute on function public.stock_apply_adjustment(uuid, uuid, text, numeric, numeric) to authenticated;

create trigger sale_items_stock_prepare before insert on public.sale_items
  for each row execute function public.sale_items_stock_prepare();
create trigger sale_items_stock_apply after insert on public.sale_items
  for each row execute function public.sale_items_stock_apply();
create trigger sale_items_stock_compensate after delete on public.sale_items
  for each row execute function public.sale_items_stock_compensate();
create trigger sale_items_stock_guard before update on public.sale_items
  for each row execute function public.sale_items_stock_guard();
create trigger products_stock_guard before insert or update on public.products
  for each row execute function public.products_stock_guard();

notify pgrst, 'reload schema';

commit;
