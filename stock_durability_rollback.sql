-- Reversión de stock_durability.sql. PREPARADA, NO APLICADA. Se puede correr más de una vez.
--
-- Deja de mover stock desde el servidor. No revierte ni repite descuentos: products.stock queda como está.
-- Las columnas nuevas y stock_ledger se conservan como registro inerte. Un ítem insertado sin los triggers queda con stock_applied_* en
-- NULL, que significa que no movió stock. Reactivar el modelo requiere una nueva activación y un conteo (stock_activation.sql).
--
-- Requisito, no atajo: todo local tiene que estar en 'deactivated' (stock_activation.sql). Con un local activo o en pausa este archivo aborta sin tocar nada:
-- quitar los triggers con clientes en modo servidor dejaría ventas sin descuento en ningún lado.
--
-- Clientes: stock_store_activation se conserva, con las filas en 'deactivated': el cliente v0.2 sigue en modo local y sigue pudiendo consultar incidencias.
-- Los clientes viejos vuelven a poder escribir stock. Sin triggers ya no se clasifica: una venta de un cliente que seguía en modo servidor queda con
-- stock_applied_at NULL y metadata.stock_client_mode = 'server'. La consulta está en el paso CONCILIAR de stock_activation.sql.
--
-- Saldos negativos: no se recortan, porque eso cambiaría el saldo. Tampoco vuelve products_stock_check NOT VALID: NOT VALID solo perdona a
-- las filas viejas mientras nadie las toca, y cualquier UPDATE de esa fila, aunque sea del nombre, volvería a evaluar el CHECK y fallaría.
-- Con negativos el CHECK queda afuera y sigue products_stock_finite_check. Conciliados esos productos, correr este archivo otra vez lo
-- restablece validado. Mientras tanto ningún cliente genera negativos nuevos: viejos y v0.2 en modo local recortan a 0 y ya no hay trigger.

begin;

-- Los locks van antes del precheck y duran hasta el commit: una reactivación concurrente espera, y al entrar choca con el CHECK de abajo.
-- Orden: activación, y después las tablas en el orden en que las toma una venta. Si no se consiguen rápido, falla sin haber tocado nada.
set local lock_timeout = '10s';
lock table public.stock_store_activation in share row exclusive mode;
lock table public.sales, public.sale_items, public.products in access exclusive mode;

do $$
begin
  if exists (select 1 from public.stock_store_activation where status <> 'deactivated') then
    raise exception 'STOCK_ROLLBACK: hay locales sin desactivar; primero sales_paused y deactivated (stock_activation.sql)';
  end if;
end;
$$;

drop trigger if exists sale_items_stock_prepare on public.sale_items;
drop trigger if exists sale_items_stock_apply on public.sale_items;
drop trigger if exists sale_items_stock_compensate on public.sale_items;
drop trigger if exists sale_items_stock_guard on public.sale_items;
drop trigger if exists products_stock_guard on public.products;
drop trigger if exists sales_stock_guard on public.sales;
drop trigger if exists sales_stock_gate on public.sales;
drop trigger if exists products_stock_gate on public.products;
drop trigger if exists stock_store_activation_guard on public.stock_store_activation;
alter table public.stock_store_activation drop constraint if exists stock_store_activation_rolled_back; -- correr el archivo otra vez

drop function if exists public.sale_items_stock_prepare();
drop function if exists public.sale_items_stock_apply();
drop function if exists public.sale_items_stock_compensate();
drop function if exists public.sale_items_stock_guard();
drop function if exists public.products_stock_guard();
drop function if exists public.sales_stock_guard();
drop function if exists public.sales_stock_gate();
drop function if exists public.products_stock_gate();
drop function if exists public.stock_store_activation_guard();
drop function if exists public.stock_apply_adjustment(uuid, uuid, text, numeric, numeric);

-- Sin triggers ya nada frena un update a 'active', y un cliente pasaría a modo servidor sin descuento en ningún lado. Reactivar exige reaplicar la migración.
alter table public.stock_store_activation add constraint stock_store_activation_rolled_back check (status = 'deactivated');

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
