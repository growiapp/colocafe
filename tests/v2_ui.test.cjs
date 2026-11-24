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

test('V2: «N sin enviar» se actualiza al instante al cambiar la mesa, sin nueva lectura de red', async () => abrir(async page => {
  await page.waitForFunction(() => window.__DEMO_LOG.some(q => q.t === 'open_order_dispatches'));
  await page.waitForTimeout(2500);
  assert.deepEqual(await tagsMesas(page), ESPERADO);
  const lecturas = () => page.evaluate(() => window.__DEMO_LOG.filter(q => q.t === 'open_order_dispatches').length);
  const antes = await lecturas();
  const tocada = await page.evaluate(() => {
    const m = mesas.find(x => x.nombre === 'Mesa 4'); const it = Object.values(m.items).find(i => Number(i.qty) > 0);
    it.qty = Number(it.qty) + 1; renderMesasSection(); return !!it;
  });
  assert.ok(tocada);
  await page.waitForFunction(() => [...document.querySelectorAll('.mesa-card')].some(c => /3 sin enviar/.test(c.innerText) && /Mesa 4/.test(c.innerText)), null, {timeout: 1500});
  assert.equal(await lecturas(), antes, 'el cambio local no debe pedir una lectura nueva');
}));

test('V2: la comanda sin turno abierto lleva a la persona con sesión, no un texto genérico ni vacío', async () => abrir(async page => {
  const r = await page.evaluate(() => {
    const porSector = {cafeteria: [{cantidad: 1, producto: 'Latte', variantes: [], nota: ''}]};
    const viejo = turno; turno = {...turno, abierto: false, operador: ''};
    window.__contextoCuenta = {loggedIn: true, nombre: 'Ana Pérez'};
    const con = htmlComanda({}, porSector);
    window.__contextoCuenta = {loggedIn: true, nombre: 'Sesión activa'};
    const generico = htmlComanda({}, porSector);
    turno = viejo;
    return {con, generico, nombreSesion: nombreSesion()};
  });
  assert.match(r.con, /Ana Pérez/);
  assert.doesNotMatch(r.generico, /Sesión activa/);
  assert.equal(r.nombreSesion, '');
}));

test('V2: Reportes vuelve a leer el servidor si los datos tienen más de 15 s', async () => abrir(async page => {
  const r = await page.evaluate(() => ({ttl: typeof DASHBOARD_REFRESH_STALE_MS === 'undefined' ? null : DASHBOARD_REFRESH_STALE_MS}));
  assert.ok(r.ttl === null || r.ttl <= 15000, String(r.ttl)); // la constante vive en un ámbito interno: se comprueba también en el código
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /DASHBOARD_REFRESH_STALE_MS=15000;/);
}));

test('V2: Reportes no reintenta en ráfaga tras un error de lectura (guarda de último intento presente en la ruta real)', async () => {
  const h = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  // la lectura registra su intento (también si falla) y la carga automática se frena durante 15 s si la fuente no es Supabase y el rango no cambió
  assert.match(h, /dashboardLastAttemptMs=Date\.now\(\);\r?\n\s+if\(!hasSalesSupabaseReady\(\)\)/);
  assert.match(h, /!forceRefresh && hasSalesSupabaseReady\(\) && dashboardVisibleSource!=='supabase' && Date\.now\(\)-dashboardLastAttemptMs<DASHBOARD_REFRESH_STALE_MS/);
});

test('V2: sin turno la comanda lleva a quien envía (no a quien abrió la mesa); con turno abierto no cambia', async () => abrir(async page => {
  const r = await page.evaluate(() => {
    const viejo = turno, v = {}; const ses = n => { window.__contextoCuenta = {loggedIn: true, nombre: n}; };
    turno = {...turno, abierto: false, operador: ''}; ses('Ana');
    v.sinTurno = operadorComanda({operator_name: 'Luis'});            // quien envía
    ses('Sesión activa'); v.sinTurnoSinNombre = operadorComanda({operator_name: 'Luis'}); // sin nombre de sesión: el de la mesa
    turno = {...viejo, abierto: true, operador: 'Beto'}; ses('Ana');
    v.conTurno = operadorComanda({operator_name: 'Luis'});            // como antes: el de la mesa
    v.conTurnoMesaVacia = operadorComanda({});                        // como antes: el del turno
    turno = viejo; return v;
  });
  assert.deepEqual(r, {sinTurno: 'Ana', sinTurnoSinNombre: 'Luis', conTurno: 'Luis', conTurnoMesaVacia: 'Beto'});
}));

test('V2: una mesa nueva que aparece justo tras una lectura de comandas se lee al vencer el freno, sin esperar otro cambio', async () => abrir(async page => {
  await page.waitForFunction(() => window.__DEMO_LOG.some(q => q.t === 'open_order_dispatches'));
  await page.waitForTimeout(2500);
  const lecturas = () => page.evaluate(() => window.__DEMO_LOG.filter(q => q.t === 'open_order_dispatches').length);
  const agregar = (id, n) => page.evaluate(([i, nombre]) => { const nueva = JSON.parse(JSON.stringify(mesas[0])); nueva.id = i; nueva._sb_id = i; delete nueva.open_order_id; nueva.nombre = nombre; mesas.push(nueva); renderMesasSection(); }, [id, n]);
  const c0 = await lecturas();
  await agregar('0000dead-0000-4000-8000-00000000beef', 'Mesa Nueva A');       // mesa nueva: lectura inmediata
  await page.waitForFunction(n => window.__DEMO_LOG.filter(q => q.t === 'open_order_dispatches').length > n, c0, {timeout: 4000});
  const c1 = await lecturas();
  await agregar('0000dead-0000-4000-8000-00000000cafe', 'Mesa Nueva B');       // otra mesa nueva a menos de 5 s de la lectura anterior
  await page.waitForFunction(n => window.__DEMO_LOG.filter(q => q.t === 'open_order_dispatches').length > n, c1, {timeout: 8000}); // se lee al vencer el freno (≈5 s), no a los 20 s
}));

test('V2: una lectura de comandas forzada que choca con otra en curso no se pierde (se repite al terminar)', async () => abrir(async page => {
  await page.waitForFunction(() => window.__DEMO_LOG.some(q => q.t === 'open_order_dispatches'));
  await page.waitForTimeout(2500);
  // la lectura de comandas tarda 6 s: la mesa B aparece mientras se lee la A y su temporizador (5 s) vence con la lectura A todavía ocupada
  await page.evaluate(() => { const c = window.__coloSupabaseClient; const orig = c.from.bind(c); c.from = t => { const b = orig(t); if (t === 'open_order_dispatches') { const th = b.then.bind(b); b.then = (res, rej) => { window.__enCurso = (window.__enCurso || 0) + 1; return new Promise(r => setTimeout(r, 6000)).then(() => th(res, rej)); }; } return b; }; });
  const lecturas = () => page.evaluate(() => window.__DEMO_LOG.filter(q => q.t === 'open_order_dispatches').length);
  const agregar = (id, n) => page.evaluate(([i, nombre]) => { const nueva = JSON.parse(JSON.stringify(mesas[0])); nueva.id = i; nueva._sb_id = i; delete nueva.open_order_id; nueva.nombre = nombre; mesas.push(nueva); renderMesasSection(); }, [id, n]);
  const c0 = await lecturas();
  await agregar('0000dead-0000-4000-8000-00000000aaaa', 'Mesa Lenta A');
  await page.waitForFunction(() => window.__enCurso >= 1, null, {timeout: 8000}); // la lectura de A ya está en curso (tarda 6 s)
  await agregar('0000dead-0000-4000-8000-00000000bbbb', 'Mesa Lenta B');
  await page.waitForFunction(n => window.__DEMO_LOG.filter(q => q.t === 'open_order_dispatches').length >= n + 2, c0, {timeout: 22000}); // A y luego la repetición por B
}));

test('V2: refresco automático de Reportes: un solo temporizador y solo con Reportes activo y documento visible', async () => abrir(async page => {
  const r = await page.evaluate(async () => {
    const out = {};
    out.mismoTemporizador = window.__instalarRefrescoReportes() === window.__dashAutoTimer && window.__instalarRefrescoReportes() === window.__instalarRefrescoReportes();
    goTab('carga'); await new Promise(r => setTimeout(r, 600));
    let n = 0; const orig = window.ensureDashboardSource; window.ensureDashboardSource = () => { n++; return Promise.resolve(); };
    out.enOtraPestana = window.__refrescoAutomaticoReportes(); out.llamadasOtra = n;
    goTab('dashboard'); await new Promise(r => setTimeout(r, 800)); n = 0;
    out.activoVisible = window.__refrescoAutomaticoReportes(); out.llamadasActivo = n;
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); n = 0;
    out.oculto = window.__refrescoAutomaticoReportes(); out.llamadasOculto = n;
    delete document.visibilityState; n = 0;
    out.alVolver = window.__refrescoAutomaticoReportes(); out.llamadasAlVolver = n;
    window.ensureDashboardSource = orig; return out;
  });
  assert.deepEqual(r, {mismoTemporizador: true, enOtraPestana: false, llamadasOtra: 0, activoVisible: true, llamadasActivo: 1, oculto: false, llamadasOculto: 0, alVolver: true, llamadasAlVolver: 1});
  // el temporizador real es de 60 s (se comprueba en el código, no esperando un minuto)
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /setInterval\(\(\)=>window\.__refrescoAutomaticoReportes\(\),60000\)/);
}));

// ── Carrera señalada por la revisión independiente: una lectura de ventas ABANDONADA (venció su espera) que llega tarde no debe pisar el estado compartido ──
test('V2: una lectura de ventas lenta que llega fuera de orden no pisa la lectura más nueva (caché de comparación)', async () => abrir(async page => {
  const r = await page.evaluate(async () => {
    const c = window.__coloSupabaseClient; const orig = c.from.bind(c); let n = 0, soltar;
    const usuario = {id: '00000000-0000-4000-8000-0000000000aa'}; c.auth = {getSession: async () => ({data: {session: {user: usuario}}, error: null}), getUser: async () => ({data: {user: usuario}, error: null})}; // sesión mínima: el arnés no la trae
    // la PRIMERA lectura de ventas queda colgada y, al soltarla, devuelve una lista VACÍA (dato viejo/incompleto)
    c.from = t => { const b = t === 'sales' ? orig(t).eq('shift_id', '50000000-0000-4000-8000-000000000001') : orig(t); /* el arnés solo responde 'sales' con filtro de turno */ if (t === 'sales' && ++n === 1) { b.then = (res, rej) => new Promise(r => { soltar = r; }).then(() => Promise.resolve({data: [], error: null}).then(res, rej)); } return b; };
    const rango = {allDates: true, limit: false, forceRefresh: true, silent: true};
    const A = window.loadSalesFromSupabasePreview(rango);          // lectura A: colgada
    await new Promise(r => setTimeout(r, 300));
    const B = await window.loadSalesFromSupabasePreview(rango);    // lectura B (más nueva): termina bien
    const antes = (await window.compareLocalSalesVsSupabase()).supabase.tickets;
    soltar(); await A; await new Promise(r => setTimeout(r, 300));  // A llega tarde, con datos vacíos
    const despues = (await window.compareLocalSalesVsSupabase()).supabase.tickets;
    return {ticketsDeB: B?.comparableRows?.length > 0, antes, despues};
  });
  assert.ok(r.ticketsDeB, 'la lectura B debe traer ventas');
  assert.ok(r.antes > 0, 'la comparación debe ver las ventas de B');
  assert.equal(r.despues, r.antes, 'la lectura vieja que llega tarde pisó la comparación: ' + JSON.stringify(r));
}));

// ── Escenarios dirigidos del refresco de Reportes: cargas simultáneas, cambio de pestaña y de foco, y errores de red ──
const prepararVentas = (modo, ms) => page => page.evaluate(([modo, ms]) => {
  const c = window.__coloSupabaseClient; const orig = c.from.bind(c); const u = {id: '00000000-0000-4000-8000-0000000000aa'};
  c.auth = {getSession: async () => ({data: {session: {user: u}}, error: null}), getUser: async () => ({data: {user: u}, error: null})};
  window.__ventasLecturas = 0;
  c.from = t => { const b = t === 'sales' ? orig(t).eq('shift_id', '50000000-0000-4000-8000-000000000001') : orig(t);
    ['gte', 'lte', 'gt', 'lt', 'neq', 'order', 'is', 'not'].forEach(m => { if (typeof b[m] !== 'function') b[m] = () => b; }); // el arnés solo trae eq/in/range/limit
    if (t === 'sales') { const th = b.then.bind(b); b.then = (res, rej) => { window.__ventasLecturas++; return new Promise(r => setTimeout(r, ms)).then(() => modo === 'error' ? Promise.resolve({data: null, error: {message: 'sin red (prueba)'}}).then(res, rej) : th(res, rej)); }; }
    return b; };
}, [modo, ms]);

test('V2: Reportes no acumula cargas simultáneas (temporizador, entrada a la pestaña, foco y recarga manual a la vez = una sola carga real)', async () => abrir(async page => {
  await prepararVentas('ok', 900)(page);
  const r = await page.evaluate(async () => {
    // se mide cuántas llamadas a la recarga del tablero hacen una carga REAL (duran ≥ 500 ms por la demora simulada) frente a las que se descartan al instante
    const orig = window.reloadDashboardFromSupabase; const llamadas = [];
    window.reloadDashboardFromSupabase = function () { const t0 = Date.now(); const p = orig.apply(this, arguments); llamadas.push(p.then(() => Date.now() - t0)); return p; };
    goTab('carga'); await new Promise(r => setTimeout(r, 100));
    const a = window.reloadDashboardFromSupabase({silent: true, forceRefresh: true});             // carga en curso
    goTab('dashboard'); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
    const b = window.reloadDashboardFromSupabase({silent: true, forceRefresh: true});             // recarga manual simultánea
    window.__refrescoAutomaticoReportes(); window.__refrescoAutomaticoReportes();                  // dos ticks del temporizador
    goTab('carga'); await new Promise(r => setTimeout(r, 50)); goTab('dashboard');                 // cambio de pestaña con la carga en curso
    await a; await b; await new Promise(r => setTimeout(r, 2500));
    const duraciones = await Promise.all(llamadas);
    return {reales: duraciones.filter(d => d >= 500).length, total: duraciones.length};
  });
  assert.equal(r.reales, 1, 'cargas reales simultáneas: ' + JSON.stringify(r));
}));

test('V2: Reportes con error de lectura persistente no reintenta en ráfaga (ticks, foco y cambios de pestaña seguidos = sin lecturas nuevas)', async () => abrir(async page => {
  await prepararVentas('error', 50)(page);
  const r = await page.evaluate(async () => {
    await window.reloadDashboardFromSupabase({silent: true, forceRefresh: true});              // falla
    const tras = window.__ventasLecturas;
    for (let i = 0; i < 4; i++) { goTab('carga'); await new Promise(r => setTimeout(r, 120)); goTab('dashboard'); window.__refrescoAutomaticoReportes(); await new Promise(r => setTimeout(r, 400)); }
    return {tras, despues: window.__ventasLecturas};
  });
  assert.ok(r.tras >= 1);
  assert.equal(r.despues, r.tras, 'hubo reintentos dentro de los 15 s del freno: ' + JSON.stringify(r));
}));
