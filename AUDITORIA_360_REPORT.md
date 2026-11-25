# Colo Café · Auditoría 360° y primera ola

Base: `334df6c` (= `origin/main` al iniciar). Rama: `audit/ola1-ux-operativa`. Sin push, sin merge, sin deploy; producción y Supabase no modificados.

## 0. Cómo leer este informe

Cada afirmación lleva uno de estos niveles de evidencia:

- **PROBADO**: observado en ejecución (navegador local con el arnés de demostración, o prueba automática).
- **CÓDIGO**: confirmado leyendo `index.html` (con línea). No equivale a ejecutarlo.
- **HIPÓTESIS**: depende de algo que no se ve desde el cliente (RLS, restricciones, triggers, comportamiento de cada navegador/impresora).
- **STAGING**: verificado contra el entorno de staging. **Hoy: ninguno** (ver §3).

## 1. Contrato de generación de `index.html` (corrige un error mío)

**Dictamen:** `tools/carta-v2/apply.py` está **vigente**, no es histórico. Mi afirmación anterior («`index.html` se edita a mano, los scripts son históricos») era **incorrecta**.

- `apply.py` regenera dos regiones de `index.html`: el CSS entre `/*CARTA_V2_BEGIN*/` y `/*CARTA_V2_END*/` (desde `carta_overlay{,2,3}.css`) y el JS entre `<!--CARTA_JS_BEGIN-->` y `<!--CARTA_JS_END-->` (desde `carta_module.js`). Todo lo demás de `index.html` se edita directamente. `--check` no escribe: compara y sale con 1 si difieren.
- **Evidencia histórica (PROBADO):** `apply.py --check` corrido commit por commit desde su creación (`0ad24f1`, 2026-11-24) da `COINCIDE` en los 8 commits que tocaron `index.html` o `tools/` hasta `a1f240e` (último de `main`), y `DIFERENTE` desde `f338bce`, el primer commit de la ola 1. El mecanismo no se abandonó: lo rompí yo.
- **Qué quedó fuera de las fuentes:** mis cambios en Cobrar (vuelto, ancho completo, foco) y el manejador global de teclado estaban sólo en `index.html`, dentro de las regiones generadas. Una regeneración los habría borrado.
- **Corrección (commit `a26ad14`):** esos hunks (36 inserciones) se llevaron a `carta_overlay3.css` y `carta_module.js` sin ejecutar la regeneración. Resultado: `apply.py --check` → `COINCIDE`. Las demás ediciones de la ola 1 (filtros, acordeones, botón de mesa, nombre del local) caen fuera de las regiones generadas y se mantienen en `index.html`.
- **Guarda nueva:** `tests/carta_sync.test.cjs` ejecuta `apply.py --check` y falla si `index.html` y las fuentes divergen.

## 2. Primera ola (estado final)

| # | Mejora | Estado |
|---|---|---|
| 1 | Vuelto en Cobrar (efectivo): «Paga con» + atajos, informativo, no se guarda con la venta | Implementada, PROBADO local; fuente en `tools/carta-v2` |
| 2 | Cobrar a ancho completo en escritorio (antes columna de 296 px y botón cortado en 1280×800) | Implementada, PROBADO local; fuente en `tools/carta-v2` |
| 3 | «Eliminar mesa» como botón con nombre y zona táctil (44 px móvil, 32 px mouse) | Implementada, PROBADO local |
| 4 | Teclado en 28 controles `div` (filtros, acordeones, pills), foco conservado, `aria-expanded` | Implementada, PROBADO local |
| 5 | Nombre del local en móvil en dos líneas | Implementada, PROBADO local |

Revisiones: Codex (adversarial, estática) halló 2 defectos reales de foco, corregidos; revisión nativa halló 3 observaciones reales (centavos en «Justo», `aria-expanded` inicial, zona táctil del ×), corregidas. Suite: 11 archivos de prueba en verde a `a8b69d0`; ver §6 para la corrida final.

## 3. Staging

**Estado: no ejecutado.** Resultado por rol y flujo: ver §3.1 (se completa al ejecutar). Motivo del retraso: requiere sesiones humanas (clave anon pública + contraseñas tipeadas por la persona) y un local sintético en staging que, por la política de escrituras del arnés, sólo existe si se crea por SQL.

Salvaguardas ya preparadas (reutilizan el arnés E2E existente, copiado fuera del repo): servidor que sirve el commit exacto con hash por archivo; red permitida sólo a staging (`wjymdgfqmqutihadffec`) y a CDN públicos; **producción (`xhtpahjsddfkwsytubgu`) bloqueada por ruta y por resolución DNS**; política positiva de escrituras limitada al local sintético; perfiles de navegador aislados por cuenta; evidencia fuera del repo.

Atención: **la URL por defecto embebida en la app es la de producción** (`index.html:8243`). Por eso cualquier ejecución contra staging debe inyectar la URL de staging y bloquear producción, como hace el arnés.

### 3.1 Resultados por rol y flujo
_Pendiente de ejecución._

## 4. Matriz de cobertura 360°

Leyenda: ● hecho · ◐ parcial · ○ no hecho · — no aplica. «Funcional» = recorrido real en navegador (arnés local con datos ficticios). «Código» = lectura de `index.html`.

| Área | Funcional local | Sólo código | Pruebas automáticas previas | Staging | Notas / no evaluado |
|---|---|---|---|---|---|
| Caja (lista, filtros, reservas del día) | ● escritorio y móvil | ◐ | ● | ○ | |
| Mesas (tarjeta, panel, nueva mesa) | ● | ● eliminación, sync | ● | ○ | Modal de mesa nueva visto en escritorio, no en móvil |
| Comandas | ◐ botón y etiquetas «sin enviar» | ● | ● `comanda_panel` | ○ | Escrituras a `open_order_dispatches` fuera de la política del arnés: no probables en staging sin ampliarla |
| Cobros (3 medios) | ● escritorio y móvil | ● idempotencia, cierre | ● | ○ | Idempotencia multi-dispositivo depende de la restricción UNIQUE del servidor: HIPÓTESIS |
| Reservas | ◐ tarjetas en Caja | ● alta/edición/recordatorios | ● parcial | — | Modal de alta no inspeccionado visualmente; el arnés de staging bloquea escrituras a reservas |
| Clientes | ◐ lista | ● | ○ | ○ | Alta/edición y búsqueda no recorridas |
| Reportes | ◐ pestaña Resumen | ◐ timers | ● | ○ | Ventas, Gastos y Turnos: abiertas, sin revisión visual ni de cálculos |
| Gestión | ◐ Menú › Categorías (rol caja de la demo) | ● roles, datos locales | ◐ | ○ | Vistas de dueño/administrador no recorridas (la demo corre con rol operador) |
| Catálogo (productos, variantes, stock) | ○ | ● | ● stock | ○ | Pantalla de Productos y variantes no abiertas |
| Accesos rápidos | ○ | ● | ● F5 | ○ | |
| Roles y permisos | ○ | ● cliente | ● `v2_roles` | ○ | La seguridad real es RLS (no visible). Sin cuentas reales |
| Impresión | ○ | ● | ○ | ○ | Sin impresora ni ticketera: nunca se probó impresión real |
| Sincronización y colas | ○ | ● | ● mocks | ○ | Latencia, conflictos y red caída reales sin verificar |
| Experiencia móvil | ◐ Caja, Cobrar, encabezado | ○ | ◐ | ○ | Resto de pantallas en 390×844 sin recorrer |
| Oportunidades comerciales/operativas | — | ◐ | — | — | Todo HIPÓTESIS: sin datos reales de uso ni de ventas |

**Frentes sin cobertura funcional real:** impresión, catálogo/variantes, accesos rápidos (visual), Clientes (alta/edición), vistas de Dueño/Administrador, Reportes (Ventas/Gastos/Turnos), móvil fuera de Caja/Cobrar. El backlog de esas áreas proviene de lectura de código (ver «Evidencia» en cada ítem).

## 5. Backlog priorizado

Esfuerzo: S/M/L. Riesgo: riesgo de implementar. **Decisión** = requiere definición suya.

### P1 — integridad, seguridad o error funcional importante

| ID | Hallazgo | Evidencia | Esf. | Riesgo | Propuesta / criterio de aceptación |
|---|---|---|---|---|---|
| B1 | Nombres de categoría/producto/cliente se inyectan **sin escapar** en HTML y en `onclick` (`index.html:7756`, 7750, 7790, 7840, 7989, 7642, 13258). Un apóstrofe rompe el borrado; un nombre con HTML es XSS almacenado entre cajas. | CÓDIGO. Explotabilidad: HIPÓTESIS (quién puede escribirlos en el servidor) | S | Bajo | Escapar todas las salidas y pasar ids, no nombres, a `onclick`. Aceptación: categoría «Dulce d'leche» se elimina; `<img onerror>` se muestra como texto |
| B2 | Validación de producto: `parseInt` acepta precio negativo, trunca decimales, «12abc»→12; sin validar nombres duplicados (`7904`, `8012`). | CÓDIGO (7904 y 8012 verificados) | S | Bajo | Validar rango y formato; mensaje claro. Un precio negativo no debe poder cobrarse |
| B3 | Reservas: editar fuerza `estado:'pendiente'` (`7077`); se admite fecha/hora pasada; sin acción de cancelar (sólo eliminar definitivo). | CÓDIGO (7077 verificado) | S–M | Bajo | Conservar estado al editar; validar fecha; **Decisión:** estados y cancelación |
| B4 | «Limpiar historial de ventas» sin chequeo de rol ni de turno abierto, siempre visible (`5350-5357`). Con turno abierto y sin red, el cierre local sale incompleto. | CÓDIGO (verificado) | S | Bajo | Limitar a owner/admin y bloquear con turno abierto. **Decisión:** qué roles |
| B5 | Eliminar mesa: disponible a cualquier rol con un clic; si el borrado remoto agota el tiempo, `mesas=before` restaura un snapshot completo y pisa cambios hechos durante 10 s (`5917-5938`). | CÓDIGO. Permisos reales del servidor: HIPÓTESIS | M | Medio | Restaurar sólo la mesa afectada; **Decisión:** ¿puede el operador eliminar mesas con ítems? |
| B6 | Supabase se carga desde CDN con versión flotante `@2` y sin SRI (`index.html:103`). | CÓDIGO | S | Medio (cambia origen de script crítico) | **Infra/Decisión:** fijar versión + SRI o alojar el SDK |
| B7 | Reintento de **ventas** pendientes no corre al volver al primer plano; el banner dice «se reintenta sola». Sin backoff ni tope; máx. 10 grupos por pasada. | CÓDIGO. Impacto real: HIPÓTESIS (frecuencia de errores) | M | Medio | Disparar el reintento al reanudar; corregir el texto del banner. Medir antes |

### P2 — fricción operativa y mejoras de valor claro

| ID | Hallazgo | Evidencia | Esf. |
|---|---|---|---|
| B8 | Comandas: imprimir y «Marcar como enviada» son pasos separados; se puede reimprimir duplicado o marcar sin imprimir (`7499-7577`). | CÓDIGO | M |
| B9 | Comandas: cambiar el sector de una categoría tras enviar genera un «ANULAR» falso; producto fuera del menú imprime el id crudo (`7450-7466`). | CÓDIGO (por lógica, no ejecutado) | M |
| B10 | Mesas sin id de servidor y reservas: sólo «Imprimir pedido completo», se reimprime todo cada vez; el mensaje para reservas es engañoso. | CÓDIGO | M |
| B11 | Comprobante post-cobro se imprime aunque la venta no esté confirmada (el historial sí lo bloquea): dos caminos con reglas distintas (`18455`, `18487`, `7315`). | CÓDIGO | S |
| B12 | El comprobante no muestra «paga con» ni vuelto (decisión de la ola 1: no se persiste). | CÓDIGO | **Decisión** |
| B13 | Impresión sin manejo de errores, ancho fijo de 72 mm (ticketera 58 mm o A4: HIPÓTESIS). Nunca probada con impresora real. | CÓDIGO / HIPÓTESIS | M |
| B14 | Clientes: «visitas» no se incrementa en ningún lado del archivo (siempre 0 en este código); un guardado con copia local vieja podría pisar un contador de servidor (HIPÓTESIS). | CÓDIGO (verificado) | M |
| B15 | Alergias no aparecen en comanda, reserva ni mesa; datos personales visibles para todos los roles (`7645`). | CÓDIGO. Datos personales: **Decisión** | M |
| B16 | Recordatorio de reserva se marca «visto» antes de que alguien lo vea; se pierde al recargar (`4351`). Local por dispositivo. | CÓDIGO | S |
| B17 | Eliminar cliente deja la reserva con vínculo roto y al editarla se pierde (`12610`, `6885`). | CÓDIGO | S–M |
| B18 | Operadores: activar/desactivar y alta sin verificar rol al ejecutar; el alta se guarda local antes de saber si el servidor la acepta (`4971-5012`). | CÓDIGO. RLS: HIPÓTESIS | S |
| B19 | Catálogo: guard de UI «fail-open» con rol vacío; `toggleProdIlimitado` no revierte si el servidor rechaza (`7734`, `12120`). | CÓDIGO | S |
| B20 | Accesos rápidos: guardado no atómico (un `update` por producto); productos eliminados dejan huecos de numeración (`6628-6654`). | CÓDIGO | M |
| B21 | `clockBad` fijo a UTC-3: otra zona horaria muestra «Revisá la hora» siempre (`5591`). | CÓDIGO (verificado) | S |
| B22 | `setInterval(renderContextoGlobal, 3000)` sin gate de visibilidad; también `updateDate` y recordatorios; realtime no se detiene al ocultar. | CÓDIGO (verificado). Costo real: HIPÓTESIS, medir | S |
| B23 | Respaldo local vuelca todo `localStorage`/`sessionStorage` sin filtrar; podría incluir tokens de sesión (HIPÓTESIS: depende de supabase-js). Acceso gateado sólo en cliente. | CÓDIGO / HIPÓTESIS | S |
| B24 | Número de ticket = últimos 12 caracteres del id: no correlativo y difícil de buscar. | CÓDIGO | **Decisión** |

### P3 — exploratorio o impacto incierto
Bloque `disabled-supabase-patch` de 279 líneas (limpieza); 50 `console.log`; 74 usos de `font-size:11px` y 24 de 10px; 4 diálogos nativos (`confirm`/`prompt`); chevrones de acordeón de ~4 px; título de Clientes más pegado al borde que el de otras pantallas (captura); validación de teléfono/email y duplicados en Clientes; `aria-pressed` en filtros.

### Oportunidades comerciales/operativas (todas HIPÓTESIS, requieren decisión)
Venta adicional sugerida en Cobrar; fidelización usando «visitas» (hoy inexistente, B14); alergias visibles en cocina (B15); indicadores para el dueño a partir de Reportes. **No se implementó ni se estimó retorno de ninguna.**

### Ya descartadas
Agrandar controles del panel de pedido (ya tiene tamaños distintos por puntero); filtros de Caja en una línea en móvil (dos líneas es una regla deliberada); refactor del archivo único (sin problema verificable).

## 6. Pruebas

- Corrida completa a `a8b69d0`: 11 archivos, 190 pruebas, todas en verde (una intermitencia de `F4 … transferencia` bajo carga concurrente, 3/3 aislada y verde en la corrida sin competencia).
- Pruebas nuevas rojas contra la versión anterior (O1–O7). **Centavos (O7):** contra `341a762` (sin la corrección) «Justo» con total 12.400,4 mostraba `Faltan $0`; con la corrección, `Vuelto $0`. Se separó de la prueba de `aria-expanded` (O6) para que cada una demuestre su propio caso.
- `tests/carta_sync.test.cjs`: rojo en `f338bce`–`a8b69d0` (divergencia demostrada con `--check`), verde en `a26ad14`.

## 7. Riesgos residuales

1. Sin verificación en staging (§3).
2. Impresión nunca probada en dispositivo real.
3. Roles: sólo lectura de cliente y mocks; la seguridad efectiva depende de RLS, no auditada.
4. Backlog P1/P2 basado en lectura de código; varios ítems requieren reproducción antes de implementarse.
