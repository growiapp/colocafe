'use strict';
// Harness E2E de Stock Durability. Sirve index.html congelado y aísla la red. No contiene ni registra secretos.
const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {decidirAccesoStaging, entradaAuditable} = require('./policy.cjs');
const {manejarRetencion} = require('./barrier.cjs');
const {cargarPlaywright} = require('./deps.cjs');
const {negativaAutorizada} = require('./matriz.cjs');

const REPO = process.env.E2E_REPO, FROZEN = process.env.E2E_FROZEN;
const STAGING = 'wjymdgfqmqutihadffec.supabase.co', PROD = 'xhtpahjsddfkwsytubgu.supabase.co';
const STATE = process.env.E2E_STATE; // scratchpad: perfiles y clave pública. Nunca en la evidencia.
if (!REPO || !FROZEN) throw new Error('faltan E2E_REPO/E2E_FROZEN');
if (!STATE) throw new Error('falta E2E_STATE');
if (!process.env.E2E_EVID) throw new Error('falta E2E_EVID');
const EVID = path.resolve(process.env.E2E_EVID);
if (EVID === REPO || EVID.startsWith(REPO + path.sep)) throw new Error('EVIDENCIA_DENTRO_DEL_REPOSITORIO');
fs.mkdirSync(EVID, {recursive:true});
const KEYFILE = path.join(STATE, 'anon.key');
const fixtureOrders = new Set();
const PUBLIC_HOSTS =new Set(['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);

function validAnonKey(key) {
  try {
    const c = JSON.parse(Buffer.from(String(key).split('.')[1], 'base64url').toString());
    return c.role === 'anon' && c.ref === 'wjymdgfqmqutihadffec';
  } catch (_) { return false; }
}

// Solo el contenido congelado: HEAD exacto y worktree limpio antes de servir.
function frozenServer(onSetup) {
  const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
  if (head !== FROZEN) throw new Error(`HEAD inesperado ${head}`);
  const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=all'], {encoding:'utf8'}).trim();
  if (dirty) throw new Error('worktree con cambios');
  const tracked = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', FROZEN], {encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
  const approved = new Map();
  for (const rel of tracked) {
    if (rel.startsWith('.e2e_acceptance/') || rel.startsWith('.')) continue;
    const expected = execFileSync('git', ['-C', REPO, 'show', `${FROZEN}:${rel}`], {maxBuffer: 64 * 1024 * 1024});
    approved.set(rel, crypto.createHash('sha256').update(expected).digest('hex'));
  }
  const types = {'.html':'text/html; charset=utf-8', '.png':'image/png', '.json':'application/json', '.svg':'image/svg+xml', '.jpg':'image/jpeg'};
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (onSetup && p.startsWith('/__setup')) return onSetup(req, res);
    const rel = p === '/' ? 'index.html' : p.slice(1);
    const file = path.resolve(REPO, rel);
    if (!approved.has(rel) || !file.startsWith(path.resolve(REPO) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== approved.get(rel)) { res.writeHead(500); return res.end(); }
    res.writeHead(200, {'content-type':types[path.extname(file)] || 'application/octet-stream'});
    res.end(fs.readFileSync(file));
  });
  return new Promise(ok => server.listen(Number(process.env.E2E_PORT || 0), '127.0.0.1', () => ok( // localStorage es por origen: las sesiones requieren el puerto del login
{server, origin:`http://127.0.0.1:${server.address().port}`})));
}

// Barrera de red. mode 'readonly': ninguna escritura a /rest/v1. mode 'fixture': solo sobre el local sintético.
async function openDevice(name, {origin, audit, mode = 'readonly', fixtureStore = null, headless = true, activeStore = null}) {
  const dir = path.join(STATE, 'profiles', name);
  fs.mkdirSync(dir, {recursive:true});
  const key = fs.existsSync(KEYFILE) ? fs.readFileSync(KEYFILE, 'utf8').trim() : '';
  const {chromium, chrome} = cargarPlaywright(); // falla cerrado si falta o cambia la versión
  const ctx = await chromium.launchPersistentContext(dir, {headless, serviceWorkers:'block', executablePath:chrome, viewport:headless ? {width:1280, height:900} : null,
    args:[`--host-resolver-rules=MAP ${PROD} ~NOTFOUND`]}); // segunda barrera, a nivel de resolución
  const log = e => audit.push({at:new Date().toISOString(), device:name, ...e});
  const state = {mode, fixtureStore, faults:[], violations:[], denied:[], held:0, inflight:new Set(), pendingEvents:new Set(), pendingRoutes:new Set()};
  ctx.on('request', req => { if (req.resourceType() !== 'websocket') state.inflight.add(req); });
  ctx.on('requestfinished', req => state.inflight.delete(req));
  ctx.on('requestfailed', req => state.inflight.delete(req));
  await ctx.route('**/*', route => { const pendiente = (async () => {
    const req = route.request(), url = new URL(req.url()), m = req.method();
    if (url.origin === origin) {
      if (m === 'GET' || m === 'HEAD') return route.continue();
      state.violations.push(`ORIGEN_LOCAL_METODO:${m}`); return route.abort('blockedbyclient');
    }
    if (url.host === PROD) { log({host:url.host, method:m, result:'BLOCKED_PROD'}); state.violations.push('PROD'); return route.abort('blockedbyclient'); }
    if (url.protocol === 'https:' && PUBLIC_HOSTS.has(url.host) && m === 'GET') return route.continue();
    if (url.host !== STAGING) { log({host:url.host, method:m, result:'BLOCKED_OTHER'}); state.violations.push(`ORIGEN_NO_AUTORIZADO:${url.host}`); return route.abort('blockedbyclient'); }
    // Política POSITIVA (policy.cjs): solo lo enumerado pasa; el resto se bloquea y cuenta como violación (gate global).
    const dec = decidirAccesoStaging({method:m, url, headers:req.headers(), body:req.postData(), mode:state.mode, fixtureStore:state.fixtureStore, fixtureOrders});
    if (dec.accion === 'DENEGAR_REGISTRADA') { let entrada; try { entrada = entradaAuditable({headers:req.headers(), body:req.postData(), mode:state.mode, fixtureStore:state.fixtureStore}); } catch (e) { log({host:url.host, method:m, path:url.pathname, query:url.search, result:'BLOCKED_BY_POLICY', razon:'ENTRADA_NO_REPRESENTABLE'}); state.violations.push(`ENTRADA_NO_REPRESENTABLE: ${m} ${url.pathname}`); return route.abort('blockedbyclient'); } const neg = negativaAutorizada(name, m, url.pathname); log({host:url.host, method:m, path:url.pathname, query:url.search, result:'DENIED_BY_POLICY', razon:dec.razon, ...(neg && {escenario:neg.escenario, condicion:neg.condicion}), entrada}); state.denied.push(`${m} ${url.pathname}`); return route.abort('blockedbyclient'); }
    if (dec.accion !== 'PERMITIR') { log({host:url.host, method:m, path:url.pathname, query:url.search, result:'BLOCKED_BY_POLICY', razon:dec.razon}); state.violations.push(`${dec.razon}: ${m} ${url.pathname}`); return route.abort('blockedbyclient'); }
    log({host:url.host, method:m, path:url.pathname, query:url.search, result:'REQUEST_ALLOWED'});
    const fault = state.faults.find(f => !f.done && f.method === m && url.pathname.endsWith(f.path) && (!f.match || f.match(req.postData() || '', url)));
    if (fault) {
      if (!fault.persist) fault.done = true;
      if (fault.kind === 'lose_response') { // el servidor recibe y confirma; el cliente no recibe la respuesta
        const r = await route.fetch().catch(() => null);
        fault.status = r && r.status();
        log({host:url.host, method:m, path:url.pathname, status:fault.status, result:'RESPONSE_LOST_INJECTED'});
        return route.abort('connectionreset');
      }
      if (fault.kind === 'stall') // sale recién cuando el paso lo libera; vence por timeout y se cancela (aborta) sin llegar al servidor
        return manejarRetencion(state, fault, route, e => log({host:url.host, method:m, path:url.pathname, ...e}));
      if (fault.kind === 'offline') { log({host:url.host, method:m, path:url.pathname, result:'OFFLINE_INJECTED'}); return route.abort('internetdisconnected'); }
    }
    return route.continue();
  })().catch(async e => { state.violations.push(`HANDLER_RUTA:${e.message}`); await route.abort('blockedbyclient').catch(() => {}); });
    state.pendingRoutes.add(pendiente); pendiente.then(() => state.pendingRoutes.delete(pendiente)); return pendiente;
  });
  await ctx.routeWebSocket(/.*/, ws => {
    const url = new URL(ws.url());
    if (url.origin === `https://${STAGING}` && url.pathname === '/realtime/v1/websocket') { log({host:url.host, method:'WS', path:url.pathname, result:'ALLOWED'}); ws.connectToServer(); return; }
    log({host:url.host, method:'WS', result:'BLOCKED'}); state.violations.push(`WS_NO_AUTORIZADO:${url.host}${url.pathname}`); ws.close();
  });
  ctx.on('response', res => { const pendiente = (async () => {
    const req = res.request(), url = new URL(res.url());
    if (url.host !== STAGING) return;
    const e = {host:url.host, method:req.method(), path:url.pathname, query:url.search, status:res.status(), result:'ALLOWED'};
    if (res.status() >= 400 && url.pathname.startsWith('/rest/v1/')) {
      try { const j = await res.json(); e.pg = j.code; e.msg = String(j.message || '').slice(0, 120); } catch (_) {}
    }
    log(e);
    if (url.pathname === '/rest/v1/open_orders' && res.status() < 300 && fixtureStore) {
      try { const rows = await res.json(); (Array.isArray(rows) ? rows : [rows]).forEach(r => { if (r?.id && r.store_id === fixtureStore) fixtureOrders.add(r.id); }); } catch (_) {}
    }
  })().catch(e => state.violations.push(`EVENTO_RESPONSE:${e.message}`)); state.pendingEvents.add(pendiente); pendiente.then(() => state.pendingEvents.delete(pendiente)); });
  await ctx.addInitScript(({url, key, activeStore, name}) => {
    localStorage.setItem('supabase_url', url);
    if (key) localStorage.setItem('supabase_anon_key', key);
    let c = {}; try { c = JSON.parse(localStorage.getItem('config') || '{}') || {}; } catch (_) {}
    Object.assign(c, {supabaseUrl:url, supabaseAnonKey:key, sheetId:'', webappUrl:''});
    if (activeStore) c.activeStoreId = activeStore;
    localStorage.setItem('config', JSON.stringify(c));
    window.__device = name;
    window.addEventListener('DOMContentLoaded', () => { document.title = `[${name}] ${document.title}`; });
  }, {url:`https://${STAGING}`, key, activeStore, name});
  const page = ctx.pages()[0] || await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  return {name, ctx, page, state, consoleErrors, log};
}

const saveAudit = (audit, file) => { if (audit.length) fs.appendFileSync(path.join(EVID, file), audit.splice(0).map(e => JSON.stringify(e)).join('\n') + '\n'); };
module.exports = {openDevice, frozenServer, saveAudit, validAnonKey, KEYFILE, STATE, EVID, STAGING, PROD, FROZEN};
