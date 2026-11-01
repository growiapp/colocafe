-- Reversión de stock_durability.sql. PREPARADA, NO APLICADA. Se puede correr más de una vez.
--
-- Deja de mover stock desde el servidor. No revierte ni repite descuentos: products.stock queda como está.
-- Las columnas nuevas y stock_ledger se conservan como registro inerte. Un ítem insertado sin los triggers queda con stock_applied_* en
-- NULL, que significa que no movió stock. Reactivar el modelo requiere una nueva activación y un conteo (stock_activation.sql).
--
-- Clientes: al desaparecer stock_store_activation, el cliente v0.2 vuelve solo al modo local en la lectura siguiente. Los clientes viejos
-- vuelven a poder escribir stock.
--
-- Saldos negativos: no se recortan, porque eso cambiaría el saldo. Tampoco vuelve products_stock_check NOT VALID: NOT VALID solo perdona a
-- las filas viejas mientras nadie las toca, y cualquier UPDATE de esa fila, aunque sea del nombre, volvería a evaluar el CHECK y fallaría.
-- Con negativos el CHECK queda afuera y sigue products_stock_finite_check. Conciliados esos productos, correr este archivo otra vez lo
-- restablece validado. Mientras tanto ningún cliente genera negativos nuevos: viejos y v0.2 en modo local recortan a 0 y ya no hay trigger.

begin;

drop trigger if exists sale_items_stock_prepare on public.sale_items;
drop trigger if exists sale_items_stock_apply on public.sale_items;
drop trigger if exists sale_items_stock_compensate on public.sale_items;
drop trigger if exists sale_items_stock_guard on public.sale_items;
drop trigger if exists products_stock_guard on public.products;

drop function if exists public.sale_items_stock_prepare();
drop function if exists public.sale_items_stock_apply();
drop function if exists public.sale_items_stock_compensate();
drop function if exists public.sale_items_stock_guard();
drop function if exists public.products_stock_guard();
drop function if exists public.stock_apply_adjustment(uuid, uuid, text, numeric, numeric);

drop table if exists public.stock_store_activation;

-- Sin escrituras concurrentes entre contar y validar.
lock table public.products in share row exclusive mode;

do $$
declare
  v_negativos bigint;
begin
  select count(*) into v_negativos from public.products where stock < 0;
  if v_negativos > 0 then
    raise warning 'STOCK_ROLLBACK: % producto(s) con saldo negativo; products_stock_check queda afuera hasta conciliarlos y volver a correr este archivo', v_negativos;
    return;
  end if;
  alter table public.products drop constraint if exists products_stock_check;
  alter table public.products add constraint products_stock_check check (stock >= (0)::numeric);
  alter table public.products drop constraint if exists products_stock_finite_check;
end;
$$;

notify pgrst, 'reload schema';

commit;
