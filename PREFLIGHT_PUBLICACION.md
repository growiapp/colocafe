# Preflight de publicación — versión consolidada (Colo Café)

**Estado: NO publicado. Nada se subió, mezcló ni desplegó. Producción sigue en `334df6c`.** Este documento es la lista de verificación para cuando la persona responsable decida publicar.

## 1. Qué se publicaría
- Rama `audit/ola1-ux-operativa` (la candidata es el commit de esa rama que figure al final de este archivo en la sección 6).
- `334df6c` (producción) **es ancestro** de la candidata: es una actualización directa, sin rebase. La rama `main` local está **por detrás** de producción (es ancestro de ambas): no usarla como base; publicar desde la candidata.
- Paquete de despliegue (workflow `.github/workflows/static.yml`, solo `index.html otra-pestana.html manifest.json logo.png logo.svg preview.jpg assets`): **el único archivo del paquete que cambia es `index.html`** (+238 / −75 líneas respecto de producción). El resto de la rama son pruebas, herramientas y documentación que **no viajan** al sitio.
- **Ningún SQL de producción se ejecuta ni cambia ninguno existente.** Hay un SQL NUEVO opcional (`open_orders_operator_guard.sql` + reversa) para B5 en el servidor, probado sólo en una copia aislada y **sin ejecutar en staging ni producción**; y SQL de solo lectura/fixtures de staging bajo `tools/staging-ola1/`.

## 2. Contenido funcional
Ola 1: vuelto en Cobrar sin alterar importes; Cobrar a ancho completo; «Eliminar mesa» accesible y con confirmación; teclado y foco en controles; nombre de local en móvil.
Riesgos: B1 (escape de texto libre), B2 (precios inválidos), B4 (Limpiar historial sólo owner/admin del local activo y sin turno abierto), B5 (el operador sólo elimina mesas vacías; el plan B de borrado sólo para cobros), B7 (reintentos con espera y tope, mensajes claros), B23 (el respaldo no incluye tokens).

## 3. Evidencia
| Control | Resultado |
|---|---|
| Regresión completa (20 archivos `tests/*.test.cjs`, incluida la prueba SQL en copia aislada) | **285 pruebas OK, 0 fallas** |
| `python tools/carta-v2/apply.py --check` | COINCIDE |
| Staging real, 3 roles: cobros efectivo/transferencia/mixto/descuento, permisos, eliminación de mesas | 31 ventas, 31 coherentes en el servidor (informe §3.2) |
| Limpieza de staging y línea base | 18/19 tablas idénticas; `profiles` explicada (trigger de Auth) |
| B7 reproducido y corregido sin residuos del arnés | 600 → 6 envíos/hora; rechazo permanente 600 → 1 (informe §9.1) |
| Revisión independiente de B7 y B5 | **Hecha, dos revisiones coincidentes** (Codex por la vía oficial + revisión nativa): 8 hallazgos, todos corregidos con prueba; ninguno en el SQL (informe §9.1) |
| `APP_VERSION` | `2026-11-25-b5-b7-consolidada`; detección verificada (informe §9.4) |

## 4. Antes de publicar (decisiones y acciones de la persona responsable)
1. **Servidor B5 (opcional pero recomendado):** autorizar la lectura de políticas en staging, la ejecución de `open_orders_operator_guard.sql` en staging y el ciclo corto de verificación (informe §9.3). Sin esto, la regla del operador sólo se hace cumplir en la pantalla. **No** ejecutar en producción sin autorización expresa.
2. **Versión de la app:** ya incrementada (`2026-11-25-b5-b7-consolidada`). Un dispositivo con la app abierta no ve el aviso hasta recargar: avisar a los cajeros.
3. **Aceptar lo no probado:** nota escrita por un rol y vista por otro; comandas; impresión; reservas; Reportes con ventas reales; Stock Durability (staging sólo tiene la estructura, sin funciones ni triggers); producción (nunca consultada).
4. **Aceptar la limitación de B5:** incluso con el guard del servidor, un operador puede vaciar los productos uno a uno y luego eliminar la mesa vacía; cerrarlo del todo exige una función de cancelación con registro (diseño mayor, informe §9.3).
5. Elegir **horario de baja actividad** (sin turnos abiertos si es posible) y avisar a los cajeros que recarguen la app tras publicar.

## 5. Publicación y reversa (cuando se autorice; no se ejecutó)
- Publicar = integrar la candidata en `main` (el workflow despliega Pages desde `main`). Eso es un push: requiere autorización explícita.
- **Reversa cliente:** revertir ese cambio (o volver a publicar `334df6c`); como sólo cambia `index.html`, no toca datos. **Reversa servidor (si se aplicó el guard):** `open_orders_operator_guard_rollback.sql`. Los pendientes guardados en cada dispositivo siguen siendo compatibles (no se cambió el formato de las colas; B7 sólo agrega campos opcionales `last_error_code`).
- **Verificación posterior sugerida (5 min):** abrir turno, cobrar una venta en efectivo y una por transferencia, eliminar una mesa vacía, ver que el cartel de pendientes no aparece.

## 6. Cierre
Candidata: la punta de la rama `audit/ola1-ux-operativa` (`git rev-parse HEAD`). Pendientes antes de publicar: sección 4 (puntos 1 a 5).
