-- Reversión de stock_durability.sql. PREPARADA, NO APLICADA.
--
-- Deja de mover stock desde el servidor. No revierte ni repite descuentos: products.stock queda como está.
-- Las columnas nuevas se conservan como registro inerte. Un ítem insertado sin los triggers queda con stock_applied_* en NULL,
-- que significa que no movió stock. Reactivar el modelo requiere una nueva decisión de activación (G).
--
-- Si hay saldos negativos, no se recortan a cero, porque eso cambiaría el saldo: products_stock_check vuelve como NOT VALID y
-- solo rige para escrituras nuevas. Validarlo queda pendiente de conciliar esos productos.

begin;

drop trigger if exists sale_items_stock_prepare on public.sale_items;
drop trigger if exists sale_items_stock_apply on public.sale_items;
drop trigger if exists sale_items_stock_guard on public.sale_items;
drop trigger if exists products_stock_count_guard on public.products;

drop function if exists public.sale_items_stock_prepare();
drop function if exists public.sale_items_stock_apply();
drop function if exists public.sale_items_stock_guard();
drop function if exists public.products_stock_count_guard();

alter table public.products drop constraint if exists products_stock_finite_check;
alter table public.products drop constraint if exists products_stock_check;
alter table public.products add constraint products_stock_check check (stock >= (0)::numeric) not valid;

do $$
declare
  v_negativos bigint;
begin
  select count(*) into v_negativos from public.products where stock < 0;
  if v_negativos = 0 then
    alter table public.products validate constraint products_stock_check;
  else
    raise warning 'STOCK_ROLLBACK: % producto(s) con saldo negativo; products_stock_check queda NOT VALID', v_negativos;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
