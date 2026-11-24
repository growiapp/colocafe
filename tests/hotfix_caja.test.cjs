'use strict';
// Hotfix de Caja, Pedidos y UX (F1–F6). Pruebas sin red (el arnés de demostración es un fixture de tests y no forma parte de la app).
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

// Productos de prueba: nombres cortos y larguísimos, precios chicos y grandes (el arnés no los trae)
const PRODUCTOS = [['Té', 100], ['Capuchino', 1200], ['Medialuna de manteca rellena con dulce de leche y crema pastelera', 4500], ['Sándwich de jamón crudo, queso brie, rúcula y tomates secos al horno con aceite de oliva', 12900], ['Agua', 900], ['Torta de chocolate con frutos rojos y relleno de ganache especial de la casa', 98500]];
const CANTIDADES = [1, 12, 3, 2, 105, 1];
const sembrar = page => page.evaluate(([prods]) => { const base = menu[0]; prods.forEach(([n, p], i) => menu.push({...base, id: 'zz' + i, name: n, price: p, active: true, ilimitado: true})); }, [PRODUCTOS]);
const cargarCarrito = (page, carro, render) => page.evaluate(([carro, render, q]) => { const mapa = {carrito: () => carrito, mesaSetupCarrito: () => mesaSetupCarrito, reservaCarrito: () => reservaCarrito}; const c = mapa[carro](); for (let i = 0; i < 6; i++) c['zz' + i] = {prodId: 'zz' + i, qty: q[i], vars: [], nota: '', precio: 0, desc: i === 3 ? {tipo: 'pct', valor: 10} : null}; window[render](); }, [carro, render, CANTIDADES]);
// medidas de las filas visibles de un contenedor
const medirFilas = (page, sel) => page.evaluate(sel => [...document.querySelectorAll(sel + ' .cart-row')].filter(r => r.offsetParent).map(r => {
  const fila = r.getBoundingClientRect(), q = r.querySelector('.qty-wrap').getBoundingClientRect(), n = r.querySelector('.c-name-wrap').getBoundingClientRect(), s = r.querySelector('.c-sub').getBoundingClientRect(), a = r.querySelector('.c-actions').getBoundingClientRect();
  const del = r.querySelector('.c-act-del');
  return {q: Math.round(q.width), qx: Math.round(q.x - fila.x), btn: [...r.querySelectorAll('.qty-wrap .qty-btn')].map(b => Math.round(b.getBoundingClientRect().width)), a: Math.round(a.width), ax: Math.round(fila.right - a.right),
    delDentroDeQty: !!del && !!del.closest('.qty-wrap'), subDerecha: Math.round(fila.right - s.right), nombre: Math.round(n.width), desborda: r.scrollWidth > r.clientWidth + 1, solapa: n.right > q.left + 1 && n.left < q.right - 1, h: Math.round(fila.height)};
}), sel);

// ── F1: controles de cantidad uniformes en Mesa, Nueva mesa y Reserva (escritorio y móvil) ──
for (const [nombreVp, vp] of [['escritorio', ESC], ['móvil', MOV]]) {
  test(`F1 (${nombreVp}): los controles de cantidad tienen el mismo ancho y lugar en Mesa, Nueva mesa y Reserva, con nombres, precios y cantidades extremos`, async () => abrir(async page => {
    await sembrar(page);
    const casos = [];
    // Mesa existente (panel Pedido)
    await page.evaluate(id => abrirMesa(id), MESA); await page.waitForTimeout(1000);
    await cargarCarrito(page, 'carrito', 'renderCart'); await page.waitForTimeout(400);
    casos.push(['Mesa', await medirFilas(page, '#cart-rows')]);
    // Nueva mesa
    await page.evaluate(() => { goTab('carga'); abrirNuevaMesa(); }); await page.waitForTimeout(600);
    await cargarCarrito(page, 'mesaSetupCarrito', 'renderMesaSetupCarrito'); await page.waitForTimeout(300);
    casos.push(['Nueva mesa', await medirFilas(page, '.order-items-scroll')]);
    await page.evaluate(() => cerrarModalNuevaMesa());
    // Reserva
    await page.evaluate(() => openReservaModal(null)); await page.waitForTimeout(600);
    await cargarCarrito(page, 'reservaCarrito', 'renderReservaCarrito'); await page.waitForTimeout(300);
    casos.push(['Reserva', await medirFilas(page, '.reserva-cart-scroll')]);
    for (const [donde, filas] of casos) {
      assert.ok(filas.length >= 6, `${donde}: faltan filas (${filas.length})`);
      assert.equal(new Set(filas.map(f => f.q)).size, 1, `${donde}: el ancho del control de cantidad varía ${JSON.stringify(filas.map(f => f.q))}`);
      assert.equal(new Set(filas.map(f => f.qx)).size, 1, `${donde}: el control no está alineado ${JSON.stringify(filas.map(f => f.qx))}`);
      assert.equal(new Set(filas.map(f => f.btn.join('x'))).size, 1, `${donde}: los botones − y + cambian de tamaño ${JSON.stringify(filas.map(f => f.btn))}`);
      assert.equal(new Set(filas.map(f => f.a)).size, 1, `${donde}: la columna de acciones varía`);
      assert.equal(new Set(filas.map(f => f.ax)).size, 1, `${donde}: las acciones no están alineadas a la derecha`);
      assert.ok(filas.every(f => !f.delDentroDeQty), `${donde}: «×» no debe ir dentro del control de cantidad`);
      assert.ok(filas.every(f => f.nombre > 40), `${donde}: el nombre quedó comprimido ${JSON.stringify(filas.map(f => f.nombre))}`);
      assert.ok(filas.every(f => !f.desborda && !f.solapa), `${donde}: hay desbordes o solapamientos`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'scroll horizontal involuntario');
  }, {viewport: vp}));
}

// ── F2: sin la leyenda individual «Sin enviar»; se conserva el indicador agregado ──
test('F2: el detalle de la mesa no muestra «Sin enviar» por producto y conserva el indicador agregado', async () => abrir(async page => {
  await page.evaluate(id => abrirMesa(id), MESA);
  await page.waitForFunction(() => /sin enviar/.test(document.querySelector('.cart-head2 .tag')?.textContent || ''), null, {timeout: 15000});
  await page.waitForTimeout(800);
  assert.equal(await page.$$eval('#cart-rows .c-env', e => e.length), 0, 'quedan leyendas individuales');
  assert.doesNotMatch(await page.$eval('#cart-rows', e => e.innerText), /Sin enviar|Enviado/);
  assert.match(await page.$eval('.cart-head2 .tag', e => e.textContent), /^\d+ sin enviar$/);
  assert.match(await page.$eval('#view-pedido button[onclick="abrirComandaMesa()"]', e => e.textContent), /Comanda · \d+ sin enviar/);
}));

// ── F3: la acción de descuento no mueve el contenido ──
test('F3: la altura de las filas no cambia con hover, foco, cambio de cantidad ni al aplicar o quitar un descuento (salvo la línea del descuento aplicado)', async () => abrir(async page => {
  await sembrar(page);
  await page.evaluate(id => abrirMesa(id), MESA); await page.waitForTimeout(1000);
  await cargarCarrito(page, 'carrito', 'renderCart'); await page.waitForTimeout(300);
  const alturas = () => page.$$eval('#cart-rows .cart-row', r => r.map(x => Math.round(x.getBoundingClientRect().height)));
  const base = await alturas();
  const n = base.length;
  for (let i = 1; i <= n; i++) {
    await page.hover(`#cart-rows .cart-row:nth-child(${i})`); await page.waitForTimeout(80);
    assert.deepEqual(await alturas(), base, `la fila ${i} cambió de altura con el mouse encima`);
    await page.focus(`#cart-rows .cart-row:nth-child(${i}) .c-act-desc`).catch(() => {}); await page.waitForTimeout(60);
    assert.deepEqual(await alturas(), base, `la fila ${i} cambió de altura con el foco`);
  }
  // la acción existe en un lugar fijo, no es el texto «+ Descuento» que aparece y desaparece
  assert.equal(await page.$$eval('#cart-rows .c-act-desc', e => e.length), n);
  assert.equal(await page.$$eval('#cart-rows button.c-desc', e => e.length), 0, 'el texto «+ Descuento» no debe existir como botón flotante');
  assert.doesNotMatch(await page.$eval('#cart-rows', e => e.innerText), /\+ Descuento/);
  // cambio de cantidad y re-renderizado: la altura de cada fila se conserva
  await page.evaluate(() => { const k = Object.keys(carrito)[0]; changeQty(k, 1); }); await page.waitForTimeout(250);
  assert.deepEqual(await alturas(), base, 'el cambio de cantidad movió las filas');
  await page.evaluate(() => renderCart()); await page.waitForTimeout(150);
  assert.deepEqual(await alturas(), base, 're-renderizar movió las filas');
  // aplicar un descuento agrega SOLO su línea informativa a esa fila; las demás no se mueven; quitarlo vuelve a la altura original
  const k0 = await page.evaluate(() => Object.keys(carrito)[0]);
  await page.evaluate(k => { carrito[k].desc = {tipo: 'pct', valor: 15}; renderCart(); }, k0); await page.waitForTimeout(200);
  const con = await alturas();
  assert.ok(con[0] > base[0], 'la fila con descuento debe mostrar su línea informativa');
  assert.deepEqual(con.slice(1), base.slice(1), 'otras filas se movieron al aplicar un descuento');
  await page.evaluate(k => { carrito[k].desc = null; renderCart(); }, k0); await page.waitForTimeout(200);
  assert.deepEqual(await alturas(), base, 'quitar el descuento no devolvió la altura');
}));

test('F3: los descuentos siguen calculando igual (por producto y al ticket) con la nueva acción', async () => abrir(async page => {
  await page.evaluate(id => abrirMesa(id), MESA); await page.waitForTimeout(1000);
  const r = await page.evaluate(() => {
    const k = Object.keys(carrito)[0]; const item = carrito[k];
    const bruto = carritoItemBruto(item), sin = carritoItemTotal(item);
    item.desc = {tipo: 'pct', valor: 10}; renderCart();
    const con = carritoItemTotal(item);
    const fila = document.querySelector(`#cart-rows .cart-row[data-key="${CSS.escape(k)}"]`);
    return {bruto, sin, con, esperado: Math.round(bruto * 0.9 * 100) / 100, linea: fila.querySelector('.c-desc.on')?.textContent || '', botonOn: fila.querySelector('.c-act-desc')?.classList.contains('on'), total: document.getElementById('cart-total').textContent};
  });
  assert.equal(r.sin, r.bruto); assert.equal(r.con, r.esperado);
  assert.match(r.linea, /Desc\. 10%/); assert.equal(r.botonOn, true);
  // el botón % abre el diálogo de descuento de ESA línea (misma función de siempre)
  await page.click('#cart-rows .cart-row:nth-child(1) .c-act-desc');
  await page.waitForFunction(() => [...document.querySelectorAll('.modal-ov.open')].length > 0, null, {timeout: 5000});
}));
