'use strict';
// Comanda alcanzable desde el panel lateral de la mesa (escritorio) y la impresión desde las pantallas. Sin red; window.print se intercepta.
// Falla contra la versión publicada (e81db26) y pasa con la corrección.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {test} = require('node:test');
const {chromium} = require(process.env.D1_PLAYWRIGHT_MODULE || path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const chrome = process.env.D1_CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const MESA = '00000004-0000-4000-8000-000000000004';
const ESC = {width: 1280, height: 800}, MOV = {width: 390, height: 844};

async function abrir(fn, {viewport = ESC, pre} = {}) {
  const rootIndex = process.env.HF_INDEX_ROOT || root; // permite correr las mismas pruebas contra la versión anterior
  const html = fs.readFileSync(path.join(rootIndex, 'index.html'), 'utf8').replace('<body>', '<body><script src="/__demo.js"></script>');
  const server = http.createServer((q, r) => {
    const p = new URL(q.url, 'http://x').pathname;
    if (p === '/__demo.js') { r.setHeader('content-type', 'application/javascript'); return r.end(fs.readFileSync(path.join(root, 'tests/fixtures/demo_harness.js'))); }
    const rel = p === '/' ? 'index.html' : p.slice(1);
    if (!['index.html', 'logo.png', 'logo.svg', 'manifest.json'].includes(rel)) { r.writeHead(404); return r.end(); }
    r.setHeader('content-type', rel === 'index.html' ? 'text/html; charset=utf-8' : 'application/octet-stream');
    r.end(rel === 'index.html' ? html : fs.readFileSync(path.join(root, rel)));
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const browser = await chromium.launch({headless: true, executablePath: chrome});
  const ctx = await browser.newContext({serviceWorkers: 'block', viewport});
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
    await page.waitForFunction(() => typeof abrirMesa === 'function' && document.querySelectorAll('.mesa-card').length >= 6, null, {timeout: 20000});
    await fn(page, externos);
    assert.deepEqual(errores, []);
  } finally { await browser.close(); server.close(); }
}

const MESA_PANEL = '00000004-0000-4000-8000-000000000004';
const abrirPanel = async page => { await page.evaluate(() => { window.__imp = []; window.print = () => { window.__imp.push(document.getElementById('print-area').innerHTML); }; goTab('carga'); }); const tarjeta = page.locator('.mesa-card[data-mesa="' + MESA_PANEL + '"]'); await tarjeta.waitFor(); await page.waitForTimeout(1500); await tarjeta.click(); await page.waitForSelector('#atn-slot-cart [data-act="abrir"]'); await page.waitForTimeout(1500); };
test('Comanda: en el panel lateral (escritorio) el botón «Comanda · N sin enviar» es visible y abre el diálogo con imprimir, enviar y reimprimir', async () => abrir(async page => {
  await abrirPanel(page);
  assert.ok(await page.isVisible('#atn-slot-cart [data-act="comanda"]'), 'no hay botón Comanda visible en el panel');
  assert.match(await page.$eval('#atn-slot-cart [data-act="comanda"]', b => b.textContent), /^Comanda · \d+ sin enviar$/);
  await page.click('#atn-slot-cart [data-act="comanda"]'); await page.waitForSelector('#modal-comanda.open'); await page.waitForTimeout(1500);
  const botones = await page.$$eval('#modal-comanda button', b => b.filter(x => x.offsetParent).map(x => x.textContent.trim()));
  for (const t of ['Imprimir pendientes', 'Marcar como enviada', 'Imprimir pedido completo']) assert.ok(botones.includes(t), 'falta ' + t + ': ' + botones);
  assert.ok(botones.includes('Reimprimir'), 'falta Reimprimir');
  // imprimir no cambia nada: solo invoca la impresión con el contenido de la mesa
  const antes = await page.evaluate(() => JSON.stringify(mesas.map(m => [m.id, Object.values(m.items || {}).length])));
  await page.click('#comanda-imprimir'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__imp.length), 1);
  assert.match(await page.evaluate(() => window.__imp[0].replace(/<[^>]+>/g, ' ')), /COMANDA/);
  await page.click('button:has-text("Imprimir pedido completo")'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__imp.length), 2);
  assert.equal(await page.evaluate(() => JSON.stringify(mesas.map(m => [m.id, Object.values(m.items || {}).length]))), antes, 'imprimir alteró la mesa');
}));

test('Comanda: el texto del botón del panel sigue a los productos sin enviar y «Agregar productos» sigue funcionando', async () => abrir(async page => {
  await abrirPanel(page);
  const t0 = await page.$eval('#atn-slot-cart [data-act="comanda"]', b => b.textContent);
  assert.equal(t0, await page.evaluate(() => document.querySelector('#atn-slot-cart .tk-head, #atn-head')?.innerText.match(/\d+ sin enviar/) ? 'Comanda · ' + document.querySelector('#atn-head').innerText.match(/\d+ sin enviar/)[0] : 'Comanda'));
  await page.click('#atn-slot-cart [data-act="abrir"]'); await page.waitForTimeout(800);
  assert.equal(await page.isVisible('#view-pedido button[onclick="abrirComandaMesa()"]'), true, 'en la vista completa de la mesa también está el botón');
}));

test('Comanda: en móvil el botón de la vista de la mesa cabe en pantalla y abre el mismo diálogo', async () => abrir(async page => {
  await page.evaluate(() => { window.__imp = []; window.print = () => {}; goTab('carga'); });
  const tarjeta = page.locator('.mesa-card[data-mesa="' + MESA_PANEL + '"]'); await tarjeta.waitFor(); await page.waitForTimeout(1200); await tarjeta.click(); await page.waitForTimeout(1500);
  const r = await page.$eval('#view-pedido button[onclick="abrirComandaMesa()"]', b => { const x = b.getBoundingClientRect(); return {vis: !!b.offsetParent, cabe: x.right <= innerWidth + 1}; });
  assert.ok(r.vis && r.cabe, JSON.stringify(r));
  await page.click('#view-pedido button[onclick="abrirComandaMesa()"]'); await page.waitForSelector('#modal-comanda.open');
}, {viewport: MOV}));
