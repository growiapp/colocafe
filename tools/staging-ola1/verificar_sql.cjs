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
${extra.includes('real') ? `
alter table public.open_orders add column status text default 'open', add column metadata jsonb default '{}'::jsonb, add column customer_id uuid references public.customers(id) on delete set null, add column reservation_id uuid references public.reservations(id) on delete set null, add column shift_id uuid references public.shifts(id) on delete set null;
alter table public.sales add column open_order_id uuid references public.open_orders(id) on delete set null, add column shift_id uuid references public.shifts(id) on delete set null, add column customer_id uuid references public.customers(id) on delete set null, add column reservation_id uuid references public.reservations(id) on delete set null, add column sold_at timestamptz, add column legacy_id text;
alter table public.sale_items drop constraint sale_items_product_id_fkey, add constraint sale_items_product_id_fkey foreign key (product_id) references public.products(id) on delete set null;
alter table public.products drop constraint products_category_id_fkey, add constraint products_category_id_fkey foreign key (category_id) references public.categories(id) on delete set null;
alter table public.reservations add column customer_id uuid references public.customers(id) on delete set null;
alter table public.stock_ledger drop constraint stock_ledger_store_id_fkey;
create table public.audit_logs (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id) on delete cascade, action text not null, entity_type text not null, payload jsonb not null default '{}'::jsonb, actor_user_id uuid references auth.users(id) on delete set null);
create function public.close_open_order_after_sale() returns trigger language plpgsql as $f$ begin if new.open_order_id is not null then update public.open_orders set status = 'closed', metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('close_reason', 'paid', 'closed_by_sale_id', new.id) where id = new.open_order_id and store_id = new.store_id and status = 'open'; end if; return new; end $f$;
create trigger trg_close_open_order_after_sale after insert or update on public.sales for each row execute function public.close_open_order_after_sale();
` : ''}
insert into auth.users values ('${U[0]}','owner@x'),('${U[1]}','caja@x'),('${U[2]}','admin@x'),('${U[3]}','otro@x');
insert into public.profiles values (gen_random_uuid(), '${U[0]}'),(gen_random_uuid(), '${U[3]}');
-- Datos PREEXISTENTES de un local real (no deben cambiar nunca) + una venta con store_id nulo
insert into public.stores values ('${R}','REAL-1','Palermo');
insert into public.store_users values ('${R}','${U[3]}','owner',true,now()),('${R}','${U[0]}','owner',true,now()),('${R}','${U[2]}','admin',true,now()),('${R}','${U[1]}','operator',true,now());
insert into public.categories values ('22222222-2222-4222-8222-222222222222','${R}','C1','Cafe');
insert into public.products values ('33333333-3333-4333-8333-333333333333','${R}','P1','22222222-2222-4222-8222-222222222222','Espresso',1600,0,true);
insert into public.sales values ('44444444-4444-4444-8444-444444444444','${R}',1600),('55555555-5555-4555-8555-555555555555',null,50);
insert into public.sale_items (sale_id, store_id, product_id) values ('44444444-4444-4444-8444-444444444444','${R}','33333333-3333-4333-8333-333333333333');
insert into public.sale_payments (sale_id, store_id) values ('44444444-4444-4444-8444-444444444444','${R}');
insert into public.open_orders (store_id) values ('${R}'); insert into public.shifts (store_id) values ('${R}'); insert into public.expenses (store_id) values ('${R}');
insert into public.customers (store_id, nombre) values ('${R}','Cliente real');
${extra.includes('hijo_sin_store') ? `insert into public.sale_events (sale_id) values ('44444444-4444-4444-8444-444444444444');` : ''}
${extra.includes('real') ? `insert into public.audit_logs (store_id, action, entity_type) values ('${R}', 'sale.create', 'sale'); update public.sales set open_order_id = (select id from public.open_orders where store_id = '${R}' limit 1), shift_id = (select id from public.shifts where store_id = '${R}' limit 1) where id = '44444444-4444-4444-8444-444444444444'; insert into public.stock_ledger (store_id) values ('${R}');` : ''}
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

const escriturasReal = () => `
insert into public.sales (id, store_id, total, open_order_id, shift_id, sold_at, legacy_id) values ('e2e02026-1123-4122-8000-0000000000d3','${F}',900,'e2e02026-1123-4122-8000-0000000000b1',(select id from public.shifts where store_id = '${F}' limit 1), now(), 't_x');
insert into public.audit_logs (store_id, action, entity_type) values ('${F}', 'sale.create', 'sale'), ('${F}', 'shift.open', 'shift');
insert into public.stock_ledger (store_id) values ('${F}');
`;
const TABLAS = ['stores', 'store_users', 'categories', 'operators', 'products', 'sales', 'sale_items', 'sale_payments', 'shifts', 'open_orders', 'open_order_items', 'open_order_dispatches', 'reservations', 'customers', 'expenses', 'stock_ledger', 'stock_store_activation', 'profiles'];
const existeTabla = async (db, t) => (await db.query(`select to_regclass('public.${t}') r`)).rows[0].r !== null;
const foto = async db => { const o = {}; for (const t of [...TABLAS, ...((await existeTabla(db, 'audit_logs')) ? ['audit_logs'] : [])]) { const c = t === 'stores' ? 'id' : t === 'profiles' ? 'id' : 'store_id'; o[t] = {real: Number((await db.query(`select count(*) n from public.${t} ${t === 'profiles' ? '' : `where ${c} is distinct from '${F}'`}`)).rows[0].n), sint: t === 'profiles' ? 0 : Number((await db.query(`select count(*) n from public.${t} where ${c} = '${F}'`)).rows[0].n)}; } return o; };
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
  await caso('TOPOLOGÍA REAL de staging (FK cascade + SET NULL, stock_ledger sin FK, audit_logs, trigger de cierre): ciclo completo, preexistente intacto y 0 residuos', async () => {
    const db = await nuevo({fk: 'cascade', extra: ['real']}); const a = await foto(db);
    assert.equal((await correr(db, fix)).ok, true); await db.exec(escrituras()); await db.exec(escriturasReal());
    assert.equal(Number((await db.query(`select count(*) n from public.open_orders where id = 'e2e02026-1123-4122-8000-0000000000b1' and status = 'closed'`)).rows[0].n), 1, 'el trigger de cierre debe haber cerrado la mesa del local sintético');
    const lleno = await foto(db); assert.ok(lleno.audit_logs.sint === 2 && lleno.stock_ledger.sint === 1, JSON.stringify(lleno.audit_logs));
    const e = await correr(db, cleEnsayo); assert.match(e.msg, /ENSAYO_OK_SE_REVIERTE: borraria/); assert.equal(JSON.stringify(await foto(db)), JSON.stringify(lleno));
    const r = await correr(db, cle); assert.equal(r.ok, true, r.msg);
    const d = await foto(db);
    assert.equal(preexistente(a), preexistente(d), 'cambió lo preexistente');
    assert.ok(Object.entries(d).every(([, v]) => v.sint === 0), 'residuos: ' + JSON.stringify(d));
    // lo preexistente conserva sus vinculos (los SET NULL no deben haber tocado filas del local real)
    const v = (await db.query(`select open_order_id is not null as oo, shift_id is not null as sh from public.sales where id = '44444444-4444-4444-8444-444444444444'`)).rows[0];
    assert.deepEqual(v, {oo: true, sh: true});
  });

  // ── RECUPERACIÓN ANTE INTERRUPCIONES (topología real) ──
  // «Contenido ajeno»: hash del CONTENIDO COMPLETO (cada fila) de todo lo que no pertenece al local sintético, tabla por tabla.
  const TABS_STORE = ['audit_logs', 'categories', 'customers', 'expenses', 'open_order_dispatches', 'open_order_items', 'open_orders', 'operators', 'products', 'reservations', 'sale_items', 'sale_payments', 'sales', 'shifts', 'stock_ledger', 'stock_store_activation', 'store_users'];
  const contenido = async db => { const o = {}; for (const t of ['stores', ...TABS_STORE, 'profiles']) { if (!(await existeTabla(db, t))) continue; const filtro = t === 'stores' ? `x.id <> '${F}'` : t === 'profiles' ? 'true' : `x.store_id is distinct from '${F}'`; o[t] = (await db.query(`select count(*)::int n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from public.${t} x where ${filtro}`)).rows[0]; } return JSON.stringify(o); };
  const accesos = db => db.query(`select user_id::text u, store_id::text s, role::text r, active a from public.store_users where store_id = '${R}' order by user_id`).then(r => JSON.stringify(r.rows));
  const sinSintetico = async db => (await foto(db)) && Object.entries(await foto(db)).every(([, v]) => v.sint === 0);
  const entorno = async () => { const db = await nuevo({fk: 'cascade', extra: ['real']}); return {db, base: await contenido(db), acc: await accesos(db)}; };
  const verificarRestauracion = async ({db, base, acc}, motivo) => {
    assert.equal(await contenido(db), base, motivo + ': el contenido de lo ajeno cambió');
    assert.equal(await accesos(db), acc, motivo + ': cambió el acceso de alguna cuenta al local preexistente');
    assert.ok(await sinSintetico(db), motivo + ': quedan residuos del local sintético');
    assert.equal(Number((await db.query(`select count(*) n from public.store_users where store_id = '${R}' and user_id in ('${U[0]}','${U[1]}','${U[2]}')`)).rows[0].n), 3, motivo + ': una cuenta de prueba perdió su membresía en el local preexistente');
  };
  await caso('RECUPERACIÓN A: interrupción justo después de crear el local, membresías y productos → la limpieza deja todo como antes', async () => {
    const E = await entorno(); assert.equal((await correr(E.db, fix)).ok, true);
    const r = await correr(E.db, cle); assert.equal(r.ok, true, r.msg); await verificarRestauracion(E, 'A');
  });
  await caso('RECUPERACIÓN B: interrupción tras crear mesas (pedidos, ítems, comandas) → la limpieza deja todo como antes', async () => {
    const E = await entorno(); await correr(E.db, fix);
    await E.db.exec(`insert into public.open_orders (id, store_id) values ('e2e02026-1123-4122-8000-0000000000b1','${F}'); insert into public.open_order_items (open_order_id, store_id) values ('e2e02026-1123-4122-8000-0000000000b1','${F}'); insert into public.open_order_dispatches (open_order_id, store_id) values ('e2e02026-1123-4122-8000-0000000000b1','${F}');`);
    const r = await correr(E.db, cle); assert.equal(r.ok, true, r.msg); await verificarRestauracion(E, 'B');
  });
  await caso('RECUPERACIÓN C: interrupción tras ventas, pagos, turno, auditoría y stock_ledger (con el trigger de cierre) → la limpieza deja todo como antes', async () => {
    const E = await entorno(); await correr(E.db, fix); await E.db.exec(escrituras()); await E.db.exec(escriturasReal());
    const r = await correr(E.db, cle); assert.equal(r.ok, true, r.msg); await verificarRestauracion(E, 'C');
  });
  await caso('RECUPERACIÓN D: la limpieza misma se interrumpe a mitad (falla un borrado) → se revierte TODO, nada queda a medias y se puede reanudar', async () => {
    const E = await entorno(); await correr(E.db, fix); await E.db.exec(escrituras()); await E.db.exec(escriturasReal());
    const lleno = await foto(E.db);
    await E.db.exec(`create function public.interrumpir() returns trigger language plpgsql as $f$ begin if old.store_id = '${F}' then raise exception 'INTERRUPCION_SIMULADA'; end if; return old; end $f$; create trigger t_interrumpir before delete on public.sale_payments for each row execute function public.interrumpir();`);
    const r1 = await correr(E.db, cle); assert.equal(r1.ok, false); assert.match(r1.msg, /INTERRUPCION_SIMULADA/);
    assert.equal(JSON.stringify(await foto(E.db)), JSON.stringify(lleno), 'tras la interrupción el estado debe ser EXACTAMENTE el anterior (nada borrado a medias)');
    assert.equal(await accesos(E.db), E.acc, 'las cuentas conservan su acceso al local preexistente aun con la limpieza interrumpida');
    await E.db.exec('drop trigger t_interrumpir on public.sale_payments');          // se retira el obstáculo y se reanuda
    const e = await correr(E.db, cleEnsayo); assert.match(e.msg, /ENSAYO_OK_SE_REVIERTE: borraria/);
    const r2 = await correr(E.db, cle); assert.equal(r2.ok, true, r2.msg); await verificarRestauracion(E, 'D (reanudada)');
  });
  await caso('RECUPERACIÓN E: alguien borró el local a mano (quedan filas SIN FK, p. ej. stock_ledger) → la limpieza se reanuda y elimina solo esos residuos', async () => {
    const E = await entorno(); await correr(E.db, fix); await E.db.exec(escrituras()); await E.db.exec(escriturasReal());
    await E.db.exec(`delete from public.stores where id = '${F}'`);                  // el cascade se lleva casi todo; stock_ledger (sin FK) queda huérfano
    const huerfanas = Number((await E.db.query(`select count(*) n from public.stock_ledger where store_id = '${F}'`)).rows[0].n); assert.ok(huerfanas > 0, 'el escenario debe dejar filas huérfanas');
    const e = await correr(E.db, cleEnsayo); assert.match(e.msg, /ENSAYO_OK_SE_REVIERTE: borraria stock_ledger=/);
    assert.equal(Number((await E.db.query(`select count(*) n from public.stock_ledger where store_id = '${F}'`)).rows[0].n), huerfanas, 'el ensayo no debe borrar');
    const r = await correr(E.db, cle); assert.equal(r.ok, true, r.msg); await verificarRestauracion(E, 'E');
  });
  await caso('RECUPERACIÓN F: hijos borrados parcialmente a mano (ventas ya eliminadas) → la limpieza igual termina sin tocar lo ajeno', async () => {
    const E = await entorno(); await correr(E.db, fix); await E.db.exec(escrituras()); await E.db.exec(escriturasReal());
    await E.db.exec(`delete from public.sale_payments where store_id = '${F}'; delete from public.sale_items where store_id = '${F}'; delete from public.sales where store_id = '${F}'`);
    const r = await correr(E.db, cle); assert.equal(r.ok, true, r.msg); await verificarRestauracion(E, 'F');
  });
  await caso('RECUPERACIÓN G: el ciclo se puede repetir (fixtures → limpieza → fixtures → limpieza) y la limpieza ya hecha aborta sin tocar nada', async () => {
    const E = await entorno();
    for (let i = 0; i < 2; i++) { assert.equal((await correr(E.db, fix)).ok, true); await E.db.exec(escrituras()); const r = await correr(E.db, cle); assert.equal(r.ok, true, r.msg); await verificarRestauracion(E, 'G' + i); }
    const otra = await correr(E.db, cle); assert.match(otra.msg, /OLA1_CLEANUP_NADA_QUE_LIMPIAR/); await verificarRestauracion(E, 'G (repetida)');
  });
  await caso('RECUPERACIÓN H: una fila AJENA metida a propósito en el local sintético (producto real) → la limpieza aborta y NO borra nada', async () => {
    const E = await entorno(); await correr(E.db, fix);
    await E.db.exec(`insert into public.products values (gen_random_uuid(),'${F}','REAL-P','e2e02026-1123-4122-8000-0000000000c1','Real',1,0,true)`);
    const antes = await foto(E.db); const r = await correr(E.db, cle); assert.match(r.msg, /OLA1_CLEANUP_PRODUCTO_AJENO/); assert.equal(JSON.stringify(await foto(E.db)), JSON.stringify(antes));
    assert.equal(await accesos(E.db), E.acc);
  });
  await caso('INVENTARIO y LÍNEA BASE (solo lectura): la huella de lo ajeno es idéntica antes de crear y después de limpiar; el inventario muestra el local sintético mientras existe y cero al final', async () => {
    const INV = fs.readFileSync(path.join(HERE, 'inventario_sintetico.sql'), 'utf8'), BASE = fs.readFileSync(path.join(HERE, 'linea_base.sql'), 'utf8');
    const sl = async (db, sql) => { await db.exec('set default_transaction_read_only = on'); try { return (await db.query(sql)).rows; } finally { await db.exec('set default_transaction_read_only = off'); } };
    const db = await nuevo({fk: 'cascade', extra: ['real']});
    // el local preexistente de staging empieza con 89401a44…: se agrega con las 3 cuentas de prueba
    await db.exec(`insert into public.stores values ('89401a44-acc2-4e32-8860-000000000000','REAL-STAGING','Colo Café Staging'); insert into public.store_users values ('89401a44-acc2-4e32-8860-000000000000','${U[0]}','owner',true,now()),('89401a44-acc2-4e32-8860-000000000000','${U[2]}','admin',true,now()),('89401a44-acc2-4e32-8860-000000000000','${U[1]}','operator',true,now());`);
    const mapa = filas => Object.fromEntries(filas.map(f => [f.tipo + '|' + f.detalle, f.valor]));
    const base1 = mapa(await sl(db, BASE)); const inv0 = mapa(await sl(db, INV));
    assert.equal(inv0['LOCAL_SINTETICO|stores'], '0'); assert.ok(Object.entries(inv0).filter(([k]) => k.startsWith('FILAS_DEL_SINTETICO')).every(([, v]) => v === '0'));
    assert.deepEqual(['7cd84c4f (owner)', 'eef11ffb (admin)', '48075b31 (operator)'].map(c => inv0['MEMBRESIA_EN_LOCAL_PREEXISTENTE|' + c]), ['1', '1', '1']);
    await correr(db, fix); await db.exec(escrituras()); await db.exec(escriturasReal());
    const inv1 = mapa(await sl(db, INV));
    assert.equal(inv1['LOCAL_SINTETICO|stores'], '1'); assert.equal(inv1['FILAS_DEL_SINTETICO|store_users'], '3'); assert.equal(inv1['FILAS_DEL_SINTETICO|products'], '6'); assert.ok(Number(inv1['FILAS_DEL_SINTETICO|sales']) >= 2); assert.equal(inv1['FILAS_DEL_SINTETICO|audit_logs'], '2');
    assert.equal(inv1['OTRO_LOCAL_ZZ_E2E|stores'], '0');
    assert.deepEqual(mapa(await sl(db, BASE)), base1, 'la línea base de lo ajeno no debe cambiar mientras existe el sintético');
    const r = await correr(db, cle); assert.equal(r.ok, true, r.msg);
    assert.deepEqual(mapa(await sl(db, BASE)), base1, 'tras la limpieza la huella de lo ajeno debe ser idéntica a la de antes de crear');
    const inv2 = mapa(await sl(db, INV)); assert.equal(inv2['LOCAL_SINTETICO|stores'], '0'); assert.ok(Object.entries(inv2).filter(([k]) => k.startsWith('FILAS_DEL_SINTETICO')).every(([, v]) => v === '0'));
    assert.deepEqual(['7cd84c4f (owner)', 'eef11ffb (admin)', '48075b31 (operator)'].map(c => inv2['MEMBRESIA_EN_LOCAL_PREEXISTENTE|' + c]), ['1', '1', '1']);
  });
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
    const r = await correr(db, cle); assert.match(r.msg, /OLA1_CLEANUP_NADA_QUE_LIMPIAR/);
    assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
  });
  await caso('limpieza dos veces → la segunda aborta (no hay nada que borrar), sin colaterales', async () => {
    const db = await nuevo(); await correr(db, fix); await correr(db, cle); const a = await foto(db);
    const r = await correr(db, cle); assert.match(r.msg, /OLA1_CLEANUP_NADA_QUE_LIMPIAR/); assert.equal(JSON.stringify(await foto(db)), JSON.stringify(a));
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
  // ── Scripts de solo lectura: se ejecutan con la sesión forzada a READ ONLY (si escribieran, fallarían) y se compara el estado antes/después ──
  const GATE = fs.readFileSync(path.join(HERE, 'esquema_gate.sql'), 'utf8'), POL = fs.readFileSync(path.join(HERE, 'politicas_rls.sql'), 'utf8');
  const huella = async db => JSON.stringify([await foto(db), (await db.query(`select md5(string_agg(c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text, ',' order by c.relname)) h from pg_class c where c.relnamespace = 'public'::regnamespace`)).rows[0].h,
    (await db.query(`select count(*) n from pg_policies`)).rows[0].n, (await db.query(`select count(*) n from pg_constraint`)).rows[0].n]);
  const soloLectura = async (db, sql) => { await db.exec('set default_transaction_read_only = on'); try { return (await db.query(sql)).rows; } finally { await db.exec('set default_transaction_read_only = off'); } };
  for (const [nombre, sql] of [['esquema_gate.sql', GATE], ['politicas_rls.sql', POL]]) {
    await caso(`${nombre}: corre en sesión READ ONLY, devuelve filas y deja datos y catálogo idénticos`, async () => {
      const db = await nuevo({fk: 'restrict'}); await correr(db, fix); await db.exec(escrituras());
      await db.exec("alter table public.sales enable row level security; create policy sales_sel on public.sales for select using (true); create function public.has_store_role(a uuid, b text[]) returns boolean language sql as 'select true'");
      const antes = await huella(db);
      const filas = await soloLectura(db, sql);
      assert.ok(filas.length > 0, 'debe devolver filas');
      assert.equal(await huella(db), antes, 'el estado cambió');
    });
  }
  await caso('la sesión READ ONLY es efectiva: un INSERT falla (la garantía no es nominal)', async () => {
    const db = await nuevo(); await db.exec('set default_transaction_read_only = on');
    const r = await correr(db, "insert into public.stores values (gen_random_uuid(), 'X', 'Y')");
    assert.equal(r.ok, false); assert.match(r.msg, /read-only transaction/i);
  });
  await caso('esquema_gate.sql (primera ejecución real): detecta FKs, rol y la tabla hija SIN store_id', async () => {
    const db = await nuevo({fk: 'restrict', extra: ['hijo_sin_store']});
    const filas = await soloLectura(db, GATE), tipos = new Set(filas.map(f => f.tipo));
    assert.ok(tipos.has('ROL') && tipos.has('TABLA_CON_STORE_ID') && tipos.has('FK_EN_EL_ARBOL'), [...tipos].join(','));
    assert.ok(filas.some(f => f.tipo === 'STOP_HIJO_SIN_STORE_ID' && /sale_events/.test(f.detalle)), 'debe marcar sale_events como STOP');
    assert.ok(filas.some(f => f.tipo === 'ADVERTENCIA_BORRADO_BLOQUEA'), 'sin cascada debe advertir que el borrado bloquea');
    assert.ok(!filas.some(f => f.tipo === 'STOP_ROL_SIN_BYPASSRLS'), 'el rol del SQL Editor tiene bypassrls');
  });
  await caso('esquema_gate.sql con FKs en cascada y sin hijas huérfanas: sin STOP', async () => {
    const db = await nuevo({fk: 'cascade'}); const filas = await soloLectura(db, GATE);
    assert.ok(!filas.some(f => /^STOP_/.test(f.tipo)), JSON.stringify(filas.filter(f => /^STOP_/.test(f.tipo))));
  });
  await caso('politicas_rls.sql: lista políticas, RLS activo, restricción de precio e índice único', async () => {
    const db = await nuevo(); await db.exec("alter table public.open_orders enable row level security; create policy p_del on public.open_orders for delete using (true); alter table public.products add constraint chk_precio check (price > 0); create unique index sales_u on public.sales(id);");
    const filas = await soloLectura(db, POL), tipos = new Set(filas.map(f => f.tipo));
    for (const t of ['POLITICA', 'RLS_ACTIVO', 'RESTRICCION_PRODUCTS', 'COLUMNA_PRECIO', 'INDICE_UNICO_VENTAS']) assert.ok(tipos.has(t), 'falta ' + t);
    assert.ok(filas.every(f => String(f.definicion || '').length <= 400), 'definiciones acotadas');
  });
  console.log(resultados.map(([n, r]) => `${r === 'OK' ? '✔' : '✖'} ${n}${r === 'OK' ? '' : '  → ' + r}`).join('\n'));
  console.log(`${resultados.filter(r => r[1] === 'OK').length}/${resultados.length} casos OK`);
})().catch(e => { console.error(e); process.exit(1); });
