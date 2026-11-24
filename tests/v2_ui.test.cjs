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
  assert.deepEqual(nav, ['Pedidos', 'Negocio', 'Clientes', 'Administrar']);
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
  await page.evaluate(() => { const k = Object.keys(carrito)[0]; carrito[k].qty = Number(carrito[k].qty) + 1; renderCart(); });
  await page.waitForFunction(t => document.querySelector('.cobro-tk .tk-total b').innerText !== t, totalAntes);
  const despues = await page.$$eval('.cobro-tk .tk-lines li', l => l.map(x => x.innerText.replace(/\s+/g, ' ')));
  assert.notDeepEqual(despues, antes);
  assert.match(await page.$eval('#cobro-msg', e => e.textContent), /El pedido cambió/);
  const boton = await page.$eval('.btn-confirmar[data-c=confirmar]', e => e.textContent);
  assert.ok(boton.endsWith(await page.$eval('.cobro-tk .tk-total b', e => e.innerText)), boton);
  await page.click('[data-o]');
  await page.evaluate(() => { window.__ventasAntes = ventas.length; const k = Object.keys(carrito)[0]; carrito[k].qty = Number(carrito[k].qty) + 1; renderCart(); });
  await page.evaluate(() => document.querySelector('.btn-confirmar[data-c=confirmar]').click());
  assert.equal(await page.evaluate(() => ventas.length), await page.evaluate(() => window.__ventasAntes));
}));

test('V2: Negocio muestra indicadores reales y turnos del servidor simulado', async () => abrir(async page => {
  await page.evaluate(() => goTab('dashboard'));
  await page.waitForSelector('#tab-dashboard.active .kpi-grid');
  await page.evaluate(() => document.querySelector('.res-head [data-r="turnos"]').click());
  await page.waitForSelector('.turno-row');
  assert.ok((await page.$$('.turno-row')).length >= 2);
}));
