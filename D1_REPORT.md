# D1 · carrito, mesa y cobro

## Causa y reproducción

La evidencia original (`StockDurability/E2E/20261102T024000Z/steps.jsonl`, paso `diagcart`) registró dos ventas de 2 unidades después de que el carrito mostrara 5; con 4 segundos de espera, vendió 5. En la misma corrida se observó una oscilación 5→3→5.

En `index.html`, cada toque modifica `carrito` y encola una sincronización de mesa. `syncActiveOpenOrderView` vuelve a cargar `carrito` desde una lectura remota. Una respuesta de lectura anterior a los últimos toques podía llegar después de ellos; el marcador `_syncing` podía haber sido limpiado por una sincronización anterior, de modo que el merge no conservaba el borrador local. `cerrarMesaOReserva` espera la carga de operadores, y `ejecutarCobro` tomaba su snapshot **después** de esa espera. Así, el carrito podía mostrar 5 al pulsar “Cerrar y cobrar”, reducirse a 2 durante el modal y persistir una venta de 2.

`tests/d1_browser.test.cjs` ejecuta el `index.html` real en Chromium contra un servidor local. Intercepta toda URL externa: sirve un SDK vacío para el script de CDN y aborta las demás. Las escrituras de venta y RPC se simulan en memoria. Antes del arreglo, el test con el baseline `c5520f9` falló: visible al clic 5, lectura remota atrasada 2, snapshot vendido 2, venta local 2, total $200. El mismo test con `main` también falló en el carrito visible: 5→2. `main` carece de parte de los contratos de la rama, por lo que esta comparación prueba el síntoma de interfaz bajo el mismo mock, no equivalencia completa de RPC o PostgreSQL.

## Corrección

- Cada edición de mesa guarda una revisión local y mantiene el borrador hasta que se confirma esa misma revisión. Una lectura remota iniciada antes de la confirmación tampoco reemplaza ese borrador.
- Una respuesta RPC vieja no limpia el pendiente de una revisión nueva. El reintento de ítems solo marca confirmada la revisión que envió.
- El cobro conserva la firma del carrito, descuentos y pagos desde el clic inicial. Si cambia durante cualquier espera previa a crear la venta, avisa y no registra una venta. Las líneas de la venta usan una copia del snapshot.
- Al reconstruir ítems remotos se preservan líneas distintas del mismo producto con variantes, notas, descuentos o filas duplicadas.

No cambiaron SQL, RPC, reglas comerciales, stock ni contratos remotos.

## Pruebas

```powershell
node --test tests/d1_browser.test.cjs
node --test tests/r_b2a_sales_recovery.test.cjs tests/stock_durability.test.cjs tests/d3_gastos_1.test.cjs
```

Para verificar el fallo previo con el mismo test: `$env:D1_BASELINE='1'; node --test tests/d1_browser.test.cjs`. Para comparar `main`: `$env:D1_MAIN='1'; node --test tests/d1_browser.test.cjs`. Se espera que ambos fallen. El test usa el Playwright y Chromium que ya existen en este equipo; `D1_PLAYWRIGHT_MODULE` y `D1_CHROME` permiten señalar otras instalaciones locales. No descarga ni instala dependencias.

El test actual cubre cinco toques, cobro inmediato, respuesta remota atrasada, edición durante sincronización, dos RPC secuenciadas con respuesta vieja retenida, recarga, reintento de venta parcial, líneas distintas, cambio de cuenta y local durante un cobro, dos contextos de navegador editando mesas diferentes, y recuperación idempotente de un cierre marcado `syncing`. Es una simulación local; no sustituye una validación real de PostgreSQL.

## O1 · E2E-E5x2 en `syncing`

El cierre usa `pendingOpenOrderClosures` y `retryPendingOpenOrderClosures`, una cola distinta del reemplazo de ítems y del carrito. `steps.jsonl` lo muestra en `syncing` a las 12:23 y 12:24 UTC, con cero escrituras de red en vuelo; `network_e2e.jsonl` no registra escrituras de `open_orders` de owner después de las 12:14 UTC. El estado `syncing` se guarda antes de esperar el cierre, por lo que puede sobrevivir a una interrupción, pero esa evidencia no permite identificar qué espera o transición dejó E5x2 así. El test local confirma que un reintento de un cierre en ese estado lo completa una vez y limpia la cola. **No hay evidencia de que O1 comparta la causa de D1; su causa específica sigue abierta.**
