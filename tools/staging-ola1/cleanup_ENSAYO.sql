-- Colo Café · auditoría ola 1 · LIMPIEZA del local sintético de staging. SOLO STAGING. NUNCA producción.
-- Qué hace (todo en UNA transacción: si algo falla, no se borra nada y el estado queda como estaba):
--   1. Exige identidad exacta del local sintético (id + legacy_id + nombre) y que sea el ÚNICO ZZ_E2E%. Exige rol con BYPASSRLS (SQL Editor).
--      REANUDACIÓN: si el local ya no existe pero quedan filas con su store_id (p. ej. stock_ledger, que no tiene FK), limpia solo esos residuos.
--   2. Foto de conteos de TODAS las tablas públicas SIN contar el local sintético, y huella (hash) de los demás locales y de todas las membresías ajenas.
--   3. Borra filas con store_id = local sintético, tabla por tabla, en pasadas que toleran violaciones de FK (no depende de ON DELETE CASCADE).
--   4. Borra el local. Si quedara referenciado por algo, falla y se revierte todo.
--   5. Verifica: 0 residuos por store_id y los conteos de todo lo demás idénticos a la foto. Si no, error y reversión.
-- Nunca ejecuta DELETE sin la condición store_id = <local sintético>. No toca auth.*, ni otros locales, ni Stock Durability.
begin;
set local lock_timeout = '10s';

do $$
declare tienda int; residuos bigint := 0; t record; n bigint;
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then raise exception 'OLA1_CLEANUP_ROL_SIN_BYPASSRLS'; end if;
  select count(*) into tienda from public.stores where id = 'e2e02026-1123-4122-8000-000000000001';
  if tienda = 1 then
    if (select count(*) from public.stores where id = 'e2e02026-1123-4122-8000-000000000001' and legacy_id = 'ZZE2E-STORE' and name like 'ZZ_E2E%') <> 1 then raise exception 'OLA1_CLEANUP_IDENTIDAD'; end if;
  else
    -- El local ya no existe: solo se continúa si quedan filas con su store_id (reanudación); si no hay nada, se aborta.
    for t in select c.relname::text as nombre from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname <> 'stores'
                and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped) loop
      execute format('select count(*) from public.%I where store_id = %L', t.nombre, 'e2e02026-1123-4122-8000-000000000001') into n; residuos := residuos + n;
    end loop;
    if residuos = 0 then raise exception 'OLA1_CLEANUP_NADA_QUE_LIMPIAR'; end if;
  end if;
  if (select count(*) from public.stores where legacy_id = 'ZZE2E-STORE' or name like 'ZZ_E2E%') <> tienda then raise exception 'OLA1_CLEANUP_ALCANCE'; end if;
  if exists (select 1 from public.products where store_id = 'e2e02026-1123-4122-8000-000000000001' and legacy_id not like 'ZZE2E-%') then raise exception 'OLA1_CLEANUP_PRODUCTO_AJENO'; end if;
  if exists (select 1 from public.stock_store_activation where store_id = 'e2e02026-1123-4122-8000-000000000001' and status <> 'deactivated') then raise exception 'OLA1_CLEANUP_STOCK_ACTIVO'; end if;
end $$;

create temp table ola1_tablas on commit drop as
  select c.oid::regclass::text as tabla,
         c.relname::text as nombre,
         exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped) as con_store
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');

create temp table ola1_antes (tabla text primary key, n bigint) on commit drop;
create temp table ola1_borrado (tabla text primary key, n bigint) on commit drop;
-- Huella de lo AJENO: locales y TODAS las membresías (quién tiene acceso a qué local) fuera del local sintético. Se compara tal cual al final.
create temp table ola1_huella on commit drop as
  select (select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.stores x where x.id <> 'e2e02026-1123-4122-8000-000000000001') as locales,
         (select md5(coalesce(string_agg(x::text, '|' order by x.store_id, x.user_id), '')) from public.store_users x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001') as membresias;

do $$
declare t record; n bigint;
begin
  for t in select * from ola1_tablas loop
    if t.nombre = 'stores' then
      execute format('select count(*) from %s where id <> %L', t.tabla, 'e2e02026-1123-4122-8000-000000000001') into n;
    elsif t.con_store then
      execute format('select count(*) from %s where store_id is distinct from %L', t.tabla, 'e2e02026-1123-4122-8000-000000000001') into n;
    else
      execute format('select count(*) from %s', t.tabla) into n;
    end if;
    insert into ola1_antes values (t.tabla, n);
  end loop;
end $$;

do $$
declare t record; n bigint; pasada int; progreso boolean; restantes bigint;
begin
  for pasada in 1..12 loop
    progreso := false;
    for t in select * from ola1_tablas where con_store and nombre <> 'stores' loop
      begin
        execute format('delete from %s where store_id = %L', t.tabla, 'e2e02026-1123-4122-8000-000000000001');
        get diagnostics n = row_count;
        if n > 0 then
          progreso := true;
          insert into ola1_borrado values (t.tabla, n) on conflict (tabla) do update set n = ola1_borrado.n + excluded.n;
        end if;
      exception when foreign_key_violation then
        null; -- un hijo todavía lo referencia: se reintenta en la pasada siguiente
      end;
    end loop;
    restantes := 0;
    for t in select * from ola1_tablas where con_store and nombre <> 'stores' loop
      execute format('select count(*) from %s where store_id = %L', t.tabla, 'e2e02026-1123-4122-8000-000000000001') into n;
      restantes := restantes + n;
    end loop;
    exit when restantes = 0 or not progreso;
  end loop;
end $$;

delete from public.stores where id = 'e2e02026-1123-4122-8000-000000000001' and legacy_id = 'ZZE2E-STORE' and name like 'ZZ_E2E%';

do $$
declare t record; n bigint; r record; resid bigint := 0;
begin
  for t in select * from ola1_tablas where con_store loop
    execute format('select count(*) from %s where store_id = %L', t.tabla, 'e2e02026-1123-4122-8000-000000000001') into n;
    if n <> 0 then raise exception 'OLA1_CLEANUP_RESIDUO:%:%', t.tabla, n; end if;
  end loop;
  if exists (select 1 from public.stores where id = 'e2e02026-1123-4122-8000-000000000001') then raise exception 'OLA1_CLEANUP_LOCAL_PERSISTE'; end if;
  for t in select * from ola1_tablas loop
    if t.nombre = 'stores' then
      execute format('select count(*) from %s', t.tabla) into n;
    elsif t.con_store then
      execute format('select count(*) from %s where store_id is distinct from %L', t.tabla, 'e2e02026-1123-4122-8000-000000000001') into n;
    else
      execute format('select count(*) from %s', t.tabla) into n;
    end if;
    select * into r from ola1_antes where tabla = t.tabla;
    if r.n <> n then raise exception 'OLA1_CLEANUP_COLATERAL:%:antes=%:despues=%', t.tabla, r.n, n; end if;
  end loop;
  if (select locales from ola1_huella) is distinct from (select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.stores x where x.id <> 'e2e02026-1123-4122-8000-000000000001') then raise exception 'OLA1_CLEANUP_COLATERAL_LOCALES'; end if;
  if (select membresias from ola1_huella) is distinct from (select md5(coalesce(string_agg(x::text, '|' order by x.store_id, x.user_id), '')) from public.store_users x where x.store_id is distinct from 'e2e02026-1123-4122-8000-000000000001') then raise exception 'OLA1_CLEANUP_COLATERAL_MEMBRESIAS: cambió el acceso de alguna cuenta a un local no sintético'; end if;
end $$;
do $$ declare s text; begin select string_agg(tabla || '=' || n, ', ' order by tabla) into s from ola1_borrado; raise exception 'ENSAYO_OK_SE_REVIERTE: borraria %', coalesce(s, '(nada)'); end $$;
