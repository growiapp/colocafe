'use strict';
// Preflight de SOLO LECTURA (barrera 'readonly': ninguna escritura a /rest/v1). Se identifica a cada cuenta por su USUARIO, no por el nombre de la ventana.
// Por perfil: proyecto/URL, usuario, rol, locales visibles (id corto, nombre, rol), local activo, claves de credencial (SOLO nombres) y errores. No escribe nada.
const fs = require('node:fs'), path = require('node:path');
const {openDevice, frozenServer, saveAudit, EVID, STAGING} = require('./lib.cjs');
const PERFILES = (process.env.PREFLIGHT_PERFILES || 'owner,admin,caja').split(',');
const LOGICA = {'7cd84c4f': 'owner', 'eef11ffb': 'admin', '48075b31': 'operator (caja)'};
(async () => {
  const {server, origin} = await frozenServer();
  const audit = [], out = {};
  for (const perfil of PERFILES) {
    const d = await openDevice(perfil, {origin, audit, mode: 'readonly', headless: true});
    try {
      await d.page.goto(`${origin}/`);
      await d.page.waitForFunction(() => typeof window.__sesionUserId === 'function' && !!window.__sesionUserId(), null, {timeout: 30000}).catch(() => {});
      await d.page.waitForTimeout(8000);
      const r = await d.page.evaluate(() => ({
        sesion: !!(window.__sesionUserId && window.__sesionUserId()),
        user8: String((window.__sesionUserId && window.__sesionUserId()) || '').slice(0, 8),
        urlHost: (() => { try { return new URL(config.supabaseUrl).host; } catch (_) { return null; } })(),
        localActivo: String((config && config.activeStoreId) || '').slice(0, 8),
        rolActivo: (window.getSupabaseActiveRole && window.getSupabaseActiveRole()) || '',
        rolEstricto: (window.getActiveStoreRoleEstricto && window.getActiveStoreRoleEstricto()) || '',
        rolViejoGetActiveStoreRole: (window.getActiveStoreRole && window.getActiveStoreRole()) || '',   // referencia: siempre vacío (lee una variable no publicada)
        // B26: qué devuelven las funciones que leen window.supabaseStores (no publicada)
        b26: (() => { const n = window.getActiveStoreName ? String(window.getActiveStoreName()) : null, st = window.getActiveStore ? window.getActiveStore() : null;
          return {getActiveStoreName_esUuid: n ? /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(n) : null, getActiveStore: st ? {idCorto: String(st.id || '').slice(0, 8), nombreVacio: !st.name, rolVacio: !st.role} : null,
                  nombreEnTicket: typeof nombreComercio === 'function' ? nombreComercio() : null}; })(),
        puedeLimpiarHistorial: typeof esAdminDelLocalActivo === 'function' ? esAdminDelLocalActivo() : null,
        locales: (Array.isArray(window.supabaseStores) ? window.supabaseStores : []).map(s => `${String(s.id || '').slice(0, 8)}|${String(s.name || '').slice(0, 40)}|${s.role || ''}|activo=${s.active}`),
        encabezado: ((document.querySelector('#ctx-local .ctx-v') || {}).textContent || '').trim(),
        mesas: document.querySelectorAll('.mesa-card').length,
        clavesCredencial: Object.keys(localStorage).filter(k => /^sb-.+-auth-token/.test(k)).map(k => k.replace(/^(sb-[^-]{0,6}).*(-auth-token.*)$/, '$1…$2')),
      }));
      r.cuenta = LOGICA[r.user8] || 'DESCONOCIDA';
      r.esStaging = r.urlHost === STAGING;
      out[perfil] = r;
    } catch (e) { out[perfil] = {error: String(e.message).slice(0, 200)}; }
    out[perfil].violaciones = d.state.violations.slice();
    out[perfil].erroresConsola = d.consoleErrors.slice(0, 4);
    await d.ctx.close();
  }
  saveAudit(audit, 'network_preflight.jsonl');
  fs.writeFileSync(path.join(EVID, 'preflight.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  server.close();
})().catch(e => { console.error('PREFLIGHT_FAILED', e.message); process.exit(1); });
