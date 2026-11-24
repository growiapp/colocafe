/* DEMO — SOLO VISTA PREVIA LOCAL. Este archivo lo inyecta el servidor de demostración; no forma parte de index.html ni del paquete que se publica.
   Reproduce los datos de ejemplo del prototipo V2 (datos ficticios) sobre la app real, sin Supabase. */
(()=>{
const hoy=new Date(), pad=n=>String(n).padStart(2,'0'), fecha=`${hoy.getFullYear()}-${pad(hoy.getMonth()+1)}-${pad(hoy.getDate())}`;
const U='demo-user',S='89000000-0000-4000-8000-000000000001';
const iso=(h,m)=>new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate(),h,m).toISOString();
const ago=min=>new Date(Date.now()-min*60000).toISOString();
const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
// Catálogo
const cats=[['cafe','Cafetería','#F27021','cafeteria'],['pan','Panadería','#C99A5B','cafeteria'],['coc','Cocina','#B43737','cocina'],['pas','Pastelería','#A0527A','cafeteria'],['beb','Bebidas','#235E9D','cafeteria']].map(([id,name,color,seccion])=>({id,name,color,seccion}));
const P=[[1,'Café con leche','cafe',2200,null],[2,'Flat white','cafe',2800,null],[3,'Espresso','cafe',1600,null],[4,'Latte de avena','cafe',3100,null],[5,'Medialuna','pan',900,38],[6,'Tostado de jamón y queso','coc',4500,null],[7,'Avocado toast','coc',5200,null],[8,'Cheesecake','pas',3900,4],[9,'Budín de limón','pas',1800,12],[10,'Jugo de naranja','beb',2600,null],[11,'Agua sin gas','beb',1400,30],[12,'Croissant','pan',1500,0]];
const menu=P.map(([id,name,cat,price,stock])=>({id:'p'+id,name,cat,price,stock:stock===null?0:stock,ilimitado:stock===null,variantes:[],active:true}));
const it=a=>Object.fromEntries(a.map(([pid,q])=>{const p=menu.find(m=>m.id==='p'+pid);return[p.id+'_plain',{prodId:p.id,qty:q,vars:[],nota:'',precio:p.price}]}));
const origin={store_id:S,user_id:U};
const mk=(n,nombre,tipo,min,a)=>({id:'0000000'+n+'-0000-4000-8000-00000000000'+n,_sb_id:'0000000'+n+'-0000-4000-8000-00000000000'+n,open_order_id:'0000000'+n+'-0000-4000-8000-00000000000'+n,legacy_local_id:'m_'+n,nombre,tipo,items:it(a),nota:'',pago:'ef',payment_mode:'single',pagos:[],apertura:ago(min),_items_version:1,_origin:origin});
// Mismas seis mesas/pedidos que el prototipo (importes incluidos)
const mesas=[mk(1,'Mesa 1','salon',12,[[1,2],[5,2]]),mk(4,'Mesa 4','salon',38,[[1,2],[6,1],[5,1],[10,1]]),mk(2,'Barra 2','salon',5,[[3,1]]),mk(7,'Mesa 7','salon',21,[[2,2],[8,1]]),mk(12,'Juan P.','delivery',9,[[6,2],[10,1]]),mk(3,'Para llevar 3','takeaway',2,[[1,2]])];
set('cats',cats);set('menu',menu);set('mesas',mesas);set('operadores',['Ana','Bruno','Carla']);
set('turno',{abierto:true,operador:'Ana',apertura:iso(8,0),fondoCaja:5000,ventasIds:[],_sb_id:'demo-shift'});
// Horas de las reservas de demostración RELATIVAS a la hora actual (+4 h y +5 h): el recordatorio (10 min antes a 60 min después) nunca coincide con la ejecución de las pruebas.
const HR=d=>String((new Date().getHours()+d)%24).padStart(2,'0')+':00';
set('reservas',[
 {id:'res_1',_sb_id:'10000000-0000-4000-8000-000000000001',tipo:'salon',nombre:'Familia Rodríguez',clienteId:'',clienteNombre:'',fecha,hora:HR(4),reservation_at:fecha+'T'+HR(4)+':00',recordatorio:'30',estado:'confirmada',nota:'Cumpleaños, traen torta propia',items:[{prodId:'p1',qty:4,vars:[],nota:'',precio:2200},{prodId:'p5',qty:4,vars:[],nota:'',precio:900}],pago:'ef',payment_mode:'single',pagos:[],_origin:origin},
 {id:'res_2',_sb_id:'10000000-0000-4000-8000-000000000002',tipo:'takeaway',nombre:'Martina Sosa',clienteId:'c1',clienteNombre:'Martina Sosa',fecha,hora:HR(5),reservation_at:fecha+'T'+HR(5)+':00',recordatorio:'10',estado:'pendiente',nota:'',items:[],pago:'transferencia',payment_mode:'single',pagos:[],_origin:origin}]);
set('clientes',[{id:'c1',_sb_id:'30000000-0000-4000-8000-000000000001',nombre:'Martina Sosa',telefono:'+54 11 5555-0101',email:'martina@example.com',alergias:'Maní',preferencias:'Latte de avena'},{id:'c2',_sb_id:'30000002-0000-4000-8000-000000000002',nombre:'Diego Ferreyra',telefono:'+54 11 5555-0102',email:'',alergias:'',preferencias:'Espresso doble'},{id:'c3',_sb_id:'30000003-0000-4000-8000-000000000003',nombre:'Sofía Paz',telefono:'+54 11 5555-0103',email:'sofia@example.com',alergias:'Celiaquía',preferencias:'Sin TACC'},{id:'c4',_sb_id:'30000004-0000-4000-8000-000000000004',nombre:'Familia Rodríguez',telefono:'+54 11 5555-0104',email:'',alergias:'',preferencias:''}]);
const V=(i,h,m,op,mesa,prod,cant,precio,pago,F=fecha)=>({id:'v_'+i,fecha:F,hora:pad(h)+':'+pad(m),timestamp:F+'T'+pad(h)+':'+pad(m)+':00',operador:op,mesa,tipo:'salon',ticket_id:'t_'+i,payment_mode:'single',pagos:[{metodo:pago,monto:cant*precio}],producto:prod,variantes:'',nota:'',categoria:'Cafetería',seccion:'cafeteria',cantidad:cant,precioBase:precio,precioVars:0,total:cant*precio,bruto:cant*precio,descuento:null,pago,_sb_sale_id:'40000000-0000-4000-8000-00000000'+pad(i)+'00',_sb_sync_status:'synced',_origin:origin});
const VV=[V(1,8,12,'Ana','Mesa 2','Café con leche',2,2200,'efectivo'),V(2,8,40,'Ana','Barra 1','Espresso',1,1600,'transferencia'),V(3,9,3,'Bruno','Mesa 5','Flat white',2,2800,'efectivo'),V(4,9,40,'Bruno','Mesa 3','Medialuna',4,900,'efectivo'),V(5,10,2,'Ana','Mesa 6','Tostado de jamón y queso',2,4500,'transferencia'),V(6,10,15,'Carla','Delivery','Avocado toast',1,5200,'transferencia'),...(()=>{const out=[];let n=100;for(let k=1;k<=6;k++){const d=new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate()-k);const F=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());const c=3+(k*2)%4;for(let j=0;j<c;j++){const q=P[(k*3+j*5)%P.length];out.push(V(n++,8+j*2,10+k*3,['Ana','Bruno','Carla'][(k+j)%3],'Mesa '+(1+(k+j)%7),q[1],1+(j*2+k)%3,q[3],(k+j)%2?'transferencia':'efectivo',F));}}return out;})()];set('ventas',VV);
set('gastos',[{id:'g1',fecha,hora:'09:15',desc:'Leche entera x12',monto:18400,pago:'efectivo',categoria:'insumos',nota:'',operador:'Ana',_origin:origin,_sb_id:'20000000-0000-4000-8000-000000000001'},{id:'g2',fecha,hora:'10:30',desc:'Servicio de limpieza',monto:9000,pago:'transferencia',categoria:'servicios',nota:'',operador:'Bruno',_origin:origin,_sb_id:'20000000-0000-4000-8000-000000000002'}]);
['colocafe_cuarentena_v1','pending_open_order_item_syncs','pending_open_order_closures','pending_shift_closures','pending_sales_operations'].forEach(k=>localStorage.removeItem(k));localStorage.setItem('colocafe_ctx_verificado',JSON.stringify({user_id:U,store_id:S}));
window.__sesionLista=true;window.__sesionUserId=()=>U;

// Comandas ya enviadas (para las etiquetas «N sin enviar» del prototipo)
const firma=(pid)=>pid+'||';
const L=(pid,q)=>({firma:firma(pid),prodId:pid,producto:menu.find(m=>m.id===pid).name,variantes:[],nota:'',cantidad:q});
const disp=[
 {open_order_id:mesas[0].id,sector:'cafeteria',lines:[L('p1',2),L('p5',2)]},
 {open_order_id:mesas[1].id,sector:'cafeteria',lines:[L('p1',2)]},{open_order_id:mesas[1].id,sector:'cocina',lines:[L('p6',1)]},
 {open_order_id:mesas[2].id,sector:'cafeteria',lines:[L('p3',1)]},
 {open_order_id:mesas[3].id,sector:'cafeteria',lines:[L('p2',2),L('p8',1)]}];
const turnos=[{id:'50000000-0000-4000-8000-000000000001',status:'open',business_date:fecha,opened_at:iso(8,0),closed_at:null,opened_by_name:'Ana',closed_by_name:null,opening_cash:5000,total_amount:30500,total_cash:20300,total_mercado_pago:0,total_transferencia:10200,total_other:0}];
const [yy,mm,dd]=fecha.split('-').map(Number);
for(let k=1;k<=4;k++){const d=new Date(yy,mm-1,dd-k);const f=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;turnos.push({id:'s'+(k+1),status:'closed',business_date:f,opened_at:new Date(d.getFullYear(),d.getMonth(),d.getDate(),8,0).toISOString(),closed_at:new Date(d.getFullYear(),d.getMonth(),d.getDate(),20,5).toISOString(),opened_by_name:k%2?'Bruno':'Ana',closed_by_name:k%2?'Bruno':'Ana',opening_cash:5000,total_amount:92000+k*6300,total_cash:51000+k*2000,total_mercado_pago:0,total_transferencia:41000+k*4300,total_other:0});}
const DATA={open_order_dispatches:disp,shifts:turnos};
// Ventas del turno abierto «s1» (mismas del día): permiten calcular su acumulado parcial por el mismo camino que producción.
const hoyV=VV.filter(v=>v.fecha===fecha);
DATA.sales=hoyV.map(v=>({id:'sv_'+v.id,store_id:S,legacy_id:v.ticket_id,legacy_source:'demo',metadata:{},shift_id:'50000000-0000-4000-8000-000000000001',total_amount:v.total,sold_at:v.timestamp,operator_name:v.operador}));
DATA.sale_items=hoyV.map(v=>({id:'si_'+v.id,sale_id:'sv_'+v.id,store_id:S,product_name:v.producto,category_name:'Cafetería',section:'cafeteria',quantity:v.cantidad,line_total:v.total}));
DATA.sale_payments=hoyV.map(v=>({id:'sp_'+v.id,sale_id:'sv_'+v.id,store_id:S,method:v.pago,amount:v.total}));
// Operadores del local (activos e inactivos) y de OTRO local: Cobrar debe mostrar solo los activos de este local
const OP=(id,name,active,store)=>({id:'60000000-0000-4000-8000-00000000000'+id,store_id:store||S,name,normalized_name:name.toLowerCase(),active,role:'operator',metadata:{}});
DATA.operators=[OP(1,'Ana',true),OP(2,'Bruno',true),OP(3,'Carla',true),OP(4,'Maia',false),OP(5,'Zeta',true,'89000000-0000-4000-8000-0000000000ff')];
window.__DEMO_DATA=DATA; // las pruebas pueden sustituir tablas
if(typeof window.__DEMO_PRE==='function')window.__DEMO_PRE(DATA,{S,mesas,L,disp}); // gancho de pruebas: ajusta los datos antes de que la app lea
window.__DEMO_LOG=[]; // consultas recibidas (tabla, filtros, página)
const GATED={sales:'shift_id',sale_items:'sale_id',sale_payments:'sale_id'}; // solo responden a consultas de un turno (el resto sigue sin servidor, como antes)
const builder=(t)=>{const f=[];let rg=null,lim=null;const b={select(){return b},eq(c,v){f.push(['eq',c,v]);return b},gte(){return b},order(){return b},limit(n){lim=n;return b},in(c,v){f.push(['in',c,v]);return b},range(a,z){rg=[a,z];return b},
  then(res,rej){const sinTurno=GATED[t]&&!f.some(x=>x[1]===GATED[t]);(sinTurno?(window.__DEMO_LOG_OTRAS||(window.__DEMO_LOG_OTRAS=[])):window.__DEMO_LOG).push({t,f:f.map(x=>x.slice()),rg,lim});let rows=DATA[t];if(sinTurno)rows=[]; // lecturas que no son de un turno: responden vacío y OK (el servidor «existe» pero sin ventas) y no se registran en __DEMO_LOG
    if(rows){rows=rows.filter(r=>f.every(([k,c,v])=>!(c in r)||(k==='eq'?r[c]===v:v.includes(r[c]))));if(rg)rows=rows.slice(rg[0],rg[1]+1);else if(lim!==null)rows=rows.slice(0,lim);}
    return Promise.resolve(rows?{data:rows,error:null}:{data:null,error:{code:'DEMO',message:'sin servidor en la demostración'}}).then(res,rej)}};return b;};
const MOCK={from:builder,auth:{getSession:async()=>({data:{session:{user:{id:U}}},error:null}),getUser:async()=>({data:{user:{id:U}},error:null})},rpc:(n,a)=>Promise.resolve({data:{ok:true,items_version:((a&&a.p_expected_version)||0)+1,version:((a&&a.p_expected_version)||0)+1},error:null})};Object.defineProperty(window,'__coloSupabaseClient',{get:()=>MOCK,set:()=>{},configurable:true});
// Contexto de la demostración: sesión, local y turno confirmados
const aplicar=()=>{
  if(typeof config==='undefined'||typeof renderContextoGlobal!=='function')return false;
  window.__coloSupabaseClient=MOCK;window.getSupabaseClient=()=>MOCK;config.activeStoreId=S;window.__sesionLista=true;window.__sesionUserId=()=>U;window.checkOpenOrderStillOpen=async()=>true;
  window.__contextoCuenta={loading:false,loggedIn:true,nombre:'Caja Palermo',rol:'operator',userId:U,storeId:S,store:{id:S,name:'Colo Café · Palermo'},storeCount:2};
  window.__turnoVerificado={userId:U,storeId:S,abierto:true,id:'demo-shift'};
  window.getOpenOrdersSyncState=()=>({ready:true,state:'ok',hasSupabaseRead:true});
  window.getActiveStoreName=()=> 'Colo Café · Palermo';window.getDashboardState=()=>null;
  try{renderContextoGlobal();}catch(_){}
  return true;
};
let n=0;const t=setInterval(()=>{aplicar();if(++n>200)clearInterval(t);},100);
setInterval(aplicar,1000);
document.title='Colo Café · DEMOSTRACIÓN';
const tag=document.createElement('div');tag.textContent='DEMOSTRACIÓN · datos ficticios';tag.style.cssText='position:fixed;left:108px;bottom:8px;z-index:99999;background:#F4C06A;color:#2A1206;font:700 11px sans-serif;padding:3px 8px;border-radius:999px;opacity:.9;pointer-events:none';
document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(tag));
})();
