'use strict';
// B5 (servidor) en una copia AISLADA (PGlite = Postgres en memoria; sin red, sin staging, sin producción).
// Usa el texto REAL de los .sql del repo (políticas de open_orders, RPC de ítems versionados, trigger de cierre por venta) y agrega open_orders_operator_guard.sql.
// El esquema base (stores, store_users, has_store_role) es una simulación mínima: el de staging no está en el repo.
// Uso: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> node --test tests/b5_servidor_rls.test.cjs   (sin PGLITE_DIR se omite)
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {test} = require('node:test');
const dir = process.env.PGLITE_DIR;
const R = path.resolve(__dirname, '..');
const sql = f => fs.readFileSync(path.join(R, f), 'utf8').replace(/\r\n/g, '\n');
const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222';
const U = {owner: 'a0000000-0000-4000-8000-000000000001', admin: 'a0000000-0000-4000-8000-000000000002', operator: 'a0000000-0000-4000-8000-000000000003', operador2: 'a0000000-0000-4000-8000-000000000004'};
const polReal = (() => { const s = sql('open_orders_schema_alignment.sql'); const a = s.indexOf('alter table public.open_orders enable row level security;'), b = s.indexOf('-- 7) Grants'); assert.ok(a > 0 && b > a); return s.slice(a, b); })();

async function nueva() {
  const {PGlite} = require(path.join(dir, 'node_modules/@electric-sql/pglite'));
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.store_user_role as enum ('owner','admin','operator');
    create table public.stores (id uuid primary key, name text);
    create table public.store_users (store_id uuid references public.stores(id) on delete cascade, user_id uuid, role public.store_user_role not null, active boolean default true);
    create function public.has_store_role(p_store uuid, p_roles public.store_user_role[]) returns boolean language sql stable security definer set search_path = public as
      $$ select exists (select 1 from public.store_users u where u.store_id = p_store and u.user_id = auth.uid() and u.active and u.role = any(p_roles)) $$;
    create table public.open_orders (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade, status text not null default 'open', metadata jsonb default '{}'::jsonb, label text, unique (id, store_id));
    create table public.open_order_items (id uuid primary key default gen_random_uuid(), store_id uuid not null, open_order_id uuid not null, product_id uuid, product_name text, quantity numeric default 1, unit_price numeric default 0, line_total numeric default 0, variants jsonb default '[]'::jsonb, note text default '', sort_order int default 0, metadata jsonb default '{}'::jsonb, created_at timestamptz default now(),
      foreign key (open_order_id, store_id) references public.open_orders(id, store_id) on delete cascade);
    create table public.open_order_dispatches (id uuid primary key default gen_random_uuid(), store_id uuid not null, open_order_id uuid not null, foreign key (open_order_id, store_id) references public.open_orders(id, store_id) on delete cascade);
    create table public.sales (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id), open_order_id uuid references public.open_orders(id) on delete set null, legacy_id text, sold_at timestamptz default now(), total numeric);
    insert into public.stores values ('${S1}','Local 1'),('${S2}','Local 2');
    insert into public.store_users values ('${S1}','${U.owner}','owner'),('${S1}','${U.admin}','admin'),('${S1}','${U.operator}','operator'),('${S2}','${U.operador2}','operator');
    alter table public.open_orders enable row level security; alter table public.open_order_items enable row level security; alter table public.sales enable row level security;
  `);
  await db.exec(polReal);
  await db.exec(sql('open_orders_items_version.sql').replace(/notify pgrst[^;]*;/g, ''));
  await db.exec(sql('open_orders_sales_reconciliation.sql').replace(/notify pgrst[^;]*;/g, ''));
  await db.exec(`
    create policy sales_ops on public.sales for all using (public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[])) with check (public.has_store_role(store_id, array['owner','admin','operator']::public.store_user_role[]));
    grant usage on schema public, auth to authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
  `);
  return db;
}
const GUARD = () => sql('open_orders_operator_guard.sql'), ROLLBACK = () => sql('open_orders_operator_guard_rollback.sql');
// Ejecuta como un rol de la app; devuelve filas o el error (los errores de RLS son datos, no excepciones de la prueba)
async function como(db, quien, consulta, params) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${U[quien]}', false);`);
  try { const r = await db.query(consulta, params); return {n: r.affectedRows ?? r.rows.length, rows: r.rows}; }
  catch (e) { return {error: e.message}; } finally { await db.exec('reset role;'); }
}
async function mesa(db, {store = S1, items = 0, vendida = false} = {}) {
  const id = (await db.query(`insert into public.open_orders (store_id, label) values ('${store}', 'm') returning id`)).rows[0].id;
  for (let i = 0; i < items; i++) await db.exec(`insert into public.open_order_items (store_id, open_order_id, product_name, quantity, unit_price, line_total) values ('${store}', '${id}', 'Cafe', 2, 100, 200)`);
  if (vendida) await db.exec(`insert into public.sales (store_id, open_order_id, legacy_id, total) values ('${store}', '${id}', 'v-${id}', 200)`);
  return id;
}
const existe = async (db, id) => (await db.query(`select count(*)::int n from public.open_orders where id = '${id}'`)).rows[0].n === 1;
const itemsDe = async (db, id) => (await db.query(`select count(*)::int n from public.open_order_items where open_order_id = '${id}'`)).rows[0].n;
// El flujo EXACTO de «Eliminar mesa» de la app: cerrar (PATCH) → borrar ítems → borrar fila
async function eliminarComoLaApp(db, quien, id) {
  const cierre = await como(db, quien, `update public.open_orders set status = 'closed' where id = '${id}' and store_id = '${S1}' returning id`);
  // closeOpenOrderInSupabase (cliente corregido): si el servidor rechaza el cierre de una eliminación, se detiene: no borra ítems ni fila
  if (cierre.error || cierre.n === 0) return {cierre, items: {n: 0}, fila: {n: 0}};
  const items = await como(db, quien, `delete from public.open_order_items where open_order_id = '${id}'`);
  const fila = await como(db, quien, `delete from public.open_orders where id = '${id}' and store_id = '${S1}' returning id`);
  return {cierre, items, fila};
}

const omitir = dir ? {} : {skip: 'falta PGLITE_DIR'};

test('SIN el guard (estado actual): el operador puede cancelar una mesa con productos (esto es lo que se corrige)', omitir, async () => {
  const db = await nueva(); const id = await mesa(db, {items: 2});
  await eliminarComoLaApp(db, 'operator', id);
  assert.equal(await existe(db, id), false);
});

test('CON el guard: el operador NO puede cerrar ni borrar una mesa con productos sin cobrar (ni directo ni con el flujo de la app); sigue con sus ítems', omitir, async () => {
  const db = await nueva(); await db.exec(GUARD());
  const id = await mesa(db, {items: 2});
  const cierre = await como(db, 'operator', `update public.open_orders set status = 'closed' where id = '${id}' returning id`);
  assert.ok(cierre.error || cierre.n === 0, 'cerrar debe fallar o no afectar filas');
  const borrar = await como(db, 'operator', `delete from public.open_orders where id = '${id}' returning id`);
  assert.ok(borrar.error || borrar.n === 0);
  assert.equal(await existe(db, id), true); assert.equal(await itemsDe(db, id), 2);
  // la app: si el cierre falla se detiene antes de tocar los ítems (ver el cambio de cliente); aquí se comprueba que el cierre y el borrado de fila fallan
  const f = await eliminarComoLaApp(db, 'operator', id);
  assert.ok(f.cierre.error || f.cierre.n === 0); assert.ok(f.fila.error || f.fila.n === 0);
});

test('CON el guard: el operador sí elimina una mesa VACÍA; owner y admin eliminan mesas con productos', omitir, async () => {
  const db = await nueva(); await db.exec(GUARD());
  const vacia = await mesa(db, {items: 0});
  const r = await eliminarComoLaApp(db, 'operator', vacia);
  assert.equal(r.cierre.n, 1); assert.equal(r.fila.n, 1); assert.equal(await existe(db, vacia), false);
  for (const quien of ['owner', 'admin']) {
    const id = await mesa(db, {items: 3});
    const f = await eliminarComoLaApp(db, quien, id);
    assert.equal(f.cierre.n, 1, quien); assert.equal(f.fila.n, 1, quien); assert.equal(await existe(db, id), false, quien);
  }
});

test('CON el guard: el COBRO del operador sigue funcionando (venta → trigger cierra → PATCH/ítems/fila) y una mesa cobrada con ítems se puede limpiar', omitir, async () => {
  const db = await nueva(); await db.exec(GUARD());
  const id = await mesa(db, {items: 2});
  const venta = await como(db, 'operator', `insert into public.sales (store_id, open_order_id, legacy_id, total) values ('${S1}', '${id}', 'v1', 200) returning id`);
  assert.ok(!venta.error, venta.error);
  assert.equal((await db.query(`select status from public.open_orders where id = '${id}'`)).rows[0].status, 'closed', 'el trigger de venta cierra la mesa');
  const f = await eliminarComoLaApp(db, 'operator', id);
  assert.equal(f.cierre.n, 1); assert.ok(f.items.n >= 1); assert.equal(f.fila.n, 1);
  // el cierre del cliente ocurre también ANTES de que el trigger cierre (mesa con venta pero aún 'open', p. ej. recuperación): permitido porque ya está cobrada
  const id2 = await mesa(db, {items: 1, vendida: true});
  await db.exec(`update public.open_orders set status = 'open' where id = '${id2}'`);
  const c2 = await como(db, 'operator', `update public.open_orders set status = 'closed' where id = '${id2}' returning id`);
  assert.equal(c2.n, 1);
});

test('CON el guard: editar ítems (RPC versionada), incluso dejar la mesa vacía, y comandas siguen igual; límite documentado: vaciar y luego eliminar', omitir, async () => {
  const db = await nueva(); await db.exec(GUARD());
  const id = await mesa(db, {items: 1});
  const v = (await db.query(`select items_version v from public.open_orders where id = '${id}'`)).rows[0].v;
  const r1 = await como(db, 'operator', `select public.replace_open_order_items('${id}', ${v}, '[{"product_name":"Te","quantity":3,"unit_price":50,"line_total":150}]'::jsonb) r`);
  assert.equal(r1.rows[0].r.ok, true);
  assert.equal(await itemsDe(db, id), 1);
  await db.exec(`insert into public.open_order_dispatches (store_id, open_order_id) values ('${S1}', '${id}')`);
  const v2 = (await db.query(`select items_version v from public.open_orders where id = '${id}'`)).rows[0].v;
  const r2 = await como(db, 'operator', `select public.replace_open_order_items('${id}', ${v2}, '[]'::jsonb) r`);
  assert.equal(r2.rows[0].r.ok, true, 'quitar todos los productos sigue siendo una edición normal');
  const f = await eliminarComoLaApp(db, 'operator', id);
  assert.equal(f.fila.n, 1, 'LÍMITE: tras vaciarla, la mesa es «vacía» y el operador puede eliminarla');
  assert.equal((await db.query('select count(*)::int n from public.open_order_dispatches')).rows[0].n, 0, 'las comandas de la mesa se eliminan en cascada, como antes');
});

test('CON el guard: otro local, y quien no es miembro, siguen sin poder tocar nada', omitir, async () => {
  const db = await nueva(); await db.exec(GUARD());
  const id = await mesa(db, {items: 0});
  const ajeno = await como(db, 'operador2', `delete from public.open_orders where id = '${id}' returning id`);
  assert.ok(ajeno.error || ajeno.n === 0); assert.equal(await existe(db, id), true);
});

test('alcance del cambio: agrega SOLO 2 políticas restrictivas y 1 función; no toca otras políticas, ni stock_*, ni sales/sale_items/comandas; es idempotente y reversible', omitir, async () => {
  const db = await nueva();
  const foto = async () => JSON.stringify({
    pol: (await db.query(`select tablename, policyname, permissive, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`)).rows,
    fun: (await db.query(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)).rows.map(x => x.proname),
    trg: (await db.query(`select tgname from pg_trigger where not tgisinternal order by 1`)).rows.map(x => x.tgname),
  });
  const antes = JSON.parse(await foto());
  await db.exec(GUARD()); await db.exec(GUARD()); // idempotente
  const despues = JSON.parse(await foto());
  const nuevasPol = despues.pol.filter(p => !antes.pol.some(q => q.policyname === p.policyname && q.tablename === p.tablename));
  assert.deepEqual(nuevasPol.map(p => `${p.tablename}.${p.policyname}.${p.permissive}.${p.cmd}`).sort(), ['open_orders.open_orders_delete_guard_operador.RESTRICTIVE.DELETE', 'open_orders.open_orders_update_guard_operador.RESTRICTIVE.UPDATE']);
  assert.deepEqual(despues.pol.filter(p => antes.pol.some(q => q.policyname === p.policyname)), antes.pol, 'las políticas existentes no cambian');
  assert.deepEqual(despues.fun.filter(f => !antes.fun.includes(f)), ['open_order_operador_puede_cerrar']);
  assert.deepEqual(despues.trg, antes.trg, 'no hay triggers nuevos');
  assert.ok(!despues.fun.concat(despues.trg).some(n => /stock/i.test(n)) && !/stock/i.test(GUARD().replace(/--.*\n/g, '')), 'no toca Stock Durability');
  await db.exec(ROLLBACK());
  assert.deepEqual(JSON.parse(await foto()), antes, 'la reversa deja el esquema exactamente como estaba');
  const id = await mesa(db, {items: 2}); await eliminarComoLaApp(db, 'operator', id);
  assert.equal(await existe(db, id), false, 'tras la reversa vuelve el comportamiento anterior');
});

test('el guard falla de forma segura si falta algo del esquema (no cambia nada)', omitir, async () => {
  const db = await nueva(); await db.exec('drop function public.has_store_role(uuid, public.store_user_role[]) cascade;');
  await assert.rejects(db.exec(GUARD()), /B5_GUARD_ESQUEMA/);
});
