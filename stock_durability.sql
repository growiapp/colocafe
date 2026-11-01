-- Stock Durability v0.1: products.stock como saldo teórico confirmado, movido por el servidor al insertar un ítem de venta.
-- PREPARADA, NO APLICADA. Parte del esquema observado en staging (evidencia 20261101T201021Z) y aborta si no lo encuentra.
--
-- Contrato:
--   * Saldo teórico positivo, cero o negativo (D1). Sin clamps: el faltante queda como número negativo.
--   * Identidad del movimiento = la fila de sale_items, única por (store_id, legacy_id).
--   * BEFORE INSERT no tiene efectos fuera de la fila: un INSERT omitido por ON CONFLICT no descuenta nada.
--   * AFTER INSERT solo corre si la fila se insertó: descuenta y registra lo aplicado, en la misma transacción.
--   * Cualquier error aborta el INSERT completo: no quedan ni ítem ni descuento, y R-B2a reintenta.
--
-- Queda fuera, a la espera de decisiones de negocio:
--   * DELETE no restaura unidades (decisión C). No hay trigger de DELETE.
--   * stock_counted_at solo se sella en el servidor: nada lo usa para decidir un descuento (decisiones A y D).
--
-- Reversión: stock_durability_rollback.sql. Pruebas: stock_durability_test.sql y stock_durability_concurrency_test.sql.

begin;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_stock_check') then
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
end;
$$;

-- D1: saldo negativo permitido. Lo que sigue prohibido es un valor no numérico, que rompería la aritmética.
alter table public.products drop constraint products_stock_check;
alter table public.products add constraint products_stock_finite_check
  check (stock not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric));

alter table public.products add column if not exists stock_counted_at timestamptz;

-- NULL en los tres = ítem anterior a este modelo: nunca movió stock.
alter table public.sale_items
  add column if not exists stock_applied_qty numeric,
  add column if not exists stock_applied_reason text,
  add column if not exists stock_applied_at timestamptz;
alter table public.sale_items add constraint sale_items_stock_applied_reason_check
  check (stock_applied_reason is null
         or stock_applied_reason in ('applied', 'unlimited', 'unresolved', 'store_mismatch', 'no_identity'));

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

-- Corre solo si la fila existe. El UPDATE relativo toma el lock de la fila del producto: dos ventas concurrentes se serializan.
-- lock_timeout: si el producto está bloqueado demasiado tiempo, el INSERT falla entero y R-B2a lo reintenta.
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
begin
  if nullif(btrim(new.legacy_id), '') is null then
    v_reason := 'no_identity'; -- sin identidad, un reintento no se puede reconocer: no se descuenta
  elsif new.product_id is null then
    v_reason := 'unresolved';
  else
    update public.products set stock = stock - new.quantity
     where id = new.product_id and store_id = new.store_id and not unlimited;
    if found then
      v_qty := new.quantity;
      v_reason := 'applied';
    elsif exists (select 1 from public.products where id = new.product_id and store_id = new.store_id) then
      v_reason := 'unlimited';
    else
      v_reason := 'store_mismatch';
    end if;
  end if;
  update public.sale_items
     set stock_applied_qty = v_qty, stock_applied_reason = v_reason, stock_applied_at = now()
   where id = new.id;
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

-- El cliente solo puede señalar un conteo. La hora siempre es la del servidor.
create or replace function public.products_stock_count_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.stock_counted_at is not null then new.stock_counted_at := now(); end if;
  elsif new.stock_counted_at is distinct from old.stock_counted_at then
    new.stock_counted_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.sale_items_stock_prepare() from public, anon, authenticated;
revoke all on function public.sale_items_stock_apply() from public, anon, authenticated;
revoke all on function public.sale_items_stock_guard() from public, anon, authenticated;
revoke all on function public.products_stock_count_guard() from public, anon, authenticated;

create trigger sale_items_stock_prepare before insert on public.sale_items
  for each row execute function public.sale_items_stock_prepare();
create trigger sale_items_stock_apply after insert on public.sale_items
  for each row execute function public.sale_items_stock_apply();
create trigger sale_items_stock_guard before update on public.sale_items
  for each row execute function public.sale_items_stock_guard();
create trigger products_stock_count_guard before insert or update on public.products
  for each row execute function public.products_stock_count_guard();

notify pgrst, 'reload schema';

commit;
