'use strict';
// Ola 2: (1) B16 recordatorio de reserva no se marca visto con la app en segundo plano, (2) validación de teléfono/email al guardar cliente, (3) B13 impresión con error.
// Contra una versión previa: OLA2_REV=4bcf451 node --test tests/ola2_mejoras.test.cjs  (debe fallar ahí: prueba de que detecta el defecto)
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {chromium} = require(process.env.D1_PLAYWRIGHT_MODULE || path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'));
const W = path.resolve(__dirname, '..');
const rev = process.env.OLA2_REV || 'worktree';
const html = rev === 'worktree' ? fs.readFileSync(path.join(W, 'index.html'), 'utf8') : execFileSync('git', ['show', `${rev}:index.html`], {cwd: W, encoding: 'utf8', maxBuffer: 8e6});

async function conPagina(fn) {
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
  const page = await ctx.newPage();
  try {
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => typeof guardarCliente === 'function' && typeof checkReservationReminders === 'function' && typeof imprimirDocumentos === 'function');
    return await fn(page);
  } finally { await browser.close(); server.close(); }
}

test('B16: con la app oculta el recordatorio no se muestra ni se marca como visto; al volver, se muestra', () => conPagina(async page => {
  const r = await page.evaluate(() => {
    const d = new Date(Date.now() + 5 * 60000), p = n => String(n).padStart(2, '0');
    reservas = [{id: 'rtest', nombre: 'Prueba', tipo: 'salon', estado: 'pendiente', fecha: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, hora: `${p(d.getHours())}:${p(d.getMinutes())}`, recordatorio: '10', items: []}];
    Object.keys(localStorage).filter(k => k.startsWith('reservationReminder')).forEach(k => localStorage.removeItem(k));
    let oculto = true; Object.defineProperty(document, 'hidden', {configurable: true, get: () => oculto});
    const modal = () => !!document.getElementById('modal-reserva-reminder')?.classList.contains('open');
    const marcas = () => Object.keys(localStorage).filter(k => k.startsWith('reservationReminder')).length;
    checkReservationReminders();
    const enSegundoPlano = {modal: modal(), marcas: marcas()};
    oculto = false; checkReservationReminders();
    return {enSegundoPlano, visible: {modal: modal(), marcas: marcas()}};
  });
  assert.deepEqual(r.enSegundoPlano, {modal: false, marcas: 0}, 'oculta: no debe mostrar ni marcar');
  assert.equal(r.visible.modal, true, 'visible: debe mostrarse');
  assert.ok(r.visible.marcas >= 1);
}));

test('Clientes: teléfono y email inválidos se rechazan sin guardar; válidos y vacíos se aceptan', () => conPagina(async page => {
  const r = await page.evaluate(async () => {
    const mk = (n, t, e) => { for (const [id, v] of [['cli-nombre', n], ['cli-tel', t], ['cli-email', e], ['cli-alergias', ''], ['cli-prefs', '']]) { let el = document.getElementById(id); if (!el) { el = document.createElement('input'); el.id = id; document.body.appendChild(el); } el.value = v; } };
    const casos = [['Ana', 'abc', ''], ['Ana', '123', ''], ['Ana', '1'.repeat(16), ''], ['Ana', '', 'sin-arroba'], ['Ana', '', 'a@b'], ['Ana', '+54 11 5555-1234', 'ana@mail.com'], ['Ana', '', ''], ['', '', '']];
    const out = [];
    for (const c of casos) { editClienteId = null; clientes = []; mk(...c); await window.guardarCliente(); out.push({c: c.join('|'), n: clientes.length}); }
    return out;
  });
  const n = Object.fromEntries(r.map(x => [x.c, x.n]));
  for (const k of ['Ana|abc|', 'Ana|123|', 'Ana|' + '1'.repeat(16) + '|', 'Ana||sin-arroba', 'Ana||a@b', '||']) assert.equal(n[k], 0, 'debe rechazar ' + k);
  for (const k of ['Ana|+54 11 5555-1234|ana@mail.com', 'Ana||']) assert.equal(n[k], 1, 'debe aceptar ' + k);
}));

test('B13: si window.print falla, se avisa y el área de impresión no queda con contenido', () => conPagina(async page => {
  const r = await page.evaluate(() => { window.print = () => { throw new Error('sin impresora'); }; let ok = true; try { imprimirDocumentos('<p>x</p>'); } catch (_) { ok = false; } return {ok, area: document.getElementById('print-area').innerHTML, toast: document.getElementById('toast').textContent}; });
  assert.equal(r.ok, true, 'no debe propagar la excepción');
  assert.equal(r.area, '');
  assert.match(r.toast, /impresi/i);
}));
