'use strict';
// Reproducciones independientes F1–F4 adaptadas para el repo. Usa index.html, modal, cola y refresh reales con backend simulado.
// Comparación previa: $env:D1_F1_F4_REV='b1b65b0'; node --test tests/d1_f1_f4.test.cjs
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.D1_PLAYWRIGHT_MODULE || path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'));
const W = path.resolve(__dirname, '..');
const rev = process.env.D1_F1_F4_REV || 'worktree';
const html = rev === 'worktree' ? fs.readFileSync(path.join(W, 'index.html'), 'utf8') : execFileSync('git', ['show', `${rev}:index.html`], {cwd:W, encoding:'utf8', maxBuffer:8e6});

const setup = () => {
  window.__sim = {orders:new Map(), latency:60, seq:0, rpcs:0, sales:[], items:[], pays:[], failRpc:0, conflictNext:null};
  const S = window.__sim;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function builder(table) {
    const b = {_t:table, _op:'select', _f:{}, _in:{}, _body:null};
    ['select', 'order', 'limit', 'range', 'contains', 'is', 'not', 'gte', 'lte', 'neq', 'or', 'ilike', 'like'].forEach(m => { b[m] = () => b; });
    b.eq = (k, v) => { b._f[k] = v; return b; };
    b.in = (k, v) => { b._in[k] = v; return b; };
    b.update = v => { b._op = 'update'; b._body = v; return b; };
    b.delete = () => { b._op = 'delete'; return b; };
    b.insert = v => { b._op = 'insert'; b._body = v; return b; };
    b.upsert = v => { b._op = 'insert'; b._body = v; return b; };
    const run = async single => {
      if (table === 'open_order_items' && b._op === 'select') { const ids = b._in.open_order_id || [b._f.open_order_id]; b._photo = ids.flatMap(id => (S.orders.get(id)?.rows || []).map(r => ({...r, open_order_id:id}))); if (S.staleReadMs) { const d = S.staleReadMs; S.staleReadMs = 0; await wait(d); } }
      await wait(S.latency);
      if (table === 'open_orders') {
        if (b._op === 'update') { const o = S.orders.get(b._f.id); if (o) Object.assign(o, {status:b._body.status || o.status, metadata:b._body.metadata || o.metadata}); return {data:o ? (single ? {id:o.id, status:o.status} : [{id:o.id, status:o.status}]) : null, error:null}; }
        const rows = [...S.orders.values()].filter(o => o.status === 'open' && (!b._f.id || o.id === b._f.id)).map(o => ({id:o.id, store_id:'store-test', status:o.status, table_label:o.label, label:o.label, service_type:'salon', metadata:o.metadata || {}, items_version:o.version}));
        return {data:single ? rows[0] || null : rows, error:null};
      }
      if (table === 'open_order_items') {
        if (b._op === 'delete') { const o = S.orders.get(b._f.open_order_id); if (o) o.rows = []; return {data:null, error:null}; }
        return {data:b._photo, error:null};
      }
      if (table === 'sales') {
        if (b._op === 'insert') { const r = {id:`sale-${++S.seq}`, ...(Array.isArray(b._body) ? b._body[0] : b._body)}; S.sales.push(r); return {data:single ? r : [r], error:null}; }
        return {data:single ? null : [], error:null, count:0};
      }
      return {data:single ? null : [], error:null};
    };
    b.maybeSingle = () => run(true);
    b.single = () => run(true);
    b.then = (ok, no) => run(false).then(ok, no);
    return b;
  }
  window.__coloSupabaseClient = {
    from:builder,
    auth:{getSession:async () => ({data:{session:{user:{id:'user-test'}}}})},
    channel:() => null, removeChannel:async () => {},
    rpc:async (name, args) => {
      S.rpcs++;
      await wait(S.latency);
      if (S.failRpc > 0) { S.failRpc--; throw new TypeError('Failed to fetch'); }
      const o = S.orders.get(args.p_open_order_id);
      if (!o || o.status !== 'open') return {data:{ok:false, reason:'closed'}, error:null};
      if (S.conflictNext) { const c = S.conflictNext; S.conflictNext = null; o.version += 1; o.rows = c; }
      if (Number.isFinite(args.p_base_version) && args.p_base_version >= 0 && args.p_base_version !== o.version)
        return {data:{ok:false, reason:'conflict', version:o.version, items:o.rows}, error:null};
      o.version += 1;
      o.rows = (args.p_items || []).map(r => ({...r, id:`srv-${++S.seq}`, variants:r.variants || []}));
      return {data:{ok:true, version:o.version}, error:null};
    },
  };
  window.__sesionLista = true;
  window.__sesionUserId = () => window.__user || 'user-test';
  window.getActiveStoreId = () => 'store-test';
  window.getOpenOrdersSyncState = () => ({ready:true});
  window.mesaItemsVersionadoActivo = () => true;
  window.checkOpenOrderStillOpen = async () => true;
  window.saveSaleRowsToSupabase = async rows => { S.items.push(...JSON.parse(JSON.stringify(rows))); return {ok:true, last:{saleId:'s', legacyId:'s'}}; };
  window.closeOpenOrderInSupabase = async () => true;
  localStorage.setItem('colocafe_ctx_verificado', JSON.stringify({user_id:'user-test', store_id:'store-test'}));
  config.activeStoreId = 'store-test';
  menu = [{id:'prod-test', name:'Test', price:100, cat:'cafe', stock:100, ilimitado:true, variantes:[]}];
  operadores = ['Op'];
  loadOperatorsFromSupabase = async () => { await wait(S.latency); return []; };
  window.__nueva = (id, version = 1) => {
    S.orders.set(id, {id, label:id, status:'open', version, rows:[], metadata:{}});
    const m = {id, _sb_id:id, open_order_id:id, nombre:id, tipo:'salon', items:{}, _items_version:version, _origin:{store_id:'store-test', user_id:'user-test', pendiente:true}};
    mesas.push(m); return m;
  };
  window.__abrir = id => { mesaActivaId = id; carrito = JSON.parse(JSON.stringify(findMesaByAnyId(id).items || {})); $('view-mesas').style.display = 'none'; $('view-pedido').style.display = 'block'; renderCart(); };
  // Como un cajero: el operador del modal real y el botón del modal.
  window.__confirmarModal = async () => {
    const sel = $('cobro-operador-sel');
    if (![...sel.options].some(o => o.value === 'Op')) sel.innerHTML = '<option value="Op">Op</option>';
    sel.value = 'Op';
    await confirmarOperadorCobro();
  };
  window.__ventas = id => ventas.filter(v => v.mesa === id).map(v => v.cantidad);
  window.__settle = async (ms = 0) => { await wait(ms); for (let i = 0; i < 400 && (window.__cajaCobroEnCurso || window.__cajaSincronizandoMesas?.()); i++) await wait(10); };
  window.__qty = () => Object.values(carrito).reduce((n, i) => n + i.qty, 0);
};

const scenarios = {
  // R1: toques rápidos, Cerrar y cobrar enseguida, el cajero confirma el modal 1,5 s después. Sin cambios reales en el pedido.
  R1_cobro_inmediato_sin_cambios: async () => {
    __nueva('r1'); __abrir('r1');
    for (let i = 0; i < 5; i++) addItem('prod-test');
    const visible = Number($('cart-rows').querySelector('input.qty-n')?.value);
    await cerrarMesaOReserva();
    await new Promise(r => setTimeout(r, 1500));
    const antes = {qty:__qty(), ids:Object.values(carrito).map(i => !!i._sb_item_id), rpcs:__sim.rpcs};
    await __confirmarModal();
    await __settle(300);
    const toast = $('toast').textContent;
    const r = {visible, antes, ventas:__ventas('r1'), qtyTrasIntento:__qty(), toast};
    // ¿Se recupera repitiendo?
    if (!r.ventas.length) { await cerrarMesaOReserva(); await new Promise(r2 => setTimeout(r2, 200)); await __confirmarModal(); await __settle(300); r.reintento = {ventas:__ventas('r1'), toast:$('toast').textContent}; }
    return r;
  },
  // Control: mismo pedido, espera a que termine la sincronización y el refresh.
  R1c_control_con_espera: async () => {
    __nueva('r1c'); __abrir('r1c');
    for (let i = 0; i < 5; i++) addItem('prod-test');
    await new Promise(r => setTimeout(r, 2500));
    await cerrarMesaOReserva(); await new Promise(r => setTimeout(r, 300));
    await __confirmarModal(); await __settle(300);
    return {ventas:__ventas('r1c'), total:ventas.filter(v => v.mesa === 'r1c').reduce((n, v) => n + v.total, 0), toast:$('toast').textContent};
  },
  // R2: durante la espera de red del cobro el cajero abre otra mesa o vuelve a la lista. El código declara que el cobro usa su propia copia.
  R2_abre_otra_mesa_durante_el_cobro: async () => {
    __nueva('r2a'); __nueva('r2b'); findMesaByAnyId('r2b').items = {'prod-test_plain':{prodId:'prod-test', qty:9, vars:[], nota:'', precio:100}};
    __abrir('r2a'); addItem('prod-test'); await new Promise(r => setTimeout(r, 800));
    __sim.latency = 400;
    await cerrarMesaOReserva(); await new Promise(r => setTimeout(r, 500));
    await __confirmarModal();
    await new Promise(r => setTimeout(r, 100));
    await abrirMesa('r2b');
    await __settle(1500); __sim.latency = 60;
    return {ventasA:__ventas('r2a'), ventasB:__ventas('r2b'), toast:$('toast').textContent, mesaActiva:mesaActivaId, mesaASigueAbierta:!!findMesaByAnyId('r2a')};
  },
  R2b_vuelve_a_la_lista_durante_el_cobro: async () => {
    __nueva('r2c'); __abrir('r2c'); addItem('prod-test'); await new Promise(r => setTimeout(r, 800));
    __sim.latency = 400;
    await cerrarMesaOReserva(); await new Promise(r => setTimeout(r, 500));
    await __confirmarModal();
    await new Promise(r => setTimeout(r, 100));
    await volverAMesas();
    await __settle(1500); __sim.latency = 60;
    return {ventas:__ventas('r2c'), toast:$('toast').textContent, mesaSigueAbierta:!!findMesaByAnyId('r2c')};
  },
  R2c_navega_con_modal_abierto: async () => {
    __nueva('r2d');__nueva('r2e');
    findMesaByAnyId('r2e').items={'prod-test_plain':{prodId:'prod-test',qty:9,vars:[],nota:'',precio:100}};
    __abrir('r2d');addItem('prod-test');await __settle(500);
    await cerrarMesaOReserva();await abrirMesa('r2e');
    await __confirmarModal();await __settle(300);
    return {ventasOrigen:__ventas('r2d'),ventasOtra:__ventas('r2e'),mesaActiva:mesaActivaId,toast:$('toast').textContent};
  },
  // R3: reserva. Cambia el pedido durante la verificación remota: el cobro se invalida después de ocultarla.
  R3_reserva_invalidada: async () => {
    const r = {id:'res1', nombre:'Res', tipo:'salon', estado:'confirmada', items:[{prodId:'prod-test', qty:1, vars:[], nota:'', precio:100}], fecha:today(), hora:'20:00', pagos:[], pago:'ef', payment_mode:'single'};
    reservas.push(r);
    mesaActivaId = 'reserva_res1'; carrito = {res_0:{...r.items[0]}};
    $('view-mesas').style.display = 'none'; $('view-pedido').style.display = 'block'; renderCart();
    window.getSupabaseClient = () => window.__coloSupabaseClient; window.canShowClientTechnicalUi = () => true; const errs = []; const ce = console.error; console.error = (...a) => { errs.push(String(a[1]?.message || a[1] || a[0]).slice(0, 200)); ce(...a); }; window.__errs = errs;
    const cobro = ejecutarCobro('Op', 'op');
    await new Promise(res => setTimeout(res, 20));
    carrito.res_0.qty = 2; // edición durante la espera
    await cobro; await __settle(200);
    const oculta = isReservationOptimisticallyHidden(r); const enLista = isReservationVisibleInCaja(r);
    return {ventas:__ventas('Res'), oculta, enLista, segundos:oculta ? Math.round((reservaHiddenUntil.get('res1')?.until - Date.now()) / 1000) : null, toast:$('toast').textContent, errs:window.__errs};
  },
  // R4: RPC vieja que responde tras una edición nueva, y la lectura vieja de por medio.
  R4_rpc_y_lectura_viejas: async () => {
    __nueva('r4'); __abrir('r4');
    addItem('prod-test');
    await new Promise(r => setTimeout(r, 20));
    addItem('prod-test'); addItem('prod-test');
    const refresh = window.triggerOORefresh('tab');
    await refresh;
    const enVuelo = {qty:__qty(), dirty:findMesaByAnyId('r4')._items_dirty};
    await new Promise(r => setTimeout(r, 1200));
    const m = findMesaByAnyId('r4');
    return {enVuelo, final:{qty:__qty(), dirty:m._items_dirty, st:m._sync_status, syncing:m._syncing, server:__sim.orders.get('r4').rows.reduce((n, x) => n + Number(x.quantity), 0), pend:pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'r4').length}};
  },
  // R5: fallo de red, edición encima, reintento automático real.
  R5_fallo_red_y_reintento: async () => {
    __nueva('r5'); __abrir('r5');
    __sim.failRpc = 2;
    addItem('prod-test'); await new Promise(r => setTimeout(r, 150));
    addItem('prod-test'); await new Promise(r => setTimeout(r, 500));
    const m0 = findMesaByAnyId('r5');
    const tras = {dirty:m0._items_dirty, st:m0._sync_status, syncing:m0._syncing, rev:m0._items_local_revision, pendRev:pendingOpenOrderItemSyncs.find(e => e.open_order_id === 'r5')?.local_revision, server:__sim.orders.get('r5').rows.length};
    await window.triggerOORefresh('tab');
    const trasLectura = __qty();
    await window.retryPendingOpenOrderWrites?.({reason:'test'});
    await window.retryPendingOpenOrdersSync({silent:true});
    await new Promise(r => setTimeout(r, 300));
    const m = findMesaByAnyId('r5');
    return {tras, trasLectura, final:{qty:__qty(), dirty:m._items_dirty, st:m._sync_status, server:__sim.orders.get('r5').rows.reduce((n, x) => n + Number(x.quantity), 0), pend:pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'r5').length}};
  },
  // R6: otro dispositivo cambió la mesa. El conflicto tiene que verse y frenar el cobro.
  R6_conflicto_legitimo: async () => {
    __nueva('r6'); __abrir('r6');
    addItem('prod-test'); await new Promise(r => setTimeout(r, 700));
    __sim.conflictNext = [{id:'otro-1', product_id:'prod-test', quantity:7, unit_price:100, variants:[], note:'', metadata:{prodId:'prod-test'}}];
    addItem('prod-test'); await new Promise(r => setTimeout(r, 500));
    const m = findMesaByAnyId('r6');
    renderCajaPendingBanner();
    const estado = {conflict:!!m._items_conflict, st:m._sync_status, syncing:m._syncing, dirty:m._items_dirty, banner:$('caja-pending-banner').innerText.replace(/\s+/g, ' ').slice(0, 170), bloqueoCambioLocal:motivosBloqueoCambioLocal().slice(0, 3), outbox:(window.getPendingOperationsOutbox?.() || []).map(o => o.type + ':' + o.status)};
    await window.triggerOORefresh('tab');
    const trasLectura = {qty:__qty(), conflict:!!findMesaByAnyId('r6')._items_conflict};
    await cerrarMesaOReserva(); await new Promise(r => setTimeout(r, 200)); await __confirmarModal(); await __settle(300);
    return {estado, trasLectura, ventas:__ventas('r6'), toast:$('toast').textContent};
  },
  // R7: F0-B. Mesa con edición pendiente de otra cuenta: ni el reintento ni una sync la envían.
  R7_f0b_pendiente_de_otra_cuenta: async () => {
    __nueva('r7'); __abrir('r7');
    __sim.failRpc = 1;
    addItem('prod-test'); await new Promise(r => setTimeout(r, 300));
    const antes = __sim.rpcs;
    window.__user = 'otro';
    await window.retryPendingOpenOrdersSync({silent:true});
    await window.retryPendingOpenOrderItemSyncs({silent:true});
    const r = {rpcsDeOtraCuenta:__sim.rpcs - antes, server:__sim.orders.get('r7').rows.length};
    window.__user = 'user-test';
    return r;
  },
  // R9: lectura pedida con una foto de 1 unidad, que responde después de la confirmación de 3.
  R9_lectura_atrasada_real: async () => {
    __nueva('r9'); __abrir('r9');
    addItem('prod-test'); await new Promise(r => setTimeout(r, 900));
    __sim.staleReadMs = 900;
    const foto = window.triggerOORefresh('tab');
    await new Promise(r => setTimeout(r, 100)); // la foto ya se tomó, con 1 unidad
    addItem('prod-test'); addItem('prod-test');
    await new Promise(r => setTimeout(r, 400));
    const antesDeLlegar = {server:__sim.orders.get('r9').rows.reduce((n, x) => n + Number(x.quantity), 0), dirty:findMesaByAnyId('r9')._items_dirty};
    await foto; await new Promise(r => setTimeout(r, 30));
    const m9 = findMesaByAnyId('r9');
    if (m9) return {antesDeLlegar, carrito:__qty(), mesa:Object.values(m9.items).reduce((n, i) => n + i.qty, 0), server:__sim.orders.get('r9').rows.reduce((n, x) => n + Number(x.quantity), 0), dirty:m9._items_dirty, confirmada:!!m9._items_confirmed_at};
    const lectura = window.triggerOORefresh('tab');
    await lectura; await new Promise(r => setTimeout(r, 30));
    const m = findMesaByAnyId('r9');
    return {carrito:__qty(), mesa:Object.values(m.items).reduce((n, i) => n + i.qty, 0), server:__sim.orders.get('r9').rows.reduce((n, x) => n + Number(x.quantity), 0), dirty:m._items_dirty, confirmada:!!m._items_confirmed_at};
  },
  // R8: dos líneas con nota del mismo producto, cobro después del refresh: cantidad y total.
  R8_lineas_distintas: async () => {
    __nueva('r8'); __abrir('r8');
    carrito = {a:{prodId:'prod-test', qty:1, vars:[], nota:'sin azúcar', precio:100}, b:{prodId:'prod-test', qty:2, vars:[], nota:'', precio:100}, c:{prodId:'prod-test', qty:1, vars:[{nombre:'grande', precio:20}], nota:'', precio:100}};
    saveMesaCarrito();
    await new Promise(r => setTimeout(r, 1200));
    const lineas = Object.values(carrito).map(i => [i.qty, i.nota, (i.vars || []).length]);
    await cerrarMesaOReserva(); await new Promise(r => setTimeout(r, 200)); await __confirmarModal(); await __settle(300);
    return {lineas, ventas:__ventas('r8'), total:ventas.filter(v => v.mesa === 'r8').reduce((n, v) => n + v.total, 0), toast:$('toast').textContent};
  },
  R10_cambio_comercial: async () => {
    const result = {};
    for(const campo of ['qty','precio','desc','vars','nota']){
      const id='r10_'+campo;
      __nueva(id);__abrir(id);addItem('prod-test');
      await __settle(500);
      await cerrarMesaOReserva();
      const item=Object.values(carrito)[0];
      if(campo==='qty')item.qty=2;
      if(campo==='precio')item.precio=130;
      if(campo==='desc')item.desc={tipo:'pct',valor:10};
      if(campo==='vars')item.vars=[{nombre:'grande',precio:20}];
      if(campo==='nota')item.nota='sin azúcar';
      await __confirmarModal();await __settle(100);
      result[campo]={ventas:__ventas(id),toast:$('toast').textContent};
    }
    return result;
  },
  R11_cambio_cuenta: async () => {
    __nueva('r11u');__abrir('r11u');addItem('prod-test');await __settle(500);
    __sim.latency=400;await cerrarMesaOReserva();await __confirmarModal();
    await new Promise(r=>setTimeout(r,100));window.__user='other-user';
    await __settle(1500);
    return {ventas:__ventas('r11u'),server:__sim.sales.length,mesa:!!findMesaByAnyId('r11u')};
  },
  R11_cambio_local: async () => {
    __nueva('r11s');__abrir('r11s');addItem('prod-test');await __settle(500);
    __sim.latency=400;await cerrarMesaOReserva();await __confirmarModal();
    await new Promise(r=>setTimeout(r,100));config.activeStoreId='other-store';
    await __settle(1500);
    return {ventas:__ventas('r11s'),server:__sim.sales.length,mesa:!!findMesaByAnyId('r11s')};
  },
  R12_reserva_cobrada: async () => {
    window.getSupabaseClient=()=>window.__coloSupabaseClient;
    const r={id:'res12',nombre:'Reserva 12',tipo:'salon',estado:'confirmada',items:[{prodId:'prod-test',qty:1,vars:[],nota:'',precio:100}],fecha:today(),hora:'20:00',pagos:[],pago:'ef',payment_mode:'single'};
    reservas.push(r);mesaActivaId='reserva_res12';carrito={res_0:{...r.items[0]}};
    $('view-mesas').style.display='none';$('view-pedido').style.display='block';renderCart();
    await ejecutarCobro('Op','op');await __settle(200);
    return {ventas:__ventas('Reserva 12'),hidden:isReservationOptimisticallyHidden(r),visible:isReservationVisibleInCaja(r),status:r.estado,remoteItems:__sim.items.length,toast:$('toast').textContent};
  },
  R13_lineas_duplicadas: async () => {
    __nueva('r13');__abrir('r13');
    const item={prodId:'prod-test',qty:1,vars:[],nota:'',precio:100};
    carrito={a:{...item},b:{...item}};saveMesaCarrito();
    await __settle(600);await window.triggerOORefresh('tab');
    const antes=Object.values(carrito).map(i=>i.qty);
    await cerrarMesaOReserva();await __confirmarModal();await __settle(200);
    return {antes,ventas:__ventas('r13'),total:ventas.filter(v=>v.mesa==='r13').reduce((n,v)=>n+v.total,0)};
  },
  R14_venta_parcial_reintento: async () => {
    __nueva('r14');__abrir('r14');
    carrito={a:{prodId:'prod-test',qty:1,vars:[],nota:'solo',precio:100},b:{prodId:'prod-test',qty:2,vars:[],nota:'',precio:100}};
    saveMesaCarrito();await __settle(600);
    let intento=0;
    window.saveSaleRowsToSupabase=async rows=>{
      intento++;
      if(intento===1){__sim.items.push(JSON.parse(JSON.stringify(rows[0])));throw new TypeError('Failed to fetch');}
      __sim.items.push(...JSON.parse(JSON.stringify(rows.slice(1))));return {ok:true,last:{saleId:'s14',legacyId:'s14'}};
    };
    await cerrarMesaOReserva();await __confirmarModal();await __settle(200);
    const primero={ventas:__ventas('r14'),remotas:__sim.items.length,mesa:!!findMesaByAnyId('r14')};
    __abrir('r14');await cerrarMesaOReserva();await __confirmarModal();await __settle(200);
    return {primero,final:{ventas:__ventas('r14'),remotas:__sim.items.length,intentos:intento,mesa:!!findMesaByAnyId('r14')}};
  },
};

(async () => {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname.slice(1) || 'index.html';
    if (name !== 'index.html') { res.writeHead(404); return res.end(); }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({headless:true, executablePath:process.env.D1_CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe')});
  const only = process.env.D1_F1_F4_ONLY;
  const results = {};
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only && !name.startsWith(only)) continue;
    const ctx = await browser.newContext({serviceWorkers:'block'});
    let externos = 0, externalResponses = 0;
    ctx.on('response', response => { if(!['127.0.0.1','cdn.jsdelivr.net'].includes(new URL(response.url()).hostname)) externalResponses++; });
    await ctx.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') return route.continue();
      externos++;
      if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({status:200, contentType:'text/javascript', body:'window.supabase={createClient:()=>null};'});
      return route.abort('blockedbyclient');
    });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof addItem === 'function' && typeof window.triggerOORefresh === 'function');
    await page.evaluate(setup);
    try { results[name] = await page.evaluate(fn); console.log(name, JSON.stringify(results[name])); }
    catch (e) { throw new Error(`${name}: ${String(e.message).slice(0, 300)}`); }
    assert.equal(externalResponses, 0, `${name}: external response reached Chromium`);
    console.log('network', name, JSON.stringify({intercepted:externos,externalResponses}));
    await ctx.close();
  }
  if(!only){
    const r=results;
    if(rev==='worktree'){
      assert.deepEqual(r.R1_cobro_inmediato_sin_cambios.ventas,[5]);
      assert.deepEqual(r.R2_abre_otra_mesa_durante_el_cobro.ventasA,[1]);
      assert.deepEqual(r.R2_abre_otra_mesa_durante_el_cobro.ventasB,[]);
      assert.equal(r.R2_abre_otra_mesa_durante_el_cobro.mesaActiva,'r2b');
      assert.equal(r.R2_abre_otra_mesa_durante_el_cobro.mesaASigueAbierta,false);
      assert.deepEqual(r.R2b_vuelve_a_la_lista_durante_el_cobro.ventas,[1]);
      assert.deepEqual(r.R2c_navega_con_modal_abierto.ventasOrigen,[1]);
      assert.deepEqual(r.R2c_navega_con_modal_abierto.ventasOtra,[]);
      assert.equal(r.R2c_navega_con_modal_abierto.mesaActiva,'r2e');
      assert.deepEqual(r.R3_reserva_invalidada.ventas,[]);
      assert.equal(r.R3_reserva_invalidada.oculta,false);
      assert.equal(r.R3_reserva_invalidada.enLista,true);
      assert.equal(r.R6_conflicto_legitimo.estado.conflict,true);
      assert.equal(r.R6_conflicto_legitimo.estado.syncing,false);
      assert.deepEqual(r.R6_conflicto_legitimo.estado.outbox,[]);
      assert.doesNotMatch(r.R6_conflicto_legitimo.estado.banner,/reintenta sola/i);
      assert.deepEqual(r.R6_conflicto_legitimo.ventas,[]);
      assert.deepEqual(r.R5_fallo_red_y_reintento.final,{qty:2,dirty:false,st:'confirmed',server:2,pend:0});
      assert.equal(r.R7_f0b_pendiente_de_otra_cuenta.rpcsDeOtraCuenta,0);
      assert.equal(r.R4_rpc_y_lectura_viejas.final.server,3);
      assert.deepEqual(r.R8_lineas_distintas.ventas,[1,2,1]);
      for(const campo of ['qty','precio','desc','vars','nota']){
        assert.deepEqual(r.R10_cambio_comercial[campo].ventas,[],campo);
        assert.match(r.R10_cambio_comercial[campo].toast,/pedido cambió/i,campo);
      }
      assert.deepEqual(r.R11_cambio_cuenta.ventas,[]);
      assert.equal(r.R11_cambio_cuenta.server,0);
      assert.deepEqual(r.R11_cambio_local.ventas,[]);
      assert.equal(r.R11_cambio_local.server,0);
      assert.deepEqual(r.R12_reserva_cobrada.ventas,[1]);
      assert.equal(r.R12_reserva_cobrada.visible,false);
      assert.deepEqual(r.R13_lineas_duplicadas.antes,[1,1]);
      assert.deepEqual(r.R13_lineas_duplicadas.ventas,[1,1]);
      assert.equal(r.R13_lineas_duplicadas.total,200);
      assert.deepEqual(r.R14_venta_parcial_reintento.primero.ventas,[1,2]);
      assert.deepEqual(r.R14_venta_parcial_reintento.final.ventas,[1,2]);
      assert.equal(r.R14_venta_parcial_reintento.final.remotas,2);
      assert.equal(r.R14_venta_parcial_reintento.final.mesa,false);
    }else if(rev==='b1b65b0'){
      assert.deepEqual(r.R1_cobro_inmediato_sin_cambios.ventas,[]);
      assert.deepEqual(r.R2_abre_otra_mesa_durante_el_cobro.ventasA,[]);
      assert.equal(r.R3_reserva_invalidada.oculta,true);
      assert.equal(r.R6_conflicto_legitimo.estado.syncing,true);
    }
  }
  if (only === 'FUZZ') {
    const res = {vendido5:0, bloqueado:0, otraCantidad:[], total:0};
    for (const latency of [30, 80, 150, 300]) for (const modal of [0, 300, 900, 1800]) for (const stale of [0, 500, 1200]) {
      const ctx = await browser.newContext({serviceWorkers:'block'});
      await ctx.route('**/*', route => { const u = new URL(route.request().url()); if (u.hostname === '127.0.0.1') return route.continue(); if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({status:200, contentType:'text/javascript', body:'window.supabase={createClient:()=>null};'}); return route.abort('blockedbyclient'); });
      const page = await ctx.newPage();
      await page.goto('http://127.0.0.1:' + server.address().port + '/');
      await page.waitForFunction(() => typeof addItem === 'function' && typeof window.triggerOORefresh === 'function');
      await page.evaluate(setup);
      const r = await page.evaluate(async ({latency, modal, stale}) => {
        __sim.latency = latency; __nueva('f'); __abrir('f');
        addItem('prod-test'); addItem('prod-test');
        await new Promise(r => setTimeout(r, latency * 6 + 500));
        if (stale) { __sim.staleReadMs = stale; window.triggerOORefresh('tab'); await new Promise(r => setTimeout(r, latency + 20)); }
        addItem('prod-test'); addItem('prod-test'); addItem('prod-test');
        const visible = Number($('cart-rows').querySelector('input.qty-n')?.value);
        await cerrarMesaOReserva();
        await new Promise(r => setTimeout(r, modal));
        const alConfirmar = __qty();
        await __confirmarModal();
        await __settle(200);
        return {visible, alConfirmar, ventas:__ventas('f'), toast:$('toast').textContent.slice(0, 30)};
      }, {latency, modal, stale});
      res.total++;
      if (r.ventas.length === 1 && r.ventas[0] === 5) res.vendido5++;
      else if (!r.ventas.length) { res.bloqueado++; res.toasts = res.toasts || {}; res.toasts[r.toast] = (res.toasts[r.toast] || 0) + 1; }
      else res.otraCantidad.push({latency, modal, stale, ...r});
      await ctx.close();
    }
    console.log('FUZZ', JSON.stringify({...res, otraCantidad:res.otraCantidad.slice(0, 4), nOtra:res.otraCantidad.length}));
  }
  if (only === 'RELOAD') {
    const ctx = await browser.newContext({serviceWorkers:'block'});
    await ctx.route('**/*', route => { const u = new URL(route.request().url()); if (u.hostname === '127.0.0.1') return route.continue(); if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({status:200, contentType:'text/javascript', body:'window.supabase={createClient:()=>null};'}); return route.abort('blockedbyclient'); });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    await page.waitForFunction(() => typeof addItem === 'function' && typeof window.triggerOORefresh === 'function');
    await page.evaluate(setup);
    const a = await page.evaluate(async () => { __nueva('rl'); __abrir('rl'); __sim.failRpc = 3; addItem('prod-test'); addItem('prod-test'); addItem('prod-test'); await new Promise(r => setTimeout(r, 900)); save(); const m = findMesaByAnyId('rl'); return {dirty:m._items_dirty, rev:m._items_local_revision, pend:pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'rl').map(e => e.local_revision), server:__sim.orders.get('rl').rows.length}; });
    await page.reload();
    await page.waitForFunction(() => typeof addItem === 'function' && typeof window.triggerOORefresh === 'function');
    await page.evaluate(setup);
    const b = await page.evaluate(async () => {
      __sim.orders.set('rl', {id:'rl', label:'rl', status:'open', version:1, rows:[], metadata:{}});
      const m0 = findMesaByAnyId('rl');
      const tras = {existe:!!m0, dirty:m0?._items_dirty, qty:Object.values(m0?.items || {}).reduce((n, i) => n + i.qty, 0), pend:pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'rl').map(e => [e.local_revision, e.status])};
      await window.triggerOORefresh('tab');
      const m1 = findMesaByAnyId('rl');
      const trasLectura = Object.values(m1?.items || {}).reduce((n, i) => n + i.qty, 0);
      await window.retryPendingOpenOrdersSync({silent:true}); await window.retryPendingOpenOrderItemSyncs({silent:true});
      await new Promise(r => setTimeout(r, 300));
      const m = findMesaByAnyId('rl');
      return {tras, trasLectura, final:{dirty:m?._items_dirty, st:m?._sync_status, server:__sim.orders.get('rl').rows.reduce((n, x) => n + Number(x.quantity), 0), pend:pendingOpenOrderItemSyncs.filter(e => e.open_order_id === 'rl').length}};
    });
    console.log('RELOAD', JSON.stringify({antes:a, despues:b}));
    await ctx.close();
  }
  await browser.close(); server.close();
})();
