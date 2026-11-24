'use strict';
// Pruebas de la interfaz V2 (sin red; el arnés de demostración es un fixture de tests y no forma parte de la app).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {test} = require('node:test');
const {chromium} = require(process.env.D1_PLAYWRIGHT_MODULE || path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const chrome = process.env.D1_CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const MESA = '00000004-0000-4000-8000-000000000004';

async function abrir(fn, pre) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('<body>', '<body><script src="/__demo.js"></script>');
  const server = http.createServer((q, r) => {
    const p = new URL(q.url, 'http://x').pathname;
    if (p === '/__demo.js') { r.setHeader('content-type', 'application/javascript'); return r.end(fs.readFileSync(path.join(__dirname, 'fixtures/demo_harness.js'))); }
    const rel = p === '/' ? 'index.html' : p.slice(1);
    if (!['index.html', 'logo.png', 'logo.svg', 'manifest.json'].includes(rel)) { r.writeHead(404); return r.end(); }
    r.setHeader('content-type', rel === 'index.html' ? 'text/html; charset=utf-8' : 'application/octet-stream');
    r.end(rel === 'index.html' ? html : fs.readFileSync(path.join(root, rel)));
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const browser = await chromium.launch({headless: true, executablePath: chrome});
  const ctx = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1280, height: 800}});
  const externos = [];
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    externos.push(u.href);
    return /cdn\.jsdelivr\.net/.test(u.hostname) ? route.fulfill({status: 200, contentType: 'text/javascript', body: 'window.supabase={createClient:()=>({})};'}) : route.abort();
  });
  if (pre) await pre(ctx);
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => typeof abrirMesa === 'function' && document.querySelectorAll('.mesa-card').length >= 6, null, {timeout: 15000});
    await fn(page, externos);
    assert.deepEqual(errores, []);
  } finally { await browser.close(); server.close(); }
}

test('V2: demo completa, navegación y sin red a Supabase', async () => abrir(async (page, externos) => {
  const nav = await page.$$eval('.nav-btn', b => b.filter(x => x.offsetParent).map(x => x.innerText.trim()));
  assert.deepEqual(nav, ['Caja', 'Reportes', 'Clientes', 'Gestión']);
  assert.equal(await page.$$eval('.mesa-card', t => t.length), 6);
  assert.ok(!externos.some(u => /supabase\.co/.test(u)), externos.join(','));
  assert.equal(await page.$eval('#ctx-sync', e => e.innerText.trim()), 'Al día');
}));

test('V2: el Cobro refresca el detalle si el pedido cambia y no cobra con el detalle viejo', async () => abrir(async page => {
  await page.evaluate(id => abrirMesa(id), MESA);
  await page.waitForSelector('#btn-confirm');
  await page.click('#btn-confirm');
  const antes = await page.$$eval('.cobro-tk .tk-lines li', l => l.map(x => x.innerText.replace(/\s+/g, ' ')));
  const totalAntes = await page.$eval('.cobro-tk .tk-total b', e => e.innerText);
  await page.evaluate(() => { changeQty(Object.keys(carrito)[0], 1); });
  await page.waitForFunction(t => document.querySelector('.cobro-tk .tk-total b').innerText !== t, totalAntes);
  const despues = await page.$$eval('.cobro-tk .tk-lines li', l => l.map(x => x.innerText.replace(/\s+/g, ' ')));
  assert.notDeepEqual(despues, antes);
  assert.match(await page.$eval('#cobro-msg', e => e.textContent), /El pedido cambió/);
  const boton = await page.$eval('.btn-confirmar[data-c=confirmar]', e => e.textContent);
  assert.ok(boton.endsWith(await page.$eval('.cobro-tk .tk-total b', e => e.innerText)), boton);
  await page.click('[data-o]');
  await page.evaluate(() => { window.__ventasAntes = ventas.length; changeQty(Object.keys(carrito)[0], 1); });
  await page.evaluate(() => document.querySelector('.btn-confirmar[data-c=confirmar]').click());
  assert.equal(await page.evaluate(() => ventas.length), await page.evaluate(() => window.__ventasAntes));
  // tras el rechazo el botón vigente queda disponible para reintentar
  await page.waitForFunction(() => { const b = document.querySelector('.btn-confirmar[data-c=confirmar]'); return b && !b.disabled; });
}));

test('V2: un cambio del pedido con pago mixto abierto conserva los campos del pago', async () => abrir(async page => {
  await page.evaluate(id => abrirMesa(id), MESA);
  await page.waitForSelector('#btn-confirm');
  await page.click('#btn-confirm');
  await page.click('[data-m="mixed"]');
  await page.waitForSelector('#cobro-mixto-slot #mixed-payments-box');
  await page.evaluate(() => { changeQty(Object.keys(carrito)[0], 1); });
  await page.waitForSelector('#cobro-msg:not(:empty)');
  assert.equal(await page.$$eval('#cobro-screen #mixed-payments-box', n => n.length), 1);
}));

test('V2: Reportes muestra indicadores reales y turnos del servidor simulado', async () => abrir(async page => {
  await page.evaluate(() => goTab('dashboard'));
  await page.waitForSelector('#tab-dashboard.active .kpi-grid');
  await page.evaluate(() => document.querySelector('.res-head [data-r="turnos"]').click());
  await page.waitForSelector('.turno-row');
  assert.ok((await page.$$('.turno-row')).length >= 2);
}));

test('V2: Reportes calcula los indicadores con las ventas y gastos reales de cada período', async () => abrir(async page => {
  await page.evaluate(() => goTab('dashboard'));
  await page.waitForSelector('#tab-dashboard.active .kpi-grid');
  const num = t => Number(String(t).replace(/[^\d]/g, ''));
  const leer = () => page.$$eval('#kpi-grid .kpi', k => k.map(x => ({l: x.querySelector('.kpi-lbl').textContent.trim(), v: x.querySelector('.kpi-val').textContent.trim(), s: x.querySelector('.kpi-sub')?.textContent || ''})));
  for (const f of ['hoy', 'semana', 'mes']) {
    await page.evaluate(x => setDashFiltro(x), f);
    const esp = await page.evaluate(() => { const {desde, hasta} = dashRango(); const v = ventas.filter(r => r.fecha >= desde && r.fecha <= hasta); const g = gastos.filter(r => r.fecha >= desde && r.fecha <= hasta); const t = new Set(v.map(r => r.ticket_id)).size; const tot = v.reduce((s, r) => s + r.total, 0); return {tot, t, prom: t ? Math.round(tot / t) : 0, gas: g.reduce((s, r) => s + r.monto, 0), unid: v.reduce((s, r) => s + r.cantidad, 0)}; });
    const k = await leer();
    assert.deepEqual(k.map(x => x.l), ['Ventas cobradas', 'Cantidad de ventas', 'Ticket promedio', 'Gastos registrados']);
    assert.equal(num(k[0].v), esp.tot, f); assert.equal(num(k[1].v), esp.t, f); assert.equal(num(k[2].v), esp.prom, f); assert.equal(num(k[3].v), esp.gas, f);
    assert.match(k[3].s, /no es la ganancia/);
    // medios de pago: los porcentajes salen de lo cobrado en el período
    const pagos = await page.$$eval('#split-stats .split-stat .split-monto', e => e.map(x => Number(x.textContent.replace(/[^\d]/g, ''))));
    assert.equal(pagos.reduce((a, b) => a + b, 0), esp.tot, f);
  }
  // sin lenguaje de rentabilidad ni «ganancia» presentada como dato
  const txt = await page.$eval('#tab-dashboard', e => e.innerText);
  assert.doesNotMatch(txt, /Estrellas|Caballo|Bajo rendimiento|Potencial oculto|rentable/i);
  assert.match(txt, /No incluye costos ni márgenes/);
  assert.equal(await page.$eval('#bar-chart-titulo', e => e.textContent), 'Evolución de ventas');
  await page.evaluate(() => setDashFiltro('hoy'));
  assert.equal(await page.$eval('#bar-chart-titulo', e => e.textContent), 'Ventas por hora');
}));

// ── Turnos: acumulado parcial de turnos abiertos (misma función que el cierre y el modal «Turno activo») ──
async function abrirTurnos(page) {
  await page.evaluate(() => goTab('dashboard'));
  await page.waitForSelector('#tab-dashboard.active .kpi-grid');
  await page.evaluate(() => document.querySelector('.res-head [data-r="turnos"]').click());
  await page.waitForSelector('.turno-row');
  await page.waitForFunction(() => !document.querySelector('#turnos-lista .empty-v2'));
}
const filaTurno = (page, i) => page.$$eval('.turno-row', (r, i) => r[i].innerText.replace(/\s+/g, ' '), i);

test('V2: Turnos abierto con ventas confirmadas muestra el acumulado parcial, igual al de Reportes, y el cerrado conserva sus totales', async () => abrir(async page => {
  await abrirTurnos(page);
  const abierto = await filaTurno(page, 0), cerrado = await filaTurno(page, 1);
  assert.match(abierto, /Abierto · parcial/);
  assert.match(abierto, /Efectivo \$13\.600/); assert.match(abierto, /Transferencia \$15\.800/); assert.match(abierto, /Total parcial \$29\.400/);
  assert.match(abierto, /Parcial: ventas ya confirmadas por el servidor\. El total definitivo se fija al cerrar el turno\./);
  const reportes = await page.evaluate(() => { document.querySelector('.res-head [data-r="resumen"]').click(); setDashFiltro('hoy'); return document.querySelector('#kpi-grid .kpi-val').innerText; });
  assert.equal(reportes, '$29.400');
  assert.match(cerrado, /Cerrado/); assert.doesNotMatch(cerrado, /parcial/i);
  assert.match(cerrado, /Total \$/);
}));

test('V2: Turnos abierto sin ventas no inventa importes y lo dice', async () => abrir(async page => {
  await page.evaluate(() => { window.__DEMO_DATA.sales = []; window.__DEMO_DATA.sale_items = []; window.__DEMO_DATA.sale_payments = []; });
  await abrirTurnos(page);
  const abierto = await filaTurno(page, 0);
  assert.match(abierto, /Abierto · parcial/); assert.match(abierto, /Todavía no hay ventas confirmadas en este turno/); assert.match(abierto, /Total parcial \$0/);
}));

test('V2: Turnos con error al calcular el parcial muestra un estado informativo, nunca $0', async () => abrir(async page => {
  await page.evaluate(() => { window.__DEMO_DATA.sales = null; }); // la consulta de ventas del turno falla
  await abrirTurnos(page);
  const abierto = await filaTurno(page, 0), cerrado = await filaTurno(page, 1);
  assert.match(abierto, /El total se confirma al cerrar el turno\./); assert.doesNotMatch(abierto, /\$/);
  assert.match(cerrado, /Total \$/); // los cerrados no dependen de la consulta
}));

test('V2: Turnos no repite las lecturas del parcial al volver a la pestaña (15 s)', async () => abrir(async page => {
  await abrirTurnos(page);
  await page.evaluate(() => { document.querySelector('.res-head [data-r="resumen"]').click(); document.querySelector('.res-head [data-r="turnos"]').click(); });
  await page.waitForFunction(() => document.querySelectorAll('.turno-row').length >= 2);
  const log = await page.evaluate(() => window.__DEMO_LOG.map(q => q.t));
  assert.equal(log.filter(t => t === 'sales').length, 1, log.join(','));
  assert.equal(log.filter(t => t === 'sale_items').length, 1);
  assert.equal(log.filter(t => t === 'sale_payments').length, 1);
  assert.ok(log.filter(t => t === 'shifts').length >= 2); // la lista de turnos sí se relee
}));

// ── Comandas: «N sin enviar» lee solo las de las mesas abiertas del local ──
const tagsMesas = page => page.$$eval('.mesa-card', c => Object.fromEntries(c.map(x => [(x.querySelector('.mesa-nombre, h3, .m-name, b, strong')?.innerText || x.innerText.split('\n')[0]).trim(), (x.querySelector('.tag.warn')?.innerText || '').trim()]).filter(([, v]) => v)));
const ESPERADO = {'Mesa 4': '2 sin enviar', 'Juan P.': '3 sin enviar', 'Para llevar 3': '2 sin enviar'};

test('V2: «N sin enviar» sale de las comandas de cada mesa abierta (caso base)', async () => abrir(async page => {
  await page.waitForFunction(() => window.__DEMO_LOG.some(q => q.t === 'open_order_dispatches'));
  await page.waitForTimeout(2500);
  assert.deepEqual(await tagsMesas(page), ESPERADO);
  const qs = await page.evaluate(() => window.__DEMO_LOG.filter(q => q.t === 'open_order_dispatches'));
  assert.ok(qs.length >= 1);
  for (const q of qs) { assert.ok(q.f.some(([k, c]) => k === 'eq' && c === 'store_id'), 'sin filtro de local'); assert.ok(q.f.some(([k, c]) => k === 'in' && c === 'open_order_id'), 'sin filtro de mesas'); }
}));

test('V2: «N sin enviar» no se contamina con historial de mesas cerradas, otro local ni el tope de 1000 filas', async () => abrir(async page => {
  await page.waitForFunction(() => window.__DEMO_LOG.some(q => q.t === 'open_order_dispatches' && q.rg && q.rg[0] === 1000), null, {timeout: 20000});
  await page.waitForTimeout(2500);
  assert.deepEqual(await tagsMesas(page), ESPERADO);
  const qs = await page.evaluate(() => window.__DEMO_LOG.filter(q => q.t === 'open_order_dispatches'));
  const {abiertas, local} = await page.evaluate(() => ({abiertas: mesas.map(m => String(getMesaOpenOrderId(m))), local: config.activeStoreId}));
  for (const q of qs) {
    assert.ok(q.f.find(([k, c]) => k === 'in' && c === 'open_order_id')[2].every(i => abiertas.includes(i)), 'se pidieron comandas de mesas que no están abiertas');
    assert.equal(q.f.find(([k, c]) => k === 'eq' && c === 'store_id')[2], local);
  }
  assert.ok(qs.some(q => q.rg && q.rg[0] === 0 && q.rg[1] === 999) && qs.some(q => q.rg && q.rg[0] === 1000), 'no paginó más allá de 1000 filas');
}, async ctx => {
  await ctx.addInitScript(() => {
    window.__DEMO_PRE = (DATA, {S, mesas, L, disp}) => {
      const hist = Array.from({length: 2500}, (_, i) => ({store_id: S, open_order_id: `99999999-0000-4000-8000-${String(i).padStart(12, '0')}`, sector: 'cafeteria', lines: [L('p1', 1)]})); // mesas ya cerradas
      const ruido = Array.from({length: 1100}, () => ({store_id: S, open_order_id: mesas[0].id, sector: 'cafeteria', lines: []})); // la mesa 1 supera una página
      const ajeno = [{store_id: 'otro-local', open_order_id: mesas[4].id, sector: 'cocina', lines: [L('p6', 2), L('p10', 1)]}]; // mismo id, otro local
      DATA.open_order_dispatches = [...hist, ...ajeno, ...ruido, ...disp.map(d => ({...d, store_id: S}))];
    };
  });
}));
