# Colo Café · Auditoría 360° y primera ola

Base: `334df6c` (= `origin/main`, árbol limpio). Rama: `audit/ola1-ux-operativa`. Sin push, sin merge, sin tocar producción ni Supabase.

## Alcance real y límites de la evidencia

- Se auditó la app real (`index.html`) en Chromium con el arnés de demostración del repo (datos ficticios, Supabase simulado), a 1280×800 y 390×844, más lectura de código y búsquedas estáticas.
- **No se usó staging ni producción**: no hay credenciales en este entorno y los cambios son de interfaz local. Los recorridos con Supabase real (cobro de punta a punta, sincronización, roles servidor) **quedan sin verificar** y requieren su autenticación para una pasada final en staging.
- Los roles se evaluaron con lo que cubre la suite existente (`v2_roles`), no con cuentas reales Dueño/Administrador/Operador.
- `index.html` es un archivo único editado a mano: no existe paso de build desde módulos.

## A. Hallazgos principales

| ID | Flujo | Hallazgo | Evidencia | Sev. |
|---|---|---|---|---|
| H1 | Cobrar · efectivo | No existe cálculo de vuelto (ninguna aparición de «vuelto/recibido» en el código). El cajero lo hace de memoria. | `grep` sin resultados | P2 |
| H2 | Cobrar · escritorio | La pantalla quedaba confinada a la 1.ª columna de la grilla de Caja: columna de 296 px, «Transferencia» desbordaba su botón (90 px de texto en 76 px) y «Confirmar cobro» quedaba cortado bajo el borde en 1280×800. Preexistente. | Medición en DOM (`cobrow.js`), captura | P2 |
| H3 | Caja · tarjeta de mesa | El «×» que elimina el pedido era un `div` de 22 px sin nombre accesible ni acceso por teclado (con confirmación previa). | DOM | P2 |
| H4 | Filtros, acordeones, pills | 28 `div` clicables sin `role`/`tabindex`: inaccesibles por teclado. | DOM | P2 |
| H5 | Encabezado móvil | El nombre del local se cortaba en «Colo Café ·…»; no se ve qué local está abierto. | Captura 390 px | P2 |
| H6 | Seguridad | Supabase se carga desde CDN con versión flotante (`@2`) y sin SRI. | `index.html:103` | P1 (infra) |
| H7 | Rendimiento | Sondeos periódicos: `renderContextoGlobal` cada 3 s, lectura de comandas cada 6 s con la pestaña visible, 6 `setInterval`. | `grep` | P2 |
| H8 | Mantenibilidad | Bloque `application/disabled-supabase-patch` de 279 líneas inactivo; 50 `console.log`; 74 usos de `font-size:11px` y 24 de 10px. | `grep` | P3 |
| H9 | Gestión | 4 diálogos nativos (`confirm`/`prompt`) fuera del estilo de la app (renombrar operador, conteo de stock, subida de ventas). | `grep` | P3 |

## B. Backlog

**Implementadas (ola 1):** H1, H2, H3, H4, H5.

**Pendientes (seguras, sin decisión):**
- H7: pausar sondeos con pestaña oculta y medir (hace falta perfilado antes de tocar).
- H9: reemplazar `prompt`/`confirm` por el modal de la app.
- H8: eliminar el bloque desactivado (verificar primero que ningún test lo use).
- Chevrones de acordeón de Gestión de ~4 px (poca señal de que se despliegan).
- `aria-pressed` en filtros (hoy solo cambia la clase `active`).

**Requieren cambio de infraestructura / decisión suya:** H6 (fijar versión y SRI o alojar Supabase propio; cambia el origen de un script crítico).

**Requieren decisión comercial (no tocadas):** recordatorio/venta adicional en Cobrar, fidelización con datos de clientes, indicadores nuevos para el dueño.

**Descartadas con justificación:**
- Agrandar controles del panel de pedido (28 px): el layout ya tiene tamaños distintos por tipo de puntero (28 mouse, 32–34 táctil) con `!important`; no se demostró un problema.
- Filtros de Caja en una sola línea en móvil: dos líneas es una regla deliberada (`@media ≤480`).
- Refactor del archivo único: sin problema verificable que lo justifique.

## C. Primera ola implementada

1. **Vuelto en Cobrar (H1).** Campo opcional «Paga con» + atajos (Justo y próximos billetes redondos) → «Vuelto $X» / «Faltan $X». Solo informativo: no bloquea, no se guarda en la venta (prueba verifica que la venta no contiene el dato), se limpia al abrir otro cobro y se conserva al alternar medios. Solo en efectivo.
2. **Cobrar a ancho completo (H2).** Una regla CSS (`#tab-carga.atn-v2.active.cobro-abierto{display:block}`). Antes/después: columna 296 → 700 px, sin desborde, botón de confirmar visible.
3. **«Eliminar mesa» accesible (H3).** `div` → `button` con `aria-label`, zona táctil de 44 px sin cambiar el aspecto; mantiene la confirmación.
4. **Teclado en controles `div` (H4).** `role="button" tabindex="0"` en 28 controles, manejador global Enter/Espacio, `aria-expanded` en acordeones, foco restaurado si el clic repinta.
5. **Nombre del local en móvil (H5).** Dos líneas en vez de truncar.

Archivos: `index.html`, `tests/ola1_ux.test.cjs` (nuevo). Cada prueba nueva falla contra `334df6c` y pasa con el cambio.

## D. Revisión independiente (Codex, adversarial, sobre la rama)

Veredicto de Codex: *needs-attention*, dos hallazgos medios, ambos **defectos reales** y corregidos:
- El repintado de Cobrar (p. ej. al llegar la lectura de operadores) sacaba el foco del campo «Paga con» → se conserva foco y selección; prueba con lectura demorada.
- Enter/Espacio en un filtro repintado perdía el foco → se restaura al mismo lugar; prueba con activaciones consecutivas.

No hubo hallazgos de XSS, fuga de estado entre cobros ni de `display:block` en otros flujos. Codex avisó que no pudo ejecutar Chromium en su entorno (EPERM): **su revisión fue estática**; las pruebas de navegador las corrí yo.

Revisión nativa (`/code-review medium`): 5 observaciones. Corregidas 3 (centavos en «Justo», `aria-expanded` inicial, zona táctil del × con mouse reducida a 32 px). Descartadas 2 como ruido: Espacio sobre pills (comportamiento estándar de botón) y recorte del encabezado móvil (`.ctx-k` está oculto; la captura lo muestra sin recorte). La prueba O6 solo es roja de forma demostrada en su parte de `aria-expanded`; el caso de centavos se cubre con un total simulado de 12400,4 y no se probó en rojo por separado.

## E. Dictamen

**CANDIDATE_VERIFIED**, con una reserva: validada en local (190/190 pruebas, rojo→verde en las nuevas, revisión de Codex y nativa resueltas), **sin pasada en staging**. Commits: `f338bce`, `341a762`, `a8b69d0`.

Flakiness observada: `F4 … (transferencia)` agotó su tiempo una vez cuando corrió junto a otra revisión; aislada pasó 3/3 y en la corrida completa sin competencia pasó.
