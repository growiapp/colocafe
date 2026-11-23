'use strict';

const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {webcrypto} = require('node:crypto');
const {test} = require('node:test');
const vm = require('node:vm');

// Ejecuta solo las funciones de gastos del archivo real. No carga el HTML ni inicializa Supabase.
const html = readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const between = (start, end) => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `No se encontró el bloque ${start}`);
  return html.slice(from, to);
};
const code = [
  between('function nuevoUuidV4Gasto(){', 'function getPersistenceStatusInfo('),
  between('function mapExpenseFromSupabase(row){', 'function logExpenseWriteError('),
  between('window.saveExpenseToSupabase=async function(', 'window.deleteExpenseFromSupabase=async function('),
  between('window.deleteExpenseFromSupabase=async function(', 'window.syncLocalExpensesToSupabase=async function('),
  between('window.syncLocalExpensesToSupabase=async function(', 'window.reloadExpensesFromSupabase=async function(')
].join('\n');
const confirmationWrapper = between(
  '  const _confirmarGastoOperadorExpenses=window.confirmarGastoOperador;',
  '  renderExpensesSupabaseUi();'
);
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storeId = '11111111-1111-4111-8111-111111111111';
const operatorId = '22222222-2222-4222-8222-222222222222';
const pending = {fecha:'2026-10-31', hora:'12:30', desc:'Insumos', monto:12.5, pago:'efectivo', categoria:'otros', nota:''};

function harness(cryptoApi = webcrypto) {
  const storage = new Map();
  const events = [];
  const toasts = [];
  const elements = {
    'gasto-operador-sel': {value:'Ana', selectedOptions:[{dataset:{operatorId}}]},
    'modal-gasto-operador': {dataset:{pending:JSON.stringify(pending)}}
  };
  const ctx = {
    crypto:cryptoApi, Uint8Array, gastos:[], operadores:['Ana'], expensesCurrentRole:'operator',
    localStorage:{getItem:key=>storage.get(key)??null, setItem:(key,value)=>storage.set(key,value)},
    $:key=>elements[key], operacionesBloqueadasPorDiario:()=>false,
    isSupabaseAdminRole:()=>false, getOperatorByName:()=>({id:operatorId}),
    save:()=>{storage.set('gastos',JSON.stringify(ctx.gastos));events.push('save');},
    cerrarModalGastoOperador:()=>events.push('close'),
    renderGastos:()=>{}, syncGastosSheets:()=>events.push('sheets-stub'),
    showToast:message=>toasts.push(message), console:{log:()=>{}, warn:()=>{}, error:()=>{}},
    isValidUuid:value=>typeof value==='string' && uuidV4.test(value),
    normalizeBusinessDate:value=>value, getLocalDateString:()=>pending.fecha,
    normalizeLegacyFrontId:value=>value,
    getLocalTimeString:()=>pending.hora,
    parseLocalDateSafe:()=>new Date('2026-10-31T12:30:00Z'),
    parseSpentAtSafe:()=>new Date('2026-10-31T12:30:00Z'),
    getLocalTimestamp:date=>date.toISOString(), money2:value=>Number(value),
    normalizePaymentMethod:value=>value,
    queryStoreExpenses:async()=>[], origenEnviable:()=>true, origenPermite:()=>({motivo:''}),
    hasExpensesSupabaseReady:()=>true, getExpensesStoreId:()=>storeId,
    getExpensesSession:async()=>({user:{id:operatorId}}),
    getSupabaseClient:()=>null, inferExpensesPolicyMessage:()=>'', logExpenseWriteError:()=>{},
    getExpenseSupabaseErrorMessage:error=>error?.message||String(error), setTimeout:()=>{},
    setExpensesState:()=>{}, stampExpensesMoment:()=>'', renderExpensesSupabaseUi:()=>{},
    isLocalPersistencePending:record=>record._sync_status!=='confirmed'
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, {filename:'index.html:gastos', timeout:1000});
  return {ctx, storage, events, toasts};
}

test('gastos nuevos: UUID v4 distintos, guardados antes de sincronizar y estables al editar y recargar', async () => {
  let generations = 0;
  const {ctx, storage, events} = harness({randomUUID(){generations++;return webcrypto.randomUUID();}});
  const first = await ctx.confirmarGastoOperador();
  const second = await ctx.confirmarGastoOperador();
  assert.match(first.id, uuidV4);
  assert.match(second.id, uuidV4);
  assert.notEqual(first.id, second.id);
  assert.equal(first.desc, second.desc);
  assert.deepEqual(events.slice(0,3), ['save','close','sheets-stub']);
  assert.equal(JSON.parse(storage.get('gastos'))[0].id, first.id);
  first.nota = 'Editado localmente';
  ctx.save();
  ctx.gastos = JSON.parse(storage.get('gastos'));
  assert.equal(ctx.gastos[0].id, first.id);
  assert.equal(ctx.gastos[0].nota, 'Editado localmente');
  assert.equal(generations, 2);
});

test('fallback usa getRandomValues con bits v4; sin criptografía segura falla antes de guardar', async () => {
  const fallback = harness({getRandomValues:bytes=>{bytes.fill(0xff);return bytes;}});
  const expense = await fallback.ctx.confirmarGastoOperador();
  assert.equal(expense.id, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  const missing = harness(undefined);
  missing.ctx.crypto = null;
  await assert.rejects(missing.ctx.confirmarGastoOperador(), /fuente criptográfica segura/);
  assert.equal(missing.ctx.gastos.length, 0);
  assert.equal(missing.storage.has('gastos'), false);
});

test('si falla la persistencia local, el gasto no queda en memoria para el envío', async () => {
  const {ctx, storage, events} = harness();
  let remoteAttempts = 0;
  ctx.save = () => {throw new Error('localStorage sin espacio');};
  ctx.getSupabaseClient = () => {remoteAttempts++;return null;};
  vm.runInContext(confirmationWrapper,ctx,{filename:'index.html:confirmarGastoOperador-wrapper'});
  assert.equal(await ctx.confirmarGastoOperador(), null);
  assert.equal(ctx.gastos.length, 0);
  assert.equal(storage.has('gastos'), false);
  assert.equal(events.includes('sheets-stub'), false);
  assert.equal(remoteAttempts, 0);
});

test('mapeo y búsqueda usan PK UUID; el gasto histórico conserva legacy_id', async () => {
  const {ctx} = harness();
  const id = ctx.nuevoUuidV4Gasto();
  const expense = {...pending,id};
  const payload = ctx.mapExpenseToSupabase(expense,storeId,null);
  assert.equal(payload.id,id);
  assert.equal(payload.legacy_id,null);
  const row = {...payload,spent_at:'2026-10-31T12:30:00Z'};
  assert.equal(ctx.mapExpenseFromSupabase(row).id,id);
  assert.equal((await ctx.findExistingExpenseRow(null,storeId,expense,[row])).id,id);
  const legacy = {...pending,id:'g_1761913800000'};
  const oldPayload = ctx.mapExpenseToSupabase(legacy,storeId,null);
  assert.equal(oldPayload.id,undefined);
  assert.equal(oldPayload.legacy_id,legacy.id);
  const oldRow = {...oldPayload,id:ctx.nuevoUuidV4Gasto()};
  assert.equal(ctx.mapExpenseFromSupabase(oldRow).id,legacy.id);
  assert.equal((await ctx.findExistingExpenseRow(null,storeId,legacy,[oldRow])).id,oldRow.id);
});

function attachRemote(ctx,{insertMode='normal',readErrorAt=0,allowLegacyUpdate=false}={}) {
  const rows = [];
  const calls = [];
  let reads = 0;
  ctx.queryStoreExpenses = async () => {
    calls.push('list');
    if(!allowLegacyUpdate) throw new Error('Consulta de toda expenses en recuperación UUID');
    return rows.map(row=>({...row}));
  };
  ctx.getSupabaseClient = () => ({from(table){
    assert.equal(table,'expenses');
    let operation, payload;
    const filters = {};
    return {
      select(){return this;},
      eq(key,value){filters[key]=value;return this;},
      async maybeSingle(){
        calls.push('point');
        reads++;
        assert.ok(filters.id && filters.store_id, 'la lectura puntual requiere id y store_id');
        if(reads===readErrorAt) return {data:null,error:{code:'FETCH',message:'lectura fallida'}};
        return {data:rows.find(row=>row.id===filters.id&&row.store_id===filters.store_id)||null,error:null};
      },
      insert(value){operation='insert';payload=value;calls.push('insert');return this;},
      update(value){
        calls.push('update');
        if(!allowLegacyUpdate) throw new Error('UPDATE inesperado en recuperación UUID');
        operation='update';payload=value;return this;
      },
      delete(){operation='delete';calls.push('delete');return this;},
      async single(){
        if(operation==='insert'){
          if(insertMode==='pkey-existing'){
            // Otra escritura ganó la carrera; este INSERT se rechaza sin aplicarse.
            rows.push({...payload,description:'Edición remota posterior'});
            return {data:null,error:{code:'23505',constraint:'expenses_pkey',message:'duplicate key'}};
          }
          if(insertMode==='other-23505') return {data:null,error:{code:'23505',constraint:'expenses_other_unique',message:'otra unicidad'}};
          if(insertMode==='network') return {data:null,error:{code:'NETWORK',message:'red caída'}};
          const row={...payload,id:payload.id||webcrypto.randomUUID()};
          rows.push(row);
          if(insertMode==='lost-response') return {data:null,error:{code:'NETWORK',message:'respuesta perdida'}};
          return {data:{...row},error:null};
        }
        const row=rows.find(item=>item.id===filters.id&&item.store_id===filters.store_id);
        assert.ok(row);
        if(operation==='delete'){rows.splice(rows.indexOf(row),1);return {data:{id:filters.id},error:null};}
        Object.assign(row,payload);
        return {data:{...row},error:null};
      }
    };
  }});
  return {rows,calls};
}

test('primera creación y reintento: una fila, sin UPDATE ni lectura de toda la tabla', async () => {
  let generations=0;
  const {ctx,storage}=harness({randomUUID(){generations++;return webcrypto.randomUUID();}});
  const {rows,calls}=attachRemote(ctx);
  vm.runInContext(confirmationWrapper,ctx);
  const expense=await ctx.confirmarGastoOperador();
  assert.equal(expense._sync_status,'confirmed');
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,expense.id);
  assert.equal(rows[0].legacy_id,null);
  assert.equal(JSON.parse(storage.get('gastos'))[0].id,expense.id);
  expense._sync_status='error';
  ctx.save();
  rows[0].description='Edición remota posterior';
  const result=await ctx.syncLocalExpensesToSupabase();
  assert.equal(result.ok,true);
  assert.equal(result.synced,1);
  assert.deepEqual(calls,['point','insert','point']);
  assert.equal(rows.length,1);
  assert.equal(rows[0].description,'Edición remota posterior');
  assert.equal(expense.desc,'Edición remota posterior');
  assert.equal(expense._sync_status,'confirmed');
  assert.equal(generations,1);
});

test('respuesta perdida: tras recargar, recupera la fila por el mismo UUID sin otro INSERT', async () => {
  const {ctx,storage,toasts}=harness();
  const {rows,calls}=attachRemote(ctx,{insertMode:'lost-response'});
  vm.runInContext(confirmationWrapper,ctx);
  const expense=await ctx.confirmarGastoOperador();
  assert.equal(expense._sync_status,'error');
  assert.ok(toasts.some(message=>message.includes('Pendiente de sincronizar')));
  assert.equal(rows.length,1);
  const id=expense.id;
  ctx.gastos=JSON.parse(storage.get('gastos'));
  const result=await ctx.syncLocalExpensesToSupabase();
  assert.equal(result.ok,true);
  assert.equal(ctx.gastos[0].id,id);
  assert.equal(ctx.gastos[0]._sync_status,'confirmed');
  assert.equal(rows.length,1);
  assert.deepEqual(calls,['point','insert','point']);
});

test('23505 expenses_pkey: lectura puntual confirma la fila y preserva su edición remota', async () => {
  const {ctx}=harness();
  const {rows,calls}=attachRemote(ctx,{insertMode:'pkey-existing'});
  vm.runInContext(confirmationWrapper,ctx);
  const expense=await ctx.confirmarGastoOperador();
  assert.equal(expense._sync_status,'confirmed');
  assert.equal(expense.desc,'Edición remota posterior');
  assert.equal(rows[0].description,'Edición remota posterior');
  assert.equal(rows.length,1);
  assert.deepEqual(calls,['point','insert','point']);
});

test('23505 de otra restricción sin fila recuperable queda pendiente, sin falso éxito', async () => {
  const {ctx,storage}=harness();
  const {rows,calls}=attachRemote(ctx,{insertMode:'other-23505'});
  vm.runInContext(confirmationWrapper,ctx);
  const expense=await ctx.confirmarGastoOperador();
  assert.equal(expense._sync_status,'error');
  assert.match(expense._sync_error,/otra unicidad/);
  assert.equal(JSON.parse(storage.get('gastos'))[0].id,expense.id);
  assert.equal(rows.length,0);
  assert.deepEqual(calls,['point','insert','point']);
});

test('fallos de lectura y red mantienen el gasto pendiente y su UUID', async () => {
  for(const options of [{readErrorAt:1},{insertMode:'network'},{insertMode:'other-23505',readErrorAt:2}]){
    const {ctx,storage}=harness();
    const {rows,calls}=attachRemote(ctx,options);
    vm.runInContext(confirmationWrapper,ctx);
    const expense=await ctx.confirmarGastoOperador();
    assert.equal(expense._sync_status,'error');
    assert.equal(JSON.parse(storage.get('gastos'))[0].id,expense.id);
    assert.equal(rows.length,0);
    assert.equal(calls.includes('update'),false);
    assert.equal(calls.includes('list'),false);
  }
});

test('gastos históricos conservan INSERT por legacy_id y recuperación anterior', async () => {
  const {ctx}=harness();
  const {rows,calls}=attachRemote(ctx,{allowLegacyUpdate:true});
  const expense={...pending,id:'g_1761913800000',_sync_status:'pending',metadata:{persistence_status:'pending_local'}};
  ctx.gastos=[expense];
  const first=await ctx.saveExpenseToSupabase(expense);
  assert.equal(first.legacy_id,expense.id);
  assert.equal(rows.length,1);
  expense._sync_status='error';
  const result=await ctx.syncLocalExpensesToSupabase();
  assert.equal(result.ok,true);
  assert.equal(rows.length,1);
  assert.ok(calls.includes('list'));
  assert.ok(calls.includes('update'));
  assert.equal((await ctx.deleteExpenseFromSupabase(expense)).id,expense._sb_id);
  assert.equal(rows.length,0);
});
