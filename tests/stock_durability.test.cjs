'use strict';

// Ejecuta las funciones reales de inventario de index.html contra un servidor simulado. No carga el HTML ni contacta a Supabase.
// El simulador reproduce el contrato de stock_durability.sql: esto prueba al cliente, NO garantiza nada de la migración.
// Por defecto el local está activado (modo servidor). active:false = migración aplicada sin activar; schema:false = sin migración.

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const repo = path.join(__dirname, '..');
const html = readFileSync(process.env.STOCK_INDEX || path.join(repo, 'index.html'), 'utf8');
const between = (start, end) => {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Bloque ausente: ${start}`);
  return html.slice(from, to);
};
const storeId = '11111111-1111-4111-8111-111111111111';
const otherStore = '99999999-9999-4999-8999-999999999999';
const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unlimitedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const catId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const origin = {store_id:storeId, user_id:'user_a', pendiente:true};

const code = [
  between('function productRefs(', 'function safeProductPrice('),
  between('let generacionContexto=0;', 'const claveContexto='),
  between('const ventaFilaPendiente=', 'const mesaPendiente='),
  between('const STOCK_OBS_MAX=', '// fin modelo stock'),
  between('function renderStockAlerts(){', '// ══════'),
  between('function adjProdStock(', 'function toggleProdIlimitado('),
  between('  const STOCK_SIN_ESQUEMA=', '  // fin foto stock'),
  between('  async function fetchCatalogSupabaseDiagnostics(', '  function buildCategoryMaps('),
  between('  function mapProductFromSupabase(', '  function mapProductToSupabase('),
  between('  function mapProductToSupabase(', '  function getFirstAvailableCategorySupabaseId('),
  between('  window.loadCatalogFromSupabase=async function', '  window.probeCatalogSupabaseRead='),
  between('  window.saveProductToSupabase=async function', '  window.deleteProductFromSupabase='),
  between('  window.saveProductStockToSupabase=async function', '  window.syncLocalCatalogToSupabase='),
  between('  const _setProdStock=window.setProdStock;', '  const _toggleProdIlimitado=')
].join('\n');

const ACTIVADO = '2026-01-01T00:00:00+00:00';
function createServer(stock = 10, {active = true, schema = true} = {}) {
  const db = {
    products:[
      {id:productId, store_id:storeId, name:'Medialuna', legacy_id:'prod_1', category_id:catId, price:100, stock, unlimited:false, active:true, variants:[], metadata:{}},
      {id:unlimitedId, store_id:storeId, name:'Cerveza', legacy_id:'prod_2', category_id:catId, price:100, stock:7, unlimited:true, active:true, variants:[], metadata:{}}
    ],
    sale_items:[],
    categories:[{id:catId, store_id:storeId, legacy_id:'c1', name:'Cat', color:'#000', section:'cafeteria', reservable:false, active:true}],
    stores:[{id:storeId, name:'Local'}],
    store_users:[{store_id:storeId, user_id:'user_a', role:'owner'}]
  };
  const server = {db, calls:[], beforeRead:null, afterPhoto:null, failProducts:null, noEmbed:false, rlsDeniesWrite:false, failWrite:null,
    active, schema, failActivation:null, beforeActivation:null,
    // Contrato de la migración: una fila por identidad, el descuento en la misma operación y sin descuento en ilimitados.
    // late: la clasificación del corte la decide el servidor; acá se indica el resultado para probar al cliente.
    insertItem(legacy_id, product_id, quantity, {late = false, reason} = {}) {
      if (db.sale_items.some(i => i.legacy_id === legacy_id)) return {error:{code:'23505'}};
      db.sale_items.push({store_id:storeId, legacy_id, product_id, quantity, product_name:'P', stock_applied_reason:reason || (server.active ? 'applied' : 'inactive'), stock_applied_at:'2026-11-01T00:00:00Z'});
      const p = db.products.find(x => x.id === product_id && x.store_id === storeId);
      if (server.active && !late && !reason && p && !p.unlimited) p.stock -= quantity;
      return {error:null};
    },
    writes() { return server.calls.filter(c => c.op !== 'select'); },
    client:{async rpc(name, args) {
      server.calls.push({op:'rpc', name, args:structuredClone(args)});
      if (!server.schema) return {data:null, error:{code:'PGRST202', message:'sin función'}};
      if (server.failWrite) return {data:null, error:server.failWrite};
      if (server.rlsDeniesWrite) return {data:null, error:{code:'42501', message:'STOCK_FORBIDDEN'}};
      if (!server.active) return {data:{ok:false, code:'inactive'}, error:null};
      const p = db.products.find(x => x.id === args.p_product && x.store_id === args.p_store);
      if (!p) return {data:{ok:false, code:'not_found'}, error:null};
      if (p.stock !== args.p_expected) return {data:{ok:false, code:'conflict', stock:p.stock}, error:null};
      p.stock = args.p_kind === 'count' ? args.p_value : p.stock + args.p_value;
      if (args.p_kind === 'count') p.stock_counted_at = new Date().toISOString();
      return {data:{ok:true, stock:p.stock, counted_at:p.stock_counted_at || null}, error:null};
    }, from(table) {
      let op = 'select', payload = null, cols = '', filters = [], embed = null;
      const q = {
        select(c) { if (op === 'select') cols = c || ''; return q; },
        eq(k, v) { filters.push([k, v]); return q; },
        in(k, v) { if (k.startsWith('sale_items.')) embed = v; else filters.push([k, v, 'in']); return q; },
        order() { return q; },
        gte() { return q; },
        limit() { return q; },
        update(v) { op = 'update'; payload = v; return q; },
        insert(v) { op = 'insert'; payload = v; return q; },
        maybeSingle() { return run(true); },
        single() { return run(true); },
        then(ok, no) { return run(false).then(ok, no); }
      };
      async function run(single) {
        server.calls.push({table, op, cols, payload:payload && structuredClone(payload), filters:structuredClone(filters), embed});
        if (op === 'select' && table === 'products') { const hook = server.beforeRead; server.beforeRead = null; await hook?.(); }
        const match = row => filters.every(([k, v, how]) => how === 'in' ? v.includes(row[k]) : String(row[k]) === String(v));
        if (table === 'stock_store_activation') {
          const hook = server.beforeActivation; server.beforeActivation = null; await hook?.();
          if (server.failActivation) return {data:null, error:server.failActivation};
          if (!server.schema) return {data:null, error:{code:'PGRST205', message:'sin tabla'}};
          return {data:server.active ? {activated_at:ACTIVADO} : null, error:null};
        }
        if (op === 'select' && !server.schema && cols.includes('stock_counted_at')) return {data:null, error:{code:'42703', message:'sin columna'}};
        if (op === 'select') {
          if (table === 'products' && server.failProducts) return {data:null, error:server.failProducts};
          if (table === 'products' && server.noEmbed && cols.includes('sale_items(')) return {data:null, error:{code:'PGRST200', message:'sin relación'}};
          let found = (db[table] || []).filter(match).map(r => structuredClone(r));
          if (table === 'products' && cols.includes('sale_items(')) {
            found = found.map(p => ({...p, sale_items:db.sale_items.filter(i => i.product_id === p.id && embed.includes(i.legacy_id)).map(i => ({legacy_id:i.legacy_id}))}));
          }
          if (table === 'products') { const hook = server.afterPhoto; server.afterPhoto = null; await hook?.(); }
          return {data:single ? (found[0] || null) : found, error:null};
        }
        if (server.failWrite) return {data:null, error:server.failWrite};
        if (op === 'update' && table === 'products' && server.active && 'stock' in payload && db.products.some(r => match(r) && r.stock !== payload.stock)) {
          return {data:null, error:{code:'P0001', message:'STOCK_DIRECT_WRITE: el stock de este local lo gestiona el servidor'}};
        }
        if (op === 'update') {
          const found = server.rlsDeniesWrite ? [] : db[table].filter(match);
          found.forEach(r => Object.assign(r, payload));
          return {data:single ? (found[0] || null) : found.map(r => structuredClone(r)), error:null};
        }
        const row = {id:`new_${db[table].length}`, ...payload};
        db[table].push(row);
        return {data:row, error:null};
      }
      return q;
    }}
  };
  return server;
}

function load(server, {ventas = [], ilimitadoMenu = false, modo} = {}) {
  const storage = new Map(), toasts = [];
  const ctx = {console:{warn() {}, error() {}, log() {}, info() {}}, setTimeout, Promise, structuredClone, Map, Set};
  ctx.window = ctx;
  ctx.localStorage = {setItem(k, v) { storage.set(k, v); }, getItem(k) { return storage.get(k) ?? null; }};
  ctx.document = {activeElement:null};
  ctx.__state = {uid:'user_a', store:storeId, ventas, saves:0, toasts, storage, confirmOk:true, confirms:[]};
  ctx.confirm = text => { ctx.__state.confirms.push(text); return ctx.__state.confirmOk; };
  // Como un dispositivo que ya leyó el modo antes: el activado arranca en servidor, salvo que el test pida lo contrario.
  if (modo === 'servidor' || (modo === undefined && server.active && server.schema)) {
    storage.set(`stock_modo:${storeId}`, JSON.stringify({modo:'servidor', activado:ACTIVADO}));
  }
  ctx.__sesionUserId = () => ctx.__state.uid;
  vm.createContext(ctx);
  const prelude = `
    var config={get activeStoreId(){return __state.store;}};
    let ventas=__state.ventas;
    let menu=[{id:'prod_1',_sb_id:'${productId}',legacy_id:'prod_1',name:'Medialuna',price:100,cat:'c1',stock:${Number(server.db.products[0].stock)},ilimitado:${ilimitadoMenu},variantes:[]},
      {id:'prod_2',_sb_id:'${unlimitedId}',legacy_id:'prod_2',name:'Cerveza',price:100,cat:'c1',stock:7,ilimitado:true,variantes:[]}];
    let cats=[{id:'c1',_sb_id:'${catId}',legacy_id:'c1',name:'Cat'}];
    let catalogLoadState='local',catalogLoadError='',catalogLoadSeq=0,catalogCurrentStoreName='',catalogCurrentRole='owner',catalogSupabaseCounts={},catalogWarnings=[],catalogLastProbeAt='';
    const APP_VERSION='t',APP_DATA_VERSION='t',APP_DATA_VERSION_KEY='v',CATALOG_BACKUP_KEY='b';
    function $(id){return __state.elements?.[id]||null;}
    function normalizeOperatorName(v){return String(v||'');}
    function sameId(a,b){return String(a)===String(b);}
    function save(){__state.saves++;if(!__state.saveFails)localStorage.setItem('menu',JSON.stringify(menu));}
    function leerLS(k){return localStorage.getItem(k);}
    function safeJsonParse(raw,fallback){try{return JSON.parse(raw);}catch(_){return fallback;}}
    function showToast(t){__state.toasts.push(t);}
    function escapeHtml(v){return String(v);}
    function renderProdGrid(){} function renderMenuAdm(){} function syncMenuSheets(){}
    function isValidUuid(v){return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(v));}
    function normalizeLegacyFrontId(v){return v;}
    function hasCatalogSupabaseReady(){return true;}
    function getCatalogStoreId(){return config.activeStoreId;}
    function getCatalogConfig(){return {supabaseUrl:'u',supabaseAnonKey:'k',activeStoreId:config.activeStoreId};}
    function getCatalogSupabaseClient(){return __client;}
    async function getCatalogSession(){return __state.uid?{user:{id:__state.uid}}:null;}
    function catalogCanTechLog(){return false;}
    function setCatalogLoadState(s,m){__state.loadState=s;__state.loadError=m;}
    function updateCatalogBootState(){}
    function refreshCatalogUi(){}
    function withCatalogTimeout(p){return p;}
    function stampCatalogMoment(){return 'ahora';}
    function warnSupabaseCatalogFailure(_kind,err){__state.lastError=err;}
    async function getCatalogWriteContext(){return {client:__client,storeId:config.activeStoreId,role:'owner'};}
    async function queryStoreCategories(client,store){return (await client.from('categories').select('*').eq('store_id',store)).data;}
    async function queryStoreProducts(client,store){return (await client.from('products').select('*').eq('store_id',store)).data;}
    function buildCategoryMaps(rows){return {mapped:rows.map(r=>({...r,_sb_id:r.id,id:r.legacy_id})),categoryBySupabaseId:{'${catId}':'c1'},categoryByLegacyId:{},fallbackCatId:'c1'};}
    async function findExistingProductRow(client,store,p){return __server.db.products.find(x=>x.id===p._sb_id||x.legacy_id===p.legacy_id)||null;}
    function logCatalogSupabaseWriteError(){}
  `;
  ctx.__client = server.client;
  ctx.__server = server;
  const wrappers = `
    (function(){
      const originals={setProdStock,adjProdStock};
      window.setProdStock=originals.setProdStock;window.adjProdStock=originals.adjProdStock;
    })();`;
  const parts = code.split('  const _setProdStock=window.setProdStock;');
  const api = `
    globalThis.__api={stockInfo,stockStatus,stockFilasPorObservar,renderStockAlerts,stockServidor,stockCorte,stockDescontarEnDispositivo,stockFilaAntesDelCorte,
      getMenu:()=>menu,getVentas:()=>ventas,setVentas:v=>{ventas=v;},bumpContexto:()=>{generacionContexto++;}};`;
  vm.runInContext(`${prelude}\n${parts[0]}\n${wrappers}\n  const _setProdStock=window.setProdStock;${parts[1]}\n${api}`, ctx, {filename:'stock.js', timeout:2000});
  ctx.__state.elements = {'stock-alerts':{innerHTML:''}};
  return {ctx, api:ctx.__api, state:ctx.__state};
}

const row = (id, extra = {}) => ({id, ticket_id:'t', prodId:'prod_1', _product_sb_id:productId, cantidad:2, _stock_pending:true, timestamp:'2026-06-01T12:00:00.000Z',
  _sb_sync_status:'pending', _sb_sale_id:null, _origin:{...origin}, ...extra});
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const product = api => api.getMenu().find(p => p.id === 'prod_1');
const refresh = ctx => ctx.refreshStockFromSupabase();

test('saldo negativo: disponibilidad 0, discrepancia visible y sin valores negativos a la vista', () => {
  const {api, state} = load(createServer(-3));
  const info = api.stockInfo(product(api));
  assert.equal(info.confirmado, -3);
  assert.equal(info.teorico, -3);
  assert.equal(info.disponible, 0);
  assert.equal(info.discrepancia, 3);
  assert.equal(api.stockStatus(product(api)), 'out');
  api.renderStockAlerts();
  const banner = state.elements['stock-alerts'].innerHTML;
  assert.match(banner, /Discrepancia de stock, hay que conciliar: Medialuna \(faltan 3/);
  assert.doesNotMatch(banner, /-3/);
});

test('stock negativo no bloquea la venta: la regla de cafetería sigue intacta', () => {
  const addItem = between('function addItem(id){', 'function ');
  assert.match(addItem, /stock 0 no bloquea venta/);
  assert.doesNotMatch(addItem, /stockInfo|return;\s*\/\/ *stock/);
});

test('ilimitado: una venta no cuenta como pendiente ni crea discrepancia', () => {
  const {api} = load(createServer(), {ventas:[row('v1', {prodId:'prod_2', _product_sb_id:unlimitedId, cantidad:50})]});
  const p = api.getMenu().find(x => x.id === 'prod_2'), info = api.stockInfo(p);
  assert.deepEqual([info.pendiente, info.discrepancia, info.teorico, info.estimado], [0, 0, 7, false]);
  assert.equal(api.stockStatus(p), 'ok');
});

test('venta parcial con respuesta perdida: el ítem ya descontado no se resta otra vez (8, no 6)', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1', {_sb_sync_status:'partial_error', _sb_sale_id:'s1'})]});
  server.insertItem('v1', productId, 2);
  assert.equal(await refresh(ctx), true);
  const info = api.stockInfo(product(api));
  assert.deepEqual([info.confirmado, info.pendiente, info.teorico, info.estimado], [8, 0, 8, false]);
  assert.equal(api.getVentas()[0]._stock_pending, false);
});

test('venta ya persistida pero localmente pendiente: se reconoce por el ítem, no por el estado', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1')]});
  server.insertItem('v1', productId, 2);
  await refresh(ctx);
  assert.equal(api.getVentas()[0]._sb_sync_status, 'pending');
  assert.equal(api.stockInfo(product(api)).teorico, 8);
});

test('venta realmente pendiente: descuento provisional, marcado como estimado, hasta confirmarse', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1', {_sb_sync_status:'error'})]});
  await refresh(ctx);
  let info = api.stockInfo(product(api));
  assert.deepEqual([info.confirmado, info.pendiente, info.teorico, info.estimado], [10, 2, 8, true]);
  server.insertItem('v1', productId, 2);
  await refresh(ctx);
  info = api.stockInfo(product(api));
  assert.deepEqual([info.confirmado, info.pendiente, info.teorico, info.estimado], [8, 0, 8, false]);
});

test('venta offline: sin lectura posible el saldo queda estimado y conserva el descuento', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1')]});
  await refresh(ctx);
  server.failProducts = {message:'sin red'};
  api.getVentas().push(row('v2', {cantidad:1}));
  assert.equal(await refresh(ctx), false);
  const info = api.stockInfo(product(api));
  assert.deepEqual([info.teorico, info.estimado], [7, true]);
});

test('dos ítems del mismo producto: cada uno se observa por su identidad', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1', {cantidad:2}), row('v2', {cantidad:1})]});
  assert.equal(api.stockInfo(product(api)).teorico, 7);
  server.insertItem('v1', productId, 2); // solo llegó uno
  await refresh(ctx);
  let info = api.stockInfo(product(api));
  assert.deepEqual([info.confirmado, info.pendiente, info.teorico, info.estimado], [8, 1, 7, true]);
  server.insertItem('v2', productId, 1);
  await refresh(ctx);
  info = api.stockInfo(product(api));
  assert.deepEqual([info.confirmado, info.pendiente, info.teorico, info.estimado], [7, 0, 7, false]);
});

test('duplicación y reintentos: repetir el envío y las lecturas no cambia el saldo', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1')]});
  assert.equal(server.insertItem('v1', productId, 2).error, null);
  assert.equal(server.insertItem('v1', productId, 2).error.code, '23505');
  for (let i = 0; i < 3; i++) await refresh(ctx);
  assert.equal(server.db.products[0].stock, 8);
  assert.equal(api.stockInfo(product(api)).teorico, 8);
});

test('una venta que llega después de la lectura sigue restándose hasta la lectura siguiente', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1')]});
  server.afterPhoto = () => { server.insertItem('v1', productId, 2); }; // la foto ya se tomó con 10 y sin el ítem
  await refresh(ctx);
  assert.equal(server.db.products[0].stock, 8);
  assert.equal(product(api).stock, 10);
  api.getVentas()[0]._sb_sync_status = 'synced'; // el estado local no alcanza para dejar de restar
  api.getVentas()[0]._sb_sale_id = 's1';
  ctx.__api.setVentas([...api.getVentas()]);
  let info = api.stockInfo(product(api));
  assert.deepEqual([info.teorico, info.estimado], [8, true]);
  await refresh(ctx);
  info = api.stockInfo(product(api));
  assert.deepEqual([info.confirmado, info.pendiente, info.estimado], [8, 0, false]);
});

test('ítem sin producto de este local: no movió stock y no queda restando para siempre', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1', {_sb_sync_status:'synced', _sb_sale_id:'s1'})]});
  server.insertItem('v1', null, 2);
  await refresh(ctx);
  const info = api.stockInfo(product(api));
  assert.deepEqual([info.confirmado, info.pendiente, info.teorico], [10, 0, 10]);
});

test('sin relación en el esquema o sobre el tope: el saldo se informa como estimado', async () => {
  const noRel = createServer(), a = load(noRel, {ventas:[row('v1')]});
  noRel.noEmbed = true;
  assert.equal(await refresh(a.ctx), true);
  assert.deepEqual([a.api.stockInfo(product(a.api)).teorico, a.api.stockInfo(product(a.api)).estimado], [8, true]);
  const many = Array.from({length:101}, (_, i) => row(`v${i}`, {cantidad:1}));
  const over = createServer(200), b = load(over, {ventas:many});
  assert.equal(b.api.stockFilasPorObservar().ids.length, 100);
  assert.equal(b.api.stockFilasPorObservar().truncada, true);
});

test('F0-B: otra cuenta, otro local o cuarentena no cuentan ni se observan', () => {
  const {api} = load(createServer(), {ventas:[
    row('a', {_origin:{...origin, user_id:'user_b'}}),
    row('b', {_origin:{...origin, store_id:otherStore}}),
    row('c', {_origin:{legacy:true, pendiente:true}}),
    row('d', {_origin:{sin_contexto:true, pendiente:true}})
  ]});
  assert.equal(api.stockInfo(product(api)).pendiente, 0);
  assert.equal(api.stockFilasPorObservar().ids.length, 0);
});

test('F0-B: cambio de contexto durante la lectura de stock no toca memoria, filas ni almacenamiento', async () => {
  const server = createServer(), {ctx, api, state} = load(server, {ventas:[row('v1')]});
  server.insertItem('v1', productId, 2);
  server.beforeRead = () => { api.bumpContexto(); };
  const saves = state.saves;
  assert.equal(await refresh(ctx), false);
  assert.equal(product(api).stock, 10);
  assert.equal(api.getVentas()[0]._stock_pending, true);
  assert.equal(state.saves, saves);
});

test('F0-B: cambio de contexto durante la carga del catálogo no reemplaza el menú ni escribe', async () => {
  const server = createServer(), {ctx, api, state} = load(server, {ventas:[row('v1')]});
  server.insertItem('v1', productId, 2);
  server.beforeRead = () => { api.bumpContexto(); };
  assert.equal(await ctx.loadCatalogFromSupabase({silent:true}), false);
  assert.equal(product(api).stock, 10);
  assert.equal(state.storage.has('menu'), false);
  assert.equal(api.getVentas()[0]._stock_pending, true);
  assert.equal(state.loadState, 'local');
});

test('la carga del catálogo aplica saldo y observación en la misma lectura', async () => {
  const server = createServer(), {ctx, api, state} = load(server, {ventas:[row('v1')]});
  server.insertItem('v1', productId, 2);
  assert.equal(await ctx.loadCatalogFromSupabase({silent:true}), true, String(state.loadError));
  assert.equal(api.stockInfo(product(api)).teorico, 8);
  assert.equal(api.stockInfo(product(api)).estimado, false);
  assert.equal(state.loadState, 'supabase');
  assert.equal(server.calls.filter(c => c.table === 'products' && c.cols.includes('sale_items(legacy_id)')).length, 1);
});

test('editar nombre o precio no escribe stock; un producto nuevo sí lo inicializa', async () => {
  const server = createServer(), {ctx, api} = load(server);
  server.db.products[0].stock = 4; // otro dispositivo vendió: el local está viejo
  await ctx.saveProductToSupabase({...product(api), name:'Otro nombre'}, {categoryRows:[{id:'c1', _sb_id:catId}]});
  const update = server.writes().find(c => c.op === 'update');
  assert.equal('stock' in update.payload, false);
  assert.equal(server.db.products[0].stock, 4);
  assert.equal(server.db.products[0].name, 'Otro nombre');
  await ctx.saveProductToSupabase({id:'prod_9', name:'Nuevo', price:1, cat:'c1', stock:5, ilimitado:false}, {categoryRows:[{id:'c1', _sb_id:catId}]});
  assert.equal(server.writes().find(c => c.op === 'insert').payload.stock, 5);
});

test('modo servidor: el ajuste va por la función del servidor, sin UPDATE directo, y compara contra el saldo leído', async () => {
  const server = createServer(), {ctx, api} = load(server), p = product(api);
  p.stock = 12;
  assert.equal(await ctx.saveProductStockToSupabase(p, {expected:10}), true);
  assert.equal(server.db.products[0].stock, 12);
  const [call] = server.writes();
  assert.deepEqual([call.op, call.name, call.args.p_kind, call.args.p_expected, call.args.p_value], ['rpc', 'stock_apply_adjustment', 'count', 10, 12]);
  assert.equal(server.calls.some(c => c.op === 'update'), false);
});

test('ajuste concurrente: una venta en el medio no se sobrescribe', async () => {
  const server = createServer(), {ctx, api} = load(server), p = product(api);
  server.insertItem('v_otro', productId, 3);
  p.stock = 12;
  await assert.rejects(ctx.saveProductStockToSupabase(p, {expected:10}), err => err.code === 'STOCK_CONFLICT' && err.currentStock === 7);
  assert.equal(server.db.products[0].stock, 7);
});

test('RLS que filtra el ajuste sin error se informa: no se da por guardado', async () => {
  const server = createServer(), {ctx, api} = load(server), p = product(api);
  server.rlsDeniesWrite = true;
  p.stock = 12;
  await assert.rejects(ctx.saveProductStockToSupabase(p, {expected:10}), err => err.code === 'STOCK_NOT_UPDATED');
});

test('cambiar ilimitado no escribe el saldo', async () => {
  const server = createServer(), {ctx, api} = load(server), p = product(api);
  p.ilimitado = true;
  await ctx.saveProductStockToSupabase(p);
  assert.deepEqual(server.writes()[0].payload, {unlimited:true});
});

test('ajuste ± no recorta: de -3 con +1 queda -2', async () => {
  const server = createServer(-3), {ctx, api} = load(server);
  ctx.adjProdStock('prod_1', 1);
  await flush();
  assert.equal(product(api).stock, -2);
  assert.equal(server.db.products[0].stock, -2);
});

test('ajustes rápidos salen en orden, cada uno sobre el anterior', async () => {
  const server = createServer(), {ctx, api} = load(server);
  ctx.adjProdStock('prod_1', 1); ctx.adjProdStock('prod_1', 1); ctx.adjProdStock('prod_1', 1);
  await flush();
  assert.equal(server.db.products[0].stock, 13);
  assert.equal(product(api).stock, 13);
});

test('A: un conteo con ventas pendientes fija lo contado; esas ventas ya no lo descuentan, ni acá ni en el servidor', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1')]});
  assert.equal(api.stockInfo(product(api)).teorico, 8);
  ctx.setProdStock('prod_1', '20');
  await flush();
  assert.equal(api.stockInfo(product(api)).teorico, 20);
  assert.equal(server.db.products[0].stock, 20);
  server.insertItem('v1', productId, 2, {late:true}); // llega tarde: el servidor la clasifica como anterior al conteo
  await refresh(ctx);
  assert.equal(api.stockInfo(product(api)).teorico, 20);
  assert.equal(api.stockInfo(product(api)).estimado, false);
});

test('fijar el mismo valor o dejar el campo vacío no escribe', async () => {
  const server = createServer(-3), {ctx} = load(server);
  ctx.setProdStock('prod_1', '-3'); // onblur después de onchange, con discrepancia a la vista
  ctx.setProdStock('prod_1', '');
  await flush();
  assert.deepEqual(server.writes(), []);
});

test('un ajuste que no se confirma se revierte: no quedan unidades sin respaldo a la vista', async () => {
  const conflict = createServer(), a = load(conflict);
  conflict.insertItem('v_otro', productId, 3);
  a.ctx.adjProdStock('prod_1', 1);
  await flush();
  assert.equal(product(a.api).stock, 7);
  assert.equal(a.state.lastError.code, 'STOCK_CONFLICT');
  const network = createServer(), b = load(network);
  network.failWrite = {message:'sin red'};
  b.ctx.adjProdStock('prod_1', 1);
  await flush();
  assert.equal(product(b.api).stock, 10);
});

test('el cobro no muta stock: la fila guardada es el descuento provisional', () => {
  const cobro = between('      ventaLocalCreada=true;', '      let salesSync=null;');
  assert.doesNotMatch(cobro, /\.stock\s*=/);
  assert.match(between('      const ventasIdsAntes=', '      ventaLocalCreada=true;'), /ventas\.push\(\.\.\.nuevas\)/);
  assert.match(html, /_sb_retry_count:0,_stock_pending:stockServidor\(\),_stock_cut_seen:stockServidor\(\)\?stockCorte\(p\):'',/);
  assert.match(between('      ventaLocalCreada=true;', '      let salesSync=null;'), /ventaPendiente\.length\?'':stockDescontarEnDispositivo\(items\)/);
  assert.doesNotMatch(between('window.debugCatalogWritePermissions=', 'const {error:updateProductError}'), /stock:firstProduct/);
});

test('migración, revisión de texto: el descuento no corre antes de que la fila exista (no reemplaza su ejecución)', () => {
  const sql = readFileSync(path.join(repo, 'stock_durability.sql'), 'utf8');
  const fn = name => { const m = sql.match(new RegExp(`function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`)); assert.ok(m, name); return m[0]; };
  assert.doesNotMatch(fn('sale_items_stock_prepare'), /\b(update|insert into|delete from)\b/i);
  assert.match(fn('sale_items_stock_apply'), /set stock = stock - new\.quantity/);
  assert.match(sql, /create trigger sale_items_stock_prepare before insert on public\.sale_items/);
  assert.match(sql, /create trigger sale_items_stock_apply after insert on public\.sale_items/);
  assert.doesNotMatch(fn('sale_items_stock_apply'), /new\.stock_applied_qty\s*:=/);
  assert.doesNotMatch(fn('sale_items_stock_apply'), /greatest\s*\(\s*(stock|v_stock)/i);
  assert.match(fn('sale_items_stock_compensate'), /stock = stock \+ old\.stock_applied_qty/);
  assert.doesNotMatch(fn('sale_items_stock_compensate'), /old\.quantity|public\.sales/);
  assert.doesNotMatch(fn('products_stock_guard'), /security definer/i);
  assert.match(fn('sale_items_stock_prepare'), /security definer/i);
  assert.doesNotMatch(sql, /alter table public\.(products|sale_items|sales) (enable|force)|policy[^;]* on public\.(products|sale_items|sales)\b/i);
  const rollback = readFileSync(path.join(repo, 'stock_durability_rollback.sql'), 'utf8');
  assert.doesNotMatch(rollback, /update public\.products|set stock/i);
  assert.doesNotMatch(rollback.replace(/^--.*$/gm, ''), /not valid/i);
});

test('sin migración: el cliente no pide columnas que no existen y funciona en modo local', async () => {
  const server = createServer(10, {schema:false, active:false}), {ctx, api, state} = load(server);
  assert.equal(await ctx.loadCatalogFromSupabase({silent:true}), true, String(state.loadError));
  assert.equal(api.stockServidor(), false);
  assert.equal(server.calls.some(c => String(c.cols).includes('stock_counted_at')), false);
  assert.equal(server.calls.some(c => c.table === 'sale_items'), false);
  assert.equal(state.storage.get(`stock_modo:${storeId}`), JSON.stringify({modo:'local', activado:''}));
});

test('modo local: el cobro descuenta en el dispositivo como siempre, con clamp; una lectura no lo pisa', async () => {
  const server = createServer(3, {active:false}), {ctx, api} = load(server, {ventas:[row('v1', {_stock_pending:false})]});
  assert.equal(api.stockServidor(), false);
  assert.equal(api.stockDescontarEnDispositivo([{prodId:'prod_1', qty:2}, {prodId:'prod_2', qty:9}]), '');
  assert.equal(product(api).stock, 1);
  assert.equal(api.getMenu().find(p => p.id === 'prod_2').stock, 7);
  assert.equal(api.stockDescontarEnDispositivo([{prodId:'prod_1', qty:5}]), '');
  assert.equal(product(api).stock, 0);
  assert.equal(await refresh(ctx), false);
  assert.equal(product(api).stock, 0);
  assert.equal(server.calls.some(c => c.table === 'products'), false, 'ni siquiera lee el saldo');
  const info = api.stockInfo(product(api));
  assert.deepEqual([info.pendiente, info.estimado], [0, false]);
});

test('modo local: si el stock no se pudo guardar en el dispositivo, el cobro avisa', () => {
  const {api, state} = load(createServer(3, {active:false}));
  state.saveFails = true;
  assert.match(api.stockDescontarEnDispositivo([{prodId:'prod_1', qty:1}]), /no se pudo guardar/);
});

test('modo servidor: el cobro no muta nada en el dispositivo', () => {
  const {api} = load(createServer());
  assert.equal(api.stockDescontarEnDispositivo([{prodId:'prod_1', qty:2}]), '');
  assert.equal(product(api).stock, 10);
});

test('modo local: los ajustes son UPDATE compare-and-set, sin función del servidor y sin negativos', async () => {
  const server = createServer(1, {active:false}), {ctx, api} = load(server);
  ctx.adjProdStock('prod_1', -3);
  await flush();
  assert.equal(product(api).stock, 0);
  const [call] = server.writes();
  assert.deepEqual([call.op, call.payload.stock], ['update', 0]);
  assert.ok(call.filters.some(([k, v]) => k === 'stock' && v === 1));
  assert.equal(server.calls.some(c => c.op === 'rpc'), false);
});

test('activación: el cliente pasa a modo servidor en la lectura siguiente y toma el saldo del servidor', async () => {
  const server = createServer(10, {active:false}), {ctx, api} = load(server);
  assert.equal(await refresh(ctx), false);
  assert.equal(api.stockServidor(), false);
  api.stockDescontarEnDispositivo([{prodId:'prod_1', qty:2}]);
  assert.equal(product(api).stock, 8);
  server.active = true;
  assert.equal(await refresh(ctx), true);
  assert.equal(api.stockServidor(), true);
  assert.equal(product(api).stock, 10); // el descuento local no viaja: el servidor es la fuente y no hay doble descuento
  assert.equal(api.stockCorte(product(api)), ACTIVADO);
});

test('corte: una venta local previa a la activación no se resta aunque siga pendiente de sincronizar', async () => {
  const server = createServer(10, {active:false}), {ctx, api} = load(server, {ventas:[row('v1', {_stock_pending:undefined, timestamp:'2025-12-01T00:00:00.000Z'})]});
  server.active = true;
  await refresh(ctx);
  const info = api.stockInfo(product(api));
  assert.deepEqual([info.confirmado, info.pendiente, info.teorico], [10, 0, 10]);
});

test('corte: una escritura de un cliente que todavía se cree en modo local falla sin perder nada y corrige el modo', async () => {
  const server = createServer(10, {active:false}), {ctx, api, state} = load(server);
  server.active = true; // se activó y este dispositivo aún no leyó
  ctx.adjProdStock('prod_1', 1);
  await flush();
  assert.equal(state.lastError.code, 'STOCK_MODEL_CHANGED');
  assert.equal(product(api).stock, 10);
  assert.equal(server.db.products[0].stock, 10);
  await flush();
  assert.equal(api.stockServidor(), true);
});

test('rollback: en modo servidor sin la función, el ajuste no se pierde en silencio y el cliente vuelve a modo local', async () => {
  const server = createServer(), {ctx, api, state} = load(server);
  server.schema = false; server.active = false;
  ctx.adjProdStock('prod_1', 1);
  await flush();
  assert.equal(state.lastError.code, 'STOCK_MODEL_CHANGED');
  assert.equal(product(api).stock, 10);
  await flush();
  assert.equal(api.stockServidor(), false);
});

test('rollback: una columna ausente en la lectura vuelve a modo local en lugar de romper', async () => {
  const server = createServer(), {ctx, api, state} = load(server);
  server.failActivation = {code:'XX', message:'red'}; // no se pudo detectar: conserva servidor y va a leer
  server.schema = false;
  assert.equal(await refresh(ctx), false);
  assert.equal(api.stockServidor(), false);
  assert.equal(state.loadState === 'error', false);
});

test('un error de red al detectar conserva el modo: una caída no apaga el modelo', async () => {
  const server = createServer(), {ctx, api} = load(server);
  server.failActivation = {code:'', message:'sin red'};
  await refresh(ctx);
  assert.equal(api.stockServidor(), true);
  const local = createServer(10, {active:false}), b = load(local);
  local.failActivation = {code:'', message:'sin red'};
  await refresh(b.ctx);
  assert.equal(b.api.stockServidor(), false);
});

test('F0-B: un cambio de contexto durante la detección no fija el modo ni toca almacenamiento', async () => {
  const server = createServer(10, {active:false}), {ctx, api, state} = load(server);
  server.active = true;
  server.beforeActivation = () => { api.bumpContexto(); };
  assert.equal(await refresh(ctx), false);
  assert.equal(api.stockServidor(), false);
  assert.equal(state.storage.has(`stock_modo:${storeId}`), false);
});

test('D: fijar es un conteo explícito: pide confirmación, va como count y mueve el corte', async () => {
  const server = createServer(), {ctx, api, state} = load(server);
  ctx.setProdStock('prod_1', '20');
  await flush();
  assert.equal(state.confirms.length, 1);
  const [call] = server.writes();
  assert.deepEqual([call.args.p_kind, call.args.p_value], ['count', 20]);
  assert.equal(product(api).stock_counted_at, server.db.products[0].stock_counted_at);
  assert.ok(Date.parse(api.stockCorte(product(api))) > Date.parse(ACTIVADO));
});

test('D: cancelar la confirmación no cambia ni escribe nada', async () => {
  const server = createServer(), {ctx, api, state} = load(server);
  state.confirmOk = false;
  ctx.setProdStock('prod_1', '20');
  await flush();
  assert.equal(product(api).stock, 10);
  assert.equal(product(api).stock_counted_at, undefined);
  assert.deepEqual(server.writes(), []);
});

test('D: ± es una corrección: sin confirmación, va como adjust con el delta y no mueve el corte', async () => {
  const server = createServer(), {ctx, api, state} = load(server);
  ctx.adjProdStock('prod_1', -1);
  await flush();
  assert.equal(state.confirms.length, 0);
  const [call] = server.writes();
  assert.deepEqual([call.args.p_kind, call.args.p_value, call.args.p_expected], ['adjust', -1, 10]);
  assert.equal(server.db.products[0].stock_counted_at, undefined);
  assert.equal(api.stockCorte(product(api)), ACTIVADO);
});

test('D: contar el mismo saldo confirmado con ventas pendientes también es un conteo: mueve el corte', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1')]});
  ctx.setProdStock('prod_1', '10');
  await flush();
  assert.equal(server.writes().length, 1);
  assert.equal(api.stockInfo(product(api)).teorico, 10);
});

test('D: un conteo rechazado devuelve el saldo y el corte anteriores; las pendientes vuelven a restar', async () => {
  const server = createServer(), {ctx, api} = load(server, {ventas:[row('v1')]});
  server.failWrite = {message:'sin red'};
  ctx.setProdStock('prod_1', '20');
  await flush();
  assert.equal(product(api).stock, 10);
  assert.equal(product(api).stock_counted_at, '');
  assert.equal(api.stockInfo(product(api)).teorico, 8);
});

test('A: testigo. Una venta que vio el corte sigue restando aunque el reloj la ponga antes', () => {
  const {api} = load(createServer(), {ventas:[
    row('vio', {cantidad:1, timestamp:'2025-01-01T00:00:00.000Z', _stock_cut_seen:ACTIVADO}),
    row('no_vio', {cantidad:2, timestamp:'2025-01-01T00:00:00.000Z'}),
    row('viejo', {cantidad:4, timestamp:'2025-01-01T00:00:00.000Z', _stock_cut_seen:'2024-01-01T00:00:00+00:00'}),
    row('margen', {cantidad:8, timestamp:'2026-01-01T00:04:00.000Z'}),
    row('despues', {cantidad:16, timestamp:'2026-01-01T00:06:00.000Z'})
  ]});
  assert.equal(api.stockInfo(product(api)).pendiente, 17);
});

test('A: el corte es el más reciente entre conteo y activación', () => {
  const {api} = load(createServer());
  assert.equal(api.stockCorte({}), ACTIVADO);
  assert.equal(api.stockCorte({stock_counted_at:'2025-01-01T00:00:00+00:00'}), ACTIVADO);
  assert.equal(api.stockCorte({stock_counted_at:'2026-05-01T00:00:00.123456+00:00'}), '2026-05-01T00:00:00.123456+00:00');
});

test('A: el testigo viaja con el ítem solo si existe; el read-back de R-B2a no compara metadata', () => {
  const map = between('  window.mapSaleItemToSupabaseItem=async function', '  window.mapSalePaymentToSupabasePayment=');
  assert.match(map, /\.\.\.\(row\._stock_cut_seen\?\{stock_cut_seen:row\._stock_cut_seen\}:\{\}\)/);
  const sameItem = between('const sameItem=(remote,local)=>', 'const samePayment=');
  assert.doesNotMatch(sameItem, /metadata/);
});

test('E: los ítems sin descuento se muestran como incidencia, con el nombre escapado y solo en su contexto', async () => {
  const server = createServer(), {ctx, api, state} = load(server);
  server.insertItem('x1', null, 3, {reason:'unresolved'});
  server.db.sale_items[0].product_name = '<b>Raro</b>';
  server.insertItem('x2', productId, 1, {reason:'count_review'});
  server.insertItem('x3', productId, 1, {reason:'before_count'});
  server.insertItem('x4', productId, 1);
  await refresh(ctx);
  api.renderStockAlerts();
  const banner = state.elements['stock-alerts'].innerHTML;
  assert.match(banner, /Ventas que no descontaron stock/);
  assert.match(banner, /producto no identificado/);
  assert.match(banner, /cerca de un conteo/);
  assert.doesNotMatch(banner, /×1 \(revisar\)/);
  assert.equal((banner.match(/×/g) || []).length, 2, 'before_count y applied no son incidencia');
  api.bumpContexto();
  api.renderStockAlerts();
  assert.doesNotMatch(state.elements['stock-alerts'].innerHTML, /Ventas que no descontaron/);
});

test('E: el nombre de una incidencia pasa por escapeHtml', () => {
  assert.match(between('function renderStockAlerts(){', '// ══════'), /escapeHtml\(i\.product_name/);
});

test('E: en modo local no se piden incidencias: la columna puede no existir', async () => {
  const server = createServer(10, {active:false}), {ctx} = load(server);
  await refresh(ctx);
  await ctx.loadCatalogFromSupabase({silent:true});
  assert.equal(server.calls.some(c => c.table === 'sale_items'), false);
});

test('F: ajustes rápidos no chocan entre sí: cada uno manda su propio destino', async () => {
  const server = createServer(), {ctx, state} = load(server);
  ctx.adjProdStock('prod_1', 1); ctx.adjProdStock('prod_1', 1); ctx.adjProdStock('prod_1', 1);
  await flush();
  assert.equal(state.lastError, undefined);
  assert.deepEqual(server.writes().map(c => [c.args.p_expected, c.args.p_value]), [[10, 1], [11, 1], [12, 1]]);
});

test('B: la forma de las fixtures del ejecutor R-B2a, sin producto, no cuenta como pendiente', () => {
  const fixture = row('r2a', {prodId:null, _product_sb_id:null, _product_legacy_id:'', _stock_pending:undefined});
  const {api} = load(createServer(), {ventas:[fixture]});
  assert.equal(api.stockInfo(product(api)).pendiente, 0);
});

test('activación, revisión de texto: el protocolo existe y no activa nada por sí solo', () => {
  const plan = readFileSync(path.join(repo, 'stock_activation.sql'), 'utf8').replace(/^--.*$/gm, '');
  assert.doesNotMatch(plan, /\b(insert|update|delete|alter|drop|create)\b/i, 'sin comentar solo quedan lecturas');
});
