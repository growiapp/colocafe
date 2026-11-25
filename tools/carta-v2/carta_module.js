(()=>{
'use strict';
// Capa de interfaz «Carta de mostrador» (V2). Solo presentación: lee el estado real de la app y delega todas las acciones en sus funciones.
// No contiene datos de demostración ni rutas que simulen ventas: el comprobante solo se muestra cuando la app confirmó la venta.
const $=id=>document.getElementById(id);
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const IC={
  cup:'<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  bars:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-3"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clip:'<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
  moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  ban:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  cloudok:'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 13 2 2 4-4"/>',
  cloudoff:'<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.5 15.4A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10 5"/>',
  cash:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  bank:'<path d="M3 22h18"/><path d="M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="m12 2 8 5H4Z"/>',
  split:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M12 5v14"/>',
  print:'<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="8"/>'
};
const svg=(n,s=20)=>`<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${IC[n]||''}</svg>`;

// ── Iconografía: reemplaza emojis por iconos de línea ──
const EMO=[['⛔','ban'],['⚠️','alert'],['⚠','alert'],['✓','check'],['🌙','moon'],['☀️','sun'],['☀','sun']];
const EMO_RE=/⛔|⚠️|⚠|✓|🌙|☀️|☀/;
function iconize(root){
  if(!root||!EMO_RE.test(root.textContent||''))return;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>EMO_RE.test(n.nodeValue)&&!n.parentElement?.closest('script,style,textarea,option,select,input')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
  const nodes=[];while(w.nextNode())nodes.push(w.currentNode);
  nodes.forEach(n=>{
    const frag=document.createDocumentFragment();let rest=n.nodeValue;
    while(rest){
      let idx=-1,hit=null;
      for(const e of EMO){const i=rest.indexOf(e[0]);if(i>=0&&(idx<0||i<idx||(i===idx&&e[0].length>hit[0].length))){idx=i;hit=e;}}
      if(idx<0){frag.appendChild(document.createTextNode(rest));break;}
      if(idx>0)frag.appendChild(document.createTextNode(rest.slice(0,idx)));
      const sp=document.createElement('span');sp.className='ic-i';sp.innerHTML=svg(hit[1],16);frag.appendChild(sp);
      rest=rest.slice(idx+hit[0].length);
    }
    n.parentNode.replaceChild(frag,n);
  });
}
function iconosNav(){document.querySelectorAll('[data-ic]').forEach(el=>{if(!el.dataset.done){el.innerHTML=svg(el.dataset.ic,24);el.dataset.done='1';}});}

// ── Resultados: Resumen · Ventas · Gastos · Turnos ──
const RES=[['resumen','Resumen'],['ventas','Ventas'],['gastos','Gastos'],['turnos','Turnos']];
let resActual='resumen';
function pintarSeg(){document.querySelectorAll('.res-head [data-r]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.r===resActual)));}
function montarResultados(){
  ['tab-dashboard','tab-historial'].forEach(id=>{
    const t=$(id);if(!t||t.querySelector(':scope > .res-head'))return;
    const h=document.createElement('div');h.className='res-head';
    h.innerHTML=`<h1 class="ph-title">Reportes</h1><div class="seg" role="group" aria-label="Secciones de Reportes">${RES.map(([k,l])=>`<button type="button" data-r="${k}" aria-pressed="${k===resActual}">${l}</button>`).join('')}</div>`;
    h.addEventListener('click',e=>{const b=e.target.closest('[data-r]');if(b)irResultados(b.dataset.r);});
    t.insertBefore(h,t.firstChild);
  });
  const sb=document.querySelector('#tab-historial > .subtab-bar');if(sb)sb.style.display='none';
  const th=$('tab-historial');
  if(th&&!$('hist-subtab-turnos')){
    const d=document.createElement('div');d.id='hist-subtab-turnos';d.style.display='none';
    d.innerHTML='<div class="hist-layout"><h2 class="sec">Turnos de los últimos 7 días</h2><div id="turnos-lista" aria-live="polite"></div></div>';
    th.appendChild(d);
  }
}
function irResultados(r){
  resActual=r;
  if(r==='resumen'){goTab('dashboard');}
  else{
    goTab('historial');
    const v=$('hist-subtab-ventas'),g=$('hist-subtab-gastos'),t=$('hist-subtab-turnos');
    if(r==='turnos'){if(v)v.style.display='none';if(g)g.style.display='none';if(t)t.style.display='block';renderTurnos();}
    else{if(t)t.style.display='none';switchHistSubtab(r);}
  }
  pintarSeg();
}
const fm=n=>typeof fmt==='function'?fmt(n):'$'+Math.round(Number(n)||0).toLocaleString('es-AR');
const hh=ts=>{try{return new Date(ts).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});}catch(_){return '';}};
// Acumulado parcial de un turno abierto: misma función y mismas reglas que el cierre y el modal «Turno activo».
// Se reutiliza durante 15 s (y mientras la consulta está en vuelo) para no repetir tres lecturas por cada visita a la pestaña.
const parcialCache=new Map();let turnosVez=0;
function parcialTurno(storeId,shiftId){
  const k=`${storeId}|${shiftId}`,c=parcialCache.get(k);
  if(c&&Date.now()-c.at<15000)return c.p;
  const fn=window.calculateShiftCloseTotalsFromSupabase;
  if(typeof fn!=='function')return Promise.reject(new Error('sin cálculo de turno'));
  const p=Promise.resolve().then(()=>fn(shiftId));
  parcialCache.set(k,{at:Date.now(),p});
  p.catch(()=>parcialCache.delete(k));
  return p;
}
async function renderTurnos(){
  const box=$('turnos-lista');if(!box)return;
  const vez=++turnosVez;
  const client=(window.__coloSupabaseClient||window.getSupabaseClient?.()),storeId=(typeof config!=='undefined'&&config?.activeStoreId)||'';
  if(!client||!storeId){box.innerHTML='<div class="empty-v2"><b>Los turnos se consultan en el servidor.</b><span>Iniciá sesión y elegí un local para ver sus turnos.</span></div>';return;}
  box.innerHTML='<div class="empty-v2"><span>Cargando turnos…</span></div>';
  const d=new Date();d.setDate(d.getDate()-6);const desde=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  try{
    const {data,error}=await client.from('shifts').select('id,status,business_date,opened_at,closed_at,opened_by_name,closed_by_name,opening_cash,total_amount,total_cash,total_mercado_pago,total_transferencia,total_other').eq('store_id',storeId).gte('business_date',desde).order('opened_at',{ascending:false}).limit(60);
    if(error)throw error;
    if(vez!==turnosVez)return;
    if(!data?.length){box.innerHTML='<div class="empty-v2"><b>Sin turnos en los últimos 7 días.</b></div>';return;}
    // Los turnos abiertos no tienen totales guardados: se calculan con las ventas ya confirmadas por el servidor.
    const parciales=await Promise.all(data.map(s=>s.status==='open'?parcialTurno(storeId,s.id).then(v=>({v}),()=>({fallo:true})):null));
    if(vez!==turnosVez)return;
    box.innerHTML=data.map((s,i)=>{
      const abierto=s.status==='open',par=parciales[i];
      const ok=!abierto||(par&&par.v);
      const t=abierto?(ok?{ef:par.v.totalEf,tr:par.v.totalTransferencia,otros:(Number(par.v.totalMp)||0)+(Number(par.v.totalOtro)||0),tot:par.v.total}:null)
        :{ef:s.total_cash,tr:s.total_transferencia,otros:(Number(s.total_mercado_pago)||0)+(Number(s.total_other)||0),tot:s.total_amount};
      const nota=abierto?(ok?(par.v.tickets?'Parcial: ventas ya confirmadas por el servidor. El total definitivo se fija al cerrar el turno.':'Todavía no hay ventas confirmadas en este turno. El total definitivo se fija al cerrar.'):'El total se confirma al cerrar el turno.'):'';
      return `<article class="turno-row"><div class="tr-main"><b>${esc(s.business_date||'')}</b><span>${esc(s.opened_by_name||'—')} · ${hh(s.opened_at)}${s.closed_at?` a ${hh(s.closed_at)}`:''}</span></div>
        <span class="tag ${abierto?'ok':'neutral'}">${abierto?'Abierto · parcial':'Cerrado'}</span>
        ${t?`<dl class="tr-tot"><div><dt>Efectivo</dt><dd>${fm(t.ef)}</dd></div><div><dt>Transferencia</dt><dd>${fm(t.tr)}</dd></div>${t.otros?`<div><dt>Otros</dt><dd>${fm(t.otros)}</dd></div>`:''}<div><dt>${abierto?'Total parcial':'Total'}</dt><dd><b>${fm(t.tot)}</b></dd></div></dl>`:''}
        ${nota?`<p class="tr-nota">${nota}</p>`:''}</article>`;
    }).join('');
  }catch(err){if(vez===turnosVez)box.innerHTML='<div class="empty-v2"><b>No pudimos cargar los turnos.</b><span>Reintentá en unos segundos.</span></div>';}
}
function envolverGoTab(){
  const orig=window.goTab;if(typeof orig!=='function'||orig.__carta)return;
  const nuevo=function(id){
    orig.apply(this,arguments);
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===id||(id==='historial'&&b.dataset.tab==='dashboard')));
    if(id==='dashboard'){resActual='resumen';pintarSeg();}
    if(id==='historial'&&resActual==='resumen'){resActual='ventas';pintarSeg();}
    if(id==='carga')setTimeout(()=>cargarPend(false),50);
  };
  nuevo.__carta=true;window.goTab=nuevo;
}

// ── Atención V2: tarjetas + columna derecha (reservas, o el pedido real de la mesa elegida) ──
// El pedido de la columna derecha ES el carrito real de la app (mismas funciones, versiones y conflictos): solo cambia dónde se muestra.
const escritorio=()=>window.matchMedia('(min-width:1024px)').matches;
let modo='lista';            // 'lista' | 'panel' | 'detalle'
let sel=null;                // id de la mesa seleccionada
const tabC=()=>$('tab-carga'),vmesas=()=>$('view-mesas'),vped=()=>$('view-pedido');
const idMesa=m=>String(getMesaOpenOrderId(m));
const mesaDe=id=>(mesas||[]).find(m=>idMesa(m)===String(id));
const pend=new Map(),envPorMesa=new Map(),pendConocidas=new Set();let pendAt=0,pendBusy=false,pendIntento=0,pendTimer=0,pendPendiente=false;
const contarPend=m=>Object.values(pendientesComanda(m.items,envPorMesa.get(idMesa(m))||[])).reduce((s,l)=>s+l.reduce((a,x)=>a+Math.abs(Number(x.cantidad)||0),0),0);
// Sin red: con las comandas ya leídas, un cambio de la mesa se refleja al momento. Si aparece una mesa aún no leída, se lee ya.
const faltanLeer=()=>(mesas||[]).some(m=>{const i=idMesa(m);return UUID_RE.test(i)&&!pendConocidas.has(i);}); // alguna mesa con id de servidor aún sin sus comandas
function recalcPend(){let nueva=false;(mesas||[]).forEach(m=>{const i=idMesa(m);if(pendConocidas.has(i)||!UUID_RE.test(i))pend.set(i,contarPend(m));else nueva=true;});return nueva;}
let cart=null,cartHome=null,resBloque=null,resHome=null;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Solo las comandas de las mesas abiertas de este local, en lotes de 50 mesas y páginas de 1000 filas: el historial de mesas cerradas no cuenta ni topa la consulta.
async function leerComandas(client,storeId,ids){
  const out=[];
  for(let i=0;i<ids.length;i+=50){
    const lote=ids.slice(i,i+50);
    for(let desde=0;;desde+=1000){
      const {data,error}=await client.from('open_order_dispatches').select('open_order_id,sector,lines').eq('store_id',storeId).in('open_order_id',lote).order('created_at',{ascending:true}).order('id',{ascending:true}).range(desde,desde+999);
      if(error)throw error;
      out.push(...(data||[]));
      if((data||[]).length<1000)break;
    }
  }
  return out;
}
async function cargarPend(force,necesaria){
  if(pendBusy){if(necesaria)pendPendiente=true;return;} // la lectura que una mesa nueva necesita y choca con otra en curso no se pierde: se repite al terminar
  if(!force&&Date.now()-pendAt<20000)return;
  const client=(window.__coloSupabaseClient||window.getSupabaseClient?.()),storeId=(typeof config!=='undefined'&&config?.activeStoreId)||'';
  if(!client||!storeId||typeof pendientesComanda!=='function')return;
  pendBusy=true;pendIntento=Date.now();
  try{
    const ids=[...new Set((mesas||[]).map(idMesa).filter(i=>UUID_RE.test(i)))];
    const data=ids.length?await leerComandas(client,storeId,ids):[];
    const por=new Map();data.forEach(d=>{if(!por.has(d.open_order_id))por.set(d.open_order_id,[]);por.get(d.open_order_id).push(d);});
    pend.clear();envPorMesa.clear();por.forEach((v,k)=>envPorMesa.set(String(k),v));
    pendConocidas.clear();ids.forEach(x=>pendConocidas.add(x));
    (mesas||[]).forEach(m=>pend.set(idMesa(m),contarPend(m)));
    pendAt=Date.now();pintarMesas();actualizarBotonComanda();pintarCabecera();
  }catch(_){}finally{pendBusy=false;if(pendPendiente){pendPendiente=false;if(faltanLeer())setTimeout(()=>cargarPend(true,true),Math.max(0,5000-(Date.now()-pendIntento))+50);}}
}
function pintarMesas(){
  const cont=$('mesas-container');if(!cont)return;
  cont.querySelectorAll('.mesa-card[data-mesa]').forEach(c=>{
    const id=c.dataset.mesa,esSel=modo==='panel'&&sel&&id===sel;
    if(esSel)c.setAttribute('aria-current','true');else c.removeAttribute('aria-current');
    let tags=c.querySelector('.mesa-tags');
    const n=pend.get(id)||0;
    const html=`${esSel?'<span class="seltag">Seleccionada</span>':''}${n>0?`<span class="tag warn">${n} sin enviar</span>`:''}`;
    if(!html){tags?.remove();return;}
    if(!tags){tags=document.createElement('div');tags.className='mesa-tags';c.insertBefore(tags,c.querySelector('.mesa-total'));}
    if(tags.innerHTML!==html)tags.innerHTML=html;
  });
}
function actualizarBotonComanda(){
  const n=pend.get(String(typeof mesaActivaId!=='undefined'?mesaActivaId:''))||0;
  const t=n>0?`Comanda · ${n} sin enviar`:'Comanda';
  const bp=document.querySelector('#atn-slot-cart [data-act="comanda"]');if(bp&&bp.textContent!==t)bp.textContent=t;   // panel lateral (escritorio)
  const b=document.querySelector('#view-pedido button[onclick="abrirComandaMesa()"]');if(!b)return;
  if(b.textContent!==t)b.textContent=t;
  const tg=document.querySelector('.cart-head2 .tag');if(tg){tg.hidden=!(n>0);const x=`${n} sin enviar`;if(tg.textContent!==x)tg.textContent=x;}
}
function anotarCarrito(){
  const id=String(typeof mesaActivaId!=='undefined'?mesaActivaId:'');
  // La fila ya se dibuja completa en renderOrderItemRows; aquí solo se completan el título y el total del Pedido.
  // (Se eliminó la leyenda «Sin enviar» por producto: queda solo el indicador agregado de la mesa.)
  const ct=$('cart-total');
  if(ct&&typeof carrito!=='undefined'){const n=Object.values(carrito).reduce((t,i)=>t+(Number(i.qty)||0),0),l=`Total · ${n} producto${n!==1?'s':''}`;if(ct.dataset.lbl!==l)ct.dataset.lbl=l;}
  const wrap=document.querySelector('.carrito-wrap');
  if(wrap&&!wrap.querySelector('.cart-head2')){const h=document.createElement('div');h.className='cart-head2';h.innerHTML='<span class="t">Pedido</span><span class="tag warn" hidden></span>';wrap.insertBefore(h,wrap.firstChild);}
  const sub=$('mesa-tipo-badge'),m=id&&!id.startsWith('reserva_')?mesaDe(id):null;
  if(sub&&m){const mins=m.apertura?Math.max(0,Math.round((Date.now()-new Date(m.apertura).getTime())/60000)):null,t=`${tipoLabel(m.tipo||'salon')}${mins!==null?` · abierta hace ${mins} min`:''}`;if(sub.textContent!==t)sub.textContent=t;}
}
function pintarCabecera(){
  const h=$('atn-head');if(!h||modo!=='panel')return;
  const m=mesaDe(sel);if(!m){h.innerHTML='';return;}
  const n=pend.get(idMesa(m))||0,mins=m.apertura?Math.max(0,Math.round((Date.now()-new Date(m.apertura).getTime())/60000)):null;
  const html=`<div class="tk-head"><h2>${esc(m.nombre||'Mesa')}</h2>${n>0?`<span class="tag warn">${n} sin enviar</span>`:''}<button type="button" class="tk-x" data-act="cerrar" aria-label="Cerrar el pedido y volver a la lista">${svg('x',20)}</button></div>
    <div class="tk-sub">${esc(tipoLabel(m.tipo||'salon'))}${mins!==null?` · abierta hace ${mins} min`:''}</div>`;
  if(h.innerHTML!==html)h.innerHTML=html;
}
function aside(){
  let a=$('atn-side');
  if(!a){
    a=document.createElement('aside');a.id='atn-side';a.className='atn-side';a.setAttribute('aria-label','Reservas y pedido');
    a.innerHTML='<div id="atn-slot-res"></div><div id="atn-slot-cart" class="tk" hidden><div id="atn-head"></div><div id="atn-slot-body"></div><div class="tk-more"><button type="button" class="btn-sm" data-act="comanda">Comanda</button><button type="button" class="btn-sm" data-act="abrir">Agregar productos</button></div></div>';
    tabC().appendChild(a);
    a.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;
      if(b.dataset.act==='cerrar')await volverAMesas();
      else if(b.dataset.act==='comanda'){abrirComandaMesa();}   // el mismo diálogo de la vista de la mesa: imprimir, marcar como enviada, reimprimir
      else if(b.dataset.act==='abrir'){vmesas().style.display='none';irDetalle();}});
  }
  return a;
}
function colocar(){
  const a=aside(),res=$('atn-slot-res'),cs=$('atn-slot-cart'),body=$('atn-slot-body');
  const lat=escritorio();
  const lado=lat&&modo!=='detalle';
  tabC().classList.toggle('atn-v2',lado);
  if(resBloque){
    if(lat&&modo!=='panel'&&modo!=='detalle'){if(resBloque.parentNode!==res)res.appendChild(resBloque);}
    else if(resBloque.parentNode!==resHome.parent)resHome.parent.insertBefore(resBloque,resHome.next);
  }
  if(modo==='panel'&&lat){cs.hidden=false;if(cart.parentNode!==body)body.appendChild(cart);}
  else{cs.hidden=true;if(cart.parentNode!==cartHome)cartHome.appendChild(cart);}
  a.hidden=!lado;
  tabC().classList.toggle('atn-panel',modo==='panel'&&lat);
  const ct=document.querySelector('#view-pedido .cart-title,#atn-slot-body .cart-title');if(ct){const w=modo==='panel'&&lat?'Total':'Pedido';if(ct.textContent!==w)ct.textContent=w;}
}
function irPanel(id){modo='panel';sel=String(id);vmesas().style.display='block';colocar();pintarMesas();pintarCabecera();actualizarBotonComanda();}
function irDetalle(){modo='detalle';colocar();pintarMesas();}
function irLista(){modo='lista';sel=null;colocar();pintarMesas();}
async function seleccionar(id){
  const abierta=vped().style.display==='block';
  if(abierta&&modo==='panel'&&sel===String(id)){await volverAMesas();return;}
  if(abierta)await volverAMesas();            // guarda y cierra la mesa anterior con la lógica real
  const tarjeta=document.querySelector(`.mesa-card[data-mesa="${CSS.escape(String(id))}"]`);tarjeta?.setAttribute('aria-busy','true');
  try{await abrirMesa(id);}finally{tarjeta?.removeAttribute('aria-busy');}   // validaciones, conflictos y carga del pedido: las de siempre
  if(vped().style.display==='block'&&String(mesaActivaId)===String(id))irPanel(id);
}
function montarAtencion(){
  const cont=$('mesas-container');if(!cont||cont.dataset.carta)return;cont.dataset.carta='1';
  cart=document.querySelector('#view-pedido .carga-right');cartHome=cart?.parentNode;
  // Bloque de reservas: se puede mover a la columna derecha sin tocar su render
  const t=document.querySelector('#view-mesas .ventas-section-title[style*="margin-top"]');
  if(t&&$('reservas-container')){
    resBloque=document.createElement('section');resBloque.id='reservas-bloque';
    const parent=t.parentNode,next=t.nextSibling;
    resBloque.append(t,$('reservas-container'),$('reservas-empty'));
    resHome={parent,next:null};parent.appendChild(resBloque);
  }
  const h1=$('atn-title'),vh=document.querySelector('#view-mesas .ventas-header'),acc=vh?.lastElementChild;
  if(h1&&acc&&!h1.parentNode.classList.contains('ph-row')){const row=document.createElement('div');row.className='ph-row';h1.parentNode.insertBefore(row,h1);row.append(h1,acc);}
  const sa=$('stock-alerts');if(sa&&cont.parentNode&&!sa.dataset.moved){sa.dataset.moved='1';cont.insertAdjacentElement('afterend',sa);}
  aside();colocar();
  cont.addEventListener('click',e=>{
    if(!escritorio()||!cart)return;
    const c=e.target.closest('.mesa-card[data-mesa]');if(!c||e.target.closest('button,.mesa-close,a'))return;
    if(c.querySelector('button.btn-sm:not(.primary)'))return;
    e.stopPropagation();e.preventDefault();seleccionar(c.dataset.mesa);
  },true);
  cont.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const c=e.target.closest?.('.mesa-card[data-mesa]');if(!c||e.target!==c)return;
    e.preventDefault();c.click();
  });
  new MutationObserver(()=>{if(sel&&!mesaDe(sel)&&modo==='panel')irLista();const nueva=recalcPend();pintarMesas();actualizarBotonComanda();pintarCabecera();
    // mesa nueva aún no leída: se lee ya, o apenas venza el freno de 5 s (si no, su etiqueta quedaría sin calcular hasta otro cambio de la lista)
    if(nueva){const espera=5000-(Date.now()-pendIntento);if(espera<=0)cargarPend(true,true);else if(!pendTimer)pendTimer=setTimeout(()=>{pendTimer=0;if(faltanLeer())cargarPend(true,true);},espera+50);}else cargarPend(false);}).observe(cont,{childList:true});
  window.matchMedia('(min-width:1024px)').addEventListener('change',()=>{if(modo==='panel'&&!escritorio())irDetalle();colocar();});
  const cr=$('cart-rows');if(cr)new MutationObserver(()=>{anotarCarrito();actualizarBotonComanda();}).observe(cr,{childList:true});
  const ctot=$('cart-total');if(ctot)new MutationObserver(anotarCarrito).observe(ctot,{childList:true,characterData:true,subtree:true});
  anotarCarrito();
  const vp=vped();
  if(vp)new MutationObserver(()=>{
    anotarCarrito();actualizarBotonComanda();
    if(vp.style.display==='none'){if(modo!=='lista')irLista();}
    else if(modo==='lista')irDetalle();
  }).observe(vp,{attributes:true,attributeFilter:['style']});
  const vm=vmesas();
  if(vm)new MutationObserver(()=>{if(modo==='panel'&&vm.style.display==='none')irDetalle();}).observe(vm,{attributes:true,attributeFilter:['style']});
}

// ── Pantalla de Cobro V2: medio de pago + quién atendió + resumen ──
// Es un frente de la lógica real: elige el medio con setPago(), y al confirmar ejecuta cerrarMesaOReserva() y confirmarOperadorCobro()
// en sucesión (misma firma de cobro, mismas validaciones y mismos contratos de confirmación).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let opElegido='';
let recibido=''; // efectivo entregado por el cliente (solo para calcular el vuelto; no se guarda con la venta)
let mixedHome=null;
let firmaVista='',cobrando=false;
const firmaCobro=()=>{try{const m=(typeof mesaDe==='function'&&mesaDe(mesaActivaId))||{};return JSON.stringify([m._items_version??null,Object.entries(carrito||{}).filter(([,i])=>Number(i.qty)>0).map(([k,i])=>[k,Number(i.qty),i.desc||i.descuento||null,typeof carritoItemTotal==='function'?carritoItemTotal(i):0]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),typeof totalCobroActual==='function'?totalCobroActual():0]);}catch(_){return '';}};
const medioActual=()=>{try{const ps=getCurrentPaymentState();return ps.payment_mode==='mixed'?'mixed':((ps.pagos&&ps.pagos[0]?.metodo)==='transferencia'?'transferencia':'ef');}catch(_){return 'ef';}};
function destinoCobro(){try{const t=getCurrentVentaTarget();return t?.nombre||t?.cliente||'Mesa';}catch(_){return 'Mesa';}}
const montoRecibido=()=>Number(recibido)||0;
function textoVuelto(total){total=Math.round(Number(total)||0);const r=montoRecibido(); // fm() muestra el total redondeado: se compara contra ese mismo importe
  if(!r)return{t:'',falta:false};return r>=total?{t:`Vuelto ${fm(r-total)}`,falta:false}:{t:`Faltan ${fm(total-r)}`,falta:true};}
function opcionesRecibido(total){total=Math.round(total);const s=new Set();[1000,5000,10000,20000].forEach(b=>{const v=Math.ceil(total/b)*b;if(v>total)s.add(v);});return[...s].slice(0,3);}
function pintarVuelto(){const e=$('cobro-vuelto');if(!e)return;const v=textoVuelto(typeof totalCobroActual==='function'?totalCobroActual():0);e.textContent=v.t;e.classList.toggle('falta',v.falta);}
function msgCobro(t){const m=$('cobro-msg');if(m){m.textContent=t||'';}}
function pintarCobro(){
  const sc=$('cobro-screen');if(!sc)return;
  const ae=document.activeElement,enRec=ae&&ae.id==='cobro-rec-in'&&sc.contains(ae),selRec=enRec?[ae.selectionStart,ae.selectionEnd]:null; // un repintado (p. ej. al llegar los operadores) no debe sacar el foco del importe
  firmaVista=firmaCobro();
  { const cx=$('mixed-payments-box'); if(cx&&sc.contains(cx)&&mixedHome) mixedHome.appendChild(cx); } // el repintado no debe destruir los campos del pago mixto
  const items=Object.values(carrito||{}).filter(i=>Number(i.qty)>0),total=typeof totalCobroActual==='function'?totalCobroActual():0;
  const cant=items.reduce((s,i)=>s+(Number(i.qty)||0),0),nombre=destinoCobro(),esRes=String(mesaActivaId||'').startsWith('reserva_');
  const m=medioActual(),estOps=typeof estadoOperadores==='function'?estadoOperadores():'local',ops=(typeof getActiveOperators==='function'?getActiveOperators():[]).map(o=>o.name).filter(Boolean);
  const ultimo=(typeof ultimoOperadorCobro!=='undefined'&&ultimoOperadorCobro&&ultimoOperadorCobro.mesa===String(mesaActivaId))?ultimoOperadorCobro.op:'';
  if(!opElegido||!ops.includes(opElegido))opElegido=ultimo&&ops.includes(ultimo)?ultimo:'';
  const medios=[['ef','Efectivo','cash'],['transferencia','Transferencia','bank'],['mixed','Mixto','split']];
  sc.innerHTML=`<button type="button" class="btn-sm back" data-c="volver">‹ ${esc(nombre)}</button>
  <div class="ph-row"><h1 class="ph-title">${esRes?'Cobrar reserva':'Cobrar'} ${esc(nombre)}</h1><p class="cobro-sub">Revisá el medio y quién atendió.</p></div>
  <div class="cobro-grid">
    <div class="cobro-main">
      <h2 class="sec2">Medio de pago</h2>
      <div class="cobro-medios" role="radiogroup" aria-label="Medio de pago">${medios.map(([k,l,ic])=>`<button type="button" role="radio" aria-checked="${k===m}" data-m="${k}">${svg(ic,22)}<span>${l}</span></button>`).join('')}</div>
      <div id="cobro-mixto-slot"></div>
      ${m==='ef'&&total>0?`<div class="cobro-rec"><label for="cobro-rec-in">Paga con <small>(opcional, para calcular el vuelto)</small></label>
        <div class="cr-fila"><input id="cobro-rec-in" type="text" inputmode="numeric" autocomplete="off" placeholder="$ recibido" value="${esc(recibido)}">
        <button type="button" data-r="${Math.round(total)}">Justo</button>${opcionesRecibido(total).map(v=>`<button type="button" data-r="${v}">${fm(v)}</button>`).join('')}</div>
        <p id="cobro-vuelto" class="cobro-vuelto${textoVuelto(total).falta?' falta':''}" aria-live="polite">${textoVuelto(total).t}</p></div>`:''}
      <h2 class="sec2">Quién atendió</h2>
      <div class="cobro-ops" role="radiogroup" aria-label="Quién atendió">${estOps==='cargando'?'<span class="hint">Cargando quién está activo…</span>':estOps==='no_disponible'?'<span class="hint">No pudimos leer las personas activas del local. <button type="button" class="btn-sm" data-c="ops">Reintentar</button></span>':ops.length?ops.map(o=>`<button type="button" role="radio" aria-checked="${o===opElegido}" data-o="${esc(o)}">${esc(o)}${o===ultimo?' <small>última vez</small>':''}</button>`).join(''):'<span class="hint">No hay personas activas cargadas. Pedile a administración que las agregue.</span>'}</div>
      ${ultimo?'<p class="hint">Se propone la última persona elegida en este dispositivo.</p>':''}
      <p id="cobro-msg" class="cobro-msg" role="alert"></p>
      <button type="button" class="btn-confirmar" data-c="confirmar"${cobrando||estOps==='no_disponible'||estOps==='cargando'?' disabled':''}>Confirmar cobro · ${fm(total)}</button>
    </div>
    <aside class="tk cobro-tk"><h2>${esc(nombre)}</h2><div class="tk-sub">${esRes?'Reserva':esc(tipoLabel((mesaDe(mesaActivaId)||{}).tipo||'salon'))+((mesaDe(mesaActivaId)||{}).apertura?` · abierta hace ${Math.max(0,Math.round((Date.now()-new Date(mesaDe(mesaActivaId).apertura).getTime())/60000))} min`:'')}</div>
      <ul class="tk-lines">${items.map(i=>{const p=findProductById(i.prodId);return `<li><span class="q">${Number(i.qty)}×</span><span class="n">${esc(p?.name||i.prodId)}</span><span class="v">${fm(carritoItemTotal(i))}</span></li>`;}).join('')}</ul>
      <div class="tk-total"><span>Total · ${cant} producto${cant!==1?'s':''}</span><b>${fm(total)}</b></div></aside>
  </div>`;
  if(enRec){const n=$('cobro-rec-in');if(n){n.focus();try{n.setSelectionRange(selRec[0],selRec[1]);}catch(_){}}}
  const slot=$('cobro-mixto-slot'),box=$('mixed-payments-box');
  if(slot&&box){if(m==='mixed'){slot.appendChild(box);slot.hidden=false;}else{slot.hidden=true;if(box.parentNode===slot&&mixedHome)mixedHome.appendChild(box);}}
}
// Cobrar nunca ofrece a alguien que acaba de quedar inactivo: se relee la lista del local al abrir y otra vez al confirmar.
const conTope=(p,ms)=>{let t;return Promise.race([p,new Promise(r=>{t=setTimeout(()=>{if(typeof operadoresLecturaVencida==='function')operadoresLecturaVencida();r(false);},ms);})]).finally(()=>clearTimeout(t));}; // una lectura que no responde no deja el cobro colgado
async function refrescarOperadoresCobro(){
  if(typeof loadOperatorsFromSupabase!=='function'||typeof operadoresModoServidor!=='function'||!operadoresModoServidor())return;
  await conTope(loadOperatorsFromSupabase(),8000);
  const sc=$('cobro-screen');if(sc&&!sc.hidden&&!cobrando)pintarCobro();
}
function abrirCobro(){
  const sc=$('cobro-screen');if(!sc)return;
  if(!Object.values(carrito||{}).some(i=>Number(i.qty)>0)){showToast('El pedido está vacío');return;}
  if(!mixedHome)mixedHome=$('mixed-payments-box')?.parentNode||null;
  recibido='';
  pintarCobro();sc.hidden=false;tabC().classList.add('cobro-abierto');window.scrollTo(0,0);
  setTimeout(()=>sc.querySelector('[data-m][aria-checked="true"]')?.focus(),30);
  refrescarOperadoresCobro();
}
function cerrarCobro(){
  const sc=$('cobro-screen');if(!sc||sc.hidden)return;
  const box=$('mixed-payments-box');if(box&&mixedHome&&box.parentNode!==mixedHome)mixedHome.appendChild(box);
  sc.hidden=true;tabC().classList.remove('cobro-abierto','cobro-auto');
}
async function confirmarCobro(btn){
  if(cobrando)return;
  if(!opElegido){msgCobro('Elegí quién atendió.');return;}
  if(typeof operadoresModoServidor==='function'&&operadoresModoServidor()){ // verificación fresca: ¿sigue activa esa persona en este local?
    cobrando=true;const b0=btn.textContent;btn.disabled=true;btn.textContent='Verificando…';
    let leida=false;
    try{leida=await conTope(loadOperatorsFromSupabase(),8000)===true;}catch(_){leida=false;}
    finally{cobrando=false;btn.textContent=b0;btn.disabled=false;}
    if(!leida||estadoOperadores()!=='ok'){pintarCobro();msgCobro('No pudimos verificar quién está activo. Reintentá.');return;}
    if(!getActiveOperators().some(o=>o.name===opElegido)){opElegido='';pintarCobro();msgCobro('Esa persona ya no está disponible. Elegí otra.');return;}
  }
  let ps;try{ps=getCurrentPaymentState();}catch(_){ps={valido:true};}
  if(!ps.valido){msgCobro(ps.mensaje||'Revisá los pagos antes de cobrar.');return;}
  if(firmaCobro()!==firmaVista){pintarCobro();msgCobro('El pedido cambió. Revisá el detalle y volvé a confirmar.');return;}
  cobrando=true;msgCobro('');const txt=btn.textContent;btn.disabled=true;btn.textContent='Cobrando…';tabC().classList.add('cobro-auto');
  try{
    await cerrarMesaOReserva();                         // valida y abre el diálogo real del operador
    const modal=$('modal-operador-cobro');
    for(let i=0;i<50&&!modal.classList.contains('open');i++)await sleep(100);
    if(!modal.classList.contains('open')){msgCobro('No pudimos iniciar el cobro. Revisá el aviso y volvé a intentar.');return;}
    const s=$('cobro-operador-sel');
    if(![...s.options].some(o=>o.value===opElegido)){cerrarModalOperadorCobro();msgCobro('Esa persona ya no está disponible. Elegí otra.');return;}
    if(firmaCobro()!==firmaVista){cerrarModalOperadorCobro();pintarCobro();msgCobro('El pedido cambió mientras confirmabas. Revisá el detalle y volvé a confirmar.');return;}
    s.value=opElegido;s.dispatchEvent(new Event('change',{bubbles:true}));
    await confirmarOperadorCobro();                     // el cobro real, con su firma y su confirmación
    if($('modal-operador-cobro').classList.contains('open'))cerrarModalOperadorCobro();
  }catch(err){msgCobro('No pudimos completar el cobro. Reintentá.');}
  finally{cobrando=false;tabC().classList.remove('cobro-auto');
    const sc=$('cobro-screen');
    if(sc&&!sc.hidden){const vivo=sc.querySelector('.btn-confirmar');if(vivo){vivo.disabled=false;vivo.textContent=`Confirmar cobro · ${fm(typeof totalCobroActual==='function'?totalCobroActual():0)}`;}}}
}
// Teclado: los <div role="button"> (filtros, acordeones, chips) se activan con Enter o Espacio, como un botón. La tarjeta de mesa ya lo resuelve por su cuenta.
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  const t=e.target;if(!t||t.getAttribute?.('role')!=='button'||/^(BUTTON|A|INPUT)$/.test(t.tagName)||t.matches('.mesa-card'))return;
  e.preventDefault();
  const pa=t.parentElement,i=pa?[...pa.children].indexOf(t):-1;
  t.click();
  if(!t.isConnected&&pa?.isConnected&&i>=0)pa.children[i]?.focus?.(); // si el clic repintó los filtros, el foco vuelve al mismo lugar
});
function montarCobro(){
  if($('cobro-screen'))return;
  const sc=document.createElement('section');sc.id='cobro-screen';sc.className='cobro-screen';sc.hidden=true;sc.setAttribute('aria-label','Cobro');tabC().appendChild(sc);
  document.addEventListener('click',e=>{
    const b=e.target.closest('#btn-confirm');if(!b)return;
    e.preventDefault();e.stopImmediatePropagation();if(!b.disabled)abrirCobro();
  },true);
  sc.addEventListener('click',e=>{
    const x=e.target.closest('[data-m],[data-o],[data-c],[data-r]');if(!x)return;
    if(x.dataset.r!==undefined){recibido=String(Math.round(Number(x.dataset.r)||0));const i=$('cobro-rec-in');if(i)i.value=recibido;pintarVuelto();i?.focus();}
    else if(x.dataset.m){try{setPago(x.dataset.m);}catch(_){}pintarCobro();sc.querySelector(`[data-m="${x.dataset.m}"]`)?.focus();}
    else if(x.dataset.o){opElegido=x.dataset.o;pintarCobro();sc.querySelector(`[data-o="${CSS.escape(opElegido)}"]`)?.focus();}
    else if(x.dataset.c==='volver')cerrarCobro();
    else if(x.dataset.c==='ops'){pintarCobro();refrescarOperadoresCobro();}
    else if(x.dataset.c==='confirmar')confirmarCobro(x);
  });
  sc.addEventListener('input',e=>{if(e.target.id!=='cobro-rec-in')return;recibido=e.target.value.replace(/\D/g,'').slice(0,9);if(e.target.value!==recibido)e.target.value=recibido;pintarVuelto();});
  sc.addEventListener('keydown',e=>{if(e.key==='Escape')cerrarCobro();});
  const vp=vped();if(vp)new MutationObserver(()=>{if(vp.style.display==='none')cerrarCobro();}).observe(vp,{attributes:true,attributeFilter:['style']});
  let tm=0;const alCambiar=()=>{if(sc.hidden||firmaCobro()===firmaVista)return;clearTimeout(tm);tm=setTimeout(()=>{if(sc.hidden||firmaCobro()===firmaVista)return;const bloqueado=sc.querySelector('.btn-confirmar')?.disabled;pintarCobro();msgCobro(bloqueado?'El pedido cambió mientras se cobraba. Revisá el detalle antes de volver a confirmar.':'El pedido cambió. Revisá el detalle y confirmá de nuevo.');},50);};
  ['cart-total','cart-rows'].forEach(id=>{const e=$(id);if(e)new MutationObserver(alCambiar).observe(e,{childList:true,characterData:true,subtree:true,attributes:true});});
}

// ── Cobro: resumen dentro del diálogo del operador ──
window.__cartaCobroResumen=(ps,items)=>{
  const box=$('cobro-resumen');if(!box)return;
  const total=typeof totalCobroActual==='function'?totalCobroActual():0;
  const cant=(items||[]).reduce((s,i)=>s+(Number(i.qty)||0),0);
  const t=typeof getCurrentVentaTarget==='function'?getCurrentVentaTarget():null;
  const pagos=(ps?.pagos||[]).map(p=>`<li><span>${esc(getPaymentMethodMeta(p.metodo).label)}</span><b>${fm(p.monto)}</b></li>`).join('');
  box.innerHTML=`<div class="cr-total"><span>${esc(t?.nombre||t?.cliente||'Cobro')} · ${cant} producto${cant!==1?'s':''}</span><b>${fm(total)}</b></div><ul class="cr-pagos">${pagos}</ul>`;
};

// ── Comprobante: solo después de que la app confirmó la venta ──
function ticketDe(nuevas){
  const f=nuevas[0]||{},suma=(k)=>nuevas.reduce((s,v)=>s+(Number(v[k])||0),0);
  return{fecha:f.fecha,hora:f.hora,tipo:f.tipo,mesa:f.mesa,operador:f.operador,ticketId:f.ticket_id,
    items:nuevas.map(v=>({cantidad:v.cantidad,producto:v.producto,variantes:v.variantes,nota:v.nota,bruto:v.bruto,total:v.total,descLinea:Number(v.descuento?.linea)||0})),
    subtotal:suma('bruto'),descuento:{productos:nuevas.reduce((s,v)=>s+(Number(v.descuento?.linea)||0),0),ticket:nuevas.reduce((s,v)=>s+(Number(v.descuento?.ticket)||0),0)},
    total:suma('total'),payments:f.pagos||[],persistida:true};
}
let ultimoTicket=null;
function cerrarComprobante(){const m=$('modal-comprobante');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');}}
window.__cartaComprobante=(nuevas,{estado='ok',reserva=false}={})=>{
  if(!nuevas?.length)return;
  let m=$('modal-comprobante');
  if(!m){
    m=document.createElement('div');m.id='modal-comprobante';m.className='modal-ov';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.setAttribute('aria-labelledby','cmp-titulo');
    m.addEventListener('click',e=>{if(e.target===m)cerrarComprobante();});
    m.addEventListener('keydown',e=>{if(e.key==='Escape')cerrarComprobante();});
    document.body.appendChild(m);
  }
  const t=ticketDe(nuevas);ultimoTicket=t;
  const ok=estado==='ok';
  const titulo=reserva?'Reserva cobrada':(ok?'Venta guardada':'Cobro registrado');
  const desc=t.descuento.productos+t.descuento.ticket;
  m.innerHTML=`<div class="modal-box cmp-box">
    <div class="cmp-head"><span class="cmp-ok">${svg('check',22)}</span><h2 class="modal-title" id="cmp-titulo">${titulo}</h2></div>
    <p class="cmp-sub">${ok?'La venta quedó guardada.':'La venta quedó registrada. Falta confirmar en el servidor el cierre de la mesa: seguilo en Operaciones pendientes.'}</p>
    <div class="ticket cmp-ticket">
      <div class="cmp-t1">${esc(typeof nombreComercio==='function'?nombreComercio():'Colo Café')}</div>
      <div class="cmp-t2">${esc(t.fecha||'')}${t.hora?` · ${esc(t.hora)}`:''} · ${esc(tipoLabel(t.tipo||'salon'))}${t.mesa?` · ${esc(t.mesa)}`:''}</div>
      ${t.operador?`<div class="cmp-t2">Atendió · ${esc(t.operador)}</div>`:''}
      <div class="cmp-lines">${t.items.map(i=>`<div class="lead"><span class="l">${Number(i.cantidad)||0} × ${esc(i.producto)}${i.variantes?`<small>${esc(i.variantes)}</small>`:''}</span><span class="v">${fm(i.bruto??i.total)}</span></div>`).join('')}</div>
      ${desc?`<div class="lead sub"><span class="l">Descuentos</span><span class="v">−${fm(desc)}</span></div>`:''}
      <div class="cmp-total"><span>Total</span><b>${fm(t.total)}</b></div>
      <div class="cmp-pagos">${(t.payments||[]).map(p=>`<div>Pago · ${esc(getPaymentMethodMeta(p.metodo).label)} <b>${fm(p.monto)}</b></div>`).join('')}</div>
      <div class="cmp-foot">No válido como factura</div>
    </div>
    <div class="modal-actions"><button type="button" class="btn-sm" data-cmp="print">${svg('print',18)} Imprimir comprobante</button><button type="button" class="btn-save" data-cmp="close">Listo</button></div>
  </div>`;
  m.onclick=e=>{const b=e.target.closest('[data-cmp]');if(b?.dataset.cmp==='close')cerrarComprobante();else if(b?.dataset.cmp==='print'&&ultimoTicket&&typeof imprimirDocumentos==='function'&&typeof htmlTicket==='function')imprimirDocumentos(htmlTicket(ultimoTicket));else if(e.target===m)cerrarComprobante();};
  m.classList.add('open');m.removeAttribute('aria-hidden');
  setTimeout(()=>m.querySelector('[data-cmp="close"]')?.focus(),30);
};

// ── Encabezados de página para Clientes y Gestión ──
function titulos(){
  [['tab-clientes','Clientes'],['tab-ajustes','Gestión']].forEach(([id,t])=>{const el=$(id);if(el&&!el.querySelector(':scope > .ph-title')){const h=document.createElement('h1');h.className='ph-title ph-page';h.textContent=t;el.insertBefore(h,el.firstChild);}});
}

// ── Encabezado: una sola barra (local · fecha · turno · datos · usuario) ──
function montarEncabezado(){
  const hr=document.querySelector('.header-right');if(!hr||hr.dataset.v2)return;
  const t=$('ctx-turno'),s=$('ctx-sync'),c=$('ctx-cuenta'),th=$('theme-toggle');if(!t||!s||!c)return;
  hr.dataset.v2='1';
  [t,s,th,c].forEach(e=>e&&hr.appendChild(e));
  s.insertBefore(Object.assign(document.createElement('span'),{innerHTML:svg('cloud',18),className:'ic-sync'}),s.firstChild);
  const fecha=$('hoy-lbl');
  if(fecha){const f=()=>{const x=fecha.textContent.replace(/\s+\d{1,2}:\d{2}$/,'');if(fecha.textContent!==x)fecha.textContent=x;};f();new MutationObserver(f).observe(fecha,{childList:true,characterData:true,subtree:true});}
  const tv=t.querySelector('.ctx-v');
  if(tv){const hora=()=>{const m=/^Abierto (\d{1,2}:\d{2})$/.exec(tv.textContent.trim());t.classList.toggle('solo-hora',!!m);if(m)tv.dataset.hora=m[1];else delete tv.dataset.hora;};hora();new MutationObserver(hora).observe(tv,{childList:true,characterData:true,subtree:true});}
  const ico=s.querySelector('.ic-sync');
  const nube=()=>{const e=s.dataset.estado;const h=svg(e==='ok'?'cloudok':(e==='error'?'cloudoff':'cloud'),18);if(ico&&ico.innerHTML!==h)ico.innerHTML=h;};nube();new MutationObserver(nube).observe(s,{attributes:true,attributeFilter:['data-estado']});
  const av=document.createElement('span');av.className='av';const who=document.createElement('span');who.className='who-t';who.innerHTML='<b></b><span></span>';
  c.insertBefore(who,c.firstChild);c.insertBefore(av,c.firstChild);
  const ini=n=>{const p=String(n||'').trim().split(/\s+/).filter(Boolean);return (p.length>1?p[0][0]+p[1][0]:(p[0]||'?').slice(0,2)).toUpperCase();};
  const pintar=()=>{
    const nombre=c.querySelector('.ctx-v')?.textContent||'',k=(c.querySelector('.ctx-k')?.textContent||'').replace(/^Cuenta\s*·?\s*/i,'');
    const rol=k?k.charAt(0).toUpperCase()+k.slice(1):'';
    const sesion=!/^(Iniciar sesión|Cargando)/i.test(nombre);
    const set=(el,v)=>{if(el.textContent!==v)el.textContent=v;};
    set(av,sesion?ini(nombre):'?');set(who.firstChild,nombre);set(who.lastChild,sesion?rol:'');
  };
  pintar();new MutationObserver(pintar).observe(c,{childList:true,subtree:true,characterData:true});
}
function iniciar(){
  montarEncabezado();montarCobro();iconosNav();titulos();montarResultados();montarAtencion();envolverGoTab();
  iconize(document.body);
  let t=null;new MutationObserver(()=>{clearTimeout(t);t=setTimeout(()=>{iconosNav();iconize(document.body);},120);}).observe(document.body,{childList:true,subtree:true,characterData:true});
  cargarPend(true);
  setInterval(()=>{if(document.visibilityState==='visible')cargarPend(false);},6000);setTimeout(()=>cargarPend(true),1500);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(iniciar,0));else setTimeout(iniciar,0);
})();
