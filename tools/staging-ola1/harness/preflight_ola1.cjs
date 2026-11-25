'use strict';
// Preflight de SOLO LECTURA (barrera 'readonly': ninguna escritura a /rest/v1). Por cuenta: rol, locales visibles y local activo.
const fs = require('node:fs'), path = require('node:path');
const {openDevice, frozenServer, saveAudit, EVID} = require('./lib.cjs');
const DEVICES = ['owner', 'admin', 'caja'];
(async () => {
  const {server, origin} = await frozenServer();
  const audit = [], out = {};
  for (const name of DEVICES) {
    const d = await openDevice(name, {origin, audit, mode: 'readonly', headless: true});
    try {
      await d.page.goto(`${origin}/`);
      await d.page.waitForFunction(() => typeof window.__sesionUserId === 'function', null, {timeout: 20000}).catch(() => {});
      await d.page.waitForTimeout(6000);
      out[name] = await d.page.evaluate(() => ({
        sesion: !!(window.__sesionUserId && window.__sesionUserId()),
        user8: String((window.__sesionUserId && window.__sesionUserId()) || '').slice(0, 8),
        rol: (window.getSupabaseActiveRole && window.getSupabaseActiveRole()) || null,
        locales: [...document.querySelectorAll('#sb-store-sel option, #sb-store-sel-modal option')].map(o => o.value.slice(0, 8) + ':' + o.textContent.trim().slice(0, 40)),
        encabezado: (document.querySelector('#ctx-local .ctx-v') || {}).textContent || null,
        mesas: document.querySelectorAll('.mesa-card').length,
      }));
    } catch (e) { out[name] = {error: String(e.message).slice(0, 200)}; }
    out[name].violaciones = d.state.violations.slice();
    out[name].erroresConsola = d.consoleErrors.slice(0, 5);
    await d.ctx.close();
  }
  saveAudit(audit, 'network_preflight.jsonl');
  fs.writeFileSync(path.join(EVID, 'preflight.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  server.close();
})().catch(e => { console.error('PREFLIGHT_FAILED', e.message); process.exit(1); });
