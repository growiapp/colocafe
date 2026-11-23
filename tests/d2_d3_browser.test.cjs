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
const html = process.env.D2_D3_BASELINE === '1'
  ? execFileSync('git', ['show', 'cd4ef3a:index.html'], {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024})
  : fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('D2 y D3: app real con servidor simulado y red externa bloqueada', async () => {
  const server = http.createServer((req,res) => {
    const name = new URL(req.url,'http://local').pathname.slice(1) || 'index.html';
    if (!['index.html','logo.png','logo.svg','manifest.json','preview.jpg'].includes(name)) {res.writeHead(404);res.end();return;}
    res.setHeader('content-type',name.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');
    res.end(name==='index.html'?html:fs.readFileSync(path.join(root,name)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true,executablePath:chrome});
  const context = await browser.newContext({serviceWorkers:'block'});
  const blocked=[],responses=[];
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    blocked.push(url.href);
    if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({status:200,contentType:'text/javascript',body:'window.supabase={createClient:()=>null};'});
    return route.abort('blockedbyclient');
  });
  context.on('response',response=>{if(new URL(response.url()).hostname!=='127.0.0.1')responses.push(response.url());});
  const page=await context.newPage();
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>typeof setProdStock==='function'&&typeof getCajaPendingBannerState==='function');
    const result=await page.evaluate(async()=>{
      config.activeStoreId='local-test';
      menu=[{id:'d2',name:'Prueba',price:100,cat:cats[0]?.id||'cafe',stock:5,ilimitado:false,variantes:[]}];
      let confirms=0,rpcs=0,saveCalls=0;
      window.confirm=()=>{confirms++;return false;};
      window.saveProductStockToSupabase=async()=>{rpcs++;return true;};
      window.saveProductToSupabase=async()=>{saveCalls++;return true;};
      window.loadCatalogFromSupabase=async()=>true;
      catalogIsWaitingForSupabase=()=>false;
      window.getOpenOrdersSyncState=()=>({ready:true});
      stockFijarModo('local-test',{status:'active',activated_at:new Date().toISOString()});
      renderMenuAdm();
      const input=()=>document.querySelector('.prod-adm-stock-num');
      const edit=async value=>{
        input().value=value;
        input().dispatchEvent(new Event('change',{bubbles:true}));
        input()?.dispatchEvent(new Event('blur',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,0));
        return {stock:menu[0].stock,confirms,rpcs,error:document.querySelector('.stock-count-error')?.textContent||''};
      };
      const negative=await edit('-5');
      const empty=await edit('');
      const invalid=await edit('abc');
      const nonfinite=await edit('1e309');
      const cancel=await edit('4');
      window.confirm=()=>{confirms++;return true;};
      const zero=await edit('0');
      openProdModal('d2');
      $('m-stock').value='-5';
      await guardarProducto();
      const modal={saves:saveCalls,rpcs,error:$('m-stock-error')?.textContent||''};
      $('m-stock').value='';
      await guardarProducto();
      modal.emptyError=$('m-stock-error')?.textContent||'';
      openProdRapidoModal('ajustes');
      $('pr-nombre').value='Nuevo';$('pr-precio').value='100';$('pr-stock').value='-5';
      await guardarProdRapido();
      const quick={saves:saveCalls,error:$('pr-stock-error')?.textContent||''};
      $('pr-stock').value='0';
      await guardarProdRapido();
      quick.zero=menu.find(p=>p.name==='Nuevo')?.stock;
      quick.savesAfterZero=saveCalls;
      const classify=(code,message,status='error')=>{
        window.getPendingOperationsOutbox=()=>[{type:'venta',operation:'save_sale',status,error_code:code,last_error:message}];
        renderCajaPendingBanner();
        const state=getCajaPendingBannerState();
        return {rejected:state.rejected.length,confirming:state.confirming.length,html:$('caja-pending-banner').innerHTML};
      };
      const pause=classify('55000','STOCK_SALES_PAUSED: mantenimiento');
      const lock=classify('55P03','canceling statement due to lock timeout','partial_error');
      const timeout=classify('57014','canceling statement due to statement timeout');
      const unknown=classify('','network lost');
      const otherHttp=classify('503','Service Unavailable');
      const other55000=classify('55000','another object state error');
      const auth=classify('42501','permission denied');
      const authHttp=classify('403','Forbidden');
      const mismatch=classify('SALE_PARTIAL_MISMATCH','La venta no coincide');
      const toasts=[];
      showToast=message=>toasts.push(message);
      for(const name of ['syncLocalExpensesToSupabase','syncLocalReservationsToSupabase','retryPendingOpenOrderWrites','retryPendingOpenOrderClosures','retryPendingShiftClosures'])window[name]=async()=>({ok:true});
      window.retryPendingSalesSync=async()=>({ok:false,failed:1});
      await retryCajaPendingOperations();
      return {negative,empty,invalid,nonfinite,cancel,zero,modal,quick,pause,lock,timeout,unknown,otherHttp,other55000,auth,authHttp,mismatch,retryToast:toasts.at(-1),confirms,rpcs,saveCalls};
    });
    console.log('D2_D3_BROWSER',JSON.stringify(result));
    assert.equal(result.negative.stock,5);
    for(const key of ['negative','empty','invalid','nonfinite']){
      assert.equal(result[key].rpcs,0,key);
      assert.equal(result[key].confirms,0,key);
      assert.match(result[key].error,/conteo físico/i,key);
    }
    assert.equal(result.cancel.stock,5);
    assert.equal(result.cancel.confirms,1,'una sola confirmación al cancelar');
    assert.equal(result.cancel.rpcs,0);
    assert.equal(result.zero.stock,0);
    assert.equal(result.zero.rpcs,1);
    assert.equal(result.modal.saves,0);
    assert.match(result.modal.error,/conteo físico/i);
    assert.match(result.modal.emptyError,/conteo físico/i);
    assert.equal(result.quick.saves,0);
    assert.match(result.quick.error,/conteo físico/i);
    assert.equal(result.quick.zero,0);
    assert.equal(result.quick.savesAfterZero,1);
    for(const key of ['pause','lock','timeout','unknown','otherHttp','other55000']){
      assert.equal(result[key].rejected,0,key);
      assert.match(result[key].html,/Reintentar/,key);
      assert.doesNotMatch(result[key].html,/avisá al administrador/,key);
    }
    assert.match(result.pause.html,/pausa|mantenimiento/i);
    assert.equal(result.auth.rejected,1);
    assert.match(result.auth.html,/administrador/);
    assert.doesNotMatch(result.auth.html,/Reintentar/);
    assert.equal(result.authHttp.rejected,1);
    assert.doesNotMatch(result.authHttp.html,/Reintentar/);
    assert.equal(result.mismatch.rejected,1);
    assert.doesNotMatch(result.mismatch.html,/Reintentar/);
    assert.equal(result.retryToast,'Reintento finalizado con avisos.');
    assert.ok(blocked.length>0,'se intentó cargar al menos una dependencia externa');
    assert.deepEqual(responses,blocked.filter(url=>new URL(url).hostname==='cdn.jsdelivr.net'),'las únicas respuestas externas son el SDK simulado por la ruta local');
    console.log('D2_D3_NETWORK',JSON.stringify({blocked,locallyFulfilled:responses}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
