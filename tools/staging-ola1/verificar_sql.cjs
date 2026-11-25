'use strict';
// Verifica fixtures.sql y cleanup.sql en una copia AISLADA (PGlite = Postgres en memoria; sin red, sin staging, sin producción).
// El esquema es una SIMULACIÓN con las tablas que los scripts tocan y distintas reglas de FK (el esquema real de staging no está en el repo).
// Uso: PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite> node tools/staging-ola1/verificar_sql.cjs [--escribir-ensayos]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const dir = process.env.PGLITE_DIR; if (!dir) throw new Error('falta PGLITE_DIR');
const {PGlite} = require(path.join(dir, 'node_modules/@electric-sql/pglite'));
const HERE = __dirname;
const F = 'e2e02026-1123-4122-8000-000000000001', R = '11111111-1111-4111-8111-111111111111';
const U = ['7cd84c4f-0000-4000-8000-000000000001', '48075b31-0000-4000-8000-000000000002', 'eef11ffb-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000009'];

// ── Generación de las versiones ENSAYO (idénticas, pero terminan siempre en error = rollback, informando qué haría) ──
const fix = fs.readFileSync(path.join(HERE, 'fixtures.sql'), 'utf8').replace(/\r\n/g, '\n');
const cle = fs.readFileSync(path.join(HERE, 'cleanup.sql'), 'utf8').replace(/\r\n/g, '\n');
const finFix = "commit;\nselect 'FIXTURES_OK' r, (select count(*) from public.stores) stores, (select count(*) from public.store_users) su, (select count(*) from public.products) products;\n";
const finCle = "-- RESUMEN_BORRADO_PUNTO: en la versión ENSAYO esta línea se reemplaza por un error que informa el resumen y revierte todo.\ncommit;\nselect 'CLEANUP_OK' r, (select count(*) from public.stores) stores, (select count(*) from public.store_users) su, (select count(*) from public.products) products;\n";
assert.ok(fix.endsWith(finFix) && cle.endsWith(finCle), 'los scripts deben terminar con el bloque esperado');
const fixEnsayo = fix.slice(0, -finFix.length) + "do $$ begin raise exception 'ENSAYO_OK_SE_REVIERTE: insertaria 1 local, 3 membresias, 1 categoria, 1 operador y 6 productos sinteticos'; end $$;\n";
const cleEnsayo = cle.slice(0, -finCle.length) + "do $$ declare s text; begin select string_agg(tabla || '=' || n, ', ' order by tabla) into s from ola1_borrado; raise exception 'ENSAYO_OK_SE_REVIERTE: borraria %', coalesce(s, '(nada)'); end $$;\n";
if (process.argv.includes('--escribir-ensayos')) {
  fs.writeFileSync(path.join(HERE, 'fixtures_ENSAYO.sql'), fixEnsayo.replace(/^-- Ejecutar primero.*\n/m, ''));
  fs.writeFileSync(path.join(HERE, 'cleanup_ENSAYO.sql'), cleEnsayo);
  console.log('ensayos escritos');
}
for (const [f, esperado] of [['fixtures_ENSAYO.sql', fixEnsayo], ['cleanup_ENSAYO.sql', cleEnsayo]]) {
  if (fs.existsSync(path.join(HERE, f))) assert.equal(fs.readFileSync(path.join(HERE, f), 'utf8').replace(/\r\n/g, '\n').replace(/^-- Ejecutar primero.*\n/m, ''), esperado.replace(/^-- Ejecutar primero.*\n/m, ''), `${f} no coincide con el script real (regenerar con --escribir-ensayos)`);
}

// ── Esquema simulado ──
const esquema = ({fk = 'cascade', extra = []} = {}) => {
  const od = fk === 'cascade' ? ' on delete cascade' : '';
  return `
create schema auth; create table auth.users (id uuid primary key, email text);
create type public.store_user_role as enum ('owner','admin','operator');
create table public.stores (id uuid primary key, legacy_id text, name text);
create table public.store_users (store_id uuid not null references public.stores(id)${od}, user_id uuid not null, role public.store_user_role not null, active boolean, joined_at timestamptz);
create table public.categories (id uuid primary key, store_id uuid references public.stores(id)${od}, legacy_id text, name text);
create table public.operators (id uuid primary key, store_id uuid references public.stores(id)${od}, name text, normalized_name text);
create table public.products (id uuid primary key, store_id uuid references public.stores(id)${od}, legacy_id text, category_id uuid references public.categories(id)${od}, name text, price numeric ${extra.includes('check_precio') ? 'check (price < 10000)' : ''}, stock int, unlimited boolean);
create table public.sales (id uuid primary key default gen_random_uuid(), store_id uuid references public.stores(id)${od}, total numeric);
create table public.sale_items (id uuid primary key default gen_random_uuid(), sale_id uuid references public.sales(id)${od}, store_id uuid references public.stores(id)${od}, product_id uuid references public.products(id)${od});
create table public.sale_payments (id uuid primary key default gen_random_uuid(), sale_id uuid references public.sales(id)${od}, store_id uuid references public.stores(id)${od});
create table public.shifts (id uuid primary key default gen_random_uuid(), store_id uuid references public.stores(id)${od});
create table public.open_orders (id uuid primary key default gen_random_uuid(), store_id uuid references public.stores(id)${od});
create table public.open_order_items (id uuid primary key default gen_random_uuid(), open_order_id uuid references public.open_orders(id)${od}, store_id uuid references public.stores(id)${od});
create table public.open_order_dispatches (id uuid primary key default gen_random_uuid(), open_order_id uuid references public.open_orders(id)${od}, store_id uuid references public.stores(id)${od});
create table public.reservations (id uuid primary key default gen_random_uuid(), store_id uuid references public.stores(id)${od});
create table public.customers (id uuid primary key default gen_random_uuid(), store_id uuid references public.stores(id)${od}, nombre text);
create table public.expenses (id uuid primary key default gen_random_uuid(), store_id uuid references public.stores(id)${od});
create table public.stock_ledger (id uuid primary key default gen_random_uuid(), store_id uuid references public.stores(id)${od});
create table public.stock_store_activation (store_id uuid primary key references public.stores(id)${od}, status text);
create table public.profiles (id uuid primary key, user_id uuid);
${extra.includes('hijo_sin_store') ? `create table public.sale_events (id uuid primary key default gen_random_uuid(), sale_id uuid references public.sales(id)${od});` : ''}
${extra.includes('trigger_stock') ? `create function public.stock_guard() returns trigger language plpgsql as $f$ begin return new; end $f$; create trigger stock_guard_trg before insert on public.sales for each row execute function public.stock_guard();` : ''}
insert into auth.users values ('${U[0]}','owner@x'),('${U[1]}','caja@x'),('${U[2]}','admin@x'),('${U[3]}','otro@x');
insert into public.profiles values (gen_random_uuid(), '${U[0]}'),(gen_random_uuid(), '${U[3]}');
-- Datos PREEXISTENTES de un local real (no deben cambiar nunca) + una venta con store_id nulo
insert into public.stores values ('${R}','REAL-1','Palermo');
insert into public.store_users values ('${R}','${U[3]}','owner',true,now());
insert into public.categories values ('22222222-2222-4222-8222-222222222222','${R}','C1','Cafe');
insert into public.products values ('33333333-3333-4333-8333-333333333333','${R}','P1','22222222-2222-4222-8222-222222222222','Espresso',1600,0,true);
insert into public.sales values ('44444444-4444-4444-8444-444444444444','${R}',1600),('55555555-5555-4555-8555-555555555555',null,50);
insert into public.sale_items (sale_id, store_id, product_id) values ('44444444-4444-4444-8444-444444444444','${R}','33333333-3333-4333-8333-333333333333');
insert into public.sale_payments (sale_id, store_id) values ('44444444-4444-4444-8444-444444444444','${R}');
insert into public.open_orders (store_id) values ('${R}'); insert into public.shifts (store_id) values ('${R}'); insert into public.expenses (store_id) values ('${R}');
insert into public.customers (store_id, nombre) values ('${R}','Cliente real');
${extra.includes('hijo_sin_store') ? `insert into public.sale_events (sale_id) values ('44444444-4444-4444-8444-444444444444');` : ''}
`;
};
// Escrituras que haría la app en el local sintético durante los recorridos
const escrituras = (extra = []) => `
insert into public.shifts (store_id) values ('${F}');
insert into public.open_orders (id, store_id) values ('e2e02026-1123-4122-8000-0000000000b1','${F}');
insert into public.open_order_items (open_order_id, store_id) values ('e2e02026-1123-4122-8000-0000000000b1','${F}');
insert into public.open_order_dispatches (open_order_id, store_id) values ('e2e02026-1123-4122-8000-0000000000b1','${F}');
insert into public.sales (id, store_id, total) values ('e2e02026-1123-4122-8000-0000000000d1','${F}',2200),('e2e02026-1123-4122-8000-0000000000d2','${F}',87.5);
insert into public.sale_items (sale_id, store_id, product_id) values ('e2e02026-1123-4122-8000-0000000000d1','${F}','e2e02026-1123-4122-8000-000000000102');
insert into public.sale_payments (sale_id, store_id) values ('e2e02026-1123-4122-8000-0000000000d1','${F}'),('e2e02026-1123-4122-8000-0000000000d2','${F}');
insert into public.expenses (store_id) values ('${F}');
${extra.includes('hijo_sin_store') ? `insert into public.sale_events (sale_id) values ('e2e02026-1123-4122-8000-0000000000d1');` : ''}
`;

const TABLAS = ['stores', 'store_users', 'categories', 'operators', 'products', 'sales', 'sale_items', 'sale_payments', 'shifts', 'open_orders', 'open_order_items', 'open_order_dispatches', 'reservations', 'customers', 'expenses', 'stock_ledger', 'stock_store_activation', 'profiles'];
const foto = async db => { const o = {}; for (const t of TABLAS) { const c = t === 'stores' ? 'id' : t === 'profiles' ? 'id' : 'store_id'; o[t] = {real: Number((await db.query(`select count(*) n from public.${t} ${t === 'profiles' ? '' : `where ${c} is distinct from '${F}'`}`)).rows[0].n), sint: t === 'profiles' ? 0 : Number((await db.query(`select count(*) n from public.${t} where ${c} = '${F}'`)).rows[0].n)}; } return o; };
const preexistente = f => JSON.stringify(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.real])));
const correr = async (db, sql) => { try { await db.exec(sql); return {ok: true}; } catch (e) { await db.exec('rollback').catch(() => {}); return {ok: false, msg: String(e.message)}; } };
const nuevo = async o => { const db = new PGlite(); await db.exec(esquema(o)); return db; };
const resultados = [];
const caso = async (nombre, fn) => { try { await fn(); resultados.push([nombre, 'OK']); } catch (e) { resultados.push([nombre, 'FALLA: ' + e.message.split('\n')[0]]); process.exitCode = 1; } };

(async () => {
  const OLD02 = process.env.OLD_FIXTURES && fs.readFileSync(process.env.OLD_FIXTURES, 'utf8'), OLD05 = process.env.OLD_CLEANUP && fs.readFileSync(process.env.OLD_CLEANUP, 'utf8');

  for (const fk of ['cascade', 'restrict']) {
    await caso(`[${fk}] fixtures crea sólo el local sintético; los datos preexistentes no cambian`, async () => {
      const db = await nuevo({fk}); const a = await foto(db);
      assert.equal((await correr(db, fix)).ok, true);
      const d = await foto(db);
      assert.equal(preexistente(a), preexistente(d));
      assert.deepEqual([d.stores.sint, d.store_users.sint, d.categories.sint, d.operators.sint, d.products.sint], [1, 3, 1, 1, 6]);
    });
    await caso(`[${fk}] ciclo completo: fixtures → escrituras de la app → ENSAYO (no cambia nada) → limpieza real → preexistente intacto y 0 residuos`, async () => {
      const db = await nuevo({fk}); const a = await foto(db);
      assert.equal((await correr(db, fix)).ok, true); await db.exec(escrituras());
      const lleno = await foto(db);
      const e = await correr(db, cleEnsayo);
      assert.equal(e.ok, false); assert.match(e.msg, /ENSAYO_OK_SE_REVIERTE: borraria/);
      assert.equal(JSON.stringify(await foto(db)), JSON.stringify(lleno), 'el ensayo no debe cambiar nada');
      const r = await correr(db, cle); assert.equal(r.ok, true, r.msg);
      const d = await foto(db);
      assert.equal(preexistente(a), preexistente(d));
      assert.ok(Object.entries(d).every(([t, v]) => v.sint === 0), 'residuos del local sintético: ' + JSON.stringify(d));
    });
  }
  await caso('el ENSAYO de fixtures no deja nada y avisa', async () => {
    const db = await nuevo(); const a = await foto(db);
    const e = await correr(db, fixEnsayo); assert.match(e.msg, /ENSAYO_OK_SE_REVIERTE/);
    assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('ejecución parcial de fixtures (falla un producto) → no queda NADA (atomicidad)', async () => {
    const db = await nuevo({extra: ['check_precio']}); const a = await foto(db);
    const r = await correr(db, fix); assert.equal(r.ok, false);
    assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('fixtures dos veces → la segunda aborta sin cambios (idempotencia)', async () => {
    const db = await nuevo(); await correr(db, fix); const a = await foto(db);
    const r = await correr(db, fix); assert.match(r.msg, /OLA1_FIXTURE_EXISTS/);
    assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('limpieza sobre un entorno sin local sintético → aborta sin tocar nada', async () => {
    const db = await nuevo(); const a = await foto(db);
    const r = await correr(db, cle); assert.match(r.msg, /OLA1_CLEANUP_IDENTIDAD/);
    assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('limpieza dos veces → la segunda aborta (no hay nada que borrar), sin colaterales', async () => {
    const db = await nuevo(); await correr(db, fix); await correr(db, cle); const a = await foto(db);
    const r = await correr(db, cle); assert.match(r.msg, /OLA1_CLEANUP_IDENTIDAD/); assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('con un segundo local ZZ_E2E% la limpieza aborta (alcance ambiguo) y nada cambia', async () => {
    const db = await nuevo(); await correr(db, fix); await db.exec("insert into public.stores values (gen_random_uuid(),'X','ZZ_E2E_otro')"); const a = await foto(db);
    const r = await correr(db, cle); assert.match(r.msg, /OLA1_CLEANUP_ALCANCE/); assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('un producto ajeno dentro del local sintético → la limpieza aborta y nada cambia', async () => {
    const db = await nuevo(); await correr(db, fix);
    await db.exec(`insert into public.products values (gen_random_uuid(),'${F}','REAL-P','e2e02026-1123-4122-8000-0000000000c1','Real',1,0,true)`); const a = await foto(db);
    const r = await correr(db, cle); assert.match(r.msg, /OLA1_CLEANUP_PRODUCTO_AJENO/); assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('Stock Durability activo en el local sintético → la limpieza aborta', async () => {
    const db = await nuevo(); await correr(db, fix); await db.exec(`insert into public.stock_store_activation values ('${F}','active')`); const a = await foto(db);
    const r = await correr(db, cle); assert.match(r.msg, /OLA1_CLEANUP_STOCK_ACTIVO/); assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('Stock Durability presente (trigger «stock_*» instalado pero inactivo): el procedimiento nuevo SÍ corre', async () => {
    const db = await nuevo({extra: ['trigger_stock']}); const a = await foto(db);
    assert.equal((await correr(db, fix)).ok, true); await db.exec(escrituras());
    const r = await correr(db, cle); assert.equal(r.ok, true, r.msg); assert.equal(preexistente(a), preexistente(await foto(db)));
  });
  await caso('tabla hija SIN store_id con filas del local sintético (sale_events): la limpieza aborta y revierte TODO (fail-closed)', async () => {
    const db = await nuevo({extra: ['hijo_sin_store']}); await correr(db, fix); await db.exec(escrituras(['hijo_sin_store'])); const a = await foto(db);
    const r = await correr(db, cle); assert.equal(r.ok, false); assert.match(r.msg, /COLATERAL:sale_events:antes=2:despues=1/);
    assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a), 'tras abortar, el estado debe quedar exactamente igual');
  });
  await caso('negativo: ¿qué pasaba con el script ANTERIOR? (05_cleanup.sql) — informativo', async () => {
    if (!OLD02 || !OLD05) return;
    const out = [];
    for (const [nom, o] of [['cascade', {fk: 'cascade'}], ['restrict', {fk: 'restrict'}], ['trigger_stock', {fk: 'cascade', extra: ['trigger_stock']}]]) {
      const db = await nuevo(o); await db.exec(OLD02.replace(/^select 'FIXTURES_OK'.*$/m, '')).catch(async () => { await db.exec('rollback').catch(() => {}); });
      const r = await correr(db, OLD05); out.push(`${nom}:${r.ok ? 'corre' : 'aborta(' + (r.msg.match(/E2E_[A-Z_]+/) || [r.msg.slice(0, 50)])[0] + ')'}`);
    }
    console.log('  anterior →', out.join(' | '));
  });
  console.log(resultados.map(([n, r]) => `${r === 'OK' ? '✔' : '✖'} ${n}${r === 'OK' ? '' : '  → ' + r}`).join('\n'));
  console.log(`${resultados.filter(r => r[1] === 'OK').length}/${resultados.length} casos OK`);
})().catch(e => { console.error(e); process.exit(1); });
