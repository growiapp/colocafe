'use strict';
// Validación de B5 (guard del servidor) en STAGING, SOLO dentro del local sintético ZZ_E2E_OLA1, con SESIONES REALES de cada cuenta (el servidor aplica RLS con el usuario autenticado).
// B5_FASE=antes   → CONTROL previo a instalar el guard: el operador SÍ puede cerrar/borrar directamente una mesa con productos (esto es lo que el guard corrige).
// B5_FASE=despues → con el guard instalado: operador (mesa vacía OK; mesa con productos: cierre y borrado directos RECHAZADOS; cobro legítimo y cierre posterior OK), owner y admin (eliminación de mesa con productos OK).
// No se prueba aislamiento entre locales en vivo (un guard fallido podría dañar mesas reales): eso está cubierto en la copia aislada (tests/b5_servidor_rls.test.cjs).
const fs = require('node:fs'), path = require('node:path');
const {openDevice, frozenServer, saveAudit, EVID} = require('./lib.cjs');
const {FIXTURE_STORE} = require('./policy.cjs');
const H = require('./escenarios_ola1.cjs');
const {CUENTAS, PERFILES, res, identidades, capturas, reg, shot, verificarEntorno, cambiarAlSintetico, instalarCaptura, desde, nuevaMesa, abrirTurno, cobrar, evaluarCobro} = H;
const FASE = process.env.B5_FASE || 'despues';
const SOLO = (process.env.B5_SOLO || 'owner,admin,caja').split(',');
const TAG = process.env.B5_TAG || '';   // sufijo para repetir un bloque sin chocar con mesas de una pasada anterior

// Operaciones DIRECTAS contra el servidor con la sesión de la página (lo que haría un cliente a medida): cerrar y borrar la mesa; después se LEE el estado real.
const directo = (d, id) => d.page.evaluate(async ({id, store}) => {
  const c = window.getSupabaseClient(), r = {};
  const cierre = await c.from('open_orders').update({status: 'closed'}).eq('id', id).eq('store_id', store).select('id,status');
  r.cierre = {filas: (cierre.data || []).length, error: cierre.error ? (cierre.error.code || '') + ' ' + String(cierre.error.message || '').slice(0, 90) : ''};
  const borrado = await c.from('open_orders').delete().eq('id', id).eq('store_id', store);
  r.borrado = {error: borrado.error ? (borrado.error.code || '') + ' ' + String(borrado.error.message || '').slice(0, 90) : '', estado: borrado.status};
  return r;
}, {id, store: FIXTURE_STORE});
const estadoServidor = (d, id) => d.page.evaluate(async ({id, store}) => {
  const c = window.getSupabaseClient();
  const o = await c.from('open_orders').select('id,status').eq('id', id).eq('store_id', store);
  const i = await c.from('open_order_items').select('id').eq('open_order_id', id).eq('store_id', store);
  return {existe: (o.data || []).length, status: (o.data || [])[0] ? o.data[0].status : null, items: (i.data || []).length, error: (o.error || i.error) ? String((o.error || i.error).message).slice(0, 100) : ''};
}, {id, store: FIXTURE_STORE});
const idDeMesa = (d, nombre) => d.page.evaluate(n => { const m = (window.mesas || mesas || []).find(x => x.nombre === n); return m ? String(m._sb_id || '') : ''; }, nombre);

async function turnoReal(d) {   // un turno 'Sin confirmar' es residuo de un local sintético anterior ya eliminado: se descarta SOLO el estado local del dispositivo de prueba
  const t = await d.page.$eval('#ctx-turno .ctx-v', e => e.textContent.trim()).catch(() => '');
  if (/Sin confirmar/i.test(t)) { await d.page.evaluate(() => { turno = null; save(); if (typeof renderTurnoPill === 'function') renderTurnoPill(); }); await d.page.waitForTimeout(800); reg(d.cuenta, 'Turno residual (sin confirmar) de un local anterior descartado en el dispositivo de prueba', null, t); }
}
async function operador(d, cuenta) {
  const p = d.page;
  await turnoReal(d);
  await abrirTurno(d, cuenta);
  // (1) mesa con productos: operaciones directas
  let falla = await verificarEntorno(d, cuenta); if (falla) { reg(cuenta, 'Verificación previa a escribir', false, falla); return; }
  await nuevaMesa(d, `ZZ-B5-CONITEMS${TAG}`, [['ZZE2E Cien', 2]]);
  await p.waitForTimeout(2500);
  const id = await idDeMesa(d, `ZZ-B5-CONITEMS${TAG}`);
  const antes = id ? await estadoServidor(d, id) : null;
  reg(cuenta, 'Mesa con productos creada y sincronizada en el servidor (control previo)', !!id && antes && antes.existe === 1 && antes.items >= 1, JSON.stringify(antes));
  if (!id || !antes || antes.existe !== 1) return;
  const r = await directo(d, id), luego = await estadoServidor(d, id);
  if (FASE === 'antes') {
    reg(cuenta, 'CONTROL (sin guard): el operador puede cerrar y borrar directamente una mesa con productos', luego.existe === 0, `cierre=${JSON.stringify(r.cierre)} borrado=${JSON.stringify(r.borrado)} · después existe=${luego.existe}`);
    return;
  }
  reg(cuenta, 'Operador: CIERRE directo de una mesa con productos RECHAZADO', r.cierre.filas === 0 && (!!r.cierre.error || r.cierre.filas === 0), JSON.stringify(r.cierre));
  reg(cuenta, 'Operador: BORRADO directo de una mesa con productos RECHAZADO (la mesa y sus ítems siguen en el servidor)', luego.existe === 1 && luego.status === 'open' && luego.items === antes.items, `borrado=${JSON.stringify(r.borrado)} · después existe=${luego.existe} estado=${luego.status} ítems=${luego.items}/${antes.items}`);
  // la interfaz tampoco lo intenta (política B5 del cliente)
  const c0 = capturas.length; const card = p.locator('.mesa-card', {hasText: `ZZ-B5-CONITEMS${TAG}`}).first();
  await card.locator('.mesa-close').click().catch(() => {}); await p.waitForTimeout(1500);
  const modal = await p.$eval('#modal-confirm', e => e.classList.contains('open')).catch(() => false);
  reg(cuenta, 'Operador: la interfaz no ofrece eliminar una mesa con productos (aviso, sin pedir confirmación ni escribir)', !modal && !desde(c0).some(c => ['DELETE', 'PATCH'].includes(c.m) && /open_orders/.test(c.t)), `confirmación abierta=${modal}`);
  if (modal) await p.locator('#modal-confirm button:has-text("Cancelar"), #modal-confirm .btn-cancel').first().click().catch(() => {});
  // (2) mesa VACÍA: eliminación permitida
  falla = await verificarEntorno(d, cuenta); if (falla) { reg(cuenta, 'Verificación previa a escribir', false, falla); return; }
  await nuevaMesa(d, `ZZ-B5-VACIA${TAG}`, []);
  await p.waitForTimeout(1500);
  const idV = await idDeMesa(d, `ZZ-B5-VACIA${TAG}`), c1 = capturas.length;
  const x = p.locator('.mesa-card', {hasText: `ZZ-B5-VACIA${TAG}`}).first().locator('.mesa-close');
  await x.click(); await p.waitForSelector('#modal-confirm.open', {timeout: 8000}); await p.locator('#confirm-btn-ok').click(); await p.waitForTimeout(5000);
  const ev = desde(c1), est = idV ? await estadoServidor(d, idV) : {existe: -1};
  reg(cuenta, 'Operador: ELIMINAR una mesa vacía permitido (cierre, borrado de ítems y de la fila sin errores; ya no existe en el servidor)', ev.some(c => c.m === 'DELETE' && c.t === 'open_orders' && c.estado < 300) && ev.every(c => !c.estado || c.estado < 400) && est.existe === 0, `${ev.map(c => c.m + ' ' + c.t + ' ' + c.estado).join(' | ')} · existe=${est.existe}`);
  // (3) cobro legítimo y cierre posterior
  const rc = await cobrar(d, cuenta, `EF_${cuenta}`, `ZZ-B5-COBRO-${cuenta}${TAG}`, [['ZZE2E Cafe', 1], ['ZZE2E Medialuna', 1]], {medio: 'ef'});
  if (rc) {
    evaluarCobro(cuenta, `EF_${cuenta}`, rc, 3100);
    const cierres = rc.escrituras.filter(c => ['PATCH', 'DELETE'].includes(c.m) && /open_order/.test(c.t));
    reg(cuenta, 'Operador: cobro legítimo y CIERRE posterior de la mesa permitidos (PATCH/DELETE de la mesa sin errores)', cierres.length >= 1 && cierres.every(c => c.estado && c.estado < 300), cierres.map(c => `${c.m} ${c.t} ${c.estado}${c.error ? ' ' + c.error : ''}`).join(' | '));
  }
}

async function adminOwner(d, cuenta) {
  const p = d.page, falla = await verificarEntorno(d, cuenta);
  if (falla) { reg(cuenta, 'Verificación previa a escribir', false, falla); return; }
  const nombre = `ZZ-B5-DEL-${cuenta}${TAG}`;
  await nuevaMesa(d, nombre, [['ZZE2E Cien', 2]]); await p.waitForTimeout(2500);
  const id = await idDeMesa(d, nombre), antes = id ? await estadoServidor(d, id) : null;
  reg(cuenta, 'Mesa con productos creada y sincronizada en el servidor', !!id && antes && antes.existe === 1 && antes.items >= 1, JSON.stringify(antes));
  if (!id) return;
  const c0 = capturas.length, x = p.locator('.mesa-card', {hasText: nombre}).first().locator('.mesa-close');
  await x.click(); await p.waitForSelector('#modal-confirm.open', {timeout: 8000}); await p.locator('#confirm-btn-ok').click(); await p.waitForTimeout(6000);
  const ev = desde(c0), est = await estadoServidor(d, id);
  reg(cuenta, `${CUENTAS[cuenta].rol}: ELIMINAR una mesa con productos (con confirmación) permitido: cierre, borrado de ítems y de la fila sin errores; ya no existe en el servidor`, ev.some(c => c.m === 'DELETE' && c.t === 'open_orders' && c.estado < 300) && ev.every(c => !c.estado || c.estado < 400) && est.existe === 0, `${ev.map(c => c.m + ' ' + c.t + ' ' + c.estado).join(' | ')} · existe=${est.existe}`);
  // permisos de edición/creación conservados: renombrar no aplica; se comprueba crear + editar ítems ya hecho arriba (nuevaMesa con productos sincronizó)
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
      const corresponde = FASE === 'antes' ? cuenta === 'caja' : SOLO.includes(cuenta);
      if (!corresponde) { await d.ctx.close(); continue; }
      d.cuenta = cuenta; instalarCaptura(d, cuenta);
      await d.page.waitForFunction(() => !/Cargando/.test((document.querySelector('#ctx-local .ctx-v') || {}).textContent || 'Cargando'), null, {timeout: 40000});
      await d.page.waitForTimeout(4000);
      await cambiarAlSintetico(d);
      const falla = await verificarEntorno(d, cuenta);
      if (falla) { reg(cuenta, 'Verificación previa a escribir (proyecto, URL, usuario, rol, local)', false, falla); await d.ctx.close(); continue; }
      reg(cuenta, 'Verificación previa a escribir (proyecto, URL, usuario, rol, local)', true, `fase=${FASE} usuario=${CUENTAS[cuenta].user8} rol=${CUENTAS[cuenta].rol} local=sintético`);
      if (cuenta === 'caja') await operador(d, cuenta); else { await turnoReal(d); await abrirTurno(d, cuenta); await adminOwner(d, cuenta); }
    } catch (e) { reg(cuenta, 'Recorrido', false, e.message.split('\n')[0]); await shot(d, 'b5_error'); }
    reg(cuenta, 'Sin violaciones de la barrera de red (escrituras sólo al local sintético)', d.state.violations.length === 0, d.state.violations.slice(0, 4).join(' | '));
    await d.ctx.close();
  }
  saveAudit(audit, `network_b5_${FASE}.jsonl`);
  fs.writeFileSync(path.join(EVID, `resultados_b5_${FASE}.json`), JSON.stringify({fase: FASE, identidades, res, capturas: capturas.map(c => ({...c, body: c.body && JSON.stringify(c.body).slice(0, 800)}))}, null, 1));
  console.log(`\n${res.filter(r => r.ok).length}/${res.filter(r => r.ok !== null).length} comprobaciones OK (fase ${FASE})`);
  server.close();
})().catch(e => { console.error('B5_FALLO', e.message); process.exit(1); });
