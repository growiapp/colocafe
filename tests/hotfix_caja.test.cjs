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
  const del = r.querySelector('.c-act-del'); // «solapa» exige coincidir también en vertical: en móvil el nombre ocupa su propia línea
  return {q: Math.round(q.width), qx: Math.round(q.x - fila.x), btn: [...r.querySelectorAll('.qty-wrap .qty-btn')].map(b => Math.round(b.getBoundingClientRect().width)), a: Math.round(a.width), ax: Math.round(fila.right - a.right),
    delDentroDeQty: !!del && !!del.closest('.qty-wrap'), subDerecha: Math.round(fila.right - s.right), nombre: Math.round(n.width), desborda: r.scrollWidth > r.clientWidth + 1, solapa: n.right > q.left + 1 && n.left < q.right - 1 && n.bottom > q.top + 1 && n.top < q.bottom - 1, h: Math.round(fila.height)};
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

// ── F4: Cobrar muestra solo operadores ACTIVOS del local, desde el servidor, sin recaer en listas históricas ──
const abrirCobro = async page => { await page.evaluate(id => abrirMesa(id), MESA); await page.waitForSelector('#btn-confirm'); await page.click('#btn-confirm'); await page.waitForSelector('#cobro-screen:not([hidden]) .cobro-ops'); };
const opsCobro = page => page.$$eval('.cobro-ops [data-o]', b => b.map(x => x.dataset.o));
const esperarOps = async (page, esperado) => { await page.waitForFunction(e => JSON.stringify([...document.querySelectorAll('.cobro-ops [data-o]')].map(x => x.dataset.o)) === JSON.stringify(e), esperado, {timeout: 8000}); };
const OPID = n => '60000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const nuevoOp = (n, name, active = true, store) => ({id: OPID(n), store_id: store || '89000000-0000-4000-8000-000000000001', name, normalized_name: name.toLowerCase(), active, role: 'operator', metadata: {}});

test('F4: Cobrar ofrece solo los operadores activos de ESTE local (no inactivos, no de otro local, no nombres heredados de la lista local)', async () => abrir(async page => {
  await page.evaluate(() => { operadores.push('Juancito', 'Maia'); save(); });   // nombres históricos que antes reaparecían en Cobrar
  await abrirCobro(page);
  await esperarOps(page, ['Ana', 'Bruno', 'Carla']);
  assert.equal(await page.evaluate(() => estadoOperadores()), 'ok');
  assert.ok(!(await opsCobro(page)).some(n => /Maia|Juancito|Zeta/.test(n)));
}));

test('F4: altas, bajas y reactivaciones se reflejan sin duplicados (al abrir Cobrar se relee el local)', async () => abrir(async page => {
  await page.evaluate(([dana, bruno2]) => { const d = window.__DEMO_DATA.operators; d.push(dana, bruno2); d.find(o => o.name === 'Ana').active = false; d.find(o => o.name === 'Maia').active = true; }, [nuevoOp(10, 'Dana'), nuevoOp(11, 'bruno')]);
  await abrirCobro(page);
  await esperarOps(page, ['Bruno', 'Carla', 'Maia', 'Dana']);   // Ana dada de baja, Maia reactivada, Dana nueva y «bruno» duplicado una sola vez
}));

test('F4: una persona que quedó inactiva mientras Cobrar estaba abierto no puede cobrar (verificación fresca al confirmar), sin crear ventas', async () => abrir(async page => {
  await abrirCobro(page); await esperarOps(page, ['Ana', 'Bruno', 'Carla']);
  await page.click('.cobro-ops [data-o="Ana"]');
  await page.evaluate(() => { window.__DEMO_DATA.operators.find(o => o.name === 'Ana').active = false; });   // otro dispositivo la da de baja
  const antes = await page.evaluate(() => ventas.length);
  await page.click('.btn-confirmar[data-c=confirmar]');
  await page.waitForFunction(() => /ya no está disponible/.test(document.getElementById('cobro-msg')?.textContent || ''), null, {timeout: 8000});
  assert.equal(await page.evaluate(() => ventas.length), antes, 'se creó una venta con un operador inactivo');
  await esperarOps(page, ['Bruno', 'Carla']);
  assert.equal(await page.$$eval('.cobro-ops [aria-checked="true"]', e => e.length), 0, 'sigue seleccionada la persona dada de baja');
}));

test('F4: si falla la lectura de operadores no se recurre a datos viejos: se informa, se bloquea el cobro y se puede reintentar', async () => abrir(async page => {
  await page.evaluate(() => { operadores.push('Juancito'); window.__DEMO_DATA.operadoresOk = window.__DEMO_DATA.operators; window.__DEMO_DATA.operators = null; });
  await abrirCobro(page);
  await page.waitForFunction(() => /No pudimos leer las personas activas/.test(document.querySelector('.cobro-ops')?.innerText || ''), null, {timeout: 8000});
  assert.deepEqual(await opsCobro(page), [], 'se ofrecieron operadores con la lectura caída');
  assert.equal(await page.$eval('.btn-confirmar[data-c=confirmar]', b => b.disabled), true);
  assert.equal(await page.evaluate(() => getActiveOperators().length), 0);
  await page.evaluate(() => { window.__DEMO_DATA.operators = window.__DEMO_DATA.operadoresOk; });
  await page.click('.cobro-ops [data-c="ops"]');
  await esperarOps(page, ['Ana', 'Bruno', 'Carla']);
  assert.equal(await page.$eval('.btn-confirmar[data-c=confirmar]', b => b.disabled), false);
}));

test('F4 (revisión independiente): una lectura que falla DESPUÉS de una carga exitosa invalida la lista: no se cobra con datos anteriores', async () => abrir(async page => {
  await abrirCobro(page); await esperarOps(page, ['Ana', 'Bruno', 'Carla']);
  await page.click('.cobro-ops [data-o="Ana"]');
  await page.evaluate(() => { window.__DEMO_DATA.operadoresOk = window.__DEMO_DATA.operators; window.__DEMO_DATA.operators = {__error: {code: 'PGRST000', message: 'caída transitoria'}}; });
  const antes = await page.evaluate(() => ventas.length);
  await page.click('.btn-confirmar[data-c=confirmar]');
  await page.waitForFunction(() => /No pudimos verificar quién está activo/.test(document.getElementById('cobro-msg')?.textContent || ''), null, {timeout: 12000});
  assert.equal(await page.evaluate(() => ventas.length), antes, 'cobró con una lista que no se pudo verificar');
  assert.equal(await page.evaluate(() => estadoOperadores()), 'no_disponible');
  assert.deepEqual(await opsCobro(page), [], 'se siguieron ofreciendo operadores de la caché anterior');
  await page.evaluate(() => { window.__DEMO_DATA.operators = window.__DEMO_DATA.operadoresOk; });   // vuelve la red: se puede reintentar
  await page.click('.cobro-ops [data-c="ops"]'); await esperarOps(page, ['Ana', 'Bruno', 'Carla']);
}));

test('F4 (revisión independiente): tabla de operadores inexistente (42P01) = lectura no disponible: no habilita la lista local', async () => abrir(async page => {
  await page.evaluate(() => { operadores.push('Juancito'); window.__DEMO_DATA.operators = {__error: {code: '42P01', message: 'relation "operators" does not exist'}}; });
  await abrirCobro(page);
  await page.waitForFunction(() => /No pudimos leer las personas activas/.test(document.querySelector('.cobro-ops')?.innerText || ''), null, {timeout: 8000});
  assert.deepEqual(await opsCobro(page), []);
  assert.equal(await page.$eval('.btn-confirmar[data-c=confirmar]', b => b.disabled), true);
  assert.equal(await page.evaluate(() => estadoOperadores()), 'no_disponible');
}));

test('F4 (revisión independiente): una verificación que nunca responde no deja Cobrar colgado (tope de tiempo y botón restaurado)', async () => abrir(async page => {
  await abrirCobro(page); await esperarOps(page, ['Ana', 'Bruno', 'Carla']);
  await page.click('.cobro-ops [data-o="Bruno"]');
  await page.evaluate(() => { window.__DEMO_DATA.operadoresOk = window.__DEMO_DATA.operators; window.__DEMO_DATA.operators = '__cuelga'; });
  await page.click('.btn-confirmar[data-c=confirmar]');
  assert.match(await page.$eval('.btn-confirmar[data-c=confirmar]', b => b.textContent), /Verificando/);
  await page.waitForFunction(() => /No pudimos verificar quién está activo/.test(document.getElementById('cobro-msg')?.textContent || ''), null, {timeout: 15000});
  assert.equal(await page.$eval('.btn-confirmar[data-c=confirmar]', b => b.disabled), false, 'el botón quedó bloqueado');
  assert.match(await page.$eval('.btn-confirmar[data-c=confirmar]', b => b.textContent), /Confirmar cobro/);
  await page.evaluate(() => { window.__DEMO_DATA.operators = window.__DEMO_DATA.operadoresOk; });   // vuelve el servidor: se puede reintentar sin recargar
  await page.click('.cobro-ops [data-o="Bruno"]');
  const antes = await page.evaluate(() => ventas.length);
  await page.click('.btn-confirmar[data-c=confirmar]');
  await page.waitForFunction(n => ventas.length > n, antes, {timeout: 15000});   // y se puede volver a confirmar y cobrar
}));

test('F4: sin Supabase (modo local) se usa la lista local de siempre', async () => abrir(async page => {
  // todo en una sola evaluación: el arnés restablece su cliente cada segundo
  const r = await page.evaluate(() => { const antes = window.getSupabaseClient; window.getSupabaseClient = () => null; try { return {estado: estadoOperadores(), nombres: getActiveOperators().map(o => o.name)}; } finally { window.getSupabaseClient = antes; } });
  assert.equal(r.estado, 'local');
  assert.deepEqual(r.nombres, ['Ana', 'Bruno', 'Carla']);
}));

for (const medio of ['ef', 'transferencia', 'mixed']) {
  test(`F4: el operador elegido queda registrado en la venta (${medio})`, async () => abrir(async page => {
    await abrirCobro(page); await esperarOps(page, ['Ana', 'Bruno', 'Carla']);
    await page.click(`[data-m="${medio}"]`);
    if (medio === 'mixed') {
      const total = Number((await page.$eval('.cobro-tk .tk-total b', e => e.innerText)).replace(/[^\d]/g, ''));
      await page.fill('#mpay-efectivo', String(1000)); await page.fill('#mpay-transferencia', String(total - 1000));
    }
    await page.click('.cobro-ops [data-o="Carla"]');
    const antes = await page.evaluate(() => ventas.length);
    await page.click('.btn-confirmar[data-c=confirmar]');
    await page.waitForFunction(n => ventas.length > n, antes, {timeout: 15000});
    const nuevas = await page.evaluate(n => ventas.slice(n).map(v => ({op: v.operador, pago: v.pago, pagos: (v.pagos || []).map(p => p.metodo)})), antes);
    assert.ok(nuevas.length >= 1 && nuevas.every(v => v.op === 'Carla'), JSON.stringify(nuevas));
    if (medio === 'mixed') assert.ok(nuevas.every(v => v.pagos.includes('efectivo') && v.pagos.includes('transferencia')), JSON.stringify(nuevas));
    else assert.ok(nuevas.every(v => v.pago === medio), JSON.stringify(nuevas));
  }));
}

// ── F5: Accesos rápidos en Mesa, Nueva mesa y Reserva ──
const configurarAccesos = async (page, n, {invertir = false} = {}) => { await page.waitForFunction(() => !catalogIsWaitingForSupabase(), null, {timeout: 15000}); return configurarAccesos0(page, n, {invertir}); };
const configurarAccesos0 = (page, n, {invertir = false} = {}) => page.evaluate(([n, inv]) => { menu.forEach(p => { delete p.frecuente; }); const act = menu.filter(p => p.active !== false); (inv ? act.slice(0, n).reverse() : act.slice(0, n)).forEach((p, i) => { p.frecuente = i + 1; }); cats.forEach(c => { c.reservable = true; }); save(); }, [n, invertir]);
const accesos = (page, id) => page.$$eval(`#${id} .acceso .acceso-n`, e => e.map(x => x.textContent));
const abrirNueva = async page => { await page.evaluate(() => { goTab('carga'); abrirNuevaMesa(); }); await page.waitForSelector('#modal-nueva-mesa.open'); await page.waitForTimeout(400); };
const abrirRes = async page => { await page.evaluate(() => openReservaModal(null)); await page.waitForSelector('#modal-reserva.open, #modal-reserva[style*="flex"]', {timeout: 5000}).catch(() => {}); await page.waitForTimeout(400); };

for (const n of [0, 1, 11, 12]) {
  test(`F5: con ${n} accesos rápidos se muestran ${n} en Nueva mesa, Nueva reserva y Mesa, en el orden configurado`, async () => abrir(async page => {
    await configurarAccesos(page, n);
    const esperado = await page.evaluate(() => productosFrecuentes().map(p => p.name));
    assert.equal(esperado.length, n);
    await abrirNueva(page);
    assert.deepEqual(await accesos(page, 'mesa-accesos'), esperado);
    assert.equal(await page.$eval('#mesa-accesos', e => !e.hidden), n > 0);
    await page.evaluate(() => cerrarModalNuevaMesa()); await abrirRes(page);
    assert.deepEqual(await accesos(page, 'res-accesos'), esperado);
    await page.evaluate(() => { try { closeReservaModal(); } catch (_) {} document.querySelectorAll('.modal-ov.open').forEach(m => m.classList.remove('open')); });
    await page.evaluate(id => abrirMesa(id), MESA); await page.waitForTimeout(800);
    assert.deepEqual(await accesos(page, 'carga-frecuentes'), esperado);
  }));
}

test('F5: máximo 12 aunque haya más configurados; el orden y los cambios de orden se respetan; quitar uno o desactivar el producto lo retira', async () => abrir(async page => {
  await configurarAccesos(page, 14);
  await abrirNueva(page);
  assert.equal((await accesos(page, 'mesa-accesos')).length, 12);
  await page.evaluate(() => cerrarModalNuevaMesa());
  await configurarAccesos(page, 5, {invertir: true});
  const invertido = await page.evaluate(() => productosFrecuentes().map(p => p.name));
  await abrirNueva(page); assert.deepEqual(await accesos(page, 'mesa-accesos'), invertido);
  await page.evaluate(() => cerrarModalNuevaMesa());
  const [quitado, inactivo, borrado] = await page.evaluate(() => { const l = productosFrecuentes(); delete l[0].frecuente; l[1].active = false; const b = l[2]; menu.splice(menu.indexOf(b), 1); return [l[0].name, l[1].name, b.name]; });
  await abrirNueva(page);
  const vistos = await accesos(page, 'mesa-accesos');
  assert.ok(!vistos.includes(quitado) && !vistos.includes(inactivo) && !vistos.includes(borrado), JSON.stringify({vistos, quitado, inactivo, borrado}));
}));

test('F5: agregar con una sola interacción, con el precio del catálogo y sin depender de la categoría ni del buscador', async () => abrir(async page => {
  await configurarAccesos(page, 6);
  await abrirNueva(page);
  const antes = await accesos(page, 'mesa-accesos');
  await page.evaluate(() => setCatMesaSetup(cats[cats.length - 1].id)); await page.fill('#mesa-prod-search', 'zzzz'); await page.waitForTimeout(200);
  assert.deepEqual(await accesos(page, 'mesa-accesos'), antes, 'los accesos dependen de la categoría o del buscador');
  await page.click('#mesa-accesos .acceso:first-child');
  const r = await page.evaluate(() => { const p = productosFrecuentes()[0], it = Object.values(mesaSetupCarrito)[0]; return {qty: it.qty, precio: it.precio, esperado: safeProductPrice(p), total: document.querySelector('.order-modal-footer, #mesa-total')?.textContent || ''}; });
  assert.equal(r.qty, 1); assert.equal(r.precio, r.esperado);
  await page.click('#mesa-accesos .acceso:first-child');
  assert.equal(await page.evaluate(() => Object.values(mesaSetupCarrito)[0].qty), 2);
  assert.equal(await page.$eval('#mesa-accesos .acceso:first-child .acceso-q', e => e.textContent), '2');
  await page.evaluate(() => cerrarModalNuevaMesa()); await abrirRes(page);
  await page.click('#res-accesos .acceso:first-child');
  assert.equal(await page.evaluate(() => Object.values(reservaCarrito)[0].qty), 1);
}));

test('F5: en reservas solo entran productos de categorías reservables (las mismas reglas que el catálogo)', async () => abrir(async page => {
  await configurarAccesos(page, 11);
  const [nombreNo] = await page.evaluate(() => { const p = productosFrecuentes()[0]; cats.find(c => c.id === p.cat).reservable = false; return [p.name]; });
  await abrirRes(page);
  const vistos = await accesos(page, 'res-accesos');
  assert.ok(!vistos.includes(nombreNo) && vistos.length < 11 && vistos.length > 0, JSON.stringify(vistos));
  await page.evaluate(() => { try { closeReservaModal(); } catch (_) {} });
  await abrirNueva(page); assert.ok((await accesos(page, 'mesa-accesos')).includes(nombreNo), 'en Nueva mesa sí debe estar');
}));

test('F5: la configuración se guarda y se recupera igual (persistencia), y se ve con cualquier rol', async () => abrir(async page => {
  await configurarAccesos(page, 8);
  const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem('menu')).filter(p => Number(p.frecuente) > 0).sort((a, b) => a.frecuente - b.frecuente).map(p => p.name));
  assert.equal(guardado.length, 8);
  assert.deepEqual(guardado, await page.evaluate(() => productosFrecuentes().map(p => p.name)));
  for (const rol of ['owner', 'admin', 'operator']) {
    await page.evaluate(r => { window.getSupabaseActiveRole = () => r; window.getActiveStoreRole = () => r; }, rol);
    await abrirNueva(page); assert.equal((await accesos(page, 'mesa-accesos')).length, 8, rol);
    await page.evaluate(() => cerrarModalNuevaMesa());
  }
}));

test('F5 (móvil): la tira es compacta, con desplazamiento horizontal propio y sin desbordar la pantalla', async () => abrir(async page => {
  await configurarAccesos(page, 12); await abrirNueva(page);
  const m = await page.evaluate(() => { const fila = document.querySelector('#mesa-accesos .accesos-row'), r = fila.getBoundingClientRect(), b = [...fila.querySelectorAll('.acceso')].map(x => x.getBoundingClientRect().height); return {scrollable: fila.scrollWidth > fila.clientWidth, dentro: r.right <= innerWidth + 1, alturaMin: Math.min(...b), pagina: document.documentElement.scrollWidth <= innerWidth}; });
  assert.ok(m.scrollable && m.dentro && m.pagina && m.alturaMin >= 44, JSON.stringify(m));
}, {viewport: MOV}));

// ── F6: sin avisos proactivos de stock bajo o agotado (la lógica de presentación se eliminó; no es CSS) ──
test('F6: no hay avisos de «stock bajo» ni «sin stock» (banners, etiquetas de producto ni toasts) en ninguna pantalla', async () => abrir(async page => {
  const prods = await page.evaluate(() => { const l = menu.filter(p => !p.ilimitado); l[0].stock = 0; if (l[1]) l[1].stock = 3; if (l[2]) l[2].stock = 5; renderStockAlerts(); renderProdGrid(); return l.length; });
  assert.ok(prods >= 2, 'el escenario necesita productos con stock limitado');
  const toasts = []; await page.exposeFunction('__toast', t => toasts.push(t));
  await page.evaluate(() => { const o = window.showToast; window.showToast = (...a) => { window.__toast(String(a[0])); return o?.(...a); }; });
  const mirar = async donde => {
    const txt = await page.evaluate(() => document.body.innerText);
    assert.doesNotMatch(txt, /Stock bajo|Sin stock|restantes|Stock 0/i, `aviso de stock visible en ${donde}`);
    assert.equal(await page.$$eval('.prod-low-txt, .out-lbl', e => e.length), 0, `etiqueta de stock en ${donde}`);
    assert.equal(await page.$eval('#stock-alerts', e => e.querySelectorAll('.alert-banner').length), 0, `banner en ${donde}`);
  };
  await mirar('Caja');
  await page.evaluate(id => abrirMesa(id), MESA); await page.waitForTimeout(700); await mirar('Mesa');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); renderStockAlerts(); }); await page.waitForTimeout(800); await mirar('al volver a la app / sincronizar');
  await page.evaluate(() => { goTab('carga'); abrirNuevaMesa(); }); await page.waitForTimeout(500); await mirar('Nueva mesa'); await page.evaluate(() => cerrarModalNuevaMesa());
  await page.evaluate(() => openReservaModal(null)); await page.waitForTimeout(500); await mirar('Nueva reserva');
  assert.ok(!toasts.some(t => /stock (bajo|agotado)|sin stock|restantes/i.test(t)), 'toast de stock: ' + toasts.join(' | '));
}));

test('F6: la lógica que generaba esos avisos ya no existe en el código (no basta con ocultarla) y los avisos de integridad se conservan', async () => {
  const src = fs.readFileSync(path.join(process.env.HF_INDEX_ROOT || root, 'index.html'), 'utf8');
  assert.ok(!/Stock bajo:/.test(src) && !/Sin stock:/.test(src) && !/class="prod-low-txt"/.test(src) && !/class="out-lbl"/.test(src), 'quedan plantillas de avisos de stock bajo/agotado');
  assert.match(src, /Discrepancia de stock, hay que conciliar/); assert.match(src, /Mantenimiento de stock: no cobres ahora/);
});
