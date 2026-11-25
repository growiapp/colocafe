-- Colo Café · auditoría ola 1 · FIXTURES de staging (local sintético). SOLO STAGING (proyecto wjymdgfqmqutihadffec). NUNCA producción.
-- Escribe únicamente: 1 local, 3 membresías, 1 categoría, 1 operador y 6 productos, todos con uuid fijo prefijo e2e02026- y legacy_id ZZE2E-.
-- Atómico (un solo begin/commit): ante cualquier error no queda nada. No modifica ni lee datos de otros locales (salvo contar auth.users).
begin;
do $$
begin
  if exists (select 1 from public.stores where id = 'e2e02026-1123-4122-8000-000000000001' or legacy_id = 'ZZE2E-STORE' or name like 'ZZ_E2E%') then raise exception 'OLA1_FIXTURE_EXISTS'; end if;
  if exists (select 1 from public.products where legacy_id like 'ZZE2E-%') then raise exception 'OLA1_FIXTURE_EXISTS_PRODUCTS'; end if;
  if (select count(*) from auth.users where id::text like '7cd84c4f%' or id::text like '48075b31%' or id::text like 'eef11ffb%') <> 3 then raise exception 'OLA1_USERS_NO_SON_3'; end if;
  if exists (select 1 from public.stock_store_activation) then raise exception 'OLA1_STOCK_ACTIVATION_NO_VACIO'; end if; -- Stock Durability debe seguir inactivo
end $$;

insert into public.stores (id, legacy_id, name) values ('e2e02026-1123-4122-8000-000000000001', 'ZZE2E-STORE', 'ZZ_E2E_OLA1_20261125');
insert into public.store_users (store_id, user_id, role, active, joined_at)
select 'e2e02026-1123-4122-8000-000000000001', id, (case when id::text like '7cd84c4f%' then 'owner' when id::text like 'eef11ffb%' then 'admin' else 'operator' end)::public.store_user_role, true, now()
  from auth.users where id::text like '7cd84c4f%' or id::text like '48075b31%' or id::text like 'eef11ffb%';
insert into public.categories (id, store_id, legacy_id, name) values ('e2e02026-1123-4122-8000-0000000000c1', 'e2e02026-1123-4122-8000-000000000001', 'ZZE2E-CAT', 'ZZE2E Cat');
insert into public.operators (id, store_id, name, normalized_name) values ('e2e02026-1123-4122-8000-0000000000a1', 'e2e02026-1123-4122-8000-000000000001', 'ZZE2E Operador', 'zze2e operador');
insert into public.products (id, store_id, legacy_id, category_id, name, price, stock, unlimited)
select ('e2e02026-1123-4122-8000-0000000001' || n)::uuid, 'e2e02026-1123-4122-8000-000000000001', 'ZZE2E-P' || n, 'e2e02026-1123-4122-8000-0000000000c1', 'ZZE2E ' || label, precio, 0, true
  from (values ('02','Cafe',2200),('03','Medialuna',900),('04','Tostado',4500),('05','Cien',100),('06','Jugo',2600),('07','Torta',12345)) v(n,label,precio);

do $$
begin
  if (select count(*) from public.store_users where store_id = 'e2e02026-1123-4122-8000-000000000001') <> 3 then raise exception 'OLA1_MEMBERSHIPS'; end if;
  if (select count(*) from public.products where store_id = 'e2e02026-1123-4122-8000-000000000001') <> 6 then raise exception 'OLA1_PRODUCTS'; end if;
  if (select count(*) from public.stores where id = 'e2e02026-1123-4122-8000-000000000001') <> 1 then raise exception 'OLA1_STORE'; end if;
end $$;
do $$ begin raise exception 'ENSAYO_OK_SE_REVIERTE: insertaria 1 local, 3 membresias, 1 categoria, 1 operador y 6 productos sinteticos'; end $$;
