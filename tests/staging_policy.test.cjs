'use strict';
// Política de red del arnés de staging (ola 1): ampliación mínima «DELETE open_orders» para probar Eliminar mesa. Sin red ni navegador.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {decidirAccesoStaging, FIXTURE_STORE, STAGING_ORIGIN} = require('../tools/staging-ola1/harness/policy.cjs');
const OTRO = '11111111-1111-4111-8111-111111111111', MESA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', AJENA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const H = {apikey: 'x', authorization: 'Bearer y'};
const dec = (q, o = {}) => decidirAccesoStaging({method: o.m || 'DELETE', url: `${STAGING_ORIGIN}/rest/v1/open_orders?${q}`, headers: H, body: o.body ?? null, mode: o.mode || 'fixture', fixtureStore: o.fs || FIXTURE_STORE, fixtureOrders: new Set([MESA])});
const permitido = d => d.accion === 'PERMITIR';
test('DELETE open_orders: sólo la mesa creada por la prueba y el local sintético', () => {
  assert.equal(permitido(dec(`id=eq.${MESA}&store_id=eq.${FIXTURE_STORE}`)), true);
});
for (const [nombre, q, o] of [
  ['mesa que la prueba no creó', `id=eq.${AJENA}&store_id=eq.${FIXTURE_STORE}`],
  ['store_id de otro local', `id=eq.${MESA}&store_id=eq.${OTRO}`],
  ['sin store_id', `id=eq.${MESA}`],
  ['sin id (borrado masivo)', `store_id=eq.${FIXTURE_STORE}`],
  ['id con operador no exacto (in)', `id=in.(${MESA})&store_id=eq.${FIXTURE_STORE}`],
  ['filtro extra (status)', `id=eq.${MESA}&store_id=eq.${FIXTURE_STORE}&status=eq.open`],
  ['store_id repetido', `id=eq.${MESA}&store_id=eq.${FIXTURE_STORE}&store_id=eq.${OTRO}`],
  ['modo de sólo lectura', `id=eq.${MESA}&store_id=eq.${FIXTURE_STORE}`, {mode: 'readonly'}],
  ['con cuerpo', `id=eq.${MESA}&store_id=eq.${FIXTURE_STORE}`, {body: '{"a":1}'}],
  ['fixtureStore distinto del autorizado', `id=eq.${MESA}&store_id=eq.${OTRO}`, {fs: OTRO}],
]) test(`DELETE open_orders se BLOQUEA: ${nombre}`, () => assert.equal(permitido(dec(q, o || {})), false, JSON.stringify(dec(q, o || {}))));
test('otras tablas siguen bloqueadas (sales: DELETE; reservations: sondas)', () => {
  const d = (t, m) => decidirAccesoStaging({method: m, url: `${STAGING_ORIGIN}/rest/v1/${t}?id=eq.${MESA}&store_id=eq.${FIXTURE_STORE}`, headers: H, body: null, mode: 'fixture', fixtureStore: FIXTURE_STORE, fixtureOrders: new Set([MESA])});
  assert.equal(permitido(d('sales', 'DELETE')), false);
  assert.equal(permitido(d('sale_items', 'DELETE')), false);
  assert.equal(permitido(d('stores', 'DELETE')), false);
});
test('producción nunca se permite', () => {
  const r = decidirAccesoStaging({method: 'GET', url: 'https://xhtpahjsddfkwsytubgu.supabase.co/rest/v1/sales?select=*', headers: H, mode: 'fixture', fixtureStore: FIXTURE_STORE});
  assert.equal(permitido(r), false);
});

// ── Lecturas de sales con rango de fechas (consulta legítima de Reportes/Historial) ──
const lectura = (q, o = {}) => decidirAccesoStaging({method: o.m || 'GET', url: `${o.base || STAGING_ORIGIN}/rest/v1/${o.t || 'sales'}?${q}`, headers: {...H, ...(o.h || {})}, mode: 'readonly', fixtureStore: FIXTURE_STORE, fixtureOrders: new Set()});
const BASE_Q = `select=id%2Cstore_id%2Ctotal_amount&store_id=eq.${OTRO}&order=sold_at.desc`;
test('lectura de sales con rango de fechas (gte+lte sobre business_date) y límite: PERMITIDA, también con reintento del cliente', () => {
  assert.equal(permitido(lectura(`${BASE_Q}&business_date=gte.2026-11-25&business_date=lte.2026-11-25&limit=100`)), true);
  assert.equal(permitido(lectura(`${BASE_Q}&business_date=gte.2026-11-25&business_date=lt.2026-11-26`, {h: {'x-retry-count': '1'}})), true);
  assert.equal(permitido(lectura(`select=id&store_id=eq.${OTRO}&sold_at=gte.2026-11-25T00:00:00-03:00&sold_at=lte.2026-11-25T23:59:59-03:00`)), true);
});
for (const [nombre, q, o] of [
  ['otra clave repetida (id)', `${BASE_Q}&id=eq.a&id=eq.b`],
  ['store_id repetido', `select=id&store_id=eq.${OTRO}&store_id=eq.${FIXTURE_STORE}`],
  ['tres ocurrencias del rango', `${BASE_Q}&business_date=gte.2026-11-01&business_date=gte.2026-11-02&business_date=lte.2026-11-30`],
  ['dos límites inferiores', `${BASE_Q}&business_date=gte.2026-11-01&business_date=gte.2026-11-02`],
  ['valor que no es fecha con operador', `${BASE_Q}&business_date=gte.x&business_date=lte.y`],
  ['operador no permitido (eq repetido)', `${BASE_Q}&business_date=eq.2026-11-25&business_date=eq.2026-11-26`],
  ['clave no fecha con gte/lte repetidos (total_amount)', `${BASE_Q}&total_amount=gte.1&total_amount=lte.9`],
  ['escritura PATCH con rango repetido', `${BASE_Q}&business_date=gte.2026-11-25&business_date=lte.2026-11-25`, {m: 'PATCH'}],
  ['DELETE con rango repetido', `${BASE_Q}&business_date=gte.2026-11-25&business_date=lte.2026-11-25`, {m: 'DELETE'}],
  ['producción', `${BASE_Q}&business_date=gte.2026-11-25&business_date=lte.2026-11-25`, {base: 'https://xhtpahjsddfkwsytubgu.supabase.co'}],
  ['cabecera desconocida', `${BASE_Q}`, {h: {'x-otra': '1'}}],
]) test(`lectura se BLOQUEA: ${nombre}`, () => assert.equal(permitido(lectura(q, o || {})), false, JSON.stringify(lectura(q, o || {}))));
