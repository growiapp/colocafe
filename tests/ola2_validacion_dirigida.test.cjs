'use strict';
// Ola 2 · validación dirigida (reservas, clientes, impresión). Misma mecánica que ola2_mejoras.test.cjs.
// Contra una versión previa: OLA2_REV=4bcf451 node --test tests/ola2_validacion_dirigida.test.cjs
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

const reservaEn = (min, extra = {}) => `(() => { const d = new Date(Date.now() + ${min} * 60000), p = n => String(n).padStart(2, '0');
  return {id: 'r1', nombre: 'Prueba', tipo: 'salon', estado: 'pendiente', fecha: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), hora: p(d.getHours()) + ':' + p(d.getMinutes()), recordatorio: '10', items: [], ...${JSON.stringify(extra)}}; })()`;

test('Reservas: oculta → sin aviso ni marca; visible → un solo aviso; sin duplicados por tick, por evento de visibilidad ni tras cerrarlo', () => conPagina(async page => {
  const r = await page.evaluate(async r1 => {
    reservas = [r1]; Object.keys(localStorage).filter(k => k.startsWith('reservationReminder')).forEach(k => localStorage.removeItem(k));
    let oculto = true; Object.defineProperty(document, 'hidden', {configurable: true, get: () => oculto});
    let shows = 0; const orig = window.showReservationReminder || showReservationReminder;
    const modal = () => !!document.getElementById('modal-reserva-reminder')?.classList.contains('open');
    const marcas = () => Object.keys(localStorage).filter(k => k.startsWith('reservationReminder')).length;
    const o = [];
    checkReservationReminders(); checkReservationReminders();                 // varios ticks ocultos
    document.dispatchEvent(new Event('visibilitychange'));                      // evento con la app aún oculta
    o.push({modal: modal(), marcas: marcas()});
    oculto = false; document.dispatchEvent(new Event('visibilitychange'));      // vuelve: el listener real debe mostrarlo
    o.push({modal: modal(), marcas: marcas()});
    const snapMarcas = marcas();
    checkReservationReminders(); document.dispatchEvent(new Event('visibilitychange')); checkReservationReminders(); // más ticks con el modal abierto
    o.push({modal: modal(), marcas: marcas(), igual: marcas() === snapMarcas});
    document.getElementById('modal-reserva-reminder').classList.remove('open');  // se cierra sin snooze
    checkReservationReminders(); document.dispatchEvent(new Event('visibilitychange'));
    o.push({modal: modal(), marcas: marcas()});                                 // ya visto: no reaparece
    return o;
  }, await page.evaluate(`(${reservaEn(5)})`));
  assert.deepEqual(r[0], {modal: false, marcas: 0});
  assert.equal(r[1].modal, true); assert.equal(r[1].marcas, 1);
  assert.equal(r[2].modal, true); assert.equal(r[2].igual, true, 'sin marcas extra');
  assert.deepEqual(r[3], {modal: false, marcas: 1}, 'una vez visto no se repite');
}));

test('Reservas: el listener de visibilidad se registra una sola vez', () => conPagina(async page => {
  const n = await page.evaluate(() => { let c = 0; const add = document.addEventListener.bind(document); document.addEventListener = (t, ...a) => { if (t === 'visibilitychange') c++; return add(t, ...a); }; reservationReminderTimer = null; scheduleReservationReminders(); scheduleReservationReminders(); scheduleReservationReminders(); return c; });
  assert.equal(n, 1);
}));

const TELS_OK = ['', '+54 9 11 5555-1234', '(011) 4555-1234', '011 15-5555-1234', '11 5555 1234', '+1 (415) 555-2671', '+34 612 345 678', '00 44 20 7946 0958', '4555.1234', '1155551234'];
const TELS_MAL = ['abc', '12345', '1'.repeat(16), '11 5555 abcd', '+54 11 5555-1234 int. 12', '5555--', '++++++'];
const MAILS_OK = ['', 'ana@mail.com', 'Ana.Perez+cafe@mail.com.ar', 'a_b-c@sub.dominio.co', 'x@y.io'];
const MAILS_MAL = ['sin-arroba', 'a@b', 'a b@mail.com', '@mail.com', 'ana@', 'ana@@mail.com', 'ana@mail.', 'ana@mail,com'];

test('Clientes (alta): vacíos opcionales; teléfonos y emails válidos se guardan; inválidos no escriben ni dan éxito', () => conPagina(async page => {
  const r = await page.evaluate(async ({tOk, tMal, mOk, mMal}) => {
    const set = (n, t, e) => { for (const [id, v] of [['cli-nombre', n], ['cli-tel', t], ['cli-email', e], ['cli-alergias', ''], ['cli-prefs', '']]) { let el = document.getElementById(id); if (!el) { el = document.createElement('input'); el.id = id; document.body.appendChild(el); } el.value = v; } };
    const casos = [...tOk.map(t => ['ok', t, '']), ...mOk.map(m => ['ok', '', m]), ...tMal.map(t => ['mal', t, '']), ...mMal.map(m => ['mal', '', m])];
    const out = [];
    for (const [tipo, t, m] of casos) {
      editClienteId = null; clientes = []; document.getElementById('toast').textContent = ''; set('Ana', t, m);
      let escrituras = 0; const sp = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { escrituras++; return sp.apply(this, a); };
      try { await window.guardarCliente(); } finally { Storage.prototype.setItem = sp; }
      out.push({tipo, t, m, n: clientes.length, escrituras, toast: document.getElementById('toast').textContent, tel: clientes[0]?.telefono, mail: clientes[0]?.email});
    }
    return out;
  }, {tOk: TELS_OK, tMal: TELS_MAL, mOk: MAILS_OK, mMal: MAILS_MAL});
  for (const x of r) {
    if (x.tipo === 'ok') { assert.equal(x.n, 1, `debe aceptar tel="${x.t}" email="${x.m}"`); assert.equal(x.tel, x.t); assert.equal(x.mail, x.m); }
    else { assert.equal(x.n, 0, `debe rechazar tel="${x.t}" email="${x.m}"`); assert.equal(x.escrituras, 0, 'sin escrituras locales al rechazar'); assert.doesNotMatch(x.toast, /guardado/i, 'sin mensaje de éxito'); assert.match(x.toast, /v[aá]lido/i); }
  }
}));

test('Clientes (edición): rechazo no modifica ni escribe ni da éxito; datos históricos no válidos no bloquean editar otros campos', () => conPagina(async page => {
  const r = await page.evaluate(async () => {
    const set = (n, t, e) => { for (const [id, v] of [['cli-nombre', n], ['cli-tel', t], ['cli-email', e], ['cli-alergias', ''], ['cli-prefs', '']]) { let el = document.getElementById(id); if (!el) { el = document.createElement('input'); el.id = id; document.body.appendChild(el); } el.value = v; } };
    const o = {};
    // 1) edición con teléfono nuevo inválido: nada cambia
    clientes = [{id: 'c1', nombre: 'Luz', telefono: '11 5555 1234', email: 'luz@mail.com', visitas: [], _sync_status: 'synced'}]; editClienteId = 'c1';
    set('Luz', 'xx', 'luz@mail.com'); document.getElementById('toast').textContent = '';
    let esc = 0; const sp = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { esc++; return sp.apply(this, a); };
    try { await window.guardarCliente(); } finally { Storage.prototype.setItem = sp; }
    o.rechazo = {tel: clientes[0].telefono, sync: clientes[0]._sync_status, esc, toast: document.getElementById('toast').textContent};
    // 2) dato histórico NO válido (texto libre) que no se toca: se puede cambiar otro campo
    clientes = [{id: 'c2', nombre: 'Mario', telefono: '11-5555-1234 (casa)', email: 'mario arroba hotmail', visitas: [], _sync_status: 'synced'}]; editClienteId = 'c2';
    set('Mario R.', '11-5555-1234 (casa)', 'mario arroba hotmail');
    await window.guardarCliente();
    o.historico = {nombre: clientes[0].nombre, tel: clientes[0].telefono, mail: clientes[0].email};
    // 3) dato histórico + intento de cambiarlo a otro inválido: se rechaza
    clientes = [{id: 'c3', nombre: 'Eva', telefono: '11-5555-1234 (casa)', email: '', visitas: []}]; editClienteId = 'c3';
    set('Eva', '11-5555-1234 (casa) x', ''); await window.guardarCliente();
    o.cambioMalo = clientes[0].telefono;
    // 4) vaciar un dato histórico inválido es válido
    clientes = [{id: 'c4', nombre: 'Tom', telefono: '11-5555-1234 (casa)', email: '', visitas: []}]; editClienteId = 'c4';
    set('Tom', '', ''); await window.guardarCliente();
    o.vaciado = clientes[0].telefono;
    return o;
  });
  assert.equal(r.rechazo.tel, '11 5555 1234'); assert.equal(r.rechazo.sync, 'synced'); assert.equal(r.rechazo.esc, 0); assert.doesNotMatch(r.rechazo.toast, /guardado/i);
  assert.deepEqual(r.historico, {nombre: 'Mario R.', tel: '11-5555-1234 (casa)', mail: 'mario arroba hotmail'}, 'campos históricos sin tocar no bloquean la edición');
  assert.equal(r.cambioMalo, '11-5555-1234 (casa)');
  assert.equal(r.vaciado, '');
}));

test('Impresión: ticket y comanda normales rellenan el área durante print() y la limpian en afterprint; cancelar/vista previa también limpian', () => conPagina(async page => {
  const r = await page.evaluate(async () => {
    const area = () => document.getElementById('print-area'); const o = {};
    let enPrint = null; window.print = () => { enPrint = area().innerHTML; };
    imprimirDocumentos('<p>TICKET</p>'); o.ticketDurante = enPrint; o.ticketAntes = area().innerHTML;
    window.dispatchEvent(new Event('afterprint')); o.ticketDespues = area().innerHTML;       // afterprint se dispara también al cancelar o cerrar la vista previa
    // ticket real del historial
    histTicketsVisibles = [{persistida: true, items: [{cantidad: 1, producto: 'Café', total: 100, bruto: 100}], payments: [{metodo: 'efectivo', monto: 100}], total: 100, fecha: '2026-11-25', hora: '10:00', tipo: 'salon', descuento: {productos: 0, ticket: 0}}];
    enPrint = null; try { imprimirTicketHistorial(0); } catch (e) { o.errTicket = String(e); }
    o.ticketHist = (enPrint || '').includes('Café'); window.dispatchEvent(new Event('afterprint'));
    histTicketsVisibles = [{persistida: false}]; enPrint = null; imprimirTicketHistorial(0); o.noPersistida = enPrint;
    // comanda
    enPrint = null; imprimirDocumentos(htmlComanda({tipo: 'salon', mesa: 'M1'}, {cafeteria: [{producto: 'Latte', variantes: [], nota: '', cantidad: 2}]}, {titulos: {cafeteria: 'COMANDA N° 1'}}));
    o.comanda = (enPrint || '').includes('Latte'); window.dispatchEvent(new Event('afterprint')); o.comandaDespues = area().innerHTML;
    // excepción síncrona
    window.print = () => { throw new Error('boom'); };
    document.getElementById('toast').textContent = ''; let propaga = false; try { imprimirDocumentos('<p>X</p>'); } catch (_) { propaga = true; }
    o.excepcion = {propaga, area: area().innerHTML, toast: document.getElementById('toast').textContent};
    // tras la excepción, una impresión normal posterior funciona y no queda basura
    window.print = () => { enPrint = area().innerHTML; }; enPrint = null; imprimirDocumentos('<p>OTRA</p>'); o.trasExcepcion = enPrint; window.dispatchEvent(new Event('afterprint')); o.finalArea = area().innerHTML;
    return o;
  });
  assert.equal(r.ticketDurante, '<p>TICKET</p>'); assert.equal(r.ticketAntes, '<p>TICKET</p>'); assert.equal(r.ticketDespues, '');
  assert.equal(r.errTicket, undefined); assert.equal(r.ticketHist, true); assert.equal(r.noPersistida, null, 'ticket de venta no confirmada: no imprime');
  assert.equal(r.comanda, true); assert.equal(r.comandaDespues, '');
  assert.deepEqual({propaga: r.excepcion.propaga, area: r.excepcion.area}, {propaga: false, area: ''}); assert.match(r.excepcion.toast, /impresi/i);
  assert.equal(r.trasExcepcion, '<p>OTRA</p>'); assert.equal(r.finalArea, '');
}));
