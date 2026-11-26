'use strict';
// APP_VERSION: la versión cambió respecto de producción y los dispositivos que ya usaron la anterior ven el aviso «Nueva versión disponible» al cargar la nueva.
// Mecanismo real (no hay consulta al servidor): al cargar, la app compara la versión guardada en el dispositivo (colo_seen_app_version) con la suya; si difieren muestra el aviso y guarda la nueva.
// Consecuencia: un dispositivo con la app YA abierta no se entera hasta que recargue o vuelva a abrirla (sin service worker ni consulta periódica).
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {chromium} = require(process.env.D1_PLAYWRIGHT_MODULE || path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'));
const W = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(W, 'index.html'), 'utf8');
const version = h => /const APP_VERSION='([^']+)'/.exec(h)[1];
const PUBLICADA = version(execFileSync('git', ['show', '4bcf451:index.html'], {cwd: W, encoding: 'utf8', maxBuffer: 8e6}));

test('APP_VERSION: formato válido y distinto de la publicada (4bcf451)', () => {
  const v = version(html);
  assert.match(v, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
  assert.notEqual(v, PUBLICADA);
  assert.ok(v > PUBLICADA, `la versión nueva (${v}) debe ordenar después de la de producción (${PUBLICADA})`);
});

async function cargar(vistaAntes) {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname.slice(1) || 'index.html';
    if (!['index.html', 'logo.png', 'logo.svg', 'manifest.json', 'preview.jpg'].includes(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(name === 'index.html' ? html : fs.readFileSync(path.join(W, name)));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({headless: true, executablePath: process.env.D1_CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe')});
  const ctx = await browser.newContext({serviceWorkers: 'block'});
  await ctx.route('**/*', route => { const u = new URL(route.request().url()); if (u.hostname === '127.0.0.1') return route.continue(); if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({status: 200, contentType: 'text/javascript', body: 'window.supabase={createClient:()=>null};'}); return route.abort('blockedbyclient'); });
  if (vistaAntes !== null) await ctx.addInitScript(v => { if (!sessionStorage.getItem('__init_hecho')) { localStorage.setItem('colo_seen_app_version', v); sessionStorage.setItem('__init_hecho', '1'); } }, vistaAntes);
  const page = await ctx.newPage();
  try {
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => typeof addItem === 'function');
    await page.waitForTimeout(500);
    const estado = () => page.evaluate(() => ({banner: document.getElementById('app-update-banner').classList.contains('show'), guardada: localStorage.getItem('colo_seen_app_version'), actual: window.APP_VERSION, toast: document.getElementById('toast').textContent}));
    const primero = await estado();
    await page.reload(); await page.waitForFunction(() => typeof addItem === 'function'); await page.waitForTimeout(500);
    return {primero, trasRecargar: await estado()};
  } finally { await browser.close(); server.close(); }
}

test('un dispositivo que tenía la versión de producción ve el aviso al cargar la nueva, una sola vez, y queda con la nueva guardada', async () => {
  const r = await cargar(PUBLICADA);
  assert.equal(r.primero.banner, true);
  assert.equal(r.primero.guardada, r.primero.actual);
  assert.equal(r.trasRecargar.banner, false, 'tras actualizar no vuelve a avisar');
});

test('un dispositivo nuevo (sin versión guardada) o ya actualizado no ve el aviso', async () => {
  const nuevo = await cargar(null);
  assert.equal(nuevo.primero.banner, false); assert.equal(nuevo.primero.guardada, nuevo.primero.actual);
  const actualizado = await cargar(version(html));
  assert.equal(actualizado.primero.banner, false);
});
