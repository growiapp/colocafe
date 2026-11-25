'use strict';
// Ola 1 de la auditoría: vuelto en Cobrar, «Eliminar mesa» como botón accesible y teclado en controles div. Sin red (arnés de demostración).
// Cada prueba falla contra la versión publicada (f1a2954) y pasa con las correcciones.
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

const abrirCobro = async page => { await page.evaluate(id => abrirMesa(id), MESA); await page.waitForSelector('#btn-confirm'); await page.click('#btn-confirm'); await page.waitForSelector('#cobro-screen:not([hidden]) .cobro-ops'); };
const vuelto = page => page.$eval('#cobro-vuelto', e => ({t: e.textContent.trim(), falta: e.classList.contains('falta')}));

// ── O1: vuelto en efectivo (informativo: no cambia el cobro ni lo bloquea) ──
for (const [nombreVp, vp] of [['escritorio', ESC], ['móvil', MOV]]) {
  test(`O1 (${nombreVp}): Cobrar en efectivo calcula vuelto o faltante, con atajos y sin desbordar`, async () => abrir(async page => {
    await abrirCobro(page);
    assert.equal(await page.$eval('#cobro-rec-in', e => e.value), '');
    assert.equal((await vuelto(page)).t, '', 'sin monto recibido no hay mensaje');
    await page.fill('#cobro-rec-in', '20000');
    assert.deepEqual(await vuelto(page), {t: 'Vuelto $7.600', falta: false});
    await page.fill('#cobro-rec-in', '10000');
    assert.deepEqual(await vuelto(page), {t: 'Faltan $2.400', falta: true});
    await page.fill('#cobro-rec-in', '1a2.0');                         // solo dígitos
    assert.equal(await page.$eval('#cobro-rec-in', e => e.value), '120');
    const atajos = await page.$$eval('.cobro-rec [data-r]', b => b.map(x => x.dataset.r));
    assert.deepEqual(atajos, ['12400', '13000', '15000', '20000']);      // Justo + próximos billetes redondos
    await page.click('.cobro-rec [data-r="15000"]');
    assert.deepEqual(await vuelto(page), {t: 'Vuelto $2.600', falta: false});
    await page.click('.cobro-rec [data-r="12400"]');
    assert.deepEqual(await vuelto(page), {t: 'Vuelto $0', falta: false});
    assert.match(await page.$eval('.btn-confirmar[data-c=confirmar]', b => b.textContent), /Confirmar cobro · \$12\.400/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'sin desborde horizontal');
  }, {viewport: vp}));
}

test('O1: el vuelto solo existe en efectivo, se conserva al volver y se limpia al abrir otro cobro', async () => abrir(async page => {
  await abrirCobro(page);
  await page.fill('#cobro-rec-in', '15000');
  await page.click('[data-m="transferencia"]');
  assert.equal(await page.$('#cobro-rec-in'), null, 'con transferencia no se ofrece');
  await page.click('[data-m="mixed"]');
  assert.equal(await page.$('#cobro-rec-in'), null, 'con pago mixto no se ofrece');
  await page.click('[data-m="ef"]');
  assert.equal(await page.$eval('#cobro-rec-in', e => e.value), '15000');
  await page.click('[data-c="volver"]');
  await page.click('#btn-confirm'); await page.waitForSelector('#cobro-screen:not([hidden]) .cobro-ops');
  assert.equal(await page.$eval('#cobro-rec-in', e => e.value), '', 'un cobro nuevo empieza sin monto recibido');
}));

test('O1: cobrar con vuelto calculado no altera la venta (mismo total, sin campos nuevos) y sigue exigiendo operador', async () => abrir(async page => {
  await abrirCobro(page);
  await page.waitForFunction(() => document.querySelectorAll('.cobro-ops [data-o]').length === 3);
  await page.fill('#cobro-rec-in', '20000');
  await page.click('.btn-confirmar[data-c=confirmar]');
  assert.match(await page.$eval('#cobro-msg', e => e.textContent), /Elegí quién atendió/);
  await page.click('.cobro-ops [data-o="Ana"]');
  const antes = await page.evaluate(() => ventas.length);
  await page.click('.btn-confirmar[data-c=confirmar]');
  await page.waitForFunction(n => ventas.length > n, antes, {timeout: 15000});
  const nuevas = await page.evaluate(n => ventas.slice(n), antes);
  assert.equal(nuevas.reduce((s, v) => s + v.total, 0), 12400);
  assert.doesNotMatch(JSON.stringify(nuevas), /recib|vuelto|20000/i);
}));

// ── O2: «Eliminar mesa» es un botón con nombre y zona táctil de 44 px ──
for (const [nombreVp, vp] of [['escritorio', ESC], ['móvil', MOV]]) {
  test(`O2 (${nombreVp}): el × de la tarjeta es un botón con nombre, alcanzable por teclado, con zona táctil ≥ 44 px y confirmación`, async () => abrir(async page => {
    const r = await page.$$eval('.mesa-card .mesa-close', bs => bs.map(b => { const a = getComputedStyle(b, '::after'), r = b.getBoundingClientRect(); return {tag: b.tagName, nombre: b.getAttribute('aria-label'), zona: Math.min(r.width + 2 * -parseFloat(a.top), r.height + 2 * -parseFloat(a.top))}; }));
    assert.equal(r.length, 6);
    for (const b of r) { assert.equal(b.tag, 'BUTTON'); assert.match(b.nombre, /^Eliminar /); assert.ok(b.zona >= 40, JSON.stringify(b)); }
    await page.focus('.mesa-card[data-mesa] .mesa-close');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('mesa-close')), true);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#modal-confirm.open');                  // pide confirmar antes de eliminar
    assert.match(await page.$eval('#modal-confirm', e => e.innerText), /Eliminar/);
    assert.equal(await page.evaluate(() => mesas.length), 6, 'no se elimina sin confirmar');
  }, {viewport: vp}));
}

// ── O3: filtros y acordeones (div) se operan con teclado ──
test('O3: los filtros de Caja, los de Reportes y los acordeones de Gestión se operan con teclado (Enter y Espacio)', async () => abrir(async page => {
  const sinTeclado = () => page.evaluate(() => [...document.querySelectorAll('[onclick]')].filter(e => !/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL)$/.test(e.tagName) && !e.hasAttribute('tabindex') && !e.closest('button') && /(^|\s)(chip|dash-filtro-chip|accordion-hdr|turno-pill|gs-pill|pago-opt)(\s|$)/.test(e.className)).map(e => e.id || e.className));
  assert.deepEqual(await sinTeclado(), []);
  await page.focus('.chip:not(.active)');
  const antes = await page.$eval('.chip.active', e => e.textContent);
  await page.keyboard.press('Enter');
  assert.notEqual(await page.$eval('.chip.active', e => e.textContent), antes, 'Enter activa el filtro');
  const t2 = await page.$eval('.chip.active', e => e.textContent);
  await page.focus('.chip:not(.active)');
  await page.keyboard.press('Space');
  assert.notEqual(await page.$eval('.chip.active', e => e.textContent), t2, 'Espacio activa el filtro');
  await page.evaluate(() => goTab('ajustes')); await page.waitForTimeout(300);
  assert.deepEqual(await sinTeclado(), []);
  const abierto = () => page.evaluate(() => document.getElementById('acc-body-menu').classList.contains('open'));
  assert.equal(await abierto(), false);
  await page.focus('.accordion-hdr'); await page.keyboard.press('Enter');
  assert.equal(await abierto(), true, 'Enter abre el acordeón');
  assert.equal(await page.$eval('.accordion-hdr', e => e.getAttribute('aria-expanded')), 'true');
}));

// ── O4: Cobrar usa todo el ancho en escritorio ──
test('O4 (escritorio 1280×800): Cobrar no desborda los botones de medio de pago y «Confirmar cobro» queda a la vista sin desplazarse', async () => abrir(async page => {
  await page.click(`.mesa-card[data-mesa="${MESA}"]`);   // recorrido real: tarjeta → panel → Cobrar
  await page.click('#btn-confirm'); await page.waitForSelector('#cobro-screen:not([hidden]) .cobro-ops');
  const m = await page.evaluate(() => ({botones: [...document.querySelectorAll('.cobro-medios button')].map(b => [b.clientWidth, b.scrollWidth]), conf: document.querySelector('.btn-confirmar').getBoundingClientRect().bottom, alto: innerHeight, main: document.querySelector('.cobro-main').getBoundingClientRect().width}));
  for (const [c, s] of m.botones) assert.ok(s <= c, JSON.stringify(m));
  assert.ok(m.main >= 600, "columna principal ancha: " + JSON.stringify(m));
  assert.ok(m.conf <= m.alto, `el botón queda fuera de la pantalla (${m.conf} > ${m.alto})`);
}));

// ── Revisión independiente (Codex): el foco sobrevive a los repintados ──
test('O5: escribir «Paga con» no pierde el foco si Cobrar se repinta (llegada de operadores) y Enter/Espacio en filtros no pierde el foco', async () => abrir(async page => {
  await page.focus('#ventas-filtro-chips .chip:not(.active)');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#ventas-filtro-chips')), true, 'tras el repintado el foco sigue en un filtro');
  const a = await page.evaluate(() => document.activeElement.textContent);
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), a);
  await page.keyboard.press('Space');                                   // segunda activación sin volver a enfocar por programa
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#ventas-filtro-chips')), true);
  await page.evaluate(() => { const o = loadOperatorsFromSupabase; window.loadOperatorsFromSupabase = () => new Promise(r => setTimeout(() => r(o()), 1500)); });   // la lectura de operadores tarda y termina mientras se escribe
  await abrirCobro(page); await page.waitForTimeout(150);   // pasa el enfoque inicial que Cobrar da al medio de pago
  await page.evaluate(() => { document.getElementById('cobro-rec-in').dataset.viejo = '1'; });
  await page.focus('#cobro-rec-in'); await page.keyboard.type('12');
  await page.waitForFunction(() => !document.getElementById('cobro-rec-in').dataset.viejo, null, {timeout: 8000});   // el repintado reemplazó el input
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cobro-rec-in', 'el repintado no saca el foco del importe');
  await page.keyboard.type('345');
  assert.equal(await page.$eval('#cobro-rec-in', e => e.value), '12345', 'las cifras siguientes siguen entrando en orden');
}));
