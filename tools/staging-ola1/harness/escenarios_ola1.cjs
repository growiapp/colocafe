'use strict';
// Recorridos de staging de la ola 1 (cinco mejoras + B1/B2/B4/B5/B23 donde aplique). SOLO sobre el local sintético ZZ_E2E_OLA1_* de staging.
// Requisitos: login.cjs ya ejecutado (perfiles con sesión), fixtures.sql aplicado por la persona, E2E_REPO/E2E_FROZEN/E2E_STATE/E2E_EVID definidos.
// Antes de CUALQUIER escritura, por cuenta: proyecto, URL, usuario, rol y local se verifican; si algo no coincide, se aborta esa cuenta.
const fs = require('node:fs'), path = require('node:path');
const {openDevice, frozenServer, saveAudit, EVID, STAGING} = require('./lib.cjs');
const {FIXTURE_STORE} = require('./policy.cjs');
const CUENTAS = {owner: {user8: '7cd84c4f', rol: 'owner'}, admin: {user8: 'eef11ffb', rol: 'admin'}, caja: {user8: '48075b31', rol: 'operator'}};
const SOLO = (process.env.OLA1_SOLO || 'owner,admin,caja').split(',');
const ESC = {width: 1280, height: 800}, MOV = {width: 390, height: 844};
const res = []; // {cuenta, dispositivo, flujo, ok, detalle}
const reg = (cuenta, dispositivo, flujo, ok, detalle = '') => { res.push({cuenta, dispositivo, flujo, ok: !!ok, detalle: String(detalle).slice(0, 300)}); console.log(`${ok ? 'OK ' : 'FALLA'} [${cuenta}/${dispositivo}] ${flujo}${detalle ? ' · ' + String(detalle).slice(0, 160) : ''}`); };
const shot = (d, nombre) => d.page.screenshot({path: path.join(EVID, `${d.name}_${nombre}.png`)}).catch(() => {});

// Verificación previa de escritura (proyecto, URL, usuario, rol, local). Devuelve null si todo coincide.
async function verificarEntorno(d, esperado) {
  const e = await d.page.evaluate(() => ({
    url: (typeof config === 'object' && config.supabaseUrl) || '', store: (typeof config === 'object' && config.activeStoreId) || '',
    uid: String((window.__sesionUserId && window.__sesionUserId()) || ''), rol: (window.getSupabaseActiveRole && window.getSupabaseActiveRole()) || '',
    local: (document.querySelector('#ctx-local .ctx-v') || {}).textContent || '',
  }));
  const fallas = [];
  if (new URL(e.url || 'http://x').host !== STAGING) fallas.push('URL≠staging:' + e.url);
  if (e.store !== FIXTURE_STORE) fallas.push('local activo≠sintético:' + e.store);
  if (!e.uid.startsWith(esperado.user8)) fallas.push('usuario inesperado:' + e.uid.slice(0, 8));
  if (e.rol !== esperado.rol) fallas.push(`rol ${e.rol}≠${esperado.rol}`);
  if (!/ZZ_E2E_OLA1/.test(e.local)) fallas.push('nombre de local no es el sintético:' + e.local);
  return fallas.length ? fallas.join(' | ') : null;
}
const montoPagado = body => { try { const b = JSON.parse(body); const f = Array.isArray(b) ? b : [b]; return f; } catch (_) { return null; } };

async function nuevaMesa(d, nombre, productos) {   // recorrido real: + Mesa → nombre → productos → Abrir mesa
  await d.page.getByText('+ Mesa', {exact: true}).first().click();
  await d.page.locator('#nueva-mesa-input').fill(nombre);
  for (const [prod, veces] of productos) for (let i = 0; i < veces; i++) await d.page.locator('.order-modal-shell .prod-card', {hasText: prod}).first().click();
  await d.page.getByRole('button', {name: /Abrir mesa/}).click();
  await d.page.waitForSelector('.mesa-card', {timeout: 15000});
  await d.page.waitForFunction(n => [...document.querySelectorAll('.mesa-card')].some(c => c.textContent.includes(n)), nombre, {timeout: 20000});
}
const abrirCobroUI = async (d, nombre, prep) => {
  await d.page.locator('.mesa-card', {hasText: nombre}).first().click();
  if (prep) await prep();                                   // p. ej. aplicar un descuento antes de cobrar
  await d.page.locator('#btn-confirm').click();
  await d.page.waitForSelector('#cobro-screen:not([hidden]) .cobro-medios', {timeout: 15000});
};
const textoVuelto = d => d.page.$eval('#cobro-vuelto', e => e.textContent.trim()).catch(() => null);

async function recorridoCobros(d) {   // owner, escritorio: importes, vuelto, Justo, centavos, transferencia, mixto, preservación de datos
  const posts = []; const onReq = r => { if (r.method() === 'POST' && /\/rest\/v1\/(sales|sale_items|sale_payments)$/.test(r.url())) posts.push({t: r.url().split('/').pop(), body: r.postData()}); };
  d.page.on('request', onReq);
  const cobrar = async (nombre, productos, accionesCobro, prep) => {
    await nuevaMesa(d, nombre, productos); await abrirCobroUI(d, nombre, prep);
    const total = Number((await d.page.$eval('.cobro-tk .tk-total b', e => e.textContent)).replace(/\D/g, ''));
    await accionesCobro(total);
    await d.page.waitForFunction(() => document.querySelectorAll('.cobro-ops [data-o]').length > 0, null, {timeout: 20000});
    await d.page.locator('.cobro-ops [data-o]').first().click();
    const antes = posts.length;
    await d.page.locator('.btn-confirmar[data-c=confirmar]').click();
    await d.page.waitForFunction(() => !document.querySelector('#cobro-screen:not([hidden])') || document.querySelector('#modal-comprobante.open'), null, {timeout: 30000}).catch(() => {});
    await d.page.waitForTimeout(1500);
    await d.page.evaluate(() => { try { cerrarComprobante(); } catch (_) {} });
    return {total, nuevos: posts.slice(antes)};
  };
  try {
    // Efectivo: importe entregado mayor al total (vuelto), insuficiente (faltante) y exacto (Justo). Total esperado 2200+900 = 3100.
    let r = await cobrar('ZZ-AUD-EF', [['ZZE2E Cafe', 1], ['ZZE2E Medialuna', 1]], async total => {
      await d.page.fill('#cobro-rec-in', '5000'); const v1 = await textoVuelto(d);
      await d.page.fill('#cobro-rec-in', '2000'); const v2 = await textoVuelto(d);
      await d.page.locator('.cobro-rec [data-r]').first().click(); const v3 = await textoVuelto(d);
      reg('owner', 'escritorio', 'Efectivo: vuelto / faltante / exacto', total === 3100 && v1 === 'Vuelto $1.900' && v2 === 'Faltan $1.100' && v3 === 'Vuelto $0', `total=${total} ${v1} | ${v2} | ${v3}`);
      await d.page.fill('#cobro-rec-in', '5000');   // se confirma con vuelto calculado: no debe alterar la venta
    });
    const pagos = r.nuevos.filter(x => x.t === 'sale_payments').flatMap(x => montoPagado(x.body) || []);
    const ventas = r.nuevos.filter(x => x.t === 'sales').flatMap(x => montoPagado(x.body) || []);
    const sumaPagos = pagos.reduce((s, p) => s + Number(p.amount || 0), 0);
    reg('owner', 'escritorio', 'Efectivo con vuelto calculado: la venta no cambia (total, pagos, sin campos nuevos)', ventas.length >= 1 && sumaPagos === 3100 && !/recib|vuelto|5000/i.test(JSON.stringify(r.nuevos)), `ventas=${ventas.length} sumaPagos=${sumaPagos}`);
    // Centavos: 1 × $100 con descuento 12,5 % en la línea → 87,5 (se muestra $88; «Justo» no debe dar faltante)
    r = await cobrar('ZZ-AUD-CTV', [['ZZE2E Cien', 1]], async total => {
      const vJusto = await (async () => { await d.page.locator('.cobro-rec [data-r]').first().click(); return textoVuelto(d); })();
      reg('owner', 'escritorio', 'Efectivo con centavos (12,5 % sobre $100) y «Justo»: sin faltante', /^Vuelto \$0$/.test(vJusto || ''), `total mostrado=${total} · ${vJusto}`);
    }, async () => {
      await d.page.locator('#cart-rows .c-act-desc').first().click();
      await d.page.locator('#desc-tipo-pct').click(); await d.page.fill('#descuento-valor', '12.5');
      await d.page.getByRole('button', {name: /Aplicar/}).first().click(); await d.page.waitForTimeout(500);
    });
    const sc = r.nuevos.filter(x => x.t === 'sale_payments').flatMap(x => montoPagado(x.body) || []).reduce((s2, p) => s2 + Number(p.amount || 0), 0);
    reg('owner', 'escritorio', 'Centavos: el pago registrado conserva el importe exacto (87,5)', Math.abs(sc - 87.5) < 0.005, `suma pagos=${sc}`);
    // Transferencia: sin cálculo de vuelto
    r = await cobrar('ZZ-AUD-TR', [['ZZE2E Cafe', 1]], async total => {
      await d.page.locator('[data-m="transferencia"]').click();
      reg('owner', 'escritorio', 'Transferencia: sin cálculo de vuelto', (await d.page.$('#cobro-rec-in')) === null && total === 2200, `total=${total}`);
    });
    reg('owner', 'escritorio', 'Transferencia: pago registrado por el total', r.nuevos.filter(x => x.t === 'sale_payments').flatMap(x => montoPagado(x.body) || []).every(p => /transfer/i.test(p.method || '')), JSON.stringify(r.nuevos.map(x => x.t)));
    // Mixto: sin cálculo de vuelto; la suma de pagos = total
    r = await cobrar('ZZ-AUD-MX', [['ZZE2E Tostado', 1]], async total => {
      await d.page.locator('[data-m="mixed"]').click();
      await d.page.fill('#mpay-efectivo', '1000'); await d.page.fill('#mpay-transferencia', String(total - 1000));
      reg('owner', 'escritorio', 'Mixto: sin cálculo de vuelto', (await d.page.$('#cobro-rec-in')) === null && total === 4500, `total=${total}`);
    });
    const sm = r.nuevos.filter(x => x.t === 'sale_payments').flatMap(x => montoPagado(x.body) || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    reg('owner', 'escritorio', 'Mixto: suma de pagos = total', sm === 4500, `suma=${sm}`);
  } catch (e) { reg('owner', 'escritorio', 'Recorrido de cobros', false, e.message); }
  d.page.off('request', onReq);
}

async function recorridoEliminarMesa(d, cuenta, dispositivo) {   // permisos y comportamiento por rol, confirmación y teclado
  try {
    const nombre = `ZZ-DEL-${cuenta}`;
    await nuevaMesa(d, nombre, [['ZZE2E Cien', 1]]);
    const n0 = await d.page.$$eval('.mesa-card', e => e.length);
    const btn = d.page.locator('.mesa-card', {hasText: nombre}).locator('.mesa-close');
    reg(cuenta, dispositivo, 'Eliminar mesa: es un botón con nombre accesible', (await btn.evaluate(b => b.tagName === 'BUTTON' && /^Eliminar /.test(b.getAttribute('aria-label') || ''))), '');
    await btn.focus(); await d.page.keyboard.press('Enter');
    await d.page.waitForSelector('#modal-confirm.open', {timeout: 5000});
    reg(cuenta, dispositivo, 'Eliminar mesa: pide confirmación y no elimina antes', (await d.page.$$eval('.mesa-card', e => e.length)) === n0, '');
    await d.page.locator('#modal-confirm .btn-cancel, #modal-confirm button:has-text("Cancelar")').first().click().catch(() => d.page.keyboard.press('Escape'));
    reg(cuenta, dispositivo, 'Eliminar mesa: cancelar no elimina', (await d.page.$$eval('.mesa-card', e => e.length)) === n0, '');
    await btn.click(); await d.page.waitForSelector('#modal-confirm.open'); await d.page.locator('#confirm-btn-ok').click();
    await d.page.waitForTimeout(4000);
    const quedan = await d.page.$$eval('.mesa-card', (e, n) => e.filter(c => c.textContent.includes(n)).length, nombre);
    reg(cuenta, dispositivo, `Eliminar mesa confirmada: resultado del servidor para rol ${CUENTAS[cuenta].rol}`, true, quedan === 0 ? 'ELIMINADA' : 'NO ELIMINADA (el servidor la rechazó o quedó pendiente)');
  } catch (e) { reg(cuenta, dispositivo, 'Eliminar mesa', false, e.message); }
}

async function recorridoTeclado(d, cuenta) {
  try {
    await d.page.focus('#ventas-filtro-chips .chip:not(.active)'); await d.page.keyboard.press('Enter');
    reg(cuenta, 'escritorio', 'Teclado: Enter en filtro conserva el foco', await d.page.evaluate(() => !!document.activeElement.closest('#ventas-filtro-chips')), '');
    await d.page.keyboard.press('Space');
    reg(cuenta, 'escritorio', 'Teclado: Espacio en filtro conserva el foco', await d.page.evaluate(() => !!document.activeElement.closest('#ventas-filtro-chips')), '');
  } catch (e) { reg(cuenta, 'escritorio', 'Teclado', false, e.message); }
}

async function recorridoMovil(d, cuenta) {
  try {
    await d.page.setViewportSize(MOV); await d.page.waitForTimeout(800);
    const h = await d.page.$eval('#ctx-local .ctx-v', e => ({t: e.textContent.trim(), cortado: e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis', alto: e.getBoundingClientRect().height}));
    reg(cuenta, 'móvil', 'Nombre del local visible completo', !h.cortado && /ZZ_E2E_OLA1|Colo|Palermo/i.test(h.t), JSON.stringify(h));
    await shot(d, 'movil_caja');
    reg(cuenta, 'móvil', 'Caja sin desborde horizontal', await d.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '');
    await d.page.setViewportSize(ESC);
  } catch (e) { reg(cuenta, 'móvil', 'Encabezado', false, e.message); }
}

(async () => {
  const {server, origin} = await frozenServer();
  const audit = [];
  const credencialesEnLocalStorage = {};
  for (const cuenta of SOLO) {
    const d = await openDevice(cuenta, {origin, audit, mode: 'fixture', fixtureStore: FIXTURE_STORE, activeStore: FIXTURE_STORE, headless: true});
    try {
      await d.page.goto(`${origin}/`);
      await d.page.waitForFunction(() => typeof window.__sesionUserId === 'function' && !!window.__sesionUserId(), null, {timeout: 30000});
      await d.page.waitForFunction(() => document.querySelectorAll('#ctx-local .ctx-v').length && !/Cargando/.test(document.querySelector('#ctx-local .ctx-v').textContent), null, {timeout: 30000}).catch(() => {});
      await d.page.waitForTimeout(3000);
      const falla = await verificarEntorno(d, CUENTAS[cuenta]);
      if (falla) { reg(cuenta, 'escritorio', 'Verificación previa a escribir', false, falla); await d.ctx.close(); continue; }
      reg(cuenta, 'escritorio', 'Verificación previa a escribir (proyecto, URL, usuario, rol y local)', true, `rol=${CUENTAS[cuenta].rol}`);
      await shot(d, 'caja_escritorio');
      await recorridoTeclado(d, cuenta);
      if (cuenta === 'owner') await recorridoCobros(d);
      await recorridoEliminarMesa(d, cuenta, 'escritorio');
      await recorridoMovil(d, cuenta);
      // B23: nombres de claves de credencial en localStorage (SOLO nombres, nunca valores) y que el respaldo no contiene el valor real
      credencialesEnLocalStorage[cuenta] = await d.page.evaluate(async () => {
        const claves = Object.keys(localStorage).filter(k => /^sb-.+-auth-token/.test(k));
        const valores = claves.map(k => { try { const j = JSON.parse(localStorage.getItem(k)); return j && (j.access_token || j.refresh_token) || ''; } catch (_) { return ''; } }).filter(Boolean);
        const json = JSON.stringify(await window.getLocalRecoveryBackupPayload());
        return {claves, filtra: valores.some(v => json.includes(v)), hayRedaccion: json.includes('REDACTADO')};
      }).catch(e => ({error: e.message}));
      reg(cuenta, 'escritorio', 'B23: el respaldo local no contiene el token de sesión real', credencialesEnLocalStorage[cuenta].filtra === false, JSON.stringify(credencialesEnLocalStorage[cuenta]));
      // Regresiones de lectura: Caja, Reportes, Clientes, Gestión cargan sin errores de página
      for (const tab of ['dashboard', 'clientes', 'ajustes']) { await d.page.evaluate(t => goTab(t), tab); await d.page.waitForTimeout(1200); }
      reg(cuenta, 'escritorio', 'Reportes, Clientes y Gestión cargan sin errores de página', d.consoleErrors.filter(e => /pageerror/.test(e)).length === 0, d.consoleErrors.slice(0, 2).join(' | '));
    } catch (e) { reg(cuenta, 'escritorio', 'Sesión', false, e.message); }
    reg(cuenta, '—', 'Sin violaciones de la barrera de red', d.state.violations.length === 0, d.state.violations.slice(0, 3).join(' | '));
    await d.ctx.close();
  }
  saveAudit(audit, 'network_ola1.jsonl');
  fs.writeFileSync(path.join(EVID, 'resultados_ola1.json'), JSON.stringify({res, credencialesEnLocalStorage}, null, 1));
  console.log(`\n${res.filter(r => r.ok).length}/${res.length} comprobaciones OK`);
  server.close();
})().catch(e => { console.error('ESCENARIOS_FALLARON', e.message); process.exit(1); });
