'use strict';
// Ciclo de escritura de la ola 1 en STAGING, SOLO dentro del local sintético ZZ_E2E_OLA1 (la política del arnés bloquea cualquier otra escritura).
// Por cuenta (identificada por su USUARIO y rol): cambia al local sintético por el diálogo real, abre turno, cobra (efectivo con vuelto, transferencia, mixto, centavos)
// y elimina una mesa. Antes de CADA bloque de escrituras se verifica proyecto, URL, usuario, rol y local; si no coinciden, se aborta esa cuenta sin escribir.
// Requisitos: login ya hecho, fixtures.sql aplicado, E2E_REPO/E2E_FROZEN/E2E_STATE/E2E_EVID definidos.
const fs = require('node:fs'), path = require('node:path');
const {openDevice, frozenServer, saveAudit, EVID, STAGING} = require('./lib.cjs');
const {FIXTURE_STORE} = require('./policy.cjs');
const CUENTAS = {owner: {user8: '7cd84c4f', rol: 'owner'}, admin: {user8: 'eef11ffb', rol: 'admin'}, caja: {user8: '48075b31', rol: 'operator'}};
const SOLO = (process.env.OLA1_SOLO || 'owner,admin,caja').split(',');          // filtro por CUENTA, no por ventana
const BLOQUES = (process.env.OLA1_BLOQUES || 'turno,cobros,eliminar').split(',');
const PERFILES = ['owner', 'admin', 'caja'];
const res = [], identidades = {}, capturas = [];
const reg = (cuenta, flujo, ok, detalle = '') => { res.push({cuenta, flujo, ok: ok === null ? null : !!ok, detalle: String(detalle).slice(0, 400)}); console.log(`${ok === null ? 'INFO ' : ok ? 'OK   ' : 'FALLA'} [${cuenta}] ${flujo}${detalle ? ' · ' + String(detalle).slice(0, 220) : ''}`); };
const shot = (d, n) => d.page.screenshot({path: path.join(EVID, `${d.cuenta || d.name}_${n}.png`)}).catch(() => {});
const fm = n => '$' + Math.round(n).toLocaleString('es-AR');

// ── Verificación previa a escribir: proyecto, URL, usuario, rol y local ──
async function verificarEntorno(d, cuenta) {
  const e = await d.page.evaluate(() => ({url: (config && config.supabaseUrl) || '', store: (config && config.activeStoreId) || '', uid: String((window.__sesionUserId && window.__sesionUserId()) || ''), rol: (window.getActiveStoreRoleEstricto && window.getActiveStoreRoleEstricto()) || '', local: ((document.querySelector('#ctx-local .ctx-v') || {}).textContent || '')}));
  const fallas = [];
  if (new URL(e.url || 'http://x').host !== STAGING) fallas.push('URL≠staging:' + e.url);
  if (e.store !== FIXTURE_STORE) fallas.push('local activo≠sintético:' + e.store);
  if (!e.uid.startsWith(CUENTAS[cuenta].user8)) fallas.push('usuario inesperado:' + e.uid.slice(0, 8));
  if (e.rol !== CUENTAS[cuenta].rol) fallas.push(`rol ${e.rol}≠${CUENTAS[cuenta].rol}`);
  if (!/ZZ_E2E_OLA1/.test(e.local)) fallas.push('nombre de local no sintético:' + e.local);
  return fallas.length ? fallas.join(' | ') : null;
}
async function cambiarAlSintetico(d) {                                           // el recorrido real: «Local» → Elegí la tienda → Continuar
  const p = d.page;
  await p.click('#ctx-local'); await p.waitForSelector('#sb-store-sel-modal', {state: 'visible', timeout: 10000});
  await p.selectOption('#sb-store-sel-modal', FIXTURE_STORE);
  await p.getByRole('button', {name: 'Continuar'}).click();
  await p.waitForFunction(() => /ZZ_E2E_OLA1/.test((document.querySelector('#ctx-local .ctx-v') || {}).textContent || ''), null, {timeout: 25000});
  await p.waitForFunction(() => typeof menu !== 'undefined' && menu.length === 6, null, {timeout: 25000}).catch(() => {});
  await p.waitForTimeout(2500);
}
// ── Captura de lo que la app ENVÍA y de lo que el servidor RESPONDE ──
function instalarCaptura(d, cuenta) {
  d.page.on('request', r => { if (r.method() !== 'GET' && /\/rest\/v1\//.test(r.url())) { let body = null; try { body = JSON.parse(r.postData() || 'null'); } catch (_) {} capturas.push({cuenta, id: capturas.length, m: r.method(), t: new URL(r.url()).pathname.replace('/rest/v1/', ''), q: new URL(r.url()).search.slice(0, 120), body, estado: null}); r.__cap = capturas.length - 1; } });
  d.page.on('response', async resp => { const r = resp.request(); if (r.__cap !== undefined) { capturas[r.__cap].estado = resp.status(); if (resp.status() >= 400) { try { capturas[r.__cap].error = String((await resp.json()).message || '').slice(0, 160); } catch (_) {} } } });
}
const desde = n => capturas.slice(n);

async function nuevaMesa(d, nombre, productos) {                                 // + Mesa → nombre → productos → Abrir mesa
  const p = d.page;
  await p.getByText('+ Mesa', {exact: true}).first().click();
  await p.locator('#nueva-mesa-input').fill(nombre);
  for (const [prod, veces] of productos) for (let i = 0; i < veces; i++) await p.locator('.order-modal-shell .prod-card', {hasText: prod}).first().click();
  await p.getByRole('button', {name: /Abrir mesa/}).click();
  await p.waitForFunction(n => [...document.querySelectorAll('.mesa-card')].some(c => c.textContent.includes(n)), nombre, {timeout: 25000});
  await p.waitForTimeout(1500);
}
async function abrirTurno(d, cuenta) {
  const p = d.page;
  const estado = await p.$eval('#ctx-turno .ctx-v', e => e.textContent.trim()).catch(() => '');
  if (!/Sin turno/i.test(estado)) { reg(cuenta, 'Turno: ya hay uno abierto en este dispositivo', true, estado); return; }
  const falla = await verificarEntorno(d, cuenta); if (falla) { reg(cuenta, 'Turno: verificación previa a escribir', false, falla); return; }
  const n0 = capturas.length;
  await p.click('#ctx-turno'); await p.waitForSelector('#modal-turno.open', {timeout: 8000});
  await p.selectOption('#turno-operador-sel', {label: 'ZZE2E Operador'}).catch(async () => { const v = await p.$$eval('#turno-operador-sel option', o => o.map(x => x.value).filter(Boolean)); await p.selectOption('#turno-operador-sel', v[0]); });
  await p.fill('#turno-fondo', '5000');
  await p.locator('#modal-turno .btn-save').click();
  await p.waitForFunction(() => !/Sin turno/i.test((document.querySelector('#ctx-turno .ctx-v') || {}).textContent || ''), null, {timeout: 25000}).catch(() => {});
  await p.waitForTimeout(2000);
  const nuevos = desde(n0).filter(c => /shifts/.test(c.t));
  reg(cuenta, 'Turno: apertura (POST shifts en el local sintético)', nuevos.length >= 1 && nuevos.every(c => c.estado && c.estado < 300), nuevos.map(c => `${c.m} ${c.t} ${c.estado}${c.error ? ' ' + c.error : ''}`).join(' | ') + ' · ' + (await p.$eval('#ctx-turno .ctx-v', e => e.textContent.trim())));
}
async function cobrar(d, cuenta, etiqueta, nombre, productos, o) {
  const p = d.page, falla = await verificarEntorno(d, cuenta);
  if (falla) { reg(cuenta, `${etiqueta}: verificación previa a escribir`, false, falla); return null; }
  await nuevaMesa(d, nombre, productos);
  await p.locator('.mesa-card', {hasText: nombre}).first().click(); await p.waitForTimeout(800);
  if (o.descuentoPct) { await p.locator('#cart-rows .c-act-desc').first().click(); await p.locator('#desc-tipo-pct').click(); await p.fill('#descuento-valor', String(o.descuentoPct)); await p.locator('#descuento-aplicar').click(); await p.waitForTimeout(1500); }
  await p.locator('#btn-confirm').click(); await p.waitForSelector('#cobro-screen:not([hidden]) .cobro-medios', {timeout: 15000});
  const total = Number((await p.$eval('.cobro-tk .tk-total b', e => e.textContent)).replace(/\D/g, ''));
  const obs = {};
  if (o.medio === 'ef') {
    if (o.recibido) { await p.fill('#cobro-rec-in', String(o.recibido)); obs.vuelto = await p.$eval('#cobro-vuelto', e => e.textContent.trim()); }
    if (o.justo) { await p.locator('.cobro-rec [data-r]').first().click(); obs.justo = await p.$eval('#cobro-vuelto', e => e.textContent.trim()); }
  } else if (o.medio === 'tr') { await p.locator('[data-m="transferencia"]').click(); obs.sinVuelto = (await p.$('#cobro-rec-in')) === null; }
  else if (o.medio === 'mixed') { await p.locator('[data-m="mixed"]').click(); await p.fill('#mpay-efectivo', String(o.mixEf)); await p.fill('#mpay-transferencia', String(o.mixTr)); obs.sinVuelto = (await p.$('#cobro-rec-in')) === null; }
  await p.waitForFunction(() => document.querySelectorAll('.cobro-ops [data-o]').length > 0, null, {timeout: 25000});
  await p.locator('.cobro-ops [data-o]').first().click();
  await shot(d, `cobro_${etiqueta}`);
  const n0 = capturas.length;
  await p.locator('.btn-confirmar[data-c=confirmar]').click();
  await p.waitForFunction(() => !document.querySelector('#cobro-screen:not([hidden])') || document.querySelector('#modal-comprobante.open'), null, {timeout: 40000}).catch(() => {});
  await p.waitForTimeout(3500);
  await p.evaluate(() => { try { cerrarComprobante(); } catch (_) {} });
  return {total, obs, escrituras: desde(n0)};
}
const METODOS = {EF: 'cash', TR: 'transfer', MX: 'cash+transfer', CTV: 'cash'};
const filas = (cs, t) => cs.filter(c => c.t === t && c.m === 'POST').flatMap(c => [].concat(c.body || []));
function evaluarCobro(cuenta, etiqueta, r, esperado) {
  if (!r) return;
  const ventas = filas(r.escrituras, 'sales'), pagos = filas(r.escrituras, 'sale_payments'), items = filas(r.escrituras, 'sale_items');
  const fallos = r.escrituras.filter(c => c.estado && c.estado >= 400);
  const totalVenta = ventas.reduce((s, v) => s + Number(v.total_amount || 0), 0), totalItems = items.reduce((s, i) => s + Number(i.line_total || 0), 0), totalPagos = pagos.reduce((s, x) => s + Number(x.amount || 0), 0);
  reg(cuenta, `${etiqueta}: total mostrado en Cobrar = esperado`, r.total === Math.round(esperado), `mostrado=${fm(r.total)} esperado=${esperado}`);
  reg(cuenta, `${etiqueta}: la venta se registró (POST sales/sale_items/sale_payments sin errores)`, ventas.length === 1 && pagos.length >= 1 && items.length >= 1 && fallos.length === 0, `ventas=${ventas.length} pagos=${pagos.length} items=${items.length} errores=${fallos.map(c => c.t + ' ' + c.estado + ' ' + (c.error || '')).join(',') || 'ninguno'}`);
  reg(cuenta, `${etiqueta}: integridad de importes (venta = suma de pagos = suma de ítems = esperado)`, Math.abs(totalVenta - esperado) < 0.005 && Math.abs(totalPagos - esperado) < 0.005 && Math.abs(totalItems - esperado) < 0.005, `venta=${totalVenta} pagos=${totalPagos} items=${totalItems} esperado=${esperado}`);
  reg(cuenta, `${etiqueta}: medios de pago registrados`, [...new Set(pagos.map(p => p.method))].sort().join('+') === METODOS[etiqueta.split('_')[0]], [...new Set(pagos.map(p => p.method))].sort().join('+'));
  reg(cuenta, `${etiqueta}: el vuelto / «paga con» NO viaja al servidor`, !/recib|vuelto|paga_con|tender/i.test(JSON.stringify(r.escrituras.map(c => c.body))), '');
}

async function bloqueEliminar(d, cuenta) {
  const p = d.page, falla = await verificarEntorno(d, cuenta);
  if (falla) { reg(cuenta, 'Eliminar mesa: verificación previa a escribir', false, falla); return; }
  const nombre = `ZZ-DEL-${cuenta}`;
  await nuevaMesa(d, nombre, [['ZZE2E Cien', 1]]);
  const card = p.locator('.mesa-card', {hasText: nombre}).first(), x = card.locator('.mesa-close');
  const n0 = await p.$$eval('.mesa-card', e => e.length);
  reg(cuenta, 'Eliminar mesa: botón accesible con nombre', await x.evaluate(b => b.tagName === 'BUTTON' && /^Eliminar /.test(b.getAttribute('aria-label') || '')), '');
  await x.focus(); await p.keyboard.press('Enter'); await p.waitForSelector('#modal-confirm.open', {timeout: 6000});
  reg(cuenta, 'Eliminar mesa: por teclado pide confirmación y no elimina antes', (await p.$$eval('.mesa-card', e => e.length)) === n0, '');
  await p.locator('#modal-confirm button:has-text("Cancelar"), #modal-confirm .btn-cancel').first().click();
  reg(cuenta, 'Eliminar mesa: Cancelar no elimina', (await p.$$eval('.mesa-card', e => e.length)) === n0, '');
  const c0 = capturas.length;
  await x.click(); await p.waitForSelector('#modal-confirm.open'); await p.locator('#confirm-btn-ok').click();
  await p.waitForTimeout(6000);
  const quedan = await p.$$eval('.mesa-card', (e, n) => e.filter(c => c.textContent.includes(n)).length, nombre);
  const eventos = desde(c0), borrado = eventos.find(c => c.m === 'DELETE' && c.t === 'open_orders');
  reg(cuenta, `Eliminar mesa (confirmada) con rol ${CUENTAS[cuenta].rol}: resultado en el servidor`, !!borrado && borrado.estado < 300 && quedan === 0, `DELETE open_orders → ${borrado ? borrado.estado + (borrado.error ? ' ' + borrado.error : '') : 'no se emitió'} · en pantalla quedan=${quedan} · ${eventos.map(c => c.m + ' ' + c.t + ' ' + c.estado).join(' | ')}`);
}

(async () => {
  const {server, origin} = await frozenServer(), audit = [];
  for (const perfil of PERFILES) {
    const d = await openDevice(perfil, {origin, audit, mode: 'fixture', fixtureStore: FIXTURE_STORE, headless: true});
    let cuenta = perfil;
    try {
      await d.page.goto(`${origin}/`);
      await d.page.waitForFunction(() => typeof window.__sesionUserId === 'function' && !!window.__sesionUserId(), null, {timeout: 30000});
      const user8 = (await d.page.evaluate(() => String(window.__sesionUserId()))).slice(0, 8);
      cuenta = Object.keys(CUENTAS).find(k => CUENTAS[k].user8 === user8); identidades[perfil] = {user8, cuenta: cuenta || 'DESCONOCIDA'};
      if (!cuenta) { reg(perfil, 'Identidad de la sesión', false, `usuario ${user8} desconocido`); await d.ctx.close(); continue; }
      if (!SOLO.includes(cuenta)) { await d.ctx.close(); continue; }
      d.cuenta = cuenta; instalarCaptura(d, cuenta);
      await d.page.waitForFunction(() => document.querySelectorAll('.mesa-card').length > 0 && !/Cargando/.test((document.querySelector('#ctx-local .ctx-v') || {}).textContent || 'Cargando'), null, {timeout: 40000});
      await cambiarAlSintetico(d);
      const falla = await verificarEntorno(d, cuenta);
      if (falla) { reg(cuenta, 'Verificación previa a escribir (proyecto, URL, usuario, rol, local)', false, falla); await d.ctx.close(); continue; }
      reg(cuenta, 'Verificación previa a escribir (proyecto, URL, usuario, rol, local)', true, `perfil=${perfil} usuario=${CUENTAS[cuenta].user8} rol=${CUENTAS[cuenta].rol} local=sintético`);
      await shot(d, 'local_sintetico');
      if (BLOQUES.includes('turno')) await abrirTurno(d, cuenta);
      if (BLOQUES.includes('cobros')) {
        let r = await cobrar(d, cuenta, `EF_${cuenta}`, `ZZ-EF-${cuenta}`, [['ZZE2E Cafe', 1], ['ZZE2E Medialuna', 1]], {medio: 'ef', recibido: 5000});
        if (r) { reg(cuenta, 'Efectivo: vuelto calculado (paga con $5.000 sobre $3.100)', r.obs.vuelto === 'Vuelto $1.900', r.obs.vuelto); evaluarCobro(cuenta, `EF_${cuenta}`, r, 3100); }
        r = await cobrar(d, cuenta, `TR_${cuenta}`, `ZZ-TR-${cuenta}`, [['ZZE2E Tostado', 1]], {medio: 'tr'});
        if (r) { reg(cuenta, 'Transferencia: sin cálculo de vuelto', r.obs.sinVuelto === true, ''); evaluarCobro(cuenta, `TR_${cuenta}`, r, 4500); }
        r = await cobrar(d, cuenta, `MX_${cuenta}`, `ZZ-MX-${cuenta}`, [['ZZE2E Jugo', 1], ['ZZE2E Cien', 1]], {medio: 'mixed', mixEf: 1000, mixTr: 1700});
        if (r) { reg(cuenta, 'Mixto: sin cálculo de vuelto', r.obs.sinVuelto === true, ''); evaluarCobro(cuenta, `MX_${cuenta}`, r, 2700); }
        r = await cobrar(d, cuenta, `CTV_${cuenta}`, `ZZ-CTV-${cuenta}`, [['ZZE2E Cien', 1]], {medio: 'ef', descuentoPct: 12.5, justo: true});
        if (r) { reg(cuenta, 'Centavos (12,5 % sobre $100 = 87,5): «Justo» sin faltante', /^Vuelto \$0$/.test(r.obs.justo || ''), `mostrado=${fm(r.total)} · ${r.obs.justo}`); evaluarCobro(cuenta, `CTV_${cuenta}`, r, 87.5); }
      }
      if (BLOQUES.includes('eliminar')) await bloqueEliminar(d, cuenta);
    } catch (e) { reg(cuenta, 'Recorrido', false, e.message.split('\n')[0]); await shot(d, 'error'); }
    reg(cuenta, 'Sin violaciones de la barrera de red (escrituras sólo al local sintético)', d.state.violations.length === 0, d.state.violations.slice(0, 4).join(' | '));
    await d.ctx.close();
  }
  saveAudit(audit, 'network_ciclo_escritura.jsonl');
  fs.writeFileSync(path.join(EVID, 'resultados_ciclo_escritura.json'), JSON.stringify({identidades, res, capturas: capturas.map(c => ({...c, body: c.body && JSON.stringify(c.body).slice(0, 1500)}))}, null, 1));
  console.log(`\n${res.filter(r => r.ok).length}/${res.filter(r => r.ok !== null).length} comprobaciones OK`);
  server.close();
})().catch(e => { console.error('CICLO_FALLO', e.message); process.exit(1); });
