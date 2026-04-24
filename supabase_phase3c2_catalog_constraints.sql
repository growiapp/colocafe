-- Verificación previa de duplicados por legacy_id antes de crear índices únicos.
-- Si alguna query devuelve filas, hay que resolver esos duplicados antes de correr los CREATE UNIQUE INDEX.

select store_id, legacy_id, count(*)
from public.categories
where legacy_id is not null and legacy_id <> ''
group by store_id, legacy_id
having count(*) > 1;

select store_id, legacy_id, count(*)
from public.products
where legacy_id is not null and legacy_id <> ''
group by store_id, legacy_id
having count(*) > 1;

-- Si las queries de arriba no devuelven filas, podés crear estos índices únicos parciales.

create unique index if not exists categories_store_legacy_id_unique_idx
on public.categories (store_id, legacy_id)
where legacy_id is not null and legacy_id <> '';

create unique index if not exists products_store_legacy_id_unique_idx
on public.products (store_id, legacy_id)
where legacy_id is not null and legacy_id <> '';
