# Preflight de publicación — versión consolidada (Colo Café)

**Estado: NO publicado. Nada se subió, mezcló ni desplegó. Producción sigue en `334df6c`.** Este documento es la lista de verificación para cuando la persona responsable decida publicar.

## 1. Qué se publicaría
- Rama `audit/ola1-ux-operativa` (la candidata es el commit de esa rama que figure al final de este archivo en la sección 6).
- `334df6c` (producción) **es ancestro** de la candidata: es una actualización directa, sin rebase. La rama `main` local está **por detrás** de producción (es ancestro de ambas): no usarla como base; publicar desde la candidata.
- Paquete de despliegue (workflow `.github/workflows/static.yml`, solo `index.html otra-pestana.html manifest.json logo.png logo.svg preview.jpg assets`): **el único archivo del paquete que cambia es `index.html`** (+238 / −75 líneas respecto de producción). El resto de la rama son pruebas, herramientas y documentación que **no viajan** al sitio.
- **Ningún SQL de producción cambia** (no se modificó ningún `.sql` de la raíz; sólo hay SQL de solo lectura/fixtures de staging bajo `tools/staging-ola1/`, que no se ejecuta en producción).

## 2. Contenido funcional
Ola 1: vuelto en Cobrar sin alterar importes; Cobrar a ancho completo; «Eliminar mesa» accesible y con confirmación; teclado y foco en controles; nombre de local en móvil.
Riesgos: B1 (escape de texto libre), B2 (precios inválidos), B4 (Limpiar historial sólo owner/admin del local activo y sin turno abierto), B5 (el operador sólo elimina mesas vacías), B7 (reintentos con espera y tope), B23 (el respaldo no incluye tokens).

## 3. Evidencia
| Control | Resultado |
|---|---|
| Regresión completa (18 archivos `tests/*.test.cjs`) | **268 pruebas OK, 0 fallas** (266 en la corrida completa + 2 pruebas O2 ajustadas por la política B5 y vueltas a correr: 12/12) |
| `python tools/carta-v2/apply.py --check` | COINCIDE |
| Staging real, 3 roles: cobros efectivo/transferencia/mixto/descuento, permisos, eliminación de mesas | 31 ventas, 31 coherentes en el servidor (informe §3.2) |
| Limpieza de staging y línea base | 18/19 tablas idénticas; `profiles` explicada (trigger de Auth) |
| B7 reproducido y corregido sin residuos del arnés | 600 → 6 envíos/hora; rechazo permanente 600 → 1 (informe §9.1) |
| Revisión independiente (Codex) de B7 | **PENDIENTE** (bloqueada por permisos; requiere aprobación de la persona) |

## 4. Antes de publicar (decisiones y acciones de la persona responsable)
1. **Aprobar y ejecutar la revisión Codex de B7** (o aceptar explícitamente publicar sin ella).
2. **Versión de la app:** `APP_VERSION` sigue en `2026-07-22-pending-banner-grace`. Si no se cambia, los dispositivos no muestran el aviso «Hay una nueva versión». Decidir el nuevo valor (no se modificó para no tomar esa decisión por la persona).
3. **Aceptar lo no probado:** nota escrita por un rol y vista por otro; comandas; impresión; reservas; Reportes con ventas reales; Stock Durability (staging sólo tiene la estructura, sin funciones ni triggers); producción (nunca consultada).
4. **Aceptar la limitación de B5:** la regla «el operador sólo elimina mesas vacías» se hace cumplir en la interfaz; el servidor sigue permitiendo el borrado al operador hasta que se autorice el cambio de RLS/función (alcance en informe §9.3).
5. Elegir **horario de baja actividad** (sin turnos abiertos si es posible) y avisar a los cajeros que recarguen la app tras publicar.

## 5. Publicación y reversa (cuando se autorice; no se ejecutó)
- Publicar = integrar la candidata en `main` (el workflow despliega Pages desde `main`). Eso es un push: requiere autorización explícita.
- **Reversa:** revertir ese cambio (o volver a publicar `334df6c`); como sólo cambia `index.html` y no hay SQL, la reversa no toca datos. Los pendientes guardados en cada dispositivo siguen siendo compatibles (no se cambió el formato de las colas; B7 sólo agrega campos opcionales `last_error_code`).
- **Verificación posterior sugerida (5 min):** abrir turno, cobrar una venta en efectivo y una por transferencia, eliminar una mesa vacía, ver que el cartel de pendientes no aparece.

## 6. Cierre
Candidata: la punta de la rama `audit/ola1-ux-operativa` (`git rev-parse HEAD`). Pendientes antes de publicar: sección 4 (puntos 1 a 5).
