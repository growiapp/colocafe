'use strict';
// El contrato pertenece al harness, no a los escenarios. Cada criterio AUTO es obligatorio.
const filas = [
  ['e1','MANUAL'], ['e2','MANUAL'], ['e3','MANUAL'], ['e3b','MANUAL'],
  ['d1','AUTO',['tres_rafagas_validas','dom_cinco','carrito_cinco','total_visible_exacto','venta_local_cinco','venta_remota_cinco','un_post_por_caso','ticket_local_remoto','f1_causal','conjunto_local','conjunto_ventas','conjunto_items','conjunto_identidad','sin_errores']],
  ['f2','AUTO',['tres_casos',...['r2','r2b','r2c'].flatMap(n => ['local','remoto_por_identidad','un_post_sales','mismo_ticket','otra_intacta','barrera','activa'].map(k => `${n}_${k}`)),'conjunto_ventas','ninguna_venta_en_otra','conjunto_items','sin_errores']],
  ['d2','AUTO',['cinco_casos',...['menos_cinco','vacio','no_finito','cancelar','cero'].flatMap(n => ['dialogos','rpc_cantidad','saldo_servidor','error_visible','valor_visible','rpc_contenido'].map(k => `${n}_${k}`))]],
  ['e4','MANUAL'], ['e5','MANUAL'], ['e6','MANUAL'], ['e7','MANUAL'],
  ['e9','AUTO',['admin_con_membresia','admin_conteo','admin_ajuste_mas','admin_ajuste_menos','admin_update_harness_bloqueado','operator_conteo_403','operator_ajuste_403','operator_update_harness_bloqueado','operator_delete_harness_bloqueado','operator_venta_201_una_vez_por_tabla','anon_products_401','anon_ledger_401','anon_rpc_401_42501','owner_mas','owner_menos','saldo_final_igual']],
  ['e9_rls','MANUAL'],
  ['e8b','MANUAL'], ['e8c','MANUAL'], ['e10p','MANUAL'], ['e10go','MANUAL'], ['e10c','MANUAL'], ['e10r','MANUAL'],
  ['f3','AUTO',['version_inicial_conocida','owner_confirmado_con_version_mayor','rpc_de_caja_devolvio_conflict','conflicto_visible','sin_syncing','sin_outbox_nuevo','banner_sin_reintenta_sola','no_confirmado','servidor_conserva_owner','cero_ventas']],
  ['f4','PARCIAL',['r3_local_y_remoto','r12_local_y_remoto','ninguna_reserva_llego','un_solo_post_sales']],
];
const MATRIZ = Object.freeze(filas.map(([step,tipo,criterios=[]]) => Object.freeze({step,tipo,criterios:Object.freeze(criterios)})));
const CONCURRENTES = Object.freeze({e10go:Object.freeze(['e10c'])});
// Pruebas negativas deliberadas cuyo bloqueo local (DENIED_BY_POLICY) es evidencia esperada. Cada una exige escenario, condición, dispositivo, método y ruta exactos;
// no hay excepciones por método, ruta o código. El verificador además exige que el escenario cubra la condición (criterio true) y que el evento caiga en su ventana.
const NEGATIVAS = Object.freeze([
  ['e9','admin_update_harness_bloqueado','admin','PATCH','/rest/v1/products'],
  ['e9','operator_update_harness_bloqueado','caja','PATCH','/rest/v1/products'],
  ['e9','operator_delete_harness_bloqueado','caja','DELETE','/rest/v1/sale_items'],
  ['f4','ninguna_reserva_llego','owner','POST','/rest/v1/reservations'],
  ['f4','ninguna_reserva_llego','owner','PATCH','/rest/v1/reservations'],
].map(([escenario,condicion,device,method,path]) => Object.freeze({escenario,condicion,device,method,path})));
const negativaAutorizada = (device, method, path) => NEGATIVAS.find(n => n.device === device && n.method === method && n.path === path) || null;
module.exports = {MATRIZ, CONCURRENTES, NEGATIVAS, negativaAutorizada};
