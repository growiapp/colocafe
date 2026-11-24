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

async function abrir(fn) {
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
  assert.deepEqual(nav, ['Caja', 'Reportes', 'Clientes', 'Administración']);
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
