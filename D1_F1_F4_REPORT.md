# D1 · cierre local F1–F4

Base: `b1b65b0` en `fix/stock-d1-cobro-mesas`. Se ejecutó el reproductor independiente antes de editar. Las comparaciones usan `index.html` real en Chromium, un backend Supabase simulado en memoria y bloqueo de solicitudes externas.

| Hallazgo | Antes (`b1b65b0`) | Después |
| --- | --- | --- |
| F1, refresh agrega `_sb_item_id` | 5 unidades visibles, 5 en carrito, 0 ventas; segundo intento vende 5 | Primer intento vende 5 por $500. Cambios reales de cantidad, precio, descuento, variante o nota siguen invalidando el cobro. |
| F2, navegación durante cobro | Abrir otra mesa o volver a lista deja la mesa original abierta y sin venta | Se registra una venta de 1 unidad en la mesa original; la otra mesa no recibe ventas. También funciona si se navega con el modal de operador abierto. |
| F3, conflicto remoto | `_items_conflict=true`, `_syncing=true`, banner de reintento, outbox `mesa:conflict` y bloqueo adicional por operación sin enviar | El conflicto sigue visible y bloquea su cobro; `_syncing=false`, sin banner de reintento ni outbox ficticio. Permanece el aviso de conflicto para resolverlo. |
| F4, reserva invalidada | 0 ventas y reserva oculta durante 90 segundos | 0 ventas y reserva visible de inmediato. Una reserva con venta persistida sigue pagada y oculta. |

La firma del pedido compara cada línea comercial de forma independiente, preserva duplicados y no depende del orden de las líneas ni de las variantes. Excluye el identificador técnico `_sb_item_id`. El cobro conserva la mesa, las líneas, el descuento y los pagos del clic original. Tras cada espera relevante verifica el contexto F0-B y los datos de la mesa de origen. Si no se guardó la venta de una reserva, se limpia su ocultación temporal; si la venta quedó guardada localmente y su confirmación remota falla, permanece como cobro pendiente sin reabrir la reserva.

## Reproducción y pruebas

```powershell
$env:D1_F1_F4_REV='b1b65b0'; node --test tests/d1_f1_f4.test.cjs
Remove-Item Env:D1_F1_F4_REV
node --test tests/d1_browser.test.cjs tests/d1_f1_f4.test.cjs
node --test tests/r_b2a_sales_recovery.test.cjs tests/stock_durability.test.cjs tests/d3_gastos_1.test.cjs
git diff --check
```

El primer comando reproduce y afirma los cuatro fallos en la base. En el worktree corregido, D1 original pasa (1/1), el harness F1–F4 pasa (1/1) y R-B2a, Stock Durability y D3 pasan (114/114). D1 permanece cerrado y F0-B conserva el aislamiento de cuenta y local: los escenarios de cambio de contexto terminan con cero ventas, y el pendiente de otra cuenta envía cero RPC. El harness F1–F4 usa el modal y la cola de mesa reales. Cubre además cinco toques y cobro inmediato, RPC y lectura atrasadas, pendiente de red recuperable, líneas distintas e idénticas del mismo producto, y venta parcial seguida de un reintento sin duplicar las filas locales ni las simuladas remotas. Se corrigieron tres fixtures del test D1 original para que `mesa.items` represente el mismo pedido que `carrito` al comenzar el cobro.

En cada escenario Chromium interceptó las URL externas (2 por contexto, incluido el SDK servido desde el mock) y recibió **0 respuestas externas**. No se accedió a staging ni producción. No se modificaron SQL, RPC o esquema.

## Límites para staging

El backend simulado demuestra las transiciones observables en el navegador, no el comportamiento de PostgreSQL real. Antes de desplegar se requiere validar con el entorno autorizado la persistencia y el cierre remoto bajo latencias y conflictos reales, incluido un reintento de venta parcialmente confirmada. Este trabajo no aborda D2, D3 ni E2E-E5x2.
