'use strict';
// Permisos por rol en la interfaz, con roles SIMULADOS en el navegador. No prueban permisos reales del servidor (RLS/RPC).
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

for (const rol of ['owner', 'admin', 'operator']) {
  test(`roles (simulado en el navegador): ${rol}`, async () => abrir(async page => {
    await page.evaluate(r => { window.getSupabaseActiveRole = () => r; window.getActiveStoreRole = () => r; }, rol);
    const admin = rol !== 'operator';
    // la navegación no depende del rol: los cuatro destinos están para todos
    assert.deepEqual(await page.$$eval('.nav-btn', b => b.filter(x => x.offsetParent).map(x => x.innerText.trim())), ['Caja', 'Reportes', 'Clientes', 'Administración']);
    assert.equal(await page.evaluate(() => isSupabaseAdminRole()), admin);
    // "+ Nuevo operador" en el selector del cobro solo para dueño y administración
    assert.equal(await page.evaluate(() => getOperadoresOpts(true).includes('__nuevo__')), admin);
    // alta de operadores en Administrar
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'ops-section-body'; document.body.appendChild(d); renderOperadoresSection(); });
    assert.equal(await page.evaluate(() => !!document.getElementById('ops-new-name')), admin);
    // las acciones protegidas se rechazan en la interfaz para el operador
    const aviso = await page.evaluate(async () => { await window._editOperadorName('x'); return document.getElementById('toast').textContent; });
    if (!admin) assert.match(aviso, /No tenés permiso/);
    if (!admin) assert.equal(await page.evaluate(() => puedeEditarFrecuentes()), false);
    if (!admin) assert.equal(await page.evaluate(() => window.clearLocalTechnicalCache()), false);
    // Negocio, Clientes y Cobro se pueden abrir con cualquier rol
    await page.evaluate(() => goTab('dashboard'));
    await page.waitForSelector('#tab-dashboard.active .kpi-grid');
  }));
}
