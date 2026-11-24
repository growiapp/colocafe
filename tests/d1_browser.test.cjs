'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const playwrightModule = process.env.D1_PLAYWRIGHT_MODULE || path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
const {chromium} = require(playwrightModule);

const root = path.resolve(__dirname, '..');
const chrome = process.env.D1_CHROME || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe');
const compareRevision = process.env.D1_MAIN === '1' ? 'main' : process.env.D1_BASELINE === '1' ? 'c5520f9141c24ad893d95f82618212c86441c3ef' : '';
const html = compareRevision
  ? execFileSync('git', ['show', `${compareRevision}:index.html`], {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024})
  : fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function sourceOf(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const opening = html.indexOf('{', start);
  let depth = 0;
  for (let i = opening; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw Error(`unclosed ${name}`);
}

test('D1: five visible units survive an in-flight stale table refresh and immediate payment', async () => {
  const mockOrders = new Map();
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname.slice(1) || 'index.html';
    if(name === '__orders'){
      let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
        const order=JSON.parse(body);mockOrders.set(order.id,order.items);
        res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));
      });
      return;
    }
    if (!['index.html', 'logo.png', 'logo.svg', 'manifest.json', 'preview.jpg'].includes(name)) {res.writeHead(404);res.end();return;}
    res.setHeader('content-type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(name === 'index.html' ? html : fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true, executablePath:chrome});
  const context = await browser.newContext({serviceWorkers:'block'});
  const external = [];
  const remoteResponses = [];
  context.on('response', response => {
    const host = new URL(response.url()).hostname;
    if(host !== '127.0.0.1' && host !== 'cdn.jsdelivr.net') remoteResponses.push(response.url());
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    external.push(url.href);
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({status:200, contentType:'text/javascript', body:'window.supabase={createClient:()=>null};'});
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof addItem === 'function');
    const result = await page.evaluate(async ({syncSource, shouldPreserveSource, mergeSource}) => {
      config.activeStoreId='store-test';
      menu=[{id:'prod-test',name:'Test',price:100,cat:'cafe',stock:100,ilimitado:true,variantes:[]}];
      mesas=[{id:'mesa-test',_sb_id:'mesa-test',open_order_id:'mesa-test',nombre:'Mesa test',tipo:'salon',items:{},_items_version:1}];
      mesaActivaId='mesa-test'; carrito={};
      const realSync=window.syncMesaToSupabase;
      $('view-mesas').style.display='none';$('view-pedido').style.display='block';
      window.getOpenOrdersSyncState=()=>({ready:true});
      let remoteConfirmed=0;
      window.syncMesaToSupabase=async m=>{remoteConfirmed=Object.values(m.items||{}).reduce((n,i)=>n+i.qty,0);return true;};
      window.checkOpenOrderStillOpen=async()=>true;
      window.mesaItemsVersionadoActivo=()=>true;
      let persistedRows=[];
      window.saveSaleRowsToSupabase=async rows=>{persistedRows=JSON.parse(JSON.stringify(rows));return {ok:true,last:{saleId:'sale-test',legacyId:'sale-test'}};};
      window.closeOpenOrderInSupabase=async()=>true;
      window.getActiveStoreId=()=> 'store-test';
      let releaseOperators;
      loadOperatorsFromSupabase=()=>new Promise(resolve => {releaseOperators=resolve;});
      renderCart();
      for(let n=0;n<5;n++)addItem('prod-test');
      await new Promise(resolve=>setTimeout(resolve,0));
      const visibleAtClick=Number($('cart-rows').querySelector('input.qty-n')?.value);
      const localAtClick=carrito['prod-test_plain'].qty;
      const opened=cerrarMesaOReserva();
      await new Promise(resolve=>setTimeout(resolve,0));
      // Simulated delayed read of the remote table, taken after only two touches.
      const staleRemote={...mesas[0],items:{'prod-test_plain':{prodId:'prod-test',qty:2,vars:[],nota:'',precio:100}},_syncing:false,_items_dirty:false};
      remoteConfirmed=2;
      mesas=eval(`${shouldPreserveSource}\n${mergeSource}\nooMergeRemoteWithPending([staleRemote], Date.now()-1000)`);
      eval(`(${syncSource})`)();
      const visibleAfterRefresh=Number($('cart-rows').querySelector('input.qty-n')?.value)||0;
      const localAfterRefresh=carrito['prod-test_plain']?.qty||0;
      const remoteAtRefresh=remoteConfirmed;
      releaseOperators([]);
      await opened;
      await ejecutarCobro('Test operator','operator-test');
      const receiptAfterConfirmedSale=document.getElementById('modal-comprobante')?.classList.contains('open')===true&&/Venta guardada/.test(document.getElementById('modal-comprobante').innerText);
      document.getElementById('modal-comprobante')?.classList.remove('open');
      const firstPersistedRows=persistedRows;
      const distinctLines=window.ooItemsDesdeFilas([
        {id:'a',product_id:'prod-test',quantity:1,unit_price:100,variants:[],note:'sin azúcar',metadata:{prodId:'prod-test'}},
        {id:'b',product_id:'prod-test',quantity:2,unit_price:100,variants:[],note:'',metadata:{prodId:'prod-test',discount:{tipo:'pct',valor:10}}},
        {id:'c',product_id:'prod-test',quantity:1,unit_price:100,variants:[{nombre:'grande',precio:20}],metadata:{prodId:'prod-test'}},
        {id:'d',product_id:'prod-test',quantity:1,unit_price:100,variants:[{nombre:'chico',precio:0}],metadata:{prodId:'prod-test'}}
      ]);
      mesaActivaId='mesa-edit';carrito={'prod-test_plain':{prodId:'prod-test',qty:1,vars:[],nota:'',precio:100}};
      mesas=[{id:'mesa-edit',_sb_id:'mesa-edit',open_order_id:'mesa-edit',nombre:'Mesa edit',tipo:'salon',items:JSON.parse(JSON.stringify(carrito)),_items_version:1}];
      $('view-pedido').style.display='block';
      const releases=[];
      window.syncMesaToSupabase=()=>new Promise(resolve=>releases.push(resolve));
      renderCart();
      const payment=ejecutarCobro('Test operator','operator-test');
      for(let i=0;i<20&&!releases.length;i++)await new Promise(resolve=>setTimeout(resolve,0));
      const paymentSyncStarted=releases.length>0;
      addItem('prod-test');
      releases.forEach(release=>release(true));
      await payment;
      const duringSync={receiptWhenRefused:document.getElementById('modal-comprobante')?.classList.contains('open')===true,paymentSyncStarted,visible:carrito['prod-test_plain']?.qty||0,
        persisted:ventas.filter(v=>v.mesa==='Mesa edit').length,toast:$('toast').textContent};
      // Exercise the real per-table queue and versioned RPC with a delayed first response.
      const rpcCalls=[];
      window.__coloSupabaseClient={
        from:()=>({update(){return this;},eq(){return this;},then(resolve){resolve({error:null});}}),
        rpc:(name,args)=>new Promise(resolve=>rpcCalls.push({name,args,resolve}))
      };
      window.__sesionLista=true;
      window.__sesionUserId=()=> 'user-test';
      localStorage.setItem('colocafe_ctx_verificado',JSON.stringify({user_id:'user-test',store_id:'store-test'}));
      const source={store_id:'store-test',user_id:'user-test',pendiente:true};
      mesas=[{id:'mesa-rpc',_sb_id:'mesa-rpc',open_order_id:'mesa-rpc',nombre:'Mesa RPC',tipo:'salon',items:{},_items_version:0,_origin:source}];
      mesaActivaId='mesa-rpc';carrito={'prod-test_plain':{prodId:'prod-test',qty:1,vars:[],nota:'',precio:100}};
      window.syncMesaToSupabase=realSync;
      saveMesaCarrito();
      for(let i=0;i<100&&rpcCalls.length<1;i++)await new Promise(resolve=>setTimeout(resolve,0));
      const firstQty=rpcCalls[0]?.args?.p_items?.[0]?.quantity??null;
      addItem('prod-test');
      rpcCalls[0]?.resolve({data:{ok:true,version:1},error:null});
      for(let i=0;i<100&&rpcCalls.length<2;i++)await new Promise(resolve=>setTimeout(resolve,0));
      const afterOldResponse={dirty:mesas[0]._items_dirty,qty:mesas[0].items['prod-test_plain']?.qty,
        status:mesas[0]._sync_status,queuedRevision:pendingOpenOrderItemSyncs.find(e=>e.open_order_id==='mesa-rpc')?.local_revision??null};
      const secondQty=rpcCalls[1]?.args?.p_items?.[0]?.quantity??null;
      rpcCalls[1]?.resolve({data:{ok:true,version:2},error:null});
      for(let i=0;i<100&&mesas[0]._items_dirty;i++)await new Promise(resolve=>setTimeout(resolve,0));
      const delayedRpc={firstQty,secondQty,afterOldResponse,finalDirty:mesas[0]._items_dirty,
        finalQty:mesas[0].items['prod-test_plain']?.qty,version:mesas[0]._items_version};
      mesaActivaId='mesa-retry';carrito={'prod-test_plain':{prodId:'prod-test',qty:2,vars:[],nota:'',precio:100}};
      mesas.push({id:'mesa-retry',_sb_id:'mesa-retry',open_order_id:'mesa-retry',nombre:'Mesa retry',tipo:'salon',items:JSON.parse(JSON.stringify(carrito)),_items_version:1});
      ventas.push({id:'v-old',ticket_id:'t-old',mesa:'Mesa retry',_source_kind:'mesa',_open_order_sb_id:'mesa-retry',
        _sb_sync_status:'pending',prodId:'prod-test',cantidad:1,variantes:'',nota:'',precioBase:100,precioVars:0,total:100,pagos:[]});
      window.syncMesaToSupabase=async()=>true;
      renderCart();
      await ejecutarCobro('Test operator','operator-test');
      const partialRetry={rows:ventas.filter(v=>v.mesa==='Mesa retry').map(v=>v.cantidad),toast:$('toast').textContent};
      let activeUser='user-test';
      window.__sesionUserId=()=>activeUser;
      async function pendingContextChange(kind){
        config.activeStoreId='store-test';activeUser='user-test';
        const id=`mesa-${kind}`;
        mesaActivaId=id;carrito={'prod-test_plain':{prodId:'prod-test',qty:1,vars:[],nota:'',precio:100}};
        mesas.push({id,_sb_id:id,open_order_id:id,nombre:id,tipo:'salon',items:JSON.parse(JSON.stringify(carrito)),_items_version:1});
        let release;
        window.syncMesaToSupabase=()=>new Promise(resolve=>{release=resolve;});
        renderCart();
        const payment=ejecutarCobro('Test operator','operator-test');
        for(let i=0;i<20&&!release;i++)await new Promise(resolve=>setTimeout(resolve,0));
        if(kind==='user')activeUser='other-user';else config.activeStoreId='other-store';
        release(true);
        await payment;
        return ventas.filter(v=>v.mesa===id).length;
      }
      const changedUserSales=await pendingContextChange('user');
      const changedStoreSales=await pendingContextChange('store');
      config.activeStoreId='store-test';activeUser='user-test';
      mesaActivaId='mesa-rpc';carrito=JSON.parse(JSON.stringify(mesas[0].items));window.syncMesaToSupabase=realSync;
      renderCart();
      return {visibleAtClick,localAtClick,remoteAtRefresh,visibleAfterRefresh,localAfterRefresh,remoteAtPayment:remoteConfirmed,
        snapshot:firstPersistedRows[0]?.cantidad??null,
        persisted:ventas.filter(v=>v.mesa==='Mesa test').map(v=>v.cantidad),
        total:ventas.filter(v=>v.mesa==='Mesa test').reduce((n,v)=>n+v.total,0),
        persistedTotal:firstPersistedRows.reduce((n,v)=>n+v.total,0),
        distinctLineCount:Object.keys(distinctLines).length,receiptAfterConfirmedSale,duringSync,delayedRpc,partialRetry,changedUserSales,changedStoreSales};
    }, {syncSource:sourceOf('syncActiveOpenOrderView'),shouldPreserveSource:sourceOf('ooShouldPreserveLocal'),mergeSource:sourceOf('ooMergeRemoteWithPending')});
    assert.equal(result.visibleAtClick, 5);
    assert.equal(result.localAtClick, 5);
    assert.equal(result.visibleAfterRefresh, 5, JSON.stringify(result));
    assert.equal(result.localAfterRefresh, 5);
    assert.equal(result.snapshot, 5);
    assert.equal(result.remoteAtPayment, 5);
    assert.deepEqual(result.persisted, [5], JSON.stringify(result));
    assert.equal(result.total, 500);
    assert.equal(result.persistedTotal, 500);
    assert.equal(result.distinctLineCount, 4);
    assert.equal(result.receiptAfterConfirmedSale, true, 'el comprobante aparece solo tras una venta confirmada');
    assert.equal(result.duringSync.receiptWhenRefused, false, 'un cobro rechazado no muestra comprobante');
    assert.equal(result.duringSync.paymentSyncStarted, true);
    assert.equal(result.duringSync.visible, 2);
    assert.equal(result.duringSync.persisted, 0, JSON.stringify(result.duringSync));
    assert.match(result.duringSync.toast, /pedido cambió/i);
    assert.equal(result.delayedRpc.firstQty, 1, JSON.stringify(result.delayedRpc));
    assert.equal(result.delayedRpc.secondQty, 2, JSON.stringify(result.delayedRpc));
    assert.deepEqual(result.delayedRpc.afterOldResponse, {dirty:true,qty:2,status:'pending',queuedRevision:2});
    assert.equal(result.delayedRpc.finalDirty, false);
    assert.equal(result.delayedRpc.finalQty, 2);
    assert.equal(result.delayedRpc.version, 2);
    assert.deepEqual(result.partialRetry.rows, [1]);
    assert.match(result.partialRetry.toast, /cobro anterior pendiente/i);
    assert.equal(result.changedUserSales, 0);
    assert.equal(result.changedStoreSales, 0);
    const beforeReload = await page.evaluate(() => {addItem('prod-test');return {qty:carrito['prod-test_plain'].qty,dirty:mesas[0]._items_dirty};});
    assert.deepEqual(beforeReload, {qty:3,dirty:true});
    await page.reload();
    await page.waitForFunction(() => typeof addItem === 'function');
    const afterReload = await page.evaluate(() => ({qty:mesas.find(m=>m.id==='mesa-rpc')?.items?.['prod-test_plain']?.qty??null,
      dirty:mesas.find(m=>m.id==='mesa-rpc')?._items_dirty??null}));
    assert.deepEqual(afterReload, {qty:3,dirty:true});
    const closureRecovery = await page.evaluate(async () => {
      config.activeStoreId='store-test';
      window.__sesionLista=true;
      window.__sesionUserId=()=> 'user-test';
      localStorage.setItem('colocafe_ctx_verificado',JSON.stringify({user_id:'user-test',store_id:'store-test'}));
      const origin={store_id:'store-test',user_id:'user-test',pendiente:true};
      mesas.push({id:'mesa-close',_sb_id:'mesa-close',open_order_id:'mesa-close',nombre:'Mesa close',items:{},_origin:origin});
      pendingOpenOrderClosures=[{id:'close-test',open_order_id:'mesa-close',status:'syncing',payload:{deleteItems:true},_origin:origin}];
      let writes=0;
      window.__coloSupabaseClient={from:table=>({
        select(){return this;},eq(){return this;},update(){writes++;return this;},delete(){writes++;return this;},
        maybeSingle(){return Promise.resolve({data:{id:'mesa-close',status:'closed',metadata:{}},error:null});},
        then(resolve){resolve({error:null});}
      })};
      const first=await window.retryPendingOpenOrderClosures({silent:true});
      const second=await window.retryPendingOpenOrderClosures({silent:true});
      return {first,second,queue:pendingOpenOrderClosures.length,mesa:!!mesas.find(m=>m.id==='mesa-close'),writes};
    });
    assert.equal(closureRecovery.first.synced, 1);
    assert.equal(closureRecovery.second.total, 0);
    assert.equal(closureRecovery.queue, 0);
    assert.equal(closureRecovery.mesa, false);
    assert.equal(closureRecovery.writes, 2);
    const secondContext = await browser.newContext({serviceWorkers:'block'});
    await secondContext.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue() : route.abort('blockedbyclient'));
    const secondPage = await secondContext.newPage();
    await secondPage.goto(`http://127.0.0.1:${server.address().port}/`);
    await secondPage.waitForFunction(() => typeof addItem === 'function');
    const editOtherTable = (id) => {
      config.activeStoreId='store-test';
      menu=[{id:'prod-test',name:'Test',price:100,cat:'cafe',stock:100,ilimitado:true,variantes:[]}];
      mesas=[{id,_sb_id:id,open_order_id:id,nombre:id,tipo:'salon',items:{},_items_version:1}];
      mesaActivaId=id;carrito={};
      $('view-mesas').style.display='none';$('view-pedido').style.display='block';
      window.getOpenOrdersSyncState=()=>({ready:true});
      window.syncMesaToSupabase=async m=>{await fetch('/__orders',{method:'POST',body:JSON.stringify({id:m.id,items:m.items})});window.__mockSent=true;return true;};
      addItem('prod-test');
    };
    await page.evaluate(editOtherTable,'device-a-table');
    await secondPage.evaluate(editOtherTable,'device-b-table');
    await Promise.all([page.waitForFunction(()=>window.__mockSent===true),secondPage.waitForFunction(()=>window.__mockSent===true)]);
    assert.equal(mockOrders.get('device-a-table')['prod-test_plain'].qty,1);
    assert.equal(mockOrders.get('device-b-table')['prod-test_plain'].qty,1);
    await secondContext.close();
    assert.deepEqual(remoteResponses, [], `remote requests were intercepted: ${external.length}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
