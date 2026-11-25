'use strict';
const STAGING_ORIGIN = 'https://wjymdgfqmqutihadffec.supabase.co';
const FIXTURE_STORE = 'e2e02026-1123-4122-8000-000000000001';
const IDENTIDAD_FIXTURE = /^e2e02026-[0-9a-f]{4}-[0-9a-f]{4}-8000-[0-9a-f]{12}$/;
const ESCRITURAS_REST = Object.freeze({
  'POST sales':'fila', 'POST sale_items':'fila', 'POST sale_payments':'fila', 'POST shifts':'fila', 'POST open_orders':'fila',
  'PATCH open_orders':'filtro', 'DELETE open_order_items':'filtro',
  'DELETE open_orders':'borrado_orden', // AMPLIACIÓN ola 1 (Eliminar mesa): solo con store_id del local sintético Y un id de mesa creada por esta misma prueba

  'POST rpc/replace_open_order_items':'orden', 'POST rpc/stock_apply_adjustment':'rpc',
});
// Las sondas de E9 se bloquean localmente: su inocuidad no depende de RLS.
const DENEGADAS_REGISTRADAS = new Set(['POST reservations','PATCH reservations','PATCH products','DELETE sale_items']);
const TABLAS_LECTURA = new Set(['categories','customers','expenses','open_order_dispatches','open_order_items','open_orders','operators','products','profiles','reservations','sale_items','sale_payments','sales','shifts','stock_store_activation','stock_ledger','store_users','stores']);
const CABECERAS = new Set(['accept','accept-language','accept-encoding','apikey','authorization','content-type','content-length','prefer','x-client-info','x-supabase-api-version','accept-profile','content-profile','cache-control','pragma','origin','referer','user-agent','host','connection','priority','dnt','sec-fetch-site','sec-fetch-mode','sec-fetch-dest','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','x-retry-count']); // x-retry-count: la agrega el cliente Supabase al reintentar una lectura fallida
const PARAMETROS_LECTURA = new Set(['select','order','limit','offset','or','and','store_id','id','name','sale_id','open_order_id','product_id','metadata','role','status','category_id','operator_id','shift_id','legacy_id','created_at','sold_at','parent_id','active','business_date','full_name','open','opened_at','prod','reservation_id','sale_items','show','spent_at','stock','stock_applied_at','stock_applied_reason','user_id']);
const RANGO_FECHA = new Set(['business_date','sold_at','opened_at','created_at','spent_at']); // claves de fecha que pueden llevar un rango en LECTURAS
const PARAMETROS_ESCRITURA = new Set(['select','store_id','id','open_order_id','sale_id']);
const violacion = razon => ({accion:'VIOLACION', razon});
const tipoContenido = valor => {
  const partes = String(valor || '').toLowerCase().split(';').map(x => x.trim());
  if (partes.length > 2 || (partes.length === 2 && partes[1] !== 'charset=utf-8')) return null;
  return partes[0];
};

// JSON.parse acepta claves repetidas y conserva la última. La política debe ver todas.
function jsonSinDuplicados(raw) {
  const source = String(raw), n = source.length;
  let i = 0;
  const ws = () => { while (/\s/.test(source[i] || '') && i < n) i++; };
  const str = () => {
    const start = i++;
    while (i < n) { if (source[i] === '\\') { i += 2; continue; } if (source[i++] === '"') return JSON.parse(source.slice(start, i)); }
    throw new Error('JSON_INVALIDO');
  };
  const value = () => {
    ws();
    if (source[i] === '"') { str(); return; }
    if (source[i] === '{') {
      i++; ws(); const seen = new Set();
      if (source[i] === '}') { i++; return; }
      while (i < n) {
        ws(); if (source[i] !== '"') throw new Error('JSON_INVALIDO');
        const key = str(); if (seen.has(key)) throw new Error('JSON_CLAVE_REPETIDA'); seen.add(key);
        ws(); if (source[i++] !== ':') throw new Error('JSON_INVALIDO'); value(); ws();
        const sep = source[i++]; if (sep === '}') return; if (sep !== ',') throw new Error('JSON_INVALIDO');
      }
      throw new Error('JSON_INVALIDO');
    }
    if (source[i] === '[') {
      i++; ws(); if (source[i] === ']') { i++; return; }
      while (i < n) { value(); ws(); const sep = source[i++]; if (sep === ']') return; if (sep !== ',') throw new Error('JSON_INVALIDO'); }
      throw new Error('JSON_INVALIDO');
    }
    const tail = source.slice(i), atom = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(tail);
    if (!atom) throw new Error('JSON_INVALIDO'); i += atom[0].length;
  };
  value(); ws(); if (i !== n) throw new Error('JSON_INVALIDO');
  return JSON.parse(source);
}

function cabecerasValidas(headers, metodo, ruta) {
  const h = {};
  for (const [k,v] of Object.entries(headers || {})) {
    const nombre = k.toLowerCase();
    if (!CABECERAS.has(nombre) || Object.prototype.hasOwnProperty.call(h,nombre)) return 'CABECERA_NO_AUTORIZADA';
    h[nombre] = String(v).trim();
  }
  if (h.prefer && h.prefer.split(',').some(x => !/^(return=(minimal|representation)|count=(exact|planned|estimated))$/i.test(x.trim()))) return 'PREFER_NO_AUTORIZADO';
  if ((h['accept-profile'] && h['accept-profile'] !== 'public') || (h['content-profile'] && h['content-profile'] !== 'public')) return 'ESQUEMA_NO_AUTORIZADO';
  if (h['content-profile'] && (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS')) return 'ESQUEMA_DE_ESCRITURA_EN_LECTURA';
  const tipo = tipoContenido(h['content-type']);
  if (ruta === '/auth/v1/logout' && h['content-type'] && tipo !== 'application/json') return 'FORMATO_AUTH_NO_AUTORIZADO';
  if (metodo === 'POST' || metodo === 'PATCH' || metodo === 'PUT') {
    if (ruta === '/auth/v1/token') { if (tipo !== 'application/json') return 'FORMATO_AUTH_NO_AUTORIZADO'; }
    else if (ruta !== '/auth/v1/logout' && tipo !== 'application/json') return 'FORMATO_CUERPO_NO_AUTORIZADO';
  }
  if (metodo === 'DELETE' && tipo && tipo !== 'application/json') return 'FORMATO_CUERPO_NO_AUTORIZADO';
  return null;
}

function queryValida(url, metodo, ruta, forma) {
  if (url.searchParams.has('on_conflict')) return 'ON_CONFLICT_PROHIBIDO';
  // Claves repetidas: prohibido, salvo un RANGO de fechas en LECTURAS (gte + lte sobre la misma clave de fecha; p. ej. business_date=gte.D&business_date=lte.D).
  {
    const veces = new Map(); for (const k of url.searchParams.keys()) veces.set(k, (veces.get(k) || 0) + 1);
    for (const [k, n] of veces) {
      if (n === 1) continue;
      const ops = url.searchParams.getAll(k).map(v => (/^(gte|gt|lte|lt)\.[0-9T:.+\-Zz]{4,40}$/.exec(v) || [])[1]);
      const inferior = ops.filter(o => o === 'gte' || o === 'gt').length, superior = ops.filter(o => o === 'lte' || o === 'lt').length;
      if (!(['GET', 'HEAD'].includes(metodo) && RANGO_FECHA.has(k) && n === 2 && inferior === 1 && superior === 1)) return 'QUERY_REPETIDA';
    }
  }
  if (ruta === '/auth/v1/token') return [...url.searchParams].length === 1 && ['password','refresh_token'].includes(url.searchParams.get('grant_type')) ? null : 'QUERY_AUTH_NO_AUTORIZADA';
  if (ruta === '/auth/v1/logout') return url.search === '?scope=local' ? null : 'LOGOUT_GLOBAL_NO_AUTORIZADO';
  const lectura = ['GET','HEAD','OPTIONS'].includes(metodo);
  const permitidos = lectura ? PARAMETROS_LECTURA : PARAMETROS_ESCRITURA;
  for (const [k,v] of url.searchParams) {
    if (!permitidos.has(k)) return 'QUERY_NO_AUTORIZADA';
    if (!v || /[\r\n]/.test(v)) return 'QUERY_INVALIDA';
    if (k === 'select' && !lectura && !/^(\*|[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*)$/.test(v)) return 'SELECT_NO_AUTORIZADO';
    if (!lectura && k !== 'select' && k !== 'store_id' && !/^eq\.[a-zA-Z0-9_-]+$/.test(v)) return 'FILTRO_NO_EXACTO';
  }
  if ((forma === 'filtro' || forma === 'borrado_orden') && !url.searchParams.has('store_id')) return 'FILTRO_STORE_ID_AUSENTE';
  return null;
}

function alcanceEscritura(forma, url, body, fixtureStore, fixtureOrders) {
  const filtros = url.searchParams.getAll('store_id');
  if (filtros.some(f => f !== `eq.${fixtureStore}`)) return 'FILTRO_STORE_ID_DE_OTRO_LOCAL';
  if (forma === 'borrado_orden') { // DELETE open_orders: exactamente id=eq.<mesa de la prueba> y store_id=eq.<local sintético>; nunca un borrado por rango ni masivo
    const id = url.searchParams.get('id');
    if (filtros.length !== 1) return 'FILTRO_STORE_ID_AUSENTE';
    if (!/^eq\./.test(id || '') || !fixtureOrders?.has(id.slice(3))) return 'ORDEN_DESCONOCIDA';
    if ([...url.searchParams.keys()].some(k => k !== 'id' && k !== 'store_id')) return 'QUERY_NO_AUTORIZADA';
    if (body !== null && body !== undefined && body !== '') return 'CUERPO_NO_PERMITIDO';
    return null;
  }
  let b = null;
  if (body !== null && body !== undefined && body !== '') { try { b = jsonSinDuplicados(body); } catch (e) { return e.message === 'JSON_CLAVE_REPETIDA' ? e.message : 'CUERPO_NO_JSON'; } }
  const filas = Array.isArray(b) ? b : (b && typeof b === 'object' ? [b] : []);
  if (Array.isArray(b) && !b.length) return 'ARRAY_VACIO';
  if (filas.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return 'CUERPO_CON_FILAS_NO_OBJETO';
  const recorrer = (x, prof = 0) => {
    if (prof > 24) return false;
    if (!x || typeof x !== 'object') return true;
    if (Array.isArray(x)) return x.every(v => recorrer(v, prof + 1));
    for (const [k,v] of Object.entries(x)) {
      if ((k === 'store_id' || k === 'p_store') && v !== fixtureStore) return false;
      if (!recorrer(v, prof + 1)) return false;
    }
    return true;
  };
  if (!recorrer(b)) return 'CUERPO_CON_STORE_ID_DE_OTRO_LOCAL';
  if (forma === 'fila' && (!filas.length || filas.some(r => r.store_id !== fixtureStore))) return 'FILA_SIN_STORE_ID';
  if (forma === 'filtro' && !filtros.length) return 'FILTRO_STORE_ID_AUSENTE';
  if (forma === 'rpc' && (filas.length !== 1 || filas[0].p_store !== fixtureStore)) return 'RPC_SIN_P_STORE';
  if (forma === 'orden' && (filas.length !== 1 || !fixtureOrders?.has(filas[0].p_open_order_id))) return 'ORDEN_DESCONOCIDA';
  if (forma !== 'filtro' && !filas.length) return 'CUERPO_FALTANTE';
  return null;
}

function storeOfWrite(url, body) {
  const q = url.searchParams.get('store_id');
  if (q?.startsWith('eq.')) return q.slice(3);
  try { const b = JSON.parse(body || 'null'), filas = Array.isArray(b) ? b : [b], ids = new Set(filas.map(r => r?.store_id || r?.p_store).filter(Boolean)); return ids.size === 1 ? [...ids][0] : null; } catch (_) { return null; }
}

function decidirAccesoStaging({method, url, headers = {}, body = null, mode, fixtureStore, fixtureOrders, origin = STAGING_ORIGIN}) {
  let u; try { u = url instanceof URL ? url : new URL(url); } catch (_) { return violacion('URL_INVALIDA'); }
  if (u.origin !== origin || u.username || u.password || u.hash) return violacion('ORIGEN_NO_AUTORIZADO');
  const m = String(method || '');
  if (!/^(GET|HEAD|OPTIONS|POST|PATCH|DELETE)$/.test(m)) return violacion('METODO_NO_AUTORIZADO');
  const ruta = u.pathname;
  if (ruta.includes('%') || ruta.includes('//') || ruta.endsWith('/')) return violacion('RUTA_NO_CANONICA');
  const h = cabecerasValidas(headers, m, ruta);
  if (h) return violacion(h);
  if (Object.keys(headers).some(k => /^(x-http-method|x-http-method-override|x-method-override)$/i.test(k))) return violacion('OVERRIDE_METODO');
  if (ruta.startsWith('/auth/v1/')) {
    if (m === 'POST' && (ruta === '/auth/v1/token' || ruta === '/auth/v1/logout')) {
      const q = queryValida(u,m,ruta); if (q) return violacion(q);
      if (ruta === '/auth/v1/logout') return body === null || body === undefined || body === '' ? {accion:'PERMITIR'} : violacion('CUERPO_LOGOUT_NO_AUTORIZADO');
      let b; try { b = jsonSinDuplicados(body); } catch (e) { return violacion(e.message === 'JSON_CLAVE_REPETIDA' ? e.message : 'CUERPO_AUTH_NO_JSON'); }
      if (!b || typeof b !== 'object' || Array.isArray(b)) return violacion('CUERPO_AUTH_INVALIDO');
      const grant = u.searchParams.get('grant_type'), keys = Object.keys(b).sort().join(',');
      if (grant === 'password' && keys === 'email,gotrue_meta_security,password' && typeof b.email === 'string' && b.email.length > 0 && typeof b.password === 'string' && b.password.length > 0 && b.gotrue_meta_security && typeof b.gotrue_meta_security === 'object' && !Array.isArray(b.gotrue_meta_security) && Object.keys(b.gotrue_meta_security).length === 0) return {accion:'PERMITIR'};
      if (grant === 'refresh_token' && keys === 'refresh_token' && typeof b.refresh_token === 'string' && b.refresh_token.length > 0) return {accion:'PERMITIR'};
      return violacion('CUERPO_AUTH_FUERA_DE_CONTRATO');
    }
    if (['GET','HEAD','OPTIONS'].includes(m) && ruta === '/auth/v1/user' && !u.search) return {accion:'PERMITIR'};
    return violacion('AUTH_NO_AUTORIZADO');
  }
  if (ruta.startsWith('/realtime/v1/')) return ['GET','HEAD','OPTIONS'].includes(m) && !u.search ? {accion:'PERMITIR'} : violacion('REALTIME_NO_AUTORIZADO');
  if (!ruta.startsWith('/rest/v1/')) return violacion('RUTA_NO_AUTORIZADA');
  const recurso = ruta.slice('/rest/v1/'.length), clave = `${m} ${recurso}`;
  if (u.searchParams.has('on_conflict')) return violacion('ON_CONFLICT_PROHIBIDO');
  if (m === 'PATCH' && (body === null || body === undefined || body === '')) return violacion('CUERPO_FALTANTE');
  if (['GET','HEAD','OPTIONS'].includes(m)) {
    if (!TABLAS_LECTURA.has(recurso)) return violacion('LECTURA_NO_AUTORIZADA');
    const q = queryValida(u,m,ruta); return q ? violacion(q) : {accion:'PERMITIR'};
  }
  if (DENEGADAS_REGISTRADAS.has(clave)) {
    if (mode !== 'fixture' || fixtureStore !== FIXTURE_STORE || !IDENTIDAD_FIXTURE.test(fixtureStore)) return violacion('FIXTURE_NO_AUTORIZADA');
    const formaDenegada = m === 'POST' ? 'fila' : 'filtro';
    const qDenegada = queryValida(u,m,ruta,formaDenegada);
    if (qDenegada) return violacion(qDenegada);
    const alcanceDenegado = alcanceEscritura(formaDenegada,u,body,fixtureStore,fixtureOrders);
    return alcanceDenegado ? violacion(alcanceDenegado) : {accion:'DENEGAR_REGISTRADA', razon:'ESCRITURA_DE_SONDA_O_RESERVA_BLOQUEADA'};
  }
  const forma = ESCRITURAS_REST[clave];
  if (!forma) return violacion('ESCRITURA_NO_AUTORIZADA');
  if (mode !== 'fixture' || fixtureStore !== FIXTURE_STORE || !IDENTIDAD_FIXTURE.test(fixtureStore)) return violacion('FIXTURE_NO_AUTORIZADA');
  const q = queryValida(u,m,ruta,forma);
  if (q) return violacion(q);
  const alcance = alcanceEscritura(forma,u,body,fixtureStore,fixtureOrders);
  return alcance ? violacion(alcance) : {accion:'PERMITIR'};
}
// El cuerpo NUNCA se persiste. La política solo lee: forma de la raíz, filas (objetos), el store_id de cada fila y el valor de toda clave store_id/p_store
// a cualquier profundidad (tope 24). Se registra solo eso, con valores UUID estrictos; cualquier otro valor se reduce al marcador NO_UUID, y los nombres y
// valores de los demás campos (tokens, contraseñas, datos de negocio) no se conservan. Si no se puede proyectar con seguridad: error cerrado, sin valores.
const UUID_AUDITADO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valorLocal = v => typeof v === 'string' && UUID_AUDITADO.test(v) ? v : 'NO_UUID';
const MAX_CLAVES_LOCAL = 1000;
function proyectarCuerpo(body) {
  let b; try { b = jsonSinDuplicados(body); } catch (e) { throw new Error(/^JSON_[A-Z_]+$/.test(e.message) ? `CUERPO_NO_REPRESENTABLE:${e.message}` : 'CUERPO_NO_REPRESENTABLE'); }
  const claves = [];
  const recorrer = (x, prof) => {
    if (prof > 24) throw new Error('CUERPO_NO_REPRESENTABLE:PROFUNDIDAD');
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(v => recorrer(v, prof + 1)); return; }
    for (const [k,v] of Object.entries(x)) {
      if (k === 'store_id' || k === 'p_store') { claves.push(valorLocal(v)); if (claves.length > MAX_CLAVES_LOCAL) throw new Error('CUERPO_NO_REPRESENTABLE:DEMASIADAS_CLAVES'); }
      recorrer(v, prof + 1);
    }
  };
  recorrer(b, 0);
  const raiz = Array.isArray(b) ? 'arreglo' : (b && typeof b === 'object' ? 'objeto' : 'otro');
  const filas = (raiz === 'arreglo' ? b : raiz === 'objeto' ? [b] : []).map(r => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('CUERPO_NO_REPRESENTABLE:FILA_NO_OBJETO');
    return Object.hasOwn(r, 'store_id') ? {store_id:valorLocal(r.store_id)} : {};
  });
  return {raiz, filas, claves_local:claves};
}
// Cuerpo equivalente para la política (mismas decisiones), construido solo con la proyección. Falla cerrado si la proyección es ambigua.
function reconstruirCuerpo(c) {
  const invalido = () => { throw new Error('CUERPO_AUDITADO_INVALIDO'); };
  const ok = v => typeof v === 'string' && (v === 'NO_UUID' || UUID_AUDITADO.test(v));
  if (c === null) return null;
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).sort().join() !== 'claves_local,filas,raiz') invalido();
  if (!['objeto','arreglo','otro'].includes(c.raiz) || !Array.isArray(c.filas) || !Array.isArray(c.claves_local) || c.claves_local.length > MAX_CLAVES_LOCAL || !c.claves_local.every(ok)) invalido();
  if (c.filas.length > MAX_CLAVES_LOCAL || c.filas.some(r => !r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => k !== 'store_id') || (Object.hasOwn(r,'store_id') && !ok(r.store_id)))) invalido();
  if (c.raiz === 'otro') { if (c.filas.length || c.claves_local.length) invalido(); return 'null'; }
  if (c.raiz === 'objeto' && c.filas.length !== 1) invalido();
  if (c.raiz === 'arreglo' && !c.filas.length) invalido();
  const filas = c.filas.map(r => ({...r}));
  c.claves_local.forEach((v,i) => { filas[0][`n${i}`] = {p_store:v}; });
  return JSON.stringify(c.raiz === 'arreglo' ? filas : filas[0]);
}
// Entrada canónica y no secreta de la decisión. Cabeceras: los secretos van redactados (la política no inspecciona esos valores).
const CABECERAS_SECRETAS = /^(authorization|proxy-authorization|apikey|x-api-key|cookie|set-cookie)$/i;
function entradaAuditable({headers = {}, body = null, mode, fixtureStore}) {
  const h = {};
  for (const [k,v] of Object.entries(headers)) h[k.toLowerCase()] = CABECERAS_SECRETAS.test(k) ? '[REDACTED]' : String(v);
  return {mode, fixtureStore, headers:h, cuerpo:body === null || body === undefined ? null : proyectarCuerpo(body)};
}
module.exports = {entradaAuditable, reconstruirCuerpo, decidirAccesoStaging, alcanceEscritura, storeOfWrite, ESCRITURAS_REST, DENEGADAS_REGISTRADAS, IDENTIDAD_FIXTURE, FIXTURE_STORE, STAGING_ORIGIN};
