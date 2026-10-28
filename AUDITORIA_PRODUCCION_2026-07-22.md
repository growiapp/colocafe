# Auditoría integral de producción — Colo Café

Fecha: 2026-07-22

Alcance: revisión estática integral de `index.html`, persistencia local, escrituras Supabase, outboxes, cobro, Caja, Historial, Dashboard, Turnos, Catálogo, Operadores, modo técnico, manifest y estilos responsive.

Restricciones respetadas: sin cambios de schema, sin limpiar `localStorage`, sin borrar datos, sin dependencias nuevas y sin refactor amplio.

## 1. Resumen ejecutivo

Se encontraron riesgos reales de pérdida u ocultamiento de datos locales, falsos éxitos, eliminación local antes de confirmación remota y doble cobro cuando el estado remoto era incierto. Se aplicaron correcciones acotadas en `index.html` para que una operación crítica sólo quede como confirmada cuando existe respuesta remota suficiente, o se conserve localmente con estado pendiente/error visible y reintentable.

El pipeline de escritura y read-back de ventas se preservó. La única modificación dentro de `ejecutarCobro` refuerza las barreras anteriores y posteriores al cobro: bloquea si no se puede verificar el estado remoto, no permite recobrar una reserva con venta local pendiente y diferencia una venta confirmada de una reserva cuyo estado aún no sincronizó.

No se ejecutaron escrituras contra Supabase real. La validación interactiva en `localhost` fue bloqueada por la política de navegación del navegador integrado; por eso las pruebas visuales, multi-dispositivo, RLS y PWA están marcadas como pendientes de staging y no como aprobadas.

## 2. Bugs y riesgos encontrados

| Severidad | Hallazgo | Impacto posible |
|---|---|---|
| Crítica | El cambio de versión eliminaba `cats`, `menu` y el backup local | Pérdida de catálogo/fallback local |
| Crítica | Una lectura remota vacía podía reemplazar mesas, reservas, gastos o clientes locales pendientes | Operaciones invisibles y pérdida aparente de payload |
| Crítica | Una mesa nueva se eliminaba localmente si fallaba su primera sincronización | Mesa y pedido perdidos para el operador |
| Crítica | Una reserva se revertía al snapshot anterior si fallaba Supabase | Pérdida de los datos recién ingresados |
| Crítica | Errores al consultar venta previa de reserva o mesa se interpretaban como ausencia/mesa abierta | Posible doble cobro multi-dispositivo |
| Alta | El reemplazo de `open_order_items` ignoraba errores del `DELETE` | Duplicados o contenido remoto inconsistente |
| Alta | La sincronización de mesa podía considerarse correcta aunque fallara el header | Confirmación parcial mostrada como completa |
| Alta | El cierre de `open_orders` podía devolver éxito sin fila confirmada | Mesa cerrada sólo localmente o cierre ambiguo |
| Alta | Eliminaciones de producto/categoría eran locales antes del resultado remoto | El elemento reaparece o queda inconsistente entre dispositivos |
| Alta | La eliminación de cliente era local-first y el guardado emitía un check antes del resultado remoto | Cliente oculto localmente o falso éxito |
| Alta | `limpiarVentas()` también borraba gastos | Pérdida local no solicitada |
| Alta | La creación de operador mostraba éxito pleno aunque quedara sólo local | Falso éxito |
| Media | La auditoría consultaba una columna dudosa de `sale_items` y podía fallar completa | Diagnóstico inutilizable |
| Media | La auditoría clasificaba estados inactivos de reserva como pagados y todas las mesas abiertas con ítems como anomalía | Falsos positivos |
| Media | La auditoría filtraba gastos por tienda antes de buscar `store_id` nulo | Falso negativo permanente |
| Media | No había búsqueda previa de mesa por `metadata.legacy_local_id` antes de insertar | Duplicación tras timeout/reintento ambiguo |
| Media | Dashboard no diferenciaba gastos locales pendientes | Totales sin claridad de origen |

## 3. Bugs y riesgos corregidos

- La migración de versión ahora preserva catálogo local y genera backup si todavía no existe.
- Las cargas remotas mezclan y conservan entidades locales pendientes, fallidas o sin `_sb_id`.
- Una mesa que no sincroniza permanece visible, se abre normalmente y queda marcada para reintento.
- Una reserva que no sincroniza conserva todo el payload local, cierra el modal y se marca con error recuperable.
- El cobro se bloquea cuando no se puede verificar el estado remoto de mesa o reserva.
- Una venta local de reserva todavía pendiente bloquea un segundo cobro.
- El estado `pagada` de una reserva se confirma separadamente de la venta; si ese update falla, se informa “venta cobrada / reserva pendiente”.
- Los `DELETE` de ítems y los updates de cierre ahora deben responder sin error; un cierre sin fila/status confirmado ya no es éxito.
- Crear una mesa busca primero una orden abierta con el mismo `legacy_local_id`.
- Las eliminaciones de catálogo son remotas primero y sólo después actualizan el array local.
- El guardado de cliente informa confirmado sólo después de Supabase; su eliminación es remota primero.
- Limpiar historial local de ventas ya no toca gastos y se bloquea si hay ventas pendientes.
- El alta de operador diferencia guardado remoto de guardado sólo local.
- La auditoría read-only incluye ítems huérfanos de mesas y gastos sin `store_id`, y reduce falsos positivos.

## 4. Cambios implementados

1. Backup no destructivo en actualización de versión.
2. Helper genérico de identidad y merge para preservar operaciones locales pendientes.
3. Persistencia duradera de mesas, reservas, clientes y gastos durante refresh remoto.
4. Endurecimiento de create/update/items/close de `open_orders`.
5. Idempotencia adicional de apertura de mesa por `metadata.legacy_local_id`.
6. Barreras fail-closed antes de cobro de mesa/reserva.
7. Estado independiente para venta confirmada y actualización pendiente de reserva.
8. Eliminación remota primero para productos y categorías.
9. Retiro de la acción técnica destructiva de “limpiar caché”; la función compatible ahora sólo recarga.
10. Auditoría read-only corregida y ampliada.

### Matriz de persistencia revisada

| Tabla | Función principal | Confirmación actual | Fallo/preservación | Reintento / riesgo residual |
|---|---|---|---|---|
| `sales` | `saveSaleGroupToSupabase`, `saveSaleRowsToSupabase` | Insert/upsert + read-back de venta | Grupo local queda pendiente con error | `retryPendingSalesSync`; concurrencia absoluta requiere constraint/RPC DB |
| `sale_items` | pipeline de venta | Read-back de cantidad/filas | Venta completa no se declara confirmada | Reintento por grupo |
| `sale_payments` | pipeline de venta | Read-back de pagos | Venta completa no se declara confirmada | Reintento por grupo |
| `open_orders` | `createOpenOrderInSupabase`, `updateOpenOrderHeaderInSupabase`, `closeOpenOrderInSupabase` | `select` al crear/cerrar y validación de status | Mesa local visible; cierre en outbox | Reintentos de mesa/cierre; sin transacción DB completa |
| `open_order_items` | `syncOpenOrderItems` | Errores de delete/insert verificados | Payload completo guardado en outbox | `retryPendingOpenOrderItemSyncs`; replace-all no es atómico |
| `reservations` | `saveReservationToSupabase` | Fila devuelta por Supabase | Reserva local con `pending/error`, sin rollback destructivo | Reintento desde Operaciones pendientes |
| `expenses` | `saveExpenseToSupabase` | Fila devuelta por Supabase | Gasto local con estado visible | Reintento/sync de gastos |
| `shifts` | `saveShiftToSupabase`, cierre de turno | Fila remota y estado de cierre | Snapshot de cierre en outbox | `retryPendingShiftClosures` |
| `operators` | `saveOperatorToSupabase` | Fila de upsert devuelta | Nombre local y mensaje “pendiente” | Sin outbox específico: riesgo residual documentado |
| `products` | `saveProductToSupabase`, `saveProductStockToSupabase` | Create/edit/delete con fila o error; stock verifica error | Create/edit/delete no mienten | Stock rápido no tiene outbox duradero específico |
| `categories` | `saveCategoryToSupabase`, `deleteCategoryFromSupabase` | Create/edit/delete con fila o error | No se elimina local si no se confirma servidor | Reintento manual |

## 5. Funciones modificadas

- Versión y preservación: `preserveLegacyCatalogCache`, `updateCatalogBootState`.
- Merge/pending: `getPersistenceIdentityValues`, `persistenceRecordsReferToSame`, `isLocalPersistencePending`, `mergeRemoteRecordsWithLocalPending`, `mergeRemoteReservationsWithOptimistic`.
- Caja/cobro: `confirmarNuevaMesa`, `reservationHasRemoteSale`, `ejecutarCobro`, `renderDashboard`, `limpiarVentas`.
- Mesas: `ooShouldPreserveLocal`, `ooMergeRemoteWithPending`, carga remota de mesas, `createOpenOrderInSupabase`, `syncOpenOrderItems`, `syncMesaToSupabase`, `closeOpenOrderInSupabase`, `checkOpenOrderStillOpen`, reintento de ítems.
- Clientes/reservas/gastos: mapeo y carga remota, `saveCustomerToSupabase`, `saveReservationToSupabase`, `pedirEliminarCliente`, `eliminarClienteConfirmado` y wrappers de guardado.
- Catálogo: `deleteCat`, `pedirEliminarProducto`, `eliminarProductoConfirmado`, `pedirEliminarProductoInline`, `clearLocalTechnicalCache`.
- Operadores: `_addOperadorFromAjustes`.
- Soporte: `auditDataIntegrityReadOnly`.

## 6. Funciones críticas que no se tocaron

- `saveSaleRowsToSupabase`.
- `saveSaleGroupToSupabase`.
- `verifySaleGroupReadBack`.
- Escritura y read-back de `sales`, `sale_items` y `sale_payments`.
- Cálculo y validación de pago mixto (`getCurrentPaymentState` y sus validaciones).
- Agrupación/idempotencia existente de ventas pendientes.
- Exportación, copia y visualización de respaldo local.

`ejecutarCobro` sí se tocó porque existía un bug concreto: un error de verificación remota podía permitir continuar, y una reserva con venta local pendiente podía recobrarse. El cambio fue mínimo, fail-closed y no modifica el pipeline ni elimina read-backs. También se añadió la distinción entre “venta confirmada” y “estado de reserva pendiente”.

## 7. Cambios de UX/UI

- Mensajes explícitos para mesa/reserva/operador conservados sólo en el dispositivo.
- Guardado y eliminación de clientes ya no muestran confirmación antes del resultado remoto.
- Al abrir una mesa cuyo estado remoto no puede comprobarse se avisa que se muestran datos guardados y que los cambios quedarán pendientes.
- Mensaje separado cuando la venta se cobró pero el estado de reserva no terminó de sincronizar.
- Gastos pendientes visibles en el KPI del Dashboard.
- Se retiró el botón técnico “Limpiar caché local”.
- Limpiar historial informa por qué se bloquea cuando hay ventas pendientes.
- No se hizo rediseño visual ni se cambió la jerarquía operativa.

## 8. Cambios mobile/PWA

No se agregaron cambios CSS: la revisión encontró reglas existentes para `100dvh`, safe areas, modales con scroll contenido, controles de 44 px y footer móvil. Sin una ejecución visual válida no se justificó alterar estilos estabilizados.

El `manifest.json` está presente y declara modo `standalone`. El build actual desregistra service workers anteriores y no registra uno nuevo; por lo tanto no existe una garantía controlada de shell offline para la PWA. Esto queda como riesgo pendiente, no se improvisó una estrategia de caché en producción.

## 9. Operaciones pendientes / outbox

- Los refresh remotos ya no descartan mesas, reservas, clientes ni gastos pendientes.
- Se conservan entidades sin `_sb_id`, con `_syncing`, `pending`, `error`, `partial_error` o `close_pending`.
- `open_order_items` guarda el payload completo antes del replace y lo conserva si falla delete o insert.
- Los cierres de mesa y turno mantienen sus outboxes existentes.
- La herramienta técnica reúne ventas, gastos, reservas, mesas y cierres pendientes y conserva los reintentos existentes.
- No se borró ni renombró ninguna key de pending existente.

## 10. Mensajes de éxito/error

- “Mesa abierta” no se presenta como confirmación remota si el sync falla; se informa pendiente local.
- “Reserva guardada” pasa a pendiente local ante error, sin descartar datos.
- “Reserva cobrada” sólo se usa si venta y update de reserva se confirmaron; si sólo la venta se confirmó, se informa la separación.
- “Operador guardado” sólo es pleno con fila remota; de otro modo indica guardado local pendiente.
- Producto/categoría sólo muestran eliminación después del resultado remoto.
- Cliente sólo muestra guardado/eliminación confirmados después del resultado remoto; sin conexión queda explícitamente pendiente.
- Los mensajes con check visual se mantienen sólo donde la operación correspondiente ya tiene confirmación suficiente.

## 11. Cómo se evita pérdida de datos

- No se limpia catálogo ni backup por cambio de versión.
- No se reemplazan operaciones locales pendientes con una lista remota vacía o atrasada.
- No se elimina una mesa por fallo del primer sync.
- No se restaura el snapshot anterior de reservas cuando falla la red.
- Los payloads de ventas e ítems de mesa permanecen en almacenamiento pendiente antes de la escritura remota.
- Las acciones técnicas ya no exponen una limpieza destructiva de datos operativos.

## 12. Cómo se evita doble cobro

- Mesa: se exige `_sb_id`, estado remoto abierto y ausencia de venta asociada. Error o timeout devuelve estado incierto y bloquea el cobro.
- Reserva: una venta local pendiente bloquea; una consulta remota incierta bloquea; una venta confirmada marca “ya cobrada”.
- Una venta sólo provoca cierre/estado pagado después del pipeline con read-back.
- El reintento de venta conserva el `legacy_id` existente para recuperar una inserción ambigua.

Límite: sin constraint único o RPC transaccional en Supabase, dos dispositivos que escriban exactamente al mismo tiempo aún tienen una ventana de carrera. No se agregó SQL porque el schema completo de `sales` no está versionado en este repositorio y aplicar una restricción sin auditar duplicados sería riesgoso.

## 13. Cómo se evita falso éxito

- Los retornos nulos, errores, timeouts y filas ausentes se consideran no confirmados.
- La sincronización de mesa exige éxito del header y de los ítems.
- El cierre exige una fila devuelta con status distinto de `open`.
- La actualización de reserva después de cobrar exige fila remota; si no, sólo se confirma la venta.
- Las eliminaciones de catálogo ocurren localmente después del servidor.

## 14. Cómo se preserva lo pendiente

La identidad se compara por `id`, `_sb_id`, `legacy_id`, `open_order_id` y `legacy_local_id`. Al recibir datos remotos, la copia local pendiente se conserva y se fusiona en vez de desaparecer. Los outboxes existentes de ventas, ítems/cierre de mesa y cierre de turno se mantienen intactos; reservas y gastos conservan el objeto completo con `_sync_status` y `_sync_error`.

## 15. Cómo se reintenta

- Ventas: `retryPendingSalesSync`.
- Mesas sin crear/actualizar: `retryPendingOpenOrdersSync`.
- Ítems de mesa: `retryPendingOpenOrderItemSyncs`.
- Cierres de mesa: `retryPendingOpenOrderClosures`.
- Reservas: `syncLocalReservationsToSupabase`.
- Gastos: `syncLocalExpensesToSupabase`.
- Apertura/cierre de turno: sync local y `retryPendingShiftClosures`.
- Acción unificada: Modo técnico → Operaciones pendientes → Reintentar pendientes.

## 16. Cómo probar

Checklist obligatorio de staging. Requisitos: copia de respaldo previa, tienda de prueba con mismas RLS que producción, dos dispositivos/sesiones, DevTools con throttling/offline y consulta directa a Supabase después de cada paso.

| # | Prueba | Pasos mínimos | Resultado esperado |
|---:|---|---|---|
| 1 | Mesa vacía | Abrir mesa sin productos, refrescar y abrir en dispositivo B | Visible en A/B o pendiente visible en A; nunca desaparece |
| 2 | Mesa con productos | Agregar simple, variante y nota; reentrar | Header e ítems coinciden local/Supabase/B |
| 3 | Cobro efectivo | Cobrar y consultar las tres tablas de venta | Read-back completo; mesa cerrada |
| 4 | Cobro transferencia | Repetir con transferencia | Pago y total coinciden |
| 5 | Pago mixto | Probar suma exacta y suma inválida | Exacta confirma; inválida no permite cobrar |
| 6 | Doble cobro | Cobrar en A e intentar en B | B informa cerrada/ya cobrada y no crea otra venta |
| 7 | Reserva pendiente | Crear online y luego con red cortada | Online confirmada; offline visible con pendiente/error |
| 8 | Cobrar reserva | Cobrar y simular fallo sólo en update de reserva | Venta queda confirmada; reserva muestra pendiente, sin segundo cobro |
| 9 | Gasto online | Crear y verificar tabla/Dashboard | Fila remota y KPI consistente |
| 10 | Gasto offline | Cortar red y crear | Gasto visible, marcado pendiente y payload intacto |
| 11 | Reintentar gasto | Volver online y reintentar | Misma operación se confirma, sin duplicado |
| 12 | Cierre mesa con fallo | Interrumpir request de cierre después de venta | Venta confirmada; mesa/cierre pendiente visible y reintentable |
| 13 | Cerrar turno | Cerrar online y con fallo simulado | Online cerrado; fallo deja snapshot pendiente |
| 14 | Dashboard | Comparar rango contra suma SQL e Historial | Ventas, gastos, neto, tickets y medios coinciden; pendientes visibles |
| 15 | Historial | Ver mesa/reserva/mixto y cambiar fechas | `business_date`, totales y refresh correctos |
| 16 | Modo técnico | Probar permisos owner/admin y operador | Herramientas sólo visibles/autorizadas para rol esperado |
| 17 | Exportar respaldo | Exportar, copiar y mostrar en mobile/desktop | Archivo/texto contiene pendientes y no modifica datos |
| 18 | Reintentar pendientes | Crear una pendiente de cada clase y ejecutar acción unificada | Resumen no informa éxito si alguna sigue fallando |
| 19 | Mobile | 390×844, 393×852, 412×915, 430×932; abrir todos los modales y teclado | Sin overflow horizontal, acciones accesibles, safe area y scroll correctos |
| 20 | PWA | Instalar en Android/iOS, background/foreground, offline/online | Sin pérdida de estado; documentar que el shell offline no está garantizado sin SW |

Prueba adicional multi-dispositivo: abrir/cobrar la misma mesa y reserva con ambos dispositivos sincronizados mediante una barrera temporal. Contar filas por `open_order_id`, `reservation_id` y `legacy_id`; el resultado esperado es una sola venta.

## 17. Riesgos pendientes

1. Validar con Supabase real RLS, sesión, latencia y tablas exactas; la auditoría local no sustituye esa prueba.
2. Ventana de carrera multi-dispositivo sin unicidad/idempotencia transaccional en DB.
3. Replace-all de `open_order_items` es delete+insert, no transacción; ahora conserva outbox pero puede existir un intervalo remoto vacío.
4. Cambios rápidos de stock son local-first y no poseen outbox de catálogo específico.
5. Operadores locales pendientes no tienen outbox específico.
6. PWA sin service worker controlado: no hay garantía de arranque offline.
7. Verificación visual/consola runtime pendiente porque la política del navegador integrado bloqueó `localhost`.

Plan separado recomendado, no aplicado: obtener dump real de schema/constraints, auditar duplicados y diseñar una función RPC idempotente/transaccional para venta + items + pagos + cierre, además de constraints parciales apropiados. Requiere staging y plan de rollback.

## 18. SQL

No hizo falta SQL para los fixes aplicados y no se modificó ningún archivo `.sql`.

No se entrega una migration especulativa para el hardening multi-dispositivo: antes se necesita confirmar schema, duplicados existentes, semántica de ventas directas y políticas RLS. Aplicar un `UNIQUE` a ciegas podría bloquear ventas válidas o fallar en producción.

## 19. Resultado de parseo JS

Resultado: **OK**. Se extrajeron y compilaron con `new Function` los 11 scripts inline activos; se omitieron correctamente 2 scripts externos/no ejecutables. No se detectaron errores de sintaxis.

## 20. Resultado de `git diff --check`

Resultado: **OK**. `git diff --check` terminó con código 0 y sin errores de whitespace. Git emitió sólo la advertencia de que `index.html` pasará de LF a CRLF la próxima vez que Git lo procese.
