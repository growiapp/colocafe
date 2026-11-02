-- Stock Durability v0.2: products.stock como saldo teórico confirmado, movido por el servidor al insertar un ítem de venta.
-- PREPARADA, NO APLICADA. Parte del esquema observado en staging (evidencia 20261101T201021Z) y aborta si no lo encuentra.
--
-- Aplicarla NO cambia ningún saldo: el modelo se enciende por local, con una fila en stock_store_activation (stock_activation.sql).
-- Apagarlo tiene un solo camino: active -> sales_paused -> deactivated. En la pausa el servidor rechaza las ventas de ese local y R-B2a las conserva.
-- Mientras un local no esté activado, sus ítems quedan con motivo 'inactive' y sus clientes, viejos o nuevos, siguen como hasta hoy.
--
-- Contrato:
--   * Saldo teórico positivo, cero o negativo (D1). Sin clamps: el faltante queda como número negativo.
--   * Identidad del movimiento = la fila de sale_items, única por (store_id, legacy_id).
--   * BEFORE INSERT no tiene efectos fuera de la fila: un INSERT omitido por ON CONFLICT no descuenta nada.
--   * AFTER INSERT solo corre si la fila se insertó: descuenta y registra lo aplicado, en la misma transacción.
--   * Cualquier error aborta el INSERT completo: no quedan ni ítem ni descuento, y R-B2a reintenta.
--   * A. Venta tardía: el corte es el último conteo o la activación. Sin evidencia temporal fiable no se decide: count_review. Ver sale_items_stock_apply.
--   * B. Un producto ilimitado no recibe UPDATE: ni saldo ni updated_at cambian. Las fixtures técnicas de R-B2a usan ilimitados o nada.
--   * C. Un DELETE devuelve stock_applied_qty solo si el movimiento es posterior al corte. Siempre deja registro en stock_ledger.
--   * D. Conteo (fija el saldo y mueve el corte) y ajuste ± (relativo, no lo mueve) van por stock_apply_adjustment, solo owner/admin.
--   * E. Lo que no descuenta queda con motivo en el ítem. Las incidencias no caducan ni se cierran solas: el motivo vive en la fila del ítem, sobrevive a
--     desactivar y a revertir, y se consulta paginado con sale_items_stock_incidents_idx.
--   * F. El ajuste compara contra el saldo leído bajo lock y devuelve conflict. En un local activado no hay otra vía de escritura.
--   * G. Activado el local, un cliente viejo ya no puede escribir stock: su UPDATE directo falla con STOCK_DIRECT_WRITE.
--   * Ningún cliente puede cambiar products.store_id, en ningún estado: esa era la forma de salir de un local activado.
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
         or stock_applied_reason in ('applied', 'inactive', 'unlimited', 'unresolved', 'store_mismatch', 'no_identity', 'before_count', 'count_review', 'transition_review'));

create index if not exists sale_items_stock_incidents_idx on public.sale_items (store_id, stock_applied_at desc, id desc)
  where stock_applied_reason in ('unresolved', 'store_mismatch', 'no_identity', 'count_review', 'transition_review');

-- Una fila = el local usó o usa este modelo. Solo se escribe desde el SQL Editor: ningún cliente puede encenderlo ni apagarlo.
-- La fila no se borra al desactivar: sigue diciendo que ese local tiene incidencias que consultar. Sobrevive al rollback por lo mismo.
create table if not exists public.stock_store_activation (
  store_id uuid primary key references public.stores(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'sales_paused', 'deactivated')),
  activated_at timestamptz not null default clock_timestamp(),
  activated_by text,
  paused_at timestamptz,
  deactivated_at timestamptz
);
alter table public.stock_store_activation enable row level security;
alter table public.stock_store_activation force row level security;
drop policy if exists stock_store_activation_select_members on public.stock_store_activation;
create policy stock_store_activation_select_members on public.stock_store_activation for select
  using (public.is_store_member(store_id));
revoke all on table public.stock_store_activation from public, anon, authenticated;
grant select on table public.stock_store_activation to authenticated;

-- Un cliente en modo servidor no descuenta en su dispositivo: si el servidor deja de descontar sin que él lo sepa, esa venta no descuenta en ningún lado.
-- Por eso nada salta de active a deactivated, ni con un DELETE: la pausa es obligatoria. Una cascada desde stores llega con profundidad > 1.
create or replace function public.stock_store_activation_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'STOCK_TRANSITION: un local no se desactiva borrando la fila; usar sales_paused y después deactivated';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'active';
    new.activated_at := clock_timestamp();
    new.paused_at := null;
    new.deactivated_at := null;
    return new;
  end if;
  if new.store_id is distinct from old.store_id then
    raise exception 'STOCK_TRANSITION: la fila no cambia de local';
  end if;
  new.activated_at := old.activated_at;
  new.paused_at := old.paused_at;
  new.deactivated_at := old.deactivated_at;
  if new.status = old.status then return new; end if;
  if old.status = 'active' and new.status = 'sales_paused' then
    new.paused_at := clock_timestamp();
  elsif old.status = 'sales_paused' and new.status = 'deactivated' then
    new.deactivated_at := clock_timestamp();
  elsif old.status = 'sales_paused' and new.status = 'active' then
    new.paused_at := null; -- pausa abortada: el régimen no cambió y el corte tampoco
  elsif old.status = 'deactivated' and new.status = 'active' then
    new.activated_at := clock_timestamp(); -- corte nuevo: lo anterior ya no descontó acá
    new.paused_at := null;
    new.deactivated_at := null;
  else
    raise exception 'STOCK_TRANSITION: de % a % no está permitido', old.status, new.status;
  end if;
  return new;
end;
$$;

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
  created_at timestamptz not null default clock_timestamp()
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
  -- Fail-closed: durante el corte no entra nada. El error deja la venta en error o partial_error en el dispositivo, y R-B2a la reintenta.
  if exists (select 1 from public.stock_store_activation a where a.store_id = new.store_id and a.status = 'sales_paused') then
    raise exception 'STOCK_SALES_PAUSED: ventas en pausa por mantenimiento de stock; quedan guardadas en el dispositivo' using errcode = '55000';
  end if;
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

-- Orden de movimientos: el lock de la fila del producto serializa descuentos, conteos y compensaciones. now() es el inicio de la transacción,
-- que puede ser anterior al lock y por lo tanto contar otro orden; por eso las marcas se toman con clock_timestamp() ya con el lock tomado,
-- y el lock dura hasta el commit: la marca de quien entró después siempre es posterior.
-- ponytail: depende de que el reloj del servidor no retroceda; un contador por producto lo evitaría, si un ajuste de NTP llegara a importar.
--
-- Corre solo si la fila existe. El lock de la fila del producto serializa ventas y conteos: el corte se lee ya bajo ese lock.
-- lock_timeout: si el producto está bloqueado demasiado tiempo, el INSERT falla entero y R-B2a lo reintenta.
--
-- A. Corte = último conteo o activación, el más reciente. El servidor solo conoce un hecho propio: cuándo recibió la cabecera. sold_at viene del
-- reloj del dispositivo y la metadata la escribe el cliente, así que ninguno prueba nada por sí solo. Pero si sold_at coincide con la recepción
-- (±5 min), la venta se registró en línea y con el reloj sano, y entonces la recepción fecha la venta:
--   recepción y sold_at antes del corte        -> before_count: ya estaba vendida. No descuenta.
--   recepción 5 min o más después del corte    -> applied. Con el ±5 min de arriba, sold_at tampoco queda antes del corte.
--   recepción y sold_at a lados opuestos       -> count_review: la evidencia se contradice, en cualquier sentido.
--   recepción en los 5 min que siguen al corte -> count_review.
--   sold_at no coincide con la recepción       -> count_review, sea venta sin conexión o reloj desviado, adelantado o atrasado. Una cabecera vieja
--                                                 con un reloj que no coincide tampoco se da por anterior.
-- count_review no descuenta y queda como incidencia, sin cerrarse sola: la decide una persona, y un ajuste ± aplica lo que corresponda.
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
  v_status text;
  v_activated timestamptz;
  v_deactivated timestamptz;
  v_counted timestamptz;
  v_unlimited boolean;
  v_cut timestamptz;
  v_created timestamptz;
  v_sold timestamptz;
begin
  select a.status, a.activated_at, a.deactivated_at into v_status, v_activated, v_deactivated
    from public.stock_store_activation a where a.store_id = new.store_id;
  if v_status is null then
    v_reason := 'inactive';
  elsif v_status = 'deactivated' then
    -- G. Modo local: el dispositivo descuenta y el servidor no. Salvo una venta del régimen anterior o de un cliente que todavía se cree en modo servidor,
    -- que no descontó en ningún lado: queda como incidencia. La metadata solo puede sumar revisión, nunca evitar ni aplicar un descuento.
    select s.created_at, s.sold_at into v_created, v_sold from public.sales s where s.id = new.sale_id;
    v_reason := case when new.metadata->>'stock_client_mode' = 'server' or v_created < v_deactivated or v_sold < v_deactivated
                     then 'transition_review' else 'inactive' end;
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
      if v_sold not between v_created - interval '5 minutes' and v_created + interval '5 minutes' then
        v_reason := 'count_review';
      elsif v_created < v_cut and v_sold < v_cut then
        v_reason := 'before_count';
      elsif v_created >= v_cut + interval '5 minutes' then
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
     set stock_applied_qty = v_qty, stock_applied_reason = v_reason, stock_applied_at = clock_timestamp()
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
  v_status text;
  v_activated timestamptz;
  v_counted timestamptz;
  v_balance numeric;
begin
  if coalesce(old.stock_applied_qty, 0) = 0 then return null; end if; -- no movió nada: sin UPDATE y sin registro
  select a.status, a.activated_at into v_status, v_activated from public.stock_store_activation a where a.store_id = old.store_id;
  select p.stock_counted_at into v_counted from public.products p
   where p.id = old.product_id and p.store_id = old.store_id for update;
  if not found or v_status is distinct from 'active' or old.stock_applied_at <= greatest(v_counted, v_activated) then
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

-- A. La recepción de la cabecera es la única hora del servidor que usa la clasificación: un cliente no la elige ni la cambia.
-- Sin SECURITY DEFINER por la misma razón que products_stock_guard. No toca sold_at ni ningún dato comercial.
create or replace function public.sales_stock_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and exists (select 1 from public.stock_store_activation a where a.store_id = new.store_id and a.status = 'sales_paused') then
    raise exception 'STOCK_SALES_PAUSED: ventas en pausa por mantenimiento de stock; quedan guardadas en el dispositivo' using errcode = '55000';
  end if;
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.created_at := clock_timestamp();
    else
      new.created_at := old.created_at;
    end if;
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
  -- Sin esto, un owner de dos locales saca el producto del activado, escribe el saldo en el otro y lo devuelve.
  if new.store_id is distinct from old.store_id then
    raise exception 'STOCK_STORE_IMMUTABLE: un producto no se traslada de local';
  end if;
  if new.stock_counted_at is distinct from old.stock_counted_at then
    raise exception 'STOCK_DIRECT_WRITE: stock_counted_at lo escribe solo el servidor';
  end if;
  if new.stock is distinct from old.stock
     and exists (select 1 from public.stock_store_activation a where a.store_id = old.store_id and a.status <> 'deactivated') then
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
  if not exists (select 1 from public.stock_store_activation a where a.store_id = p_store and a.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'inactive');
  end if;
  select p.stock, p.unlimited into v_stock, v_unlimited from public.products p
   where p.id = p_product and p.store_id = p_store for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_unlimited then return jsonb_build_object('ok', false, 'code', 'unlimited'); end if;
  if v_stock <> p_expected then return jsonb_build_object('ok', false, 'code', 'conflict', 'stock', v_stock); end if;
  update public.products
     set stock = case when p_kind = 'count' then p_value else stock + p_value end,
         stock_counted_at = case when p_kind = 'count' then clock_timestamp() else stock_counted_at end
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
revoke all on function public.sales_stock_guard() from public, anon, authenticated;
revoke all on function public.stock_store_activation_guard() from public, anon, authenticated;
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
create trigger stock_store_activation_guard before insert or update or delete on public.stock_store_activation
  for each row execute function public.stock_store_activation_guard();
create trigger sales_stock_guard before insert or update on public.sales
  for each row execute function public.sales_stock_guard();
create trigger products_stock_guard before insert or update on public.products
  for each row execute function public.products_stock_guard();

notify pgrst, 'reload schema';

commit;
