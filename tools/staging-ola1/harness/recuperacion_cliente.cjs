'use strict';
// Recuperación del CLIENTE: si el local sintético ya no existe (limpieza hecha o interrumpida) pero el navegador de una cuenta de prueba lo recuerda como local activo,
// ¿vuelve la cuenta sola al local preexistente, con su rol y sin errores? SOLO LECTURA (barrera 'readonly'). Simula el recuerdo con activeStoreId = local sintético.
const fs = require('node:fs'), path = require('node:path');
const {openDevice, frozenServer, saveAudit, EVID, STAGING} = require('./lib.cjs');
const {FIXTURE_STORE} = require('./policy.cjs');
const CUENTAS = {'7cd84c4f': 'owner', 'eef11ffb': 'admin', '48075b31': 'operator'};
(async () => {
  const {server, origin} = await frozenServer(), audit = [], out = [];
  for (const perfil of ['owner', 'admin', 'caja']) {
    const d = await openDevice(perfil, {origin, audit, mode: 'readonly', headless: true, activeStore: FIXTURE_STORE});
    try {
      await d.page.goto(`${origin}/`);
      await d.page.waitForFunction(() => typeof window.__sesionUserId === 'function' && !!window.__sesionUserId(), null, {timeout: 30000});
      await d.page.waitForFunction(() => document.querySelectorAll('.mesa-card').length > 0, null, {timeout: 40000}).catch(() => {});
      await d.page.waitForTimeout(3000);
      const r = await d.page.evaluate(() => ({user8: String(window.__sesionUserId()).slice(0, 8), localActivo: String(config.activeStoreId).slice(0, 8), rol: window.getActiveStoreRoleEstricto ? window.getActiveStoreRoleEstricto() : null, local: (document.querySelector('#ctx-local .ctx-v') || {}).textContent, mesas: document.querySelectorAll('.mesa-card').length, rolSesion: window.getSupabaseActiveRole && window.getSupabaseActiveRole()}));
      out.push({perfil, cuenta: CUENTAS[r.user8], ...r, violaciones: d.state.violations.length, erroresPagina: d.consoleErrors.filter(e => /pageerror/.test(e)).length});
    } catch (e) { out.push({perfil, error: e.message}); }
    await d.ctx.close();
  }
  saveAudit(audit, 'network_recuperacion_cliente.jsonl');
  fs.writeFileSync(path.join(EVID, 'recuperacion_cliente.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1)); server.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
