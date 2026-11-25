'use strict';
// B7: reintentos de ítems de mesa ante una falla REAL de red o del servidor (sin depender de residuos de ejecuciones previas).
// Usa index.html y la cola real con el backend simulado de d1_f1_f4. El reloj se adelanta con un desfase para simular 1 hora de ticks de 12 s.
// Comparación con una versión previa: B7_REV=2392533 node --test tests/b7_reintentos.test.cjs
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {chromium} = require(process.env.D1_PLAYWRIGHT_MODULE || path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'));
const W = path.resolve(__dirname, '..');
const rev = process.env.B7_REV || 'worktree';
const html = rev === 'worktree' ? fs.readFileSync(path.join(W, 'index.html'), 'utf8') : execFileSync('git', ['show', `${rev}:index.html`], {cwd:W, encoding:'utf8', maxBuffer:8e6});
// El simulador es el mismo de d1_f1_f4 (se extrae del archivo para no duplicarlo).
const d1 = fs.readFileSync(path.join(__dirname, 'd1_f1_f4.test.cjs'), 'utf8').split('\r\n').join('\n');
const setupSrc = d1.slice(d1.indexOf('const setup = () => {') + 'const setup = '.length, d1.indexOf('\n};\n\nconst scenarios') + 2);

async function conPagina(fn) {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname.slice(1) || 'index.html';
    if (!['index.html', 'logo.png', 'logo.svg', 'manifest.json', 'preview.jpg'].includes(name)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(name === 'index.html' ? html : fs.readFileSync(path.join(W, name)));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({headless:true, executablePath: process.env.D1_CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe')});
  const ctx = await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/*', route => { const u = new URL(route.request().url()); if (u.hostname === '127.0.0.1') return route.continue(); if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({status:200, contentType:'text/javascript', body:'window.supabase={createClient:()=>null};'}); return route.abort('blockedbyclient'); });
  const page = await ctx.newPage();
  try {
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => typeof addItem === 'function' && typeof window.triggerOORefresh === 'function');
    await page.evaluate(`(${setupSrc})()`);
    await page.evaluate(() => {
      const real = Date.now.bind(Date); window.__off = 0; Date.now = () => real() + window.__off;
      // 1 hora simulada = 300 ticks del intervalo de 12 s (el que dispara retryPendingOpenOrderWrites({reason:'interval'})).
      window.__ticks = async (n, ms = 12000) => { for (let i = 0; i < n; i++) { window.__off += ms; await window.retryPendingOpenOrderWrites({reason: 'interval'}); } };
      window.__banner = () => { renderCajaPendingBanner(); return ($('caja-pending-banner').innerText || '').replace(/\s+/g, ' '); };
    });
    return await fn(page);
  } finally { await browser.close(); server.close(); }
}

test('B7: con la red caída una hora, los reintentos automáticos tienen espera creciente y un tope; no se pierde nada y Reintentar recupera sin duplicar', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('b7a'); __abrir('b7a');
    window.__coloSupabaseClient.rpc = async () => { __sim.rpcs++; throw new TypeError('Failed to fetch'); };
    addItem('prod-test'); addItem('prod-test'); addItem('prod-test');
    await new Promise(r => setTimeout(r, 500));
    const antes = __sim.rpcs;
    await __ticks(300);
    const rpcsEnUnaHora = __sim.rpcs - antes;
    const pendiente = pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'b7a').length;
    const qtyLocal = Object.values(findMesaByAnyId('b7a').items).reduce((n, i) => n + i.qty, 0);
    const banner = __banner();
    // vuelve la red y el cajero toca Reintentar
    __sim.orders.get('b7a').rows = [];
    window.__coloSupabaseClient.rpc = async (name, args) => { __sim.rpcs++; const o = __sim.orders.get(args.p_open_order_id); o.version += 1; o.rows = (args.p_items || []).map(x => ({...x, id: 'srv-' + (++__sim.seq), variants: x.variants || []})); return {data:{ok:true, version:o.version}, error:null}; };
    await retryCajaPendingOperations(); await new Promise(r => setTimeout(r, 300));
    const m = findMesaByAnyId('b7a');
    return {rpcsEnUnaHora, pendiente, qtyLocal, banner, server: __sim.orders.get('b7a').rows.reduce((n, x) => n + Number(x.quantity), 0), filas: __sim.orders.get('b7a').rows.length, pendDespues: pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'b7a').length, dirty: m._items_dirty, bannerDespues: __banner()};
  }));
  assert.ok(r.rpcsEnUnaHora <= 10, `en una hora con la red caída se enviaron ${r.rpcsEnUnaHora} RPC (tope razonable: 10)`);
  assert.equal(r.pendiente, 1, 'el pendiente sigue guardado (no se descarta)');
  assert.equal(r.qtyLocal, 3);
  assert.match(r.banner, /Reintentar/);
  assert.match(r.banner, /no se (siguió|sigue) intentando solo|dejó de reintentar solo|dejamos de reintentar/i, 'el cajero ve que ya no se reintenta solo y qué hacer: ' + r.banner);
  assert.equal(r.server, 3, 'tras Reintentar el servidor tiene exactamente lo que había en pantalla');
  assert.equal(r.filas, 1, 'sin ítems duplicados');
  assert.equal(r.pendDespues, 0);
  assert.equal(r.dirty, false);
  assert.doesNotMatch(r.bannerDespues, /dejamos de reintentar|rechaz/i, 'al resolverse, el aviso desaparece');
});

test('B7: un rechazo PERMANENTE del servidor (sin permiso, 42501) no se reintenta en bucle y se explica con claridad', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('b7b'); __abrir('b7b');
    window.__coloSupabaseClient.rpc = async () => { __sim.rpcs++; return {data:null, error:{code:'42501', message:'permission denied for table open_order_items'}}; };
    addItem('prod-test');
    await new Promise(r => setTimeout(r, 500));
    const antes = __sim.rpcs;
    await __ticks(300);
    const intentos = __sim.rpcs - antes;
    const banner = __banner();
    const toast = $('toast').textContent;
    const antesManual = __sim.rpcs;
    await retryCajaPendingOperations();
    return {intentos, banner, toast, manual: __sim.rpcs - antesManual, pend: pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'b7b').length};
  }));
  assert.ok(r.intentos <= 2, `un error permanente no se reintenta solo: ${r.intentos} intentos automáticos en una hora`);
  assert.match(r.banner, /rechaz|permiso|administrador/i, 'mensaje claro para el cajero: ' + r.banner);
  assert.ok(r.manual >= 1, 'el botón Reintentar siempre prueba una vez');
  assert.equal(r.pend, 1, 'el pendiente se conserva');
});

test('B7: una falla corta de red se recupera sola con espera, sin quedar parada ni duplicar', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('b7c'); __abrir('b7c');
    __sim.failRpc = 2;
    addItem('prod-test'); addItem('prod-test');
    await new Promise(r => setTimeout(r, 500));
    await __ticks(12);
    const m = findMesaByAnyId('b7c');
    return {server: __sim.orders.get('b7c').rows.reduce((n, x) => n + Number(x.quantity), 0), filas: __sim.orders.get('b7c').rows.length, pend: pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'b7c').length, dirty: m._items_dirty, banner: __banner()};
  }));
  assert.equal(r.server, 2); assert.equal(r.filas, 1); assert.equal(r.pend, 0); assert.equal(r.dirty, false);
  assert.doesNotMatch(r.banner, /rechaz|dejó de reintentar|dejamos de reintentar/i);
});

test('B7: un conflicto de estado (otro dispositivo cambió la mesa) no entra en bucle de reintentos', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('b7d'); __abrir('b7d');
    addItem('prod-test'); await new Promise(r => setTimeout(r, 700));
    __sim.conflictNext = [{id:'otro-1', product_id:'prod-test', quantity:7, unit_price:100, variants:[], note:'', metadata:{prodId:'prod-test'}}];
    addItem('prod-test'); await new Promise(r => setTimeout(r, 500));
    const antes = __sim.rpcs;
    await __ticks(100);
    return {rpcs: __sim.rpcs - antes, conflicto: !!findMesaByAnyId('b7d')._items_conflict};
  }));
  assert.equal(r.conflicto, true);
  assert.equal(r.rpcs, 0, 'con un conflicto abierto no se reenvía nada hasta que el cajero elige');
});

// B5 (cliente): si el servidor rechaza el cierre de una eliminación, la app NO sigue borrando ítems ni la fila (antes lo hacía como «plan B»).
test('B5: una eliminación rechazada por el servidor no borra ítems ni fila', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('b5x'); __sim.orders.get('b5x').rows = [{id: 'i1', product_id: 'prod-test', quantity: 2, unit_price: 100, variants: [], note: '', metadata: {}}];
    const c = window.__coloSupabaseClient, from = c.from; window.__del = {items: 0, filas: 0};
    c.from = t => { const b = from(t);
      if (t === 'open_orders') { const u = b.update, d = b.delete; b.update = v => { u(v); b.maybeSingle = async () => ({data: null, error: {code: '42501', message: 'rls'}}); return b; }; b.delete = () => { window.__del.filas++; return d(); }; }
      if (t === 'open_order_items') { const d = b.delete; b.delete = () => { window.__del.items++; return d(); }; }
      return b; };
    return null;
  }).then(() => page.evaluate(async () => {
    const real = window.deleteOpenOrderFromSupabase;
    const eliminar = await real('b5x');
    const tras = {eliminar, ...window.__del};
    return {tras};
  })));
  assert.equal(r.tras.eliminar, false); assert.equal(r.tras.items, 0, 'no se borran ítems'); assert.equal(r.tras.filas, 0, 'no se borra la fila');
});

// B7 (verificación final): reconexiones y reintentos NO duplican ítems ni alteran cantidades.
test('B7: respuesta perdida (el servidor SÍ aplicó el cambio pero la app vio un corte), reconexión y reintentos repetidos: mismas filas y cantidades que la pantalla', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('b7e'); __abrir('b7e');
    const real = window.__coloSupabaseClient.rpc.bind(window.__coloSupabaseClient);
    let perderRespuestas = 2;
    window.__coloSupabaseClient.rpc = async (n, a) => { const res = await real(n, a); if (perderRespuestas > 0) { perderRespuestas--; throw new TypeError('Failed to fetch'); } return res; }; // aplicó y la respuesta se perdió
    addItem('prod-test'); addItem('prod-test'); addItem('prod-test'); // 3 unidades
    await new Promise(r => setTimeout(r, 600));
    const m = () => findMesaByAnyId('b7e');
    const cant = () => __sim.orders.get('b7e').rows.reduce((n, x) => n + Number(x.quantity), 0);
    const trasCorte = {server: cant(), filas: __sim.orders.get('b7e').rows.length, pend: pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'b7e').length};
    // se edita mientras está caído y luego vuelve la red; varios reintentos (manual, interval, online) seguidos
    addItem('prod-test'); await new Promise(r => setTimeout(r, 400));          // 4 unidades
    for (const reason of ['manual', 'interval', 'online', 'manual', 'manual']) { window.__off += 15000; await window.retryPendingOpenOrderWrites({reason}); }
    await window.retryPendingOpenOrdersSync({silent: true}); await window.retryPendingOpenOrderItemSyncs({silent: true});
    await new Promise(r => setTimeout(r, 300));
    return {trasCorte, qtyPantalla: Object.values(m().items).reduce((n, i) => n + i.qty, 0), server: cant(), filas: __sim.orders.get('b7e').rows.length, pend: pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'b7e').length, dirty: m()._items_dirty, conflicto: !!m()._items_conflict};
  }));
  assert.equal(r.qtyPantalla, 4);
  assert.equal(r.server, 4, 'el servidor tiene exactamente las unidades de la pantalla (ni más ni menos)');
  assert.equal(r.filas, 1, 'una sola fila de ítem: nada duplicado');
  assert.equal(r.pend, 0); assert.ok(!r.dirty, 'sin cambios locales sin enviar'); assert.equal(r.conflicto, false);
});

test('B7: tras recuperarse, 20 reintentos y reconexiones más no cambian nada en el servidor (idempotencia)', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('b7f'); __abrir('b7f');
    __sim.failRpc = 1; addItem('prod-test'); addItem('prod-test');
    await new Promise(r => setTimeout(r, 600));
    for (let i = 0; i < 5; i++) { window.__off += 15000; await window.retryPendingOpenOrderWrites({reason: 'manual'}); }
    const snap = () => JSON.stringify(__sim.orders.get('b7f').rows.map(x => [x.product_id, Number(x.quantity)]));
    const antes = snap(), rpcs = __sim.rpcs;
    for (let i = 0; i < 20; i++) { window.__off += 15000; await window.retryPendingOpenOrderWrites({reason: i % 2 ? 'online' : 'manual'}); await window.retryPendingOpenOrderItemSyncs({silent: true}); }
    return {antes, despues: snap(), rpcsExtra: __sim.rpcs - rpcs};
  }));
  assert.equal(r.antes, r.despues); assert.equal(JSON.parse(r.despues).reduce((n, x) => n + x[1], 0), 2);
  assert.equal(r.rpcsExtra, 0, 'sin pendientes no se envía nada');
});

// Hallazgos de la revisión independiente (Codex + revisión nativa), cada uno con su prueba.
test('revisión: una sesión vencida (PGRST301 / JWT expired) NO se trata como rechazo permanente: se reintenta y se recupera', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('rv1'); __abrir('rv1');
    const real = window.__coloSupabaseClient.rpc.bind(window.__coloSupabaseClient); let n = 0;
    window.__coloSupabaseClient.rpc = async (a, b) => { if (n++ < 2) { __sim.rpcs++; return {data: null, error: {code: 'PGRST301', message: 'JWT expired'}}; } return real(a, b); };
    addItem('prod-test'); await new Promise(r => setTimeout(r, 500));
    const tras1 = {parados: window.getOOReintentosParados().length};
    await __ticks(12);
    return {tras1, parados: window.getOOReintentosParados().length, server: __sim.orders.get('rv1').rows.length, banner: __banner()};
  }));
  assert.equal(r.tras1.parados, 0); assert.equal(r.parados, 0); assert.equal(r.server, 1); assert.doesNotMatch(r.banner, /rechaz/i);
});

test('revisión: una mesa con cobro hecho y cierre pendiente (que estos reintentos no envían) no acumula fallos ni muestra «dejamos de reintentar»', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    const m = __nueva('rv2'); m._close_pending = true; m.status = 'close_pending'; m._sync_status = 'close_pending'; save();
    await __ticks(20);
    return {parados: window.getOOReintentosParados().length, banner: __banner()};
  }));
  assert.equal(r.parados, 0); assert.doesNotMatch(r.banner, /dejamos de reintentar|rechaz/i);
});

test('revisión: «Reintentar» tocado mientras corre un reintento automático igual reinicia y envía la mesa detenida', async () => {
  const r = await conPagina(page => page.evaluate(async () => {
    __nueva('rvA'); __abrir('rvA'); addItem('prod-test'); await new Promise(r => setTimeout(r, 300));
    __nueva('rvB'); __abrir('rvB'); addItem('prod-test'); await new Promise(r => setTimeout(r, 300));
    const real = window.__coloSupabaseClient.rpc.bind(window.__coloSupabaseClient); let fase = 'caido';
    window.__coloSupabaseClient.rpc = async (n, a) => {
      if (fase === 'caido') { __sim.rpcs++; if (a.p_open_order_id === 'rvA') return {data: null, error: {code: '42501', message: 'permission denied'}}; throw new TypeError('Failed to fetch'); }
      await new Promise(r => setTimeout(r, 400)); return real(n, a); };
    // las mesas ya sincronizaron una vez antes de caer: se vuelve a editar con el servidor caído
    __abrir('rvA'); addItem('prod-test'); __abrir('rvB'); addItem('prod-test'); await new Promise(r => setTimeout(r, 400));
    await __ticks(2);
    const parada = window.getOOReintentosParados().map(p => p.id);
    fase = 'ok'; window.__off += 600000;
    const auto = window.retryPendingOpenOrderWrites({reason: 'interval'});   // B esperaba y corre en este turno (lento)
    const manual = window.retryPendingOpenOrderWrites({reason: 'manual'});   // se toca Reintentar con el turno en curso
    await auto; await manual; await new Promise(r => setTimeout(r, 300));
    const cant = id => __sim.orders.get(id).rows.reduce((n, x) => n + Number(x.quantity), 0);
    return {parada, A: cant('rvA'), B: cant('rvB'), quedan: window.getOOReintentosParados().length};
  }));
  assert.ok(r.parada.includes('rvA'), 'A quedó detenida por el rechazo permanente');
  assert.equal(r.A, 2, 'el Reintentar manual envió A aunque corría un turno automático'); assert.equal(r.B, 2); assert.equal(r.quedan, 0);
});
