'use strict';
// Validación de las mejoras de la ola 1 y de B1/B2/B4/B23 en STAGING, SIN ESCRITURAS: barrera 'readonly' del arnés (todo POST/PATCH/DELETE a /rest/v1 se bloquea y
// cuenta como violación) + un freno dentro de la página que anula los clics en «Confirmar cobro» y en el «Eliminar» del diálogo de confirmación.
// Opera sobre el local REAL de staging («Colo Café Staging»): abre pantallas, mide, escribe en campos de la pantalla (sin enviarlos) y CANCELA. Nunca confirma.
// Cada sesión se identifica por su USUARIO y rol, no por el nombre de la ventana.
const fs = require('node:fs'), path = require('node:path');
const {openDevice, frozenServer, saveAudit, EVID, STAGING} = require('./lib.cjs');
const CUENTAS = {owner: {user8: '7cd84c4f', rol: 'owner'}, admin: {user8: 'eef11ffb', rol: 'admin'}, caja: {user8: '48075b31', rol: 'operator'}};
const PERFILES = ['owner', 'admin', 'caja'];
const ESC = {width: 1280, height: 800}, MOV = {width: 390, height: 844};
const res = [], identidades = {};
const reg = (cuenta, dispositivo, flujo, ok, detalle = '') => { res.push({cuenta, dispositivo, flujo, ok: ok === null ? null : !!ok, detalle: String(detalle).slice(0, 300)}); console.log(`${ok === null ? 'INFO ' : ok ? 'OK   ' : 'FALLA'} [${cuenta}/${dispositivo}] ${flujo}${detalle ? ' · ' + String(detalle).slice(0, 170) : ''}`); };
const shot = (d, n) => d.page.screenshot({path: path.join(EVID, `${d.cuenta}_${n}.png`)}).catch(() => {});
const fmt = n => '$' + Math.round(n).toLocaleString('es-AR');

async function prepararFreno(page) {   // anula los clics que podrían escribir; cuenta los intentos
  await page.evaluate(() => {
    window.__frenados = 0;
    document.addEventListener('click', e => { if (e.target.closest('.btn-confirmar[data-c="confirmar"], #confirm-btn-ok, .btn-save')) { e.stopImmediatePropagation(); e.preventDefault(); window.__frenados++; } }, true);
  });
}
const elegirMesaConItems = page => page.evaluate(() => { const c = [...document.querySelectorAll('.mesa-card[data-mesa]')].find(x => { const t = (x.querySelector('.mesa-total') || {}).textContent || ''; return /\d/.test(t) && !/cobrad/i.test(x.textContent); }); return c ? {id: c.dataset.mesa, nombre: (c.querySelector('.mesa-nombre') || {}).textContent, total: (c.querySelector('.mesa-total') || {}).textContent} : null; });

async function escritorio(d, cuenta) {
  const p = d.page; await p.setViewportSize(ESC); await p.waitForTimeout(500);
  const mesa = await elegirMesaConItems(p);
  reg(cuenta, 'escritorio', 'Hay una mesa abierta con productos para observar', !!mesa, mesa ? `${mesa.nombre} ${mesa.total}` : '');
  await shot(d, 'caja_escritorio');
  // — Eliminar mesa: botón accesible, confirmación y CANCELAR (nunca confirmar) —
  if (mesa) {
    const card = p.locator(`.mesa-card[data-mesa="${mesa.id}"]`), x = card.locator('.mesa-close');
    const n0 = await p.$$eval('.mesa-card', e => e.length);
    reg(cuenta, 'escritorio', 'Eliminar mesa: es un <button> con nombre accesible', await x.evaluate(b => b.tagName === 'BUTTON' && /^Eliminar /.test(b.getAttribute('aria-label') || '')), await x.getAttribute('aria-label'));
    await x.focus(); await p.keyboard.press('Enter');
    const abrio = await p.waitForSelector('#modal-confirm.open', {timeout: 5000}).then(() => true).catch(() => false);
    reg(cuenta, 'escritorio', 'Eliminar mesa: por teclado abre una confirmación (no elimina)', abrio && (await p.$$eval('.mesa-card', e => e.length)) === n0, abrio ? (await p.$eval('#confirm-msg', e => e.textContent)).slice(0, 60) : '');
    await p.locator('#modal-confirm button:has-text("Cancelar"), #modal-confirm .btn-cancel').first().click({timeout: 3000}).catch(() => p.keyboard.press('Escape'));
    await p.waitForTimeout(400);
    reg(cuenta, 'escritorio', 'Eliminar mesa: Cancelar cierra el diálogo y la mesa sigue', !(await p.$('#modal-confirm.open')) && (await p.$$eval('.mesa-card', e => e.length)) === n0, '');
    // — foco tras repintados periódicos (≈10 s) —
    await x.focus(); await p.waitForTimeout(14000);
    reg(cuenta, 'escritorio', 'Foco del × se conserva tras repintados de las tarjetas (14 s)', await p.evaluate(id => { const a = document.activeElement; return !!a && a.classList.contains('mesa-close') && a.closest('.mesa-card')?.dataset.mesa === id; }, mesa.id), '');
  }
  // — filtros por teclado —
  await p.focus('#ventas-filtro-chips .chip:not(.active)'); await p.keyboard.press('Enter');
  const f1 = await p.evaluate(() => !!document.activeElement.closest('#ventas-filtro-chips')); await p.keyboard.press('Space');
  reg(cuenta, 'escritorio', 'Filtros: Enter y Espacio conservan el foco', f1 && await p.evaluate(() => !!document.activeElement.closest('#ventas-filtro-chips')), '');
  await p.evaluate(() => { document.querySelector('#ventas-filtro-chips .chip')?.click(); });   // vuelve a «Todas»
  // — Cobrar (sin confirmar): diseño, vuelto, medios, foco con carga de operadores —
  if (mesa) {
    await p.locator(`.mesa-card[data-mesa="${mesa.id}"]`).click(); await p.waitForTimeout(600);
    await p.locator('#btn-confirm').click();
    await p.waitForSelector('#cobro-screen:not([hidden]) .cobro-medios', {timeout: 15000});
    // foco: se escribe de inmediato mientras la lectura de operadores todavía puede estar en curso
    await p.waitForTimeout(150); await p.focus('#cobro-rec-in'); await p.keyboard.type('12');
    await p.waitForFunction(() => document.querySelectorAll('.cobro-ops [data-o]').length > 0 || /No pudimos/.test(document.querySelector('.cobro-ops')?.innerText || ''), null, {timeout: 20000}).catch(() => {});
    await p.keyboard.type('34');
    reg(cuenta, 'escritorio', 'Cobrar: el foco del importe sobrevive a la llegada de los operadores (lectura real)', await p.evaluate(() => document.activeElement.id === 'cobro-rec-in') && (await p.$eval('#cobro-rec-in', e => e.value)) === '1234', 'valor=' + await p.$eval('#cobro-rec-in', e => e.value));
    const m = await p.evaluate(() => ({botones: [...document.querySelectorAll('.cobro-medios button')].map(b => [b.clientWidth, b.scrollWidth]), conf: document.querySelector('.btn-confirmar').getBoundingClientRect().bottom, alto: innerHeight, main: document.querySelector('.cobro-main').getBoundingClientRect().width, scrollW: document.documentElement.scrollWidth, ancho: innerWidth, total: Number(document.querySelector('.cobro-tk .tk-total b').textContent.replace(/\D/g, ''))}));
    reg(cuenta, 'escritorio', 'Cobrar a ancho completo: sin desborde y «Confirmar cobro» visible en 1280×800', m.botones.every(([c, s]) => s <= c) && m.main >= 600 && m.conf <= m.alto && m.scrollW <= m.ancho, JSON.stringify({main: Math.round(m.main), conf: Math.round(m.conf), alto: m.alto}));
    await shot(d, 'cobrar_escritorio');
    const total = m.total;
    if (total > 0) {
      await p.locator('.cobro-rec [data-r]').first().click(); const justo = await p.$eval('#cobro-vuelto', e => e.textContent.trim());
      await p.fill('#cobro-rec-in', String(total + 5000)); const mayor = await p.$eval('#cobro-vuelto', e => e.textContent.trim());
      await p.fill('#cobro-rec-in', String(Math.max(total - 100, 1))); const menor = await p.$eval('#cobro-vuelto', e => e.textContent.trim());
      reg(cuenta, 'escritorio', 'Efectivo: exacto («Justo»), superior y faltante', justo === 'Vuelto $0' && mayor === `Vuelto ${fmt(5000)}` && menor === (total > 100 ? `Faltan ${fmt(100)}` : `Vuelto ${fmt(Math.max(total - 100, 1) - total)}`), `total=${fmt(total)} | ${justo} | ${mayor} | ${menor}`);
      reg(cuenta, 'escritorio', 'El botón de confirmar sigue mostrando el total sin cambios por el vuelto', (await p.$eval('.btn-confirmar[data-c=confirmar]', b => b.textContent)).includes(fmt(total)), '');
      await p.fill('#cobro-rec-in', String(total + 5000));
    }
    await p.locator('[data-m="transferencia"]').click(); const sinTr = (await p.$('#cobro-rec-in')) === null;
    await p.locator('[data-m="mixed"]').click(); const sinMx = (await p.$('#cobro-rec-in')) === null; const mixto = await p.evaluate(() => !!document.querySelector('#mixed-payments-box') && getComputedStyle(document.querySelector('#mixed-payments-box')).display !== 'none');
    await p.locator('[data-m="ef"]').click();
    reg(cuenta, 'escritorio', 'Transferencia y mixto: sin cálculo de vuelto; el mixto muestra sus campos; Efectivo conserva el monto', sinTr && sinMx && mixto && total > 0 ? (await p.$eval('#cobro-rec-in', e => e.value)) === String(total + 5000) : sinTr && sinMx && mixto, `sinTr=${sinTr} sinMx=${sinMx} mixto=${mixto}`);
    reg(cuenta, 'escritorio', 'Medios de pago y operadores del local (lectura)', (await p.$$eval('.cobro-medios button', b => b.length)) === 3, 'operadores=' + (await p.$$eval('.cobro-ops [data-o]', b => b.map(x => x.dataset.o).join(','))));
    // móvil con Cobrar abierto
    await p.setViewportSize(MOV); await p.waitForTimeout(700);
    reg(cuenta, 'móvil', 'Cobrar: sin desborde horizontal y botón de confirmar presente', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && !!document.querySelector('.btn-confirmar')), '');
    await shot(d, 'cobrar_movil'); await p.setViewportSize(ESC); await p.waitForTimeout(400);
    await p.locator('[data-c="volver"]').click().catch(() => {});
  }
  // — nombre del local en móvil —
  await p.setViewportSize(MOV); await p.waitForTimeout(700);
  const h = await p.$eval('#ctx-local .ctx-v', e => ({t: e.textContent.trim(), cortado: e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis', lineas: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))}));
  reg(cuenta, 'móvil', 'Nombre del local visible completo en el encabezado', !h.cortado && /Colo Caf/i.test(h.t), JSON.stringify(h)); await shot(d, 'caja_movil');
  await p.setViewportSize(ESC);
  // — permisos por rol —
  const per = await p.evaluate(() => { goTab('ajustes'); try { toggleAccordion('datos'); } catch (_) {} aplicarPermisosCatalogo?.(); const b = document.querySelector('#acc-body-datos button[onclick*="limpiarVentas"]'); return {puedeLimpiar: typeof esAdminDelLocalActivo === 'function' ? esAdminDelLocalActivo() : null, botonLimpiarVisible: !!b && getComputedStyle(b).display !== 'none', rolEstricto: window.getActiveStoreRoleEstricto ? window.getActiveStoreRoleEstricto() : null}; });
  const esAdmin = ['owner', 'admin'].includes(CUENTAS[cuenta].rol);
  reg(cuenta, 'escritorio', 'B4: «Limpiar historial» visible y permitido solo para owner/admin del local activo', per.puedeLimpiar === esAdmin && per.botonLimpiarVisible === esAdmin && per.rolEstricto === CUENTAS[cuenta].rol, JSON.stringify(per));
  await p.evaluate(() => { toggleAccordion('menu'); try { switchMenuTab?.('productos'); } catch (_) {} });
  await p.waitForTimeout(800);
  const cat = await p.evaluate(() => ({edicion: document.querySelectorAll('#menu-adm .prod-adm-row .icon-btn, #cat-mgr .cat-mgr-row .icon-btn').length, altas: [...document.querySelectorAll('[data-solo-admin]')].filter(b => getComputedStyle(b).display !== 'none').length}));
  reg(cuenta, 'escritorio', 'Edición de catálogo visible solo para owner/admin', esAdmin ? (cat.edicion > 0 && cat.altas > 0) : (cat.edicion === 0 && cat.altas === 0), JSON.stringify(cat));
  // — B2: precios inválidos NO llegan a la red —
  const b2 = await p.evaluate(async () => { let llamadas = 0, toast = ''; const t = window.showToast; window.showToast = m => { toast = String(m); };
    window.saveProductToSupabase = async () => { llamadas++; throw new Error('bloqueado por la prueba'); }; editId = null; _variantesEdit = [];
    const casos = {}; for (const v of ['2.500', '-100', '0', '12.5']) { document.getElementById('m-nombre').value = 'ZZ validacion'; document.getElementById('m-precio').value = v; document.getElementById('m-ilimitado').checked = true; const antes = llamadas; await guardarProducto(); casos[v] = {llamoAlServidor: llamadas > antes, avisoPrecio: /precio/i.test(toast)}; toast = ''; }
    window.showToast = t; return {llamadas, casos}; });
  reg(cuenta, 'escritorio', 'B2: precios «2.500», «-100», «0» y «12.5» se rechazan con aviso y no llegan al servidor', b2.llamadas === 0 && Object.values(b2.casos).every(c => c.avisoPrecio && !c.llamoAlServidor), JSON.stringify(b2.casos));
  // — B23: el respaldo no contiene el token real —
  const b23 = await p.evaluate(async () => { const claves = Object.keys(localStorage).filter(k => /^sb-.+-auth-token/.test(k)); const vals = claves.map(k => { try { const j = JSON.parse(localStorage.getItem(k)); return [j.access_token, j.refresh_token]; } catch (_) { return []; } }).flat().filter(Boolean); const json = JSON.stringify(await window.getLocalRecoveryBackupPayload()); return {hayCredencialLocal: vals.length > 0, filtra: vals.some(v => json.includes(v)), redactado: json.includes('REDACTADO')}; });
  reg(cuenta, 'escritorio', 'B23: la credencial de sesión está en localStorage y el respaldo local NO la contiene', b23.hayCredencialLocal && !b23.filtra && b23.redactado, JSON.stringify(b23));
  // — regresiones de lectura: Reportes, Clientes, Gestión —
  for (const tab of ['dashboard', 'historial', 'clientes']) { await p.evaluate(t => goTab(t), tab); await p.waitForTimeout(1800); }
  reg(cuenta, 'escritorio', 'Reportes, Historial y Clientes cargan sin errores de página ni de red', d.consoleErrors.filter(e => /pageerror/.test(e)).length === 0 && d.state.violations.length === 0, [...d.consoleErrors, ...d.state.violations].slice(0, 2).join(' | '));
  reg(cuenta, '—', 'Clics anulados por el freno (deben ser 0: nunca se intentó confirmar/guardar)', (await p.evaluate(() => window.__frenados)) === 0, String(await p.evaluate(() => window.__frenados)));
}

(async () => {
  const {server, origin} = await frozenServer();
  const audit = [];
  for (const perfil of PERFILES) {
    const d = await openDevice(perfil, {origin, audit, mode: 'readonly', headless: true});
    let cuenta = perfil;
    try {
      await d.page.goto(`${origin}/`);
      await d.page.waitForFunction(() => typeof window.__sesionUserId === 'function' && !!window.__sesionUserId(), null, {timeout: 30000});
      const user8 = (await d.page.evaluate(() => String(window.__sesionUserId()))).slice(0, 8);
      cuenta = Object.keys(CUENTAS).find(k => CUENTAS[k].user8 === user8); identidades[perfil] = {user8, cuenta: cuenta || 'DESCONOCIDA'};
      if (!cuenta) { reg(perfil, '—', 'Identidad', false, `usuario ${user8} desconocido`); await d.ctx.close(); continue; }
      d.cuenta = cuenta;
      await d.page.waitForFunction(() => document.querySelectorAll('.mesa-card').length > 0 && !/Cargando/.test((document.querySelector('#ctx-local .ctx-v') || {}).textContent || 'Cargando'), null, {timeout: 40000});
      await d.page.waitForTimeout(3000);
      const e = await d.page.evaluate(() => ({url: new URL(config.supabaseUrl).host, store: String(config.activeStoreId).slice(0, 8), rol: window.getSupabaseActiveRole && window.getSupabaseActiveRole(), local: (document.querySelector('#ctx-local .ctx-v') || {}).textContent}));
      const okEnt = e.url === STAGING && e.rol === CUENTAS[cuenta].rol && /Staging/i.test(e.local);
      reg(cuenta, '—', 'Entorno: proyecto de staging, usuario, rol y local', okEnt, JSON.stringify({...e, perfil}));
      if (!okEnt) { await d.ctx.close(); continue; }
      await prepararFreno(d.page);
      await escritorio(d, cuenta);
    } catch (e) { reg(cuenta, '—', 'Recorrido', false, e.message); }
    const escrituras = d.state.violations.filter(v => /POST|PATCH|DELETE|PUT|ESCRITURA|FIXTURE/i.test(v));
    reg(cuenta, '—', 'Cero escrituras y cero violaciones de la barrera de red', d.state.violations.length === 0, d.state.violations.slice(0, 3).join(' | ') + (escrituras.length ? ` (¡${escrituras.length} intentos de escritura bloqueados!)` : ''));
    await d.ctx.close();
  }
  saveAudit(audit, 'network_validacion_solo_lectura.jsonl');
  fs.writeFileSync(path.join(EVID, 'resultados_solo_lectura.json'), JSON.stringify({identidades, res}, null, 1));
  console.log(`\n${res.filter(r => r.ok).length}/${res.filter(r => r.ok !== null).length} comprobaciones OK`);
  server.close();
})().catch(e => { console.error('VALIDACION_FALLO', e.message); process.exit(1); });
