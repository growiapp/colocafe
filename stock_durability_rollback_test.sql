-- Prueba de stock_durability_rollback.sql. NO EJECUTADA. Solo en un entorno de pruebas, inmediatamente después del rollback y con al menos
-- un saldo negativo para cubrir el caso que importa. Termina en ROLLBACK.
-- Antes, con un local todavía activo: correr el rollback tiene que abortar con STOCK_ROLLBACK y dejar triggers y saldos intactos.

begin;

do $$
declare
  v_p uuid;
  n int;
begin
  assert to_regclass('public.stock_store_activation') is not null, 'el estado se conserva: el cliente sigue viendo sus incidencias';
  assert not exists (select 1 from public.stock_store_activation where status <> 'deactivated'), 'el rollback exige locales desactivados';
  assert exists (select 1 from pg_constraint where conname = 'stock_store_activation_rolled_back'), 'sin triggers, el CHECK impide reactivar';
  begin
    update public.stock_store_activation set status = 'active';
    if found then raise exception 'ROLLBACK_TEST: se pudo reactivar sin migración'; end if;
  exception when check_violation then null;
  end;
  assert to_regclass('public.stock_ledger') is not null, 'el registro se conserva';
  assert to_regprocedure('public.stock_apply_adjustment(uuid,uuid,text,numeric,numeric)') is null, 'la función de ajuste se fue';
  assert not exists (select 1 from pg_trigger where not tgisinternal and tgname like '%stock%'
                      and tgrelid in ('public.products'::regclass, 'public.sale_items'::regclass, 'public.sales'::regclass, 'public.stock_store_activation'::regclass)), 'sin triggers de stock';

  select id into v_p from public.products where stock < 0 limit 1;
  if v_p is null then
    assert exists (select 1 from pg_constraint where conname = 'products_stock_check' and conrelid = 'public.products'::regclass and convalidated),
      'sin negativos: el CHECK original vuelve validado';
    raise notice 'stock_durability_rollback_test: sin saldos negativos, caso principal NO cubierto';
    return;
  end if;

  assert not exists (select 1 from pg_constraint where conname = 'products_stock_check' and conrelid = 'public.products'::regclass),
    'con negativos: el CHECK no vuelve, ni siquiera NOT VALID';
  update public.products set name = name || ' (rollback)' where id = v_p;
  get diagnostics n = row_count;
  assert n = 1, 'un producto con saldo negativo se puede seguir actualizando';
  assert (select stock < 0 from public.products where id = v_p), 'el saldo no se recortó';
  raise notice 'stock_durability_rollback_test: OK';
end;
$$;

rollback;
