'use strict';
// Abre una ventana visible por cuenta. La persona pega la clave pública y escribe sus contraseñas; el script no las lee ni las registra.
// Barrera 'readonly': durante el login ninguna escritura a /rest/v1 llega a staging.
const fs = require('node:fs'), path = require('node:path');
const {openDevice, frozenServer, saveAudit, validAnonKey, KEYFILE, STATE, EVID} = require('./lib.cjs');
const DEVICES = {owner:'7cd84c4f', caja:'48075b31', admin:'eef11ffb'};
const STATUS = path.join(EVID, 'login_status.json');
const LIMIT = Number(process.env.LOGIN_MINUTES || 30) * 60000;
const HTML = {'content-type':'text/html; charset=utf-8'};

(async () => {
  if (fs.existsSync(STATUS)) throw new Error('EVIDENCIA_PREEXISTENTE');
  fs.mkdirSync(STATE, {recursive:true});
  let keyReady; const gotKey = new Promise(ok => { keyReady = ok; });
  const {server, origin} = await frozenServer((req, res) => {
    if (req.method === 'POST') {
      let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
        const key = (new URLSearchParams(b).get('key') || '').trim();
        if (!validAnonKey(key)) { res.writeHead(400, HTML); return res.end('<p>Esa clave no corresponde: se esperaba la clave PÚBLICA de staging (anon «eyJ…» con ref wjymdgfqmqutihadffec, o «sb_publishable_…»). Nunca service_role ni sb_secret_. <a href="/__setup">Volver</a></p>'); }
        fs.writeFileSync(KEYFILE, key); res.writeHead(200, HTML); res.end('<p>Listo. Se abren las ventanas de login.</p>'); keyReady();
      });
      return;
    }
    res.writeHead(200, HTML);
    res.end('<!doctype html><title>Clave publica de staging</title><form method=post style="font:16px sans-serif;margin:40px"><p>Pegá la clave <b>pública</b> del proyecto de staging <code>wjymdgfqmqutihadffec</code>: la <b>anon</b> (empieza con <code>eyJ</code>) o la <b>publishable</b> (<code>sb_publishable_…</code>). <b>No</b> pegues service_role ni secret. Dashboard → Project Settings → API Keys.</p><input name=key style="width:80%" autofocus> <button>Continuar</button></form>');
  });
  const audit = [];
  if (!fs.existsSync(KEYFILE)) {
    const s = await openDevice('setup', {origin, audit, headless: process.env.LOGIN_HEADLESS === '1'});
    await s.page.goto(`${origin}/__setup`);
    if (process.env.LOGIN_SELFTEST) {   // autotest: ¿carga el formulario y el envío (POST) llega al servidor local? Usa una clave inválida a propósito: no guarda nada.
      const r = {};
      r.campo = await s.page.locator('input[name=key]').count();
      r.otroPostBloqueado = await s.page.evaluate(() => fetch('/otra-ruta', {method: 'POST', body: 'x'}).then(() => false).catch(() => true));   // la excepción es SOLO /__setup
      r.violacionesSonda = s.state.violations.length; s.state.violations.length = 0;
      await s.page.fill('input[name=key]', 'esto-no-es-una-clave');
      await s.page.locator('button, input[type=submit]').first().click();
      await s.page.waitForTimeout(2000);
      r.url = s.page.url(); r.texto = (await s.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      r.violaciones = s.state.violations; r.claveGuardada = fs.existsSync(KEYFILE);
      console.log('SELFTEST ' + JSON.stringify(r)); await s.ctx.close(); server.close(); process.exit(0);
    }
    await Promise.race([gotKey, new Promise((_, no) => setTimeout(() => no(new Error('sin clave')), LIMIT))]);
    await s.ctx.close();
  }
  const devices = [];
  for (const name of Object.keys(DEVICES)) {
    const d = await openDevice(name, {origin, audit, headless:false});
    await d.page.goto(`${origin}/`);
    devices.push(d);
  }
  const ends = Date.now() + LIMIT, result = {};
  while (Date.now() < ends && devices.some(d => !result[d.name])) {
    for (const d of devices) {
      if (result[d.name]) continue;
      if (d.page.isClosed()) { result[d.name] = {skipped:true}; continue; } // cerrar la ventana = esa cuenta no está disponible
      const s = await d.page.evaluate(() => ({uid:window.__sesionUserId?.() || '', role:window.getSupabaseActiveRole?.() || ''})).catch(() => null);
      if (s && s.uid) result[d.name] = {user8:s.uid.slice(0, 8), expected:DEVICES[d.name], ok:s.uid.startsWith(DEVICES[d.name]), role:s.role, at:new Date().toISOString()};
    }
    fs.writeFileSync(STATUS, JSON.stringify({result}, null, 1));
    await new Promise(r => setTimeout(r, 2000));
  }
  await new Promise(r => setTimeout(r, 5000));
  const violations = devices.flatMap(d => d.state.violations.map(v => `${d.name}: ${v}`));
  fs.writeFileSync(STATUS, JSON.stringify({result, violations, finished:true}, null, 1));
  saveAudit(audit, 'network_login.jsonl');
  for (const d of devices) await d.ctx.close();
  server.close();
  console.log(JSON.stringify({result, violations}));
})().catch(e => { console.error('LOGIN_FAILED', e.message); process.exit(1); });
