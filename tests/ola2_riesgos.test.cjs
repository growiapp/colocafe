'use strict';
// Ola 2 (riesgos): reproducciones seguras de B1, B2, B4, B5 y B23. Sin red (arnés de demostración). Cada prueba falla contra 334df6c.
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

// Payload INOCUO: solo incrementa un contador en la página de prueba. Demuestra ejecución de JS donde debería haber texto.
const PAY = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const xss = page => page.evaluate(() => window.__xss || 0);

// ── B1: HTML/JS en textos libres ──
test('B1 (clientes): un nombre/teléfono/alergias/preferencias con HTML se muestra como texto y no ejecuta código', async () => abrir(async page => {
  await page.evaluate(p => { clientes.push({id: 'zz_c1', nombre: p, telefono: p, email: p, alergias: p, preferencias: p, visitas: []}); goTab('clientes'); renderClientesTab(); }, PAY);
  await page.waitForTimeout(500);
  assert.equal(await xss(page), 0, 'se ejecutó el payload');
  assert.ok((await page.$$eval('#clientes-lista-tab .cliente-nombre', e => e.map(x => x.textContent))).includes(PAY), 'el nombre debe verse literal');
}));

test('B1 (categorías): un nombre de categoría con HTML o comillas se muestra como texto; el × abre la confirmación con el nombre exacto', async () => abrir(async page => {
  for (const nombre of [PAY, "Dulce d'leche", 'Con "comillas"']) {
    await page.evaluate(n => { cats.push({id: 'zz_cat', name: n, color: '#C94A1A', seccion: 'cafeteria', reservable: false}); goTab('ajustes'); if (!document.getElementById('acc-body-menu').classList.contains('open')) toggleAccordion('menu'); renderCatMgr(); }, nombre);
    await page.waitForTimeout(300);
    assert.equal(await xss(page), 0, 'se ejecutó el payload');
    const i = await page.evaluate(() => cats.findIndex(c => c.id === 'zz_cat'));
    await page.click(`.cat-del[onclick$="(${i})"]:not([onclick*=Producto])`);
    await page.waitForSelector('#modal-confirm.open', {timeout: 3000});
    assert.equal(await page.$eval('#confirm-msg', e => e.textContent), `¿Eliminar ${nombre}?`);
    await page.evaluate(() => { cerrarModalConfirm(); cats = cats.filter(c => c.id !== 'zz_cat'); });
  }
}));

test('B1 (historial): producto, variante, nota, mesa y operador con HTML se muestran como texto en el Historial', async () => abrir(async page => {
  await page.evaluate(p => {
    const ticket = {id: 'zz_t', ticketId: 'zz_t', fecha: today(), hora: '10:00', tipo: 'salon', mesa: p, operador: p, total: 100, payments: [], itemCount: 1, items: [{producto: p, variantes: p, nota: p, cantidad: 1, total: 100}]};
    const original = window.getVisibleHistoryState;                       // devuelve una copia: se sirve un ticket con el mismo formato que el de Supabase
    window.getVisibleHistoryState = () => ({...original(), source: 'supabase', tickets: [ticket, ...original().tickets]});
    goTab('historial'); setHistFiltro('todos'); renderHistorial();
  }, PAY);
  await page.waitForTimeout(500);
  assert.ok((await page.$$eval('#hist-list .hist-item', e => e.length)) > 1, 'el ticket de prueba debe dibujarse');
  assert.equal(await xss(page), 0, 'se ejecutó el payload');
  assert.ok((await page.$$eval('#hist-list .hist-row2 strong', e => e.map(x => x.textContent))).includes(PAY), 'el producto debe verse literal');
}));

test('B1 (resumen del turno y Reportes): nombre de operador y de producto con HTML se muestran como texto', async () => abrir(async page => {
  await page.evaluate(p => {
    pintarResumenTurno({ef: 0, mp: 0, tr: 0, otro: 0, tot: 0, cafe: 0, cocina: 0, porOp: {[p]: 100, Ana: 50}}, '', false);
    const base = ventas[0];
    ventas.push({...base, id: 'zz_v9', ticket_id: 'zz_t9', producto: p, fecha: today(), timestamp: new Date().toISOString(), total: 100, cantidad: 3});
    setDashFiltro('hoy'); renderDashboard();
  }, PAY);
  await page.waitForTimeout(500);
  assert.equal(await xss(page), 0, 'se ejecutó el payload');
  assert.ok((await page.$$eval('#top-list .top-name', e => e.map(x => x.textContent))).includes(PAY), 'el producto del ranking debe verse literal');
  assert.ok((await page.$$eval('#turno-modal-body span', e => e.map(x => x.textContent))).includes(PAY), 'el operador del resumen debe verse literal');
}));

test('B1 (estático): ninguna plantilla HTML interpola texto libre (nombres, notas, teléfonos…) sin escapar', () => {
  const lineas = fs.readFileSync(path.join(process.env.HF_INDEX_ROOT || root, 'index.html'), 'utf8').split('\n');
  const campos = /\.(?:name|nombre|alergias|preferencias|nota|telefono|email|clienteNombre|direccion|variantes|grupo|producto|operador|mesa|cliente)\b|^(?:op|t\.n)$/;
  // Expresiones que NO son texto libre: constantes de la propia app o textos armados por el código.
  const permitido = /^(?:item\.desc\?|m\.label$|q\.label$|t\.source$)/;
  const sospechosas = [];
  lineas.forEach((l, i) => {
    if (!l.includes('<')) return;
    for (const m of l.matchAll(/\$\{([^{}]*)\}/g)) {
      const e = m[1].trim();
      if (!campos.test(e) || /(?:escapeHtml|esc|escapeAttr|escapeJsArg|fmt|fm|fmtFull)\(/.test(e) || permitido.test(e)) continue;
      sospechosas.push(`${i + 1}: ${e.slice(0, 60)}`);
    }
  });
  assert.deepEqual(sospechosas, []);
});

// ── B2: precio de producto ──
const PRECIOS_RECHAZADOS = ['2.500', '12.5', '-100', '0', '1e3'];
for (const [forma, ids] of [['formulario de producto', {nom: 'm-nombre', pre: 'm-precio', ilim: 'm-ilimitado', fn: 'guardarProducto'}], ['alta rápida', {nom: 'pr-nombre', pre: 'pr-precio', ilim: 'pr-ilimitado', fn: 'guardarProdRapido'}]]) {
  test(`B2 (${forma}): solo se guarda un entero mayor a 0; lo demás se rechaza con aviso y NO se trunca en silencio`, async () => abrir(async page => {
    const intentar = valor => page.evaluate(async ([ids, valor]) => {
      window.saveProductToSupabase = async () => ({});                                  // sin servidor: solo importa qué precio intenta guardar
      editId = null; _variantesEdit = [];
      document.getElementById(ids.nom).value = 'ZZ Prueba ' + valor;
      document.getElementById(ids.pre).value = valor;
      document.getElementById(ids.ilim).checked = true;
      const antes = menu.length; let toast = '';
      const t = window.showToast; window.showToast = m => { toast = String(m); };
      await window[ids.fn](); window.showToast = t;
      const nuevo = menu.length > antes ? menu[menu.length - 1] : null;
      if (nuevo) menu.pop();
      return {guardado: nuevo ? nuevo.price : null, toast};
    }, [ids, valor]);
    for (const v of PRECIOS_RECHAZADOS) {
      const r = await intentar(v);
      assert.equal(r.guardado, null, `«${v}» no debe guardarse (se guardó ${r.guardado})`);
      assert.match(r.toast, /precio/i, `«${v}» debe avisar`);
    }
    assert.equal((await intentar('1500')).guardado, 1500);
    assert.equal((await intentar('900')).guardado, 900);
  }));
}

// ── B4: limpiar historial local de ventas ──
// La fuente del rol es window.getActiveStoreRoleEstricto (rol del LOCAL ACTIVO, sin caer al primer local). Su lectura de la variable real de la
// sesión solo se puede comprobar con una sesión real (ver evidencia de staging); aquí se prueba la decisión del guard dado ese rol.
const limpiar = (page, {rol, sesion = true, turnoAbierto = false}) => page.evaluate(([rol, sesion, turnoAbierto]) => {
  window.getActiveStoreRoleEstricto = () => rol; window.__sesionUserId = () => (sesion ? 'u1' : '');
  turno = turnoAbierto ? {...(turno || {}), abierto: true} : null;
  ventas = ventas.filter(v => v && v.id); const antes = ventas.length; let toast = '';
  const t = window.showToast; window.showToast = m => { toast = String(m); };
  limpiarVentas(); window.showToast = t;
  return {antes, despues: ventas.length, toast};
}, [rol, sesion, turnoAbierto]);
test('B4: solo owner/admin del local activo, con sesión y sin turno abierto; operador, rol vacío o sin sesión no pueden', async () => abrir(async page => {
  const negado = async (nombre, o) => { const r = await limpiar(page, o); assert.equal(r.despues, r.antes, `${nombre}: no debe poder limpiar`); assert.match(r.toast, /dueño o un administrador/, nombre); };
  await negado('operador', {rol: 'operator'});
  await negado('rol vacío (local activo sin rol / sin resolver)', {rol: ''});
  await negado('sin sesión', {rol: 'owner', sesion: false});
  for (const rol of ['owner', 'admin']) {
    const r = await limpiar(page, {rol, turnoAbierto: true});
    assert.equal(r.despues, r.antes, `${rol} con turno abierto no debe poder limpiar`); assert.match(r.toast, /Cerrá el turno/);
  }
  const ok = await limpiar(page, {rol: 'owner'});
  assert.ok(ok.antes > 0 && ok.despues === 0, 'el dueño sin turno abierto sí puede');
}));
test('B4: la fuente del rol es la estricta y real (no la variable no publicada window.supabaseStores ni el fallback al primer local)', async () => abrir(async page => {
  const r = await page.evaluate(() => ({
    guard: esAdminDelLocalActivo.toString(), estricta: typeof window.getActiveStoreRoleEstricto,
    sinSesionActivaVacio: (() => { config.activeStoreId = ''; return window.getActiveStoreRoleEstricto(); })(),
    localInexistente: (() => { config.activeStoreId = 'no-existe'; return window.getActiveStoreRoleEstricto(); })(),
  }));
  assert.equal(r.estricta, 'function');
  assert.match(r.guard, /getActiveStoreRoleEstricto/); assert.doesNotMatch(r.guard, /supabaseStores|getActiveStore\(|getSupabaseActiveRole/);
  assert.equal(r.sinSesionActivaVacio, ''); assert.equal(r.localInexistente, '', 'sin fallback al primer local');
}));
test('B4: el botón «Limpiar» queda oculto salvo para owner/admin del local activo', async () => abrir(async page => {
  const visible = rol => page.evaluate(rol => { window.getActiveStoreRoleEstricto = () => rol; window.__sesionUserId = () => 'u1'; goTab('ajustes'); if (!document.getElementById('acc-body-datos').classList.contains('open')) toggleAccordion('datos'); aplicarPermisosCatalogo(); return getComputedStyle(document.querySelector('#acc-body-datos button[onclick*="limpiarVentas"]')).display !== 'none'; }, rol);
  assert.equal(await visible('operator'), false);
  assert.equal(await visible(''), false);
  assert.equal(await visible('admin'), true);
  assert.equal(await visible('owner'), true);
}));

// ── B5: eliminar mesa con fallo/timeout remoto mientras se trabaja en otras mesas ──
test('B5: si falla el borrado remoto solo vuelve la mesa eliminada; los cambios hechos mientras tanto en otras mesas NO se pierden', async () => abrir(async page => {
  const r = await page.evaluate(async id => {
    window.deleteOpenOrderFromSupabase = () => new Promise(res => setTimeout(() => res(false), 500));   // el servidor rechaza tarde
    const otra = mesas.find(m => !(String(m._sb_id) === id));
    pedirEliminarMesa(id); ejecutarConfirm();
    // mientras el borrado está en curso el operador sigue trabajando
    otra.zz_nota = 'cambio-en-curso';
    mesas.push({id: 'zz_nueva', nombre: 'ZZ nueva', tipo: 'salon', items: {}, apertura: new Date().toISOString()});
    save();
    await new Promise(r => setTimeout(r, 1200));
    return {volvio: !!findMesaByAnyId(id), conservaNota: (mesas.find(m => m.id === otra.id) || {}).zz_nota, conservaNueva: !!mesas.find(m => m.id === 'zz_nueva'), cantidad: mesas.length};
  }, MESA);
  assert.equal(r.volvio, true, 'la mesa eliminada debe volver (no se pudo borrar en el servidor)');
  assert.equal(r.conservaNota, 'cambio-en-curso', 'se perdió un cambio hecho en otra mesa');
  assert.equal(r.conservaNueva, true, 'se perdió una mesa creada mientras tanto');
}));
test('B5: si al fallar el borrado ya se cambió de cuenta o de local, la mesa NO se escribe en el contexto nuevo', async () => abrir(async page => {
  for (const cambio of ['cuenta', 'local']) {
    const r = await page.evaluate(async ([id, cambio]) => {
      // El cambio ocurre en el instante exacto del fallo (la app vuelve a fijar la sesión si se cambia antes)
      window.getActiveStoreRoleEstricto = () => 'admin';
      window.deleteOpenOrderFromSupabase = () => new Promise(res => setTimeout(() => { if (cambio === 'cuenta') window.__sesionUserId = () => 'otra-cuenta'; else config.activeStoreId = 'otro-local'; mesas = []; save(); res(false); }, 400));
      pedirEliminarMesa(id); ejecutarConfirm();
      await new Promise(r => setTimeout(r, 900));
      return {volvio: !!findMesaByAnyId(id), cantidad: mesas.length};
    }, [MESA, cambio]);
    assert.deepEqual(r, {volvio: false, cantidad: 0}, `cambio de ${cambio}: se escribió la mesa de la cuenta anterior`);
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.mesa-card').length >= 6);
  }
}));
test('B5: si el borrado remoto sale bien la mesa NO reaparece y nada más cambia', async () => abrir(async page => {
  const r = await page.evaluate(async id => {
    window.getActiveStoreRoleEstricto = () => 'admin';
    window.deleteOpenOrderFromSupabase = async () => true;
    const antes = mesas.length; pedirEliminarMesa(id); ejecutarConfirm();
    await new Promise(r => setTimeout(r, 700));
    return {volvio: !!findMesaByAnyId(id), antes, despues: mesas.length};
  }, MESA);
  assert.equal(r.volvio, false); assert.equal(r.despues, r.antes - 1);
}));

// ── B5 (política comercial aprobada): el operador solo elimina mesas vacías; con productos lo hace owner/admin ──
test('B5 política: con sesión, el operador NO elimina una mesa con productos pero sí una vacía; owner/admin sí pueden con productos', async () => abrir(async page => {
  const r = await page.evaluate(async () => {
    window.__sesionUserId = () => 'u1'; window.deleteOpenOrderFromSupabase = async () => true;
    const salida = {};
    for (const rol of ['operator', 'admin', 'owner']) {
      window.getActiveStoreRoleEstricto = () => rol;
      for (const conItems of [true, false]) {
        const id = 'zz_' + rol + '_' + conItems;
        mesas.push({id, nombre: 'ZZ ' + id, tipo: 'salon', items: conItems ? {x: {prodId: 'p', qty: 1, precio: 100}} : {}, apertura: new Date().toISOString()});
        let toast = ''; const t = window.showToast; window.showToast = m => { toast = String(m); };
        pedirEliminarMesa(id); try { ejecutarConfirm(); } catch (_) {}
        await new Promise(r => setTimeout(r, 150)); window.showToast = t;
        salida[rol + (conItems ? ' con productos' : ' vacía')] = {sigue: !!findMesaByAnyId(id), toast};
      }
    }
    return salida;
  });
  assert.equal(r['operator con productos'].sigue, true); assert.match(r['operator con productos'].toast, /administrador/);
  assert.equal(r['operator vacía'].sigue, false);
  assert.equal(r['admin con productos'].sigue, false); assert.equal(r['owner con productos'].sigue, false);
}));

// ── B23: el respaldo local no debe incluir credenciales de sesión ──
test('B23: el respaldo/diagnóstico local redacta las credenciales de sesión y conserva los datos de operación', async () => abrir(async page => {
  const r = await page.evaluate(async () => {
    // Credenciales SINTÉTICAS con la forma que guarda supabase-js (sb-<ref>-auth-token) y otras claves sensibles
    localStorage.setItem('sb-zzfake-auth-token', JSON.stringify({access_token: 'FAKE_ACCESS_TOKEN_123', refresh_token: 'FAKE_REFRESH_TOKEN_456', user: {id: 'u1'}}));
    localStorage.setItem('sb-zzfake-auth-token-code-verifier', 'FAKE_VERIFIER_789');
    sessionStorage.setItem('sb-zzfake-auth-token', 'FAKE_SESSION_TOKEN_000');
    const payload = await window.getLocalRecoveryBackupPayload();
    return {json: JSON.stringify(payload), ventas: Array.isArray(payload.localStorage.ventas) || typeof payload.localStorage.ventas === 'string', claves: Object.keys(payload.localStorage).length};
  });
  for (const secreto of ['FAKE_ACCESS_TOKEN_123', 'FAKE_REFRESH_TOKEN_456', 'FAKE_VERIFIER_789', 'FAKE_SESSION_TOKEN_000']) assert.equal(r.json.includes(secreto), false, `el respaldo contiene ${secreto}`);
  assert.match(r.json, /REDACTADO/);
  assert.equal(r.ventas, true, 'los datos de operación (ventas) deben seguir en el respaldo');
  assert.ok(r.claves > 5);
}));
