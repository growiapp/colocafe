'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const repo = path.join(__dirname, '..');
// R_B2A_INDEX permite correr la misma suite contra otra versión de index.html (demostración contra la implementación anterior).
const current = readFileSync(process.env.R_B2A_INDEX || path.join(repo, 'index.html'), 'utf8');
const baseline = execFileSync('git', ['show', 'f26ebfc:index.html'], {cwd:repo, encoding:'utf8'});
const storeId = '11111111-1111-4111-8111-111111111111';
const saleId = '22222222-2222-4222-8222-222222222222';
const group = {
  ref:{ticket_id:'t_case',_source_kind:'mesa'},
  rows:[{id:'v_one',ticket_id:'t_case'}],
  payments:[{metodo:'efectivo',monto:100}],
  legacyId:'t_case'
};

function between(html, start, end){
  const from=html.indexOf(start), to=html.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,`Bloque ausente: ${start}`);
  return html.slice(from,to);
}
function source(html){
  return [
    between(html,'function descuentoSobre(', 'function textoDescuento('),
    between(html,'  function makeSalesReadBackError(', '  window.loadSalesFromSupabasePreview='),
    between(html,'  async function findExistingSaleRow(', '  window.mapSaleGroupToSupabaseSale='),
    between(html,'  window.saveSaleGroupToSupabase=async function(group){', '  // Un ticket nunca se envía dos veces')
  ].join('\n');
}
// Campos comerciales como los escriben mapSaleGroupToSupabaseSale, mapSaleItemToSupabaseItem y mapSalePaymentToSupabasePayment.
const saleRow=(extra={})=>({id:saleId,store_id:storeId,legacy_id:'t_case',metadata:{ticket_id:'t_case'},
  subtotal_amount:100,total_amount:100,operator_name:'local',...extra});
const itemRow=(extra={})=>({id:'33333333-3333-4333-8333-333333333333',store_id:storeId,sale_id:saleId,legacy_id:'v_one',
  product_name:'local',quantity:1,unit_price:100,variants_price:0,line_total:100,...extra});
const paymentRow=(extra={})=>({id:'44444444-4444-4444-8444-444444444444',store_id:storeId,sale_id:saleId,
  legacy_id:'t_case:efectivo',method:'efectivo',amount:100,...extra});
const completeRows=()=>({sales:[saleRow()],sale_items:[itemRow()],sale_payments:[paymentRow()]});
const emptyRows=()=>({sales:[],sale_items:[],sale_payments:[]});

function createDb(initial=completeRows(),options={}){
  const rows=structuredClone(initial), calls=[];
  let saleSelects=0, lostPayments=0;
  const losePayment=()=>options.losePaymentResponse&&lostPayments++<(options.losePaymentResponse===true?Infinity:options.losePaymentResponse);
  const client={from(table){
    let op='select', payload=null, filters=[], head=false;
    const query={
      select(_cols,opts){head=!!opts?.head;return query;},
      eq(key,value){filters.push([key,value]);return query;},
      insert(value){op='insert';payload=value;return query;},
      update(value){op='update';payload=value;return query;},
      maybeSingle(){return Promise.resolve(run(true));},
      single(){return Promise.resolve(run(true));},
      then(resolve,reject){return Promise.resolve(run(false)).then(resolve,reject);}
    };
    function run(single){
      const matched=()=>rows[table].filter(row=>filters.every(([key,value])=>row[key]===value));
      calls.push({table,op,filters:structuredClone(filters),payload:payload&&structuredClone(payload)});
      if(op==='select'){
        options.afterSelect?.(table);
        if(options.failSelect===table)return {data:null,error:{message:'lectura fallida'}};
        if(table==='sales'&&options.hideFirstSaleSelect&&++saleSelects===1)return {data:null,error:null};
        const found=matched();
        if(head)return {data:null,error:null,count:found.length};
        return {data:single?(found[0]||null):structuredClone(found),error:null};
      }
      if(op==='update'){
        const found=matched();
        for(const row of found)Object.assign(row,payload);
        return {data:single?(found[0]||null):found,error:null};
      }
      if(op==='insert'){
        const conflict=options.insertError;
        if(conflict)return {data:null,error:{code:'23505',message:`duplicate key value violates unique constraint "${conflict}"`}};
        // Como el esquema: únicos (store_id, legacy_id) en las tres tablas y los CHECK de cantidad e importe.
        if(rows[table].some(row=>row.store_id===payload.store_id&&row.legacy_id===payload.legacy_id))
          return {data:null,error:{code:'23505',message:`duplicate key value violates unique constraint "${table}_store_legacy_unique_idx"`}};
        if((table==='sale_items'&&!(payload.quantity>0))||(table==='sale_payments'&&!(payload.amount>0)))
          return {data:null,error:{code:'23514',message:'violates check constraint'}};
        const row={...payload,id:table==='sales'?saleId:`new_${rows[table].length}`};
        rows[table].push(row);
        if(table==='sales'&&options.loseSaleResponse)return {data:null,error:{message:'network lost'}};
        if(table==='sale_payments'&&losePayment())return {data:null,error:{message:'payment response lost'}};
        return {data:row,error:null};
      }
      throw new Error(`Operación desconocida ${op}`);
    }
    return query;
  }};
  return {client,rows,calls};
}
function harness(html,db,{origin=()=>({ok:true}),context}={}){
  const marks=[];
  const ctx={window:null,console:{warn(){},error(){},log(){}},setTimeout(){},
    origenPermite:origin,hasSalesSupabaseReady:()=>true,getSalesStoreId:()=>storeId,
    mientrasSigaElContexto:()=>context||(()=>true),money2:n=>Math.round((Number(n)||0)*100)/100,
    isValidUuid:value=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value)),
    getSalesSupabaseClient:()=>db.client,getSalesSession:async()=>({user:{id:'user_a'}}),
    getSalesStoreName:()=>'',getStableSaleLegacyId:g=>g.legacyId,
    getStableSaleItemLegacyId:row=>row.id,
    getStableSalePaymentLegacyId:(g,p)=>`${g.legacyId}:${p?.metodo||'efectivo'}`,
    // Mismos campos que los mappers reales; los valores salen de la fila local, como en mapSaleItemToSupabaseItem.
    mapSaleGroupToSupabaseSale:async g=>({store_id:storeId,legacy_id:g.legacyId,metadata:{ticket_id:g.ref.ticket_id||null},
      operator_name:'local',subtotal_amount:g.subtotal??g.total??100,total_amount:g.total??100}),
    mapSaleItemToSupabaseItem:async(row,id)=>({store_id:storeId,sale_id:id,legacy_id:row.id,product_name:'local',
      quantity:row.cantidad??1,unit_price:row.precioBase??100,variants_price:row.precioVars??0,line_total:row.total??100,
      metadata:row.descuento?{descuento:{...row.descuento,bruto:row.bruto}}:{}}),
    mapSalePaymentToSupabasePayment:(p,id,g)=>({store_id:storeId,sale_id:id,legacy_id:`${g.legacyId}:${p.metodo}`,method:p.metodo,amount:p.monto}),
    getTicketPayments:g=>g.payments,setSalesWriteState(){},logSalesWriteAttempt(){},logSalesTableError(){},
    markLocalSaleRowsSync(_rows,mark){marks.push(mark);},refreshSalesDiagnostics:async()=>{},stampSalesMoment:()=>'',
    salesCurrentStoreName:'',salesLastTicket:'',salesLastSyncAt:''};
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(source(html),ctx,{filename:'index.html:sales',timeout:1000});
  return {ctx,marks};
}
const writes=db=>db.calls.filter(call=>call.op==='insert'||call.op==='update');
const writeLog=db=>writes(db).map(x=>`${x.op}:${x.table}`);

test('bloqueante: venta 100, ítem válido de 150 y pago faltante no inserta nada ni se marca synced',async()=>{
  const rows={sales:[saleRow()],sale_items:[itemRow({unit_price:150,line_total:150})],sale_payments:[]};
  const db=createDb(rows),{ctx,marks}=harness(current,db);
  const before=structuredClone(db.rows);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='SALE_PARTIAL_MISMATCH');
  assert.deepEqual(writes(db),[]);
  assert.deepEqual(db.rows,before);
  assert.equal(marks.at(-1).status,'partial_error');
});

test('identidad válida con cantidad incompatible frena la conciliación sin escribir',async()=>{
  const rows={sales:[saleRow()],sale_items:[itemRow({quantity:2})],sale_payments:[]};
  const db=createDb(rows),{ctx,marks}=harness(current,db);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='SALE_PARTIAL_MISMATCH');
  assert.deepEqual(writes(db),[]);
  assert.notEqual(marks.at(-1).status,'synced');
});

test('cabecera parcial con total distinto de esta operación frena sin escribir',async()=>{
  const db=createDb({sales:[saleRow({total_amount:150})],sale_items:[],sale_payments:[]}),{ctx}=harness(current,db);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='SALE_PARTIAL_MISMATCH');
  assert.deepEqual(writes(db),[]);
});

test('baseline reproduce UPDATE comercial; venta completa con edición remota coherente se adopta sin escribir',async()=>{
  const oldDb=createDb();
  await harness(baseline,oldDb).ctx.saveSaleGroupToSupabase(group);
  assert.ok(writes(oldDb).some(x=>x.op==='update'&&x.table==='sales'));
  const edited={sales:[saleRow({total_amount:90,subtotal_amount:90,operator_name:'edición remota'})],
    sale_items:[itemRow({unit_price:90,line_total:90,product_name:'edición remota'})],
    sale_payments:[paymentRow({amount:90,method:'mercado_pago'})]};
  const db=createDb(edited),{ctx,marks}=harness(current,db);
  const result=await ctx.saveSaleGroupToSupabase(group);
  assert.equal(result.ok,true);
  assert.equal(result.saleId,saleId);
  assert.deepEqual(writes(db),[]);
  assert.deepEqual(db.rows,edited);
  assert.equal(marks.at(-1).status,'synced');
});

test('venta completa con importes remotos que no cierran nunca se marca synced',async()=>{
  for(const mutate of [rows=>{rows.sale_items[0].line_total=150;},rows=>{rows.sale_payments[0].amount=90;},
    rows=>{rows.sale_payments[0].amount=null;}]){
    const rows=completeRows();mutate(rows);
    const db=createDb(rows),{ctx,marks}=harness(current,db);
    await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='READ_BACK_COMMERCIAL_MISMATCH');
    assert.deepEqual(writes(db),[]);
    assert.equal(marks.at(-1).status,'partial_error');
  }
});

test('INSERT de la venta con respuesta perdida: el reintento completa solo ítems y pagos faltantes',async()=>{
  const db=createDb(emptyRows(),{loseSaleResponse:true});
  const {ctx,marks}=harness(current,db);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.message==='network lost');
  assert.equal(marks.at(-1).status,'error');
  db.rows.sales[0].operator_name='edición remota';
  assert.equal((await ctx.saveSaleGroupToSupabase(group)).ok,true);
  assert.equal(db.rows.sales.length,1);
  assert.equal(db.rows.sale_items.length,1);
  assert.equal(db.rows.sale_payments.length,1);
  assert.deepEqual(writeLog(db),['insert:sales','insert:sale_items','insert:sale_payments']);
  assert.equal(db.rows.sales[0].operator_name,'edición remota');
  assert.equal(marks.at(-1).status,'synced');
});

test('detalle parcial coherente: inserta solo lo que falta y una segunda interrupción converge sin duplicar',async()=>{
  const rows=completeRows();rows.sale_payments=[];
  const db=createDb(rows,{losePaymentResponse:1});
  const {ctx,marks}=harness(current,db);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.message==='payment response lost');
  assert.equal(marks.at(-1).status,'partial_error');
  assert.equal((await ctx.saveSaleGroupToSupabase(group)).ok,true);
  assert.equal(db.rows.sale_items.length,1);
  assert.equal(db.rows.sale_payments.length,1);
  assert.deepEqual(writeLog(db),['insert:sale_payments']);
  assert.equal(marks.at(-1).status,'synced');
});

test('respuesta perdida tras el último INSERT: el reintento solo lee y conserva una fila por componente',async()=>{
  const db=createDb(emptyRows(),{losePaymentResponse:true});
  const {ctx,marks}=harness(current,db);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.message==='payment response lost');
  assert.equal(marks.at(-1).status,'partial_error');
  const before=writes(db).length;
  assert.equal((await ctx.saveSaleGroupToSupabase(group)).ok,true);
  assert.equal(writes(db).length,before);
  assert.equal(db.rows.sale_payments.length,1);
  assert.equal(marks.at(-1).status,'synced');
});

test('un 23505 al completar el detalle deja la venta pendiente y no actualiza nada',async()=>{
  const rows=completeRows();rows.sale_items=[itemRow({id:'otro',sale_id:'otra_venta'})];
  const db=createDb(rows),{ctx,marks}=harness(current,db);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='23505');
  assert.equal(marks.at(-1).status,'partial_error');
  assert.equal(writes(db).filter(x=>x.op==='update').length,0);
  assert.equal(db.rows.sale_items.length,1);
});

test('23505 del índice de identidad recupera solo una venta completa',async()=>{
  const db=createDb(completeRows(),{hideFirstSaleSelect:true,insertError:'sales_store_legacy_unique_idx'});
  const {ctx}=harness(current,db);
  assert.equal((await ctx.saveSaleGroupToSupabase(group)).ok,true);
  assert.equal(db.rows.sales.length,1);
  assert.deepEqual(writeLog(db),['insert:sales']);
});

test('23505 de otra restricción no confirma una venta aunque exista la misma identidad',async()=>{
  const db=createDb(completeRows(),{hideFirstSaleSelect:true,insertError:'sales_other_unique_idx'});
  const {ctx,marks}=harness(current,db);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='23505');
  assert.equal(marks.at(-1).status,'error');
  assert.equal(writes(db).filter(x=>x.op==='update').length,0);
});

test('23505 del índice correcto sin fila legible permanece pendiente',async()=>{
  const db=createDb(emptyRows(),{insertError:'sales_store_legacy_unique_idx'});
  const {ctx,marks}=harness(current,db);
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='23505');
  assert.equal(marks.at(-1).status,'error');
  assert.equal(writes(db).filter(x=>x.op==='update').length,0);
});

test('venta histórica por legacy_id conserva recuperación de solo lectura',async()=>{
  const oldGroup={...group,ref:{_source_kind:'mesa'},legacyId:'2026-10-31|Ana|mesa|ef'};
  const rows=completeRows();
  rows.sales[0].legacy_id=oldGroup.legacyId;
  rows.sales[0].metadata={fallback_key:oldGroup.legacyId};
  rows.sale_payments[0].legacy_id=`${oldGroup.legacyId}:efectivo`;
  const db=createDb(rows),{ctx}=harness(current,db);
  assert.equal((await ctx.saveSaleGroupToSupabase(oldGroup)).ok,true);
  assert.deepEqual(writes(db),[]);
});

test('identidades extrañas, detalle de otra venta o lecturas fallidas nunca sincronizan ni escriben',async()=>{
  for(const mutate of [
    rows=>{rows.sale_items[0].legacy_id='v_ajeno';},
    rows=>{rows.sale_payments[0].legacy_id='p_ajeno';},
    rows=>{rows.sale_items.push(itemRow({id:'extra',legacy_id:'v_extra'}));},
    rows=>{rows.sales[0].metadata.ticket_id='t_ajeno';}
  ]){
    const rows=completeRows();mutate(rows);
    const db=createDb(rows),{ctx,marks}=harness(current,db);
    await assert.rejects(ctx.saveSaleGroupToSupabase(group));
    assert.notEqual(marks.at(-1).status,'synced');
    assert.deepEqual(writes(db),[]);
  }
  for(const table of ['sale_items','sale_payments']){
    const rows=completeRows();rows.sale_payments=[];
    const db=createDb(rows,{failSelect:table}),{ctx,marks}=harness(current,db);
    await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.message==='lectura fallida');
    assert.notEqual(marks.at(-1).status,'synced');
    assert.deepEqual(writes(db),[]);
  }
});

test('cambio de cuenta o local retiene el pendiente antes de consultar o escribir',async()=>{
  const db=createDb();
  const {ctx}=harness(current,db,{origin:()=>({ok:false,motivo:'otro contexto'})});
  await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='F0B_RETENIDA');
  assert.equal(db.calls.length,0);
});

test('cambio de contexto durante una espera de la conciliación frena antes de escribir y no marca la venta',async()=>{
  for(const flipAfter of ['sales','sale_payments']){
    let vigente=true;
    const rows=completeRows();rows.sale_payments=[];
    const db=createDb(rows,{afterSelect:table=>{if(table===flipAfter)vigente=false;}});
    const {ctx,marks}=harness(current,db,{context:()=>vigente});
    await assert.rejects(ctx.saveSaleGroupToSupabase(group),err=>err.code==='F0B_RETENIDA');
    assert.deepEqual(writes(db),[]);
    assert.equal(marks.length,0);
  }
});

// ── Integridad por línea: fórmula de carritoItemBruto, carritoItemTotal y resumenCobro ──
const ticketGroup=(rows,payments,total,extra={})=>({ref:{ticket_id:'t_case',_source_kind:'mesa'},rows,payments,legacyId:'t_case',total,...extra});
const remoteFor=(g,{items,sale={}})=>({
  sales:[saleRow({total_amount:g.total,subtotal_amount:g.subtotal??g.total,...sale})],
  sale_items:items.map((it,n)=>itemRow({id:`item_${n}`,legacy_id:g.rows[n].id,...it})),
  sale_payments:g.payments.map((p,n)=>paymentRow({id:`pay_${n}`,legacy_id:`t_case:${p.metodo}`,method:p.metodo,amount:p.monto}))
});
async function syncs(g,rows){
  const db=createDb(rows),{ctx,marks}=harness(current,db);
  let outcome;
  try{outcome=(await ctx.saveSaleGroupToSupabase(g)).ok?'synced':'not_ok';}catch(err){outcome=err.code||err.message;}
  return {outcome,writes:writes(db),status:marks.at(-1)?.status,db};
}
const linePct10={linea:10,ticket:0,regla:{tipo:'pct',valor:10},regla_ticket:null,bruto:100};
const oneLine=(total,{subtotal,items,payment=total})=>{
  const g=ticketGroup([{id:'v_one'}],[{metodo:'efectivo',monto:payment}],total,subtotal===undefined?{}:{subtotal});
  return {g,remote:remoteFor(g,{items})};
};

test('A · cantidad 2 × 100 con línea de 100 y sin descuento: bloqueada aunque los totales cierren',async()=>{
  const {g,remote}=oneLine(100,{items:[{quantity:2,unit_price:100,line_total:100}]});
  const r=await syncs(g,remote);
  assert.equal(r.outcome,'READ_BACK_LINE_MISMATCH');
  assert.deepEqual(r.writes,[]);
  assert.equal(r.status,'partial_error');
});

test('B · cantidad 2 × 100 con línea de 200: sincroniza sin escribir',async()=>{
  const {g,remote}=oneLine(200,{items:[{quantity:2,unit_price:100,line_total:200}]});
  const r=await syncs(g,remote);
  assert.equal(r.outcome,'synced');
  assert.deepEqual(r.writes,[]);
});

test('C · descuentos válidos de línea y de ticket explican el total menor; los que no salen de su regla se bloquean',async()=>{
  let c=oneLine(90,{subtotal:100,items:[{line_total:90,metadata:{descuento:linePct10}}]});
  assert.equal((await syncs(c.g,c.remote)).outcome,'synced');
  // resumenCobro con 100 + 2 × 50 y $30 al ticket: netos 100 y 100, reparto 15 y 15, líneas 85 y 85.
  const regla_ticket={tipo:'monto',valor:30};
  const share=(ticket,extra={})=>({metadata:{descuento:{linea:0,ticket,regla:null,regla_ticket,bruto:100}},...extra});
  const two=(t1,t2,total)=>{
    const g=ticketGroup([{id:'v_one'},{id:'v_two'}],[{metodo:'efectivo',monto:total}],total,{subtotal:200});
    return {g,remote:remoteFor(g,{items:[share(t1,{line_total:100-t1}),share(t2,{quantity:2,unit_price:50,line_total:100-t2})]})};
  };
  c=two(15,15,170);
  assert.equal((await syncs(c.g,c.remote)).outcome,'synced');
  for(const bad of [
    oneLine(80,{subtotal:100,items:[{line_total:80,metadata:{descuento:{...linePct10,linea:20}}}]}),
    oneLine(90,{subtotal:100,items:[{line_total:90,metadata:{descuento:{...linePct10,regla:null}}}]}),
    two(15,10,175)
  ]){
    const r=await syncs(bad.g,bad.remote);
    assert.equal(r.outcome,'READ_BACK_LINE_MISMATCH');
    assert.deepEqual(r.writes,[]);
  }
});

test('E · venta parcial con una línea inconsistente no inserta nada',async()=>{
  // La línea presente no coincide con la operación local.
  let c=oneLine(100,{items:[{quantity:2,unit_price:100,line_total:100}]});c.remote.sale_payments=[];
  let r=await syncs(c.g,c.remote);
  assert.equal(r.outcome,'SALE_PARTIAL_MISMATCH');
  assert.deepEqual(r.writes,[]);
  // La operación local misma es inconsistente y lo remoto la copia: solo la fórmula por línea lo detecta.
  const gBad=ticketGroup([{id:'v_one',cantidad:2,precioBase:100,total:100}],[{metodo:'efectivo',monto:100}],100);
  for(const items of [[{quantity:2,unit_price:100,line_total:100}],[]]){
    const remote=remoteFor(gBad,{items});remote.sale_payments=[];
    r=await syncs(gBad,remote);
    assert.equal(r.outcome,'SALE_PARTIAL_MISMATCH');
    assert.deepEqual(r.writes,[]);
  }
});

test('F · campos de línea faltantes o inválidos nunca se declaran synced',async()=>{
  for(const [total,it] of [[100,{quantity:null}],[100,{unit_price:null}],[100,{variants_price:undefined}],[100,{line_total:'abc'}],
    [100,{quantity:0}],[90,{line_total:90,metadata:{descuento:{...linePct10,linea:'x'}}}],
    [90,{line_total:90,metadata:{descuento:{...linePct10,bruto:undefined}}}]]){
    const c=oneLine(total,{items:[it]});
    const r=await syncs(c.g,c.remote);
    assert.notEqual(r.outcome,'synced',JSON.stringify(it));
    assert.deepEqual(r.writes,[]);
  }
});

test('G · varias líneas con centavos y pago mixto cierran; un centavo de más en una línea no da falso éxito',async()=>{
  const rows=[{id:'v_1'},{id:'v_2'},{id:'v_3'}];
  const items=[0,1,2].map(()=>({unit_price:33.33,line_total:33.33}));
  const g=ticketGroup(rows,[{metodo:'efectivo',monto:50},{metodo:'mercado_pago',monto:49.99}],99.99);
  assert.equal((await syncs(g,remoteFor(g,{items}))).outcome,'synced');
  const gOff=ticketGroup(rows,[{metodo:'efectivo',monto:50},{metodo:'mercado_pago',monto:50}],100);
  const r=await syncs(gOff,remoteFor(gOff,{items:[...items.slice(0,2),{unit_price:33.33,line_total:33.34}]}));
  assert.equal(r.outcome,'READ_BACK_LINE_MISMATCH');
  assert.deepEqual(r.writes,[]);
});
