# Plan de publicación coordinada a PRODUCCIÓN — candidata `4bcf451`

**Estado: PREPARADO, NO EJECUTADO.** Nada se publicó ni se ejecutó en producción. Todo lo consultado en producción fue **solo lectura** (catálogos y páginas del panel). Fecha del preflight: 2026-11-25.

## 1. Qué se publicaría (exacto)
- **Commit:** `4bcf451fcc69740307236ef12e4488ae657d959a` (rama `audit/ola1-ux-operativa`). Árbol: `85403d3d99c8940aad38e49fe8a73e6eb09cb22d`.
- **Base:** `origin/main` = `334df6c22a1db5469cfff3ce93b5315c817ef517` (consultado con `git ls-remote`, repo público `growiapp/colocafe`). Es **ancestro directo** de la candidata → **fast-forward posible** (54 commits). La rama `main` **local** está atrasada (`a9e2534`): **no usarla**; se publica el commit al ref remoto.
- **Paquete de despliegue** (workflow `static.yml` copia sólo `index.html otra-pestana.html manifest.json logo.png logo.svg preview.jpg assets/`): **sólo cambia `index.html`**; los demás archivos son byte a byte iguales a producción.
- **Hash esperado del sitio (bytes servidos de `index.html`):**
  - **Nuevo:** `sha256 = 85ed2aa0a43dfaf2e1f89a51b3bdb336e88dbbc3f35117774d3d18d391b75290`, **1.080.801 bytes**, `APP_VERSION = '2026-11-25-b5-b7-consolidada'`.
  - **Actual (hoy servido, verificado por HTTP):** `b5100e9c16ce3e1e985917ab0f0b33b52e0840ed624ad72ead3f32e2f491858b`, 1.064.428 bytes, `APP_VERSION = '2026-07-22-pending-banner-grace'`. Es idéntico a `334df6c:index.html`.
  - Sin cambios (deben seguir igual): `otra-pestana.html 384e1feb…`, `manifest.json 5106b743…`, `logo.png 4c1ced93…`, `logo.svg 0ab899e4…`, `preview.jpg 696bcc8f…` (primeros 16 hex).
- **Evidencia de código:** última regresión completa **285/285 OK** sobre este `index.html` (sin cambios posteriores en `index.html` ni `tools/carta-v2`; `apply.py --check` = COINCIDE). B7 verificado con dos revisiones independientes (Codex y nativa). B5 cliente probado; B5 servidor validado en staging (§3 y `AUDITORIA_360_REPORT.md` §9.3b–9.3d).
- **SQL a instalar después (producción):** `open_orders_operator_guard.sql` — SHA-256 `da419c4760ca967751eae3a02dc89b783789187ecfb1008afbe6cac997f3b308` (3.828 bytes, LF). **Reversa:** `open_orders_operator_guard_rollback.sql` — SHA-256 `c674ce95bc29f1e2730036416396a72f000105084a60db0e5ae6b3f9c58e829f` (430 bytes, LF). Son los **mismos bytes** que se validaron en staging (el texto completo está en el Apéndice A).

## 2. Verificaciones de producción (solo lectura) — resultados
### 2.1 Código y repositorio
| Verificación | Resultado |
|---|---|
| `origin/main` vigente | `334df6c` = lo que sirve el sitio hoy (hash `b5100e9c…` coincide) |
| Fast-forward | Sí: `334df6c` es ancestro de `4bcf451` |
| Protección de `main` | **Ninguna** (rama no protegida): un push no-fast-forward/force sería técnicamente posible → este plan **prohíbe** `--force` y lo comprueba |
| Último despliegue | `334df6c`: **success** (2026-11-25 03:42 UTC). Antes hubo **2 fallos** (`a1f240eb`, 00:35 y 00:37 UTC) y un éxito (`e81db265`): hay que **verificar la corrida** del despliegue nuevo, no darla por hecha |
| Caché del sitio | `Cache-Control: max-age=600`: un navegador puede seguir con el `index.html` anterior hasta 10 min tras el despliegue |

### 2.2 Base de datos de producción (proyecto `xhtpahjsddfkwsytubgu`) vs staging (`wjymdgfqmqutihadffec`)
Se ejecutó `tools/staging-ola1/guard_referencia.sql` (una sola consulta de solo lectura sobre catálogos; SHA-256 `4d899fd6…6e0c`) en ambos proyectos y se compararon **huella por huella** las 54 filas de staging (antes del guard) con producción:
- **54 de 54 idénticas**: 34 políticas (los **dos juegos permisivos** de `open_orders` y `open_order_items`, `sales`, `sale_items`, `sale_payments`, `open_order_dispatches`, `store_users`), RLS **forzada** en las 7 tablas, dueños y permisos (ACL), las 4 funciones con su cuerpo (`has_store_role`, `replace_open_order_items` = SECURITY INVOKER, `close_open_order_after_sale` y `bump_open_order_items_version` = SECURITY DEFINER, dueño `postgres`, `search_path = public`) y los 9 triggers comunes.
- **Única diferencia:** producción tiene **6 triggers más, de Stock Durability**: `sale_items_stock_apply`, `sale_items_stock_compensate`, `sale_items_stock_guard`, `sale_items_stock_prepare`, `sales_stock_gate`, `sales_stock_guard`. **No invalidan la migración:** el guard no escribe en `sales` ni `sale_items` (sólo las **lee** en su función auxiliar) y no toca ningún objeto `stock_*`. **Pero esos triggers nunca se ejercitaron en la validación de staging** (staging no los tiene): ver riesgos (§6).
- No existe ningún objeto del guard en producción (ni `open_orders_*_guard_operador` ni `open_order_operador_puede_cerrar`).
- Precondiciones del SQL (las comprueba el propio script y aborta sin cambiar nada si fallan): existen `open_orders`, `open_order_items`, `sales`, `sales.open_order_id` y `has_store_role(uuid, store_user_role[])` (esta última: definición idéntica a staging).

### 2.3 Función `SECURITY DEFINER` (`open_order_operador_puede_cerrar`)
- **Propietario:** el rol que ejecuta el script en el SQL Editor (`postgres`), igual que las otras funciones del proyecto. **`search_path = public`** fijado (mismo patrón que las existentes). **Sólo lectura** (`STABLE`, un `SELECT` de `open_order_items` y `sales`).
- **Permisos de ejecución** (en staging, tras instalar): `postgres`, `authenticated`, `service_role`; **no** `anon` ni `public` (el script revoca explícitamente). Producción comparte los mismos roles y la misma ACL en las funciones existentes.
- **Aislamiento entre locales:** (a) dentro de las políticas sólo se evalúa sobre filas que el usuario ya puede ver (pertenece al local); (b) exige que la venta sea **del mismo local** que la mesa (hueco que corregí y verifiqué con mutación); (c) **límite residual:** por ser ejecutable por `authenticated`, un usuario autenticado podría llamarla por RPC con un UUID ajeno y obtener un booleano («tiene ítems y no está cobrada» → `false`; si no existe → `true`). Requiere conocer el UUID de una mesa de otro local (no listable) y revela sólo ese booleano → **riesgo bajo, aceptado**; endurecerlo (devolver `false` a no miembros) cambiaría el SQL validado y exigiría revalidar en staging: **no incluido**.

### 2.4 Respaldo y recuperación — **HALLAZGO: NO hay respaldo de plataforma**
El panel de producción muestra «**Free Plan does not include project backups**» (sin backups diarios ni punto en el tiempo ni «restore to new project»). **No existe un procedimiento de respaldo de plataforma apropiado para el esquema/datos productivos.** Consecuencias y mitigación:
- La migración **no modifica datos**: sólo agrega 2 políticas y 1 función (no hay `INSERT/UPDATE/DELETE` de negocio). La «recuperación» es la **reversa** (instantánea, probada en copia y descrita abajo) y la **foto del catálogo previo** (las 60 filas de hoy, 54 comunes + 6 de stock).
- Esto **no resuelve** la ausencia general de respaldos de producción (riesgo que ya existía y que el guard no agrava). **Decisión que te corresponde:** (A) aceptar instalar el guard sabiendo que el riesgo de datos del cambio es nulo y la reversa inmediata; o (B) subir temporalmente a Pro / hacer un respaldo propio antes (fuera del alcance de esta auditoría). **La instalación del SQL queda condicionada a que elijas A o B por escrito.**
- Del lado del frontend no se requiere respaldo de datos: el rollback es volver a publicar los bytes de `334df6c`.

## 3. Orden recomendado de ejecución
**Principio:** primero el frontend (la pantalla ya respeta la regla y el «plan B» de borrado queda restringido), **esperar a que los dispositivos recarguen**, y sólo entonces el SQL. Si se instalara el guard con clientes viejos abiertos, su «plan B» (borrar ítems y luego la fila) lo eludiría; no rompe nada, pero el guard no protegería.

**Fase 0 — Preparación (sin cambios)**
1. `git fetch origin`; confirmar `git ls-remote origin main` = `334df6c…` (si cambió: **PARAR** y re-evaluar); árbol limpio; `git rev-parse 4bcf451` = `4bcf451fcc69740307236ef12e4488ae657d959a`.
2. Elegir ventana de baja actividad y avisar a los cajeros (§5). Tener a mano esta lista, el SQL y su reversa.

**Fase 1 — Frontend (requiere tu autorización explícita)**
3. `git push origin 4bcf451:refs/heads/main` — **sin `--force`**, sin `--force-with-lease`, sin tocar la rama local `main`. Si el remoto rechaza (no fast-forward): **PARAR**.

**Fase 2 — Verificar el despliegue**
4. Esperar la corrida «Deploy static content to Pages» para `4bcf451` (API pública de Actions) → debe terminar **success** (hubo fallos previos). Si falla: **PARAR** (producción sigue con `334df6c`; no hay nada que revertir en el sitio) y diagnosticar.
5. Descargar `https://growiapp.github.io/colocafe/index.html` con cabecera `Cache-Control: no-cache` y comprobar: `sha256 = 85ed2aa0…5290`, `1.080.801` bytes, `APP_VERSION = 2026-11-25-b5-b7-consolidada`; y que `manifest.json`, `otra-pestana.html`, `logo.*` y `preview.jpg` conservan sus hashes. Si no coincide tras 15 min: **PARAR**.

**Fase 3 — Recarga de los dispositivos**
6. Cada dispositivo de caja: cerrar y volver a abrir la app (o recargar). Al cargar, muestra una vez «Nueva versión disponible» y el botón **Actualizar app**. Comprobar en Soporte/diagnóstico que dice `APP_VERSION 2026-11-25-b5-b7-consolidada`. **No pasar a la Fase 4 hasta que todos los dispositivos de caja estén en la versión nueva** (la caché del navegador puede retrasarlo hasta 10 min).
7. Humo del frontend (operaciones reales rutinarias, sin datos de prueba): abrir turno, abrir una mesa, cobrar una venta real en efectivo y una por transferencia, ver que no aparece el cartel de pendientes. **Condición de parada del frontend:** si algo de esto falla → rollback del frontend (§4.1).

**Fase 4 — Guard B5 en producción (requiere tu autorización explícita y tu elección A/B del §2.4)**
8. **Precondiciones (solo lectura):** repetir `guard_referencia.sql` en producción → debe dar **exactamente las mismas 60 filas** de hoy (sin deriva) y ningún objeto del guard. Si difiere: **PARAR**. Sin cobros ni cierres de mesa en curso.
9. Ejecutar `open_orders_operator_guard.sql` (Apéndice A; verificar su SHA-256 antes) en el SQL Editor de **producción** (`xhtpahjsddfkwsytubgu`, etiqueta PRODUCTION). Es **una transacción** (`lock_timeout 10 s`): si algo falla, no queda nada. El panel pedirá confirmar «Potential issue detected» (contiene `DROP POLICY IF EXISTS` sobre las dos políticas nuevas, que aún no existen): confirmarlo.
10. **Verificación inmediata (solo lectura):** `guard_referencia.sql` → **63 filas** = las 60 + exactamente 3 nuevas (`FUNCION open_order_operador_puede_cerrar(uuid)`, `POLITICA open_orders · open_orders_delete_guard_operador` y `… update_guard_operador`, ambas `RESTRICTIVE`), **0 filas cambiadas o quitadas**; ACL de la función sin `anon`.

**Fase 5 — Comprobación funcional posterior (operaciones reales, sin datos de prueba)**
11. Un operador real: cobra una mesa con productos (venta guardada, mesa cerrada y sin cartel de pendientes); crea y elimina una mesa **vacía**. Owner/admin: eliminan una mesa con productos (con confirmación). Todo con la app nueva. **No** se hacen pruebas destructivas ni peticiones directas contra mesas reales; la prueba negativa (el operador rechazado) ya se hizo en staging.
12. Observación 24–48 h: avisos «El servidor rechazó los cambios…» o `42501` en cobros/cierres legítimos = condición de rollback SQL.

## 4. Condiciones de parada y rollback — independientes
### 4.1 Frontend
- **Parar / revertir si:** la corrida de Pages falla; el hash/`APP_VERSION` servido no coincide tras 15 min; en el humo de la Fase 3 no se puede abrir turno, abrir mesa o cobrar; o aparecen errores nuevos generalizados.
- **Rollback (sin force):** crear un commit que restaure los bytes de producción previos y publicarlo por fast-forward: `git checkout 334df6c -- index.html` en una rama a partir de `origin/main`, `git commit -m "revert: volver a 334df6c"`, `git push origin HEAD:refs/heads/main`. Verificar que el sitio sirve `sha256 b5100e9c…858b` (1.064.428 bytes). Los dispositivos verán de nuevo el aviso de «Nueva versión» (la versión guardada es la nueva y la cargada es la vieja): inofensivo. No requiere SQL.
- **Estados mixtos:** frontend revertido **con** el guard instalado → el guard sigue sin romper cobros ni mesas vacías; el cliente viejo, ante el rechazo del cierre de una mesa con productos, ejecuta su «plan B» (borra ítems y fila) y la elude (comportamiento anterior). No hay corrupción.

### 4.2 SQL (guard)
- **Parar sin cambiar nada:** cualquier discrepancia en las precondiciones (Fase 4, paso 8); cualquier error del script (la transacción se revierte sola); o que falte la elección A/B del §2.4.
- **Rollback inmediato** (`open_orders_operator_guard_rollback.sql`, Apéndice B; SHA-256 `c674ce95…829f`) si, tras instalar: un cobro legítimo del operador es rechazado (`42501`/«El servidor rechazó…»), una mesa cobrada queda con «Cierre de mesa pendiente» sin resolverse, o un owner/admin no puede eliminar una mesa. Verificación posterior: `guard_referencia.sql` vuelve a **60 filas** idénticas a las de antes.
- **Independencia:** revertir el SQL no exige revertir el frontend y viceversa; ninguno modifica datos.

## 5. Coordinación de los cajeros (Fase 3)
- Elegir un horario sin cobros en curso; avisar con anticipación: «Vamos a actualizar la app. Cerrá y volvé a abrir Colo Café; si ves “Nueva versión disponible”, tocá Actualizar app».
- Cada dispositivo debe mostrar `APP_VERSION 2026-11-25-b5-b7-consolidada` antes de seguir. Un dispositivo con la app **ya abierta** no se entera solo: la app **no consulta al servidor ni usa service worker**; avisa recién al cargar el código nuevo y compara con la versión guardada en el dispositivo (`colo_seen_app_version`). Un dispositivo nuevo o ya actualizado no muestra aviso.
- Con la caché de 10 min, si un dispositivo recarga demasiado pronto puede recibir todavía el código anterior: reintentar a los 10 minutos.

## 6. Riesgos y alcance (explícitos)
1. **B5 NO previene cancelaciones deliberadas.** El guard protege contra **errores accidentales** y usos normales; **no** contra un operador deliberado y con conocimientos técnicos: puede (a) vaciar los productos con la edición normal y luego eliminar la mesa vacía (sin rastro), (b) borrar los ítems directamente y luego la fila, o (c) fabricar una venta a su nombre que apunte a la mesa (queda una venta falsa en el historial). Cerrarlo exige una cancelación con registro de auditoría (diseño mayor, fuera de alcance). **No debe presentarse como control de seguridad.**
2. **Sin respaldos de plataforma en producción** (Free): riesgo preexistente; ver §2.4.
3. **Diferencias staging ↔ producción:** (i) 6 triggers de Stock Durability en `sales`/`sale_items` sólo en producción (nunca ejercitados en la validación; interacción nula esperada, **no probada**); (ii) plan Free sin respaldos; (iii) datos, usuarios y volumen reales (staging: 3 cuentas y un local de prueba); (iv) producción es el destino por defecto de la app. Todo lo demás en el catálogo es idéntico (54/54).
4. **No probado:** Stock Durability activo con cobros; nota escrita por un rol y vista por otro; comandas; impresión; reservas; Reportes con ventas reales; el reemplazo de ítems por la ruta sin función versionada; el aislamiento entre locales **en vivo** (sólo en copia aislada); pruebas negativas directas en producción (se evitan a propósito).
5. **`APP_VERSION`:** se detecta sólo al cargar (ver §5); un dispositivo abierto no se entera; caché de 10 min.
6. **Despliegue de Pages:** hubo 2 fallos previos; `main` no está protegida (hay que cuidar de no usar force).
7. **Función auxiliar:** oráculo booleano de bajo riesgo por RPC con UUID ajeno (§2.3).
8. **Límites de B7:** el estado de espera vive en memoria; los cierres de mesa pendientes no tienen espera creciente; una mesa detenida no se reinicia sola con una edición nueva que vuelva a fallar.

## 7. Autorización necesaria (no concedida todavía)
Este documento **no autoriza** nada. Se necesitan dos autorizaciones separadas: (1) publicar el frontend (Fase 1–3); (2) instalar el guard (Fase 4–5) + tu elección A/B de respaldo.

---
## Apéndice A — SQL exacto a instalar (`open_orders_operator_guard.sql`, SHA-256 `da419c4760ca967751eae3a02dc89b783789187ecfb1008afbe6cac997f3b308`)
```sql
-- Colo Café · B5 (servidor) · el OPERADOR no puede cerrar ni borrar una mesa con productos que no fue cobrada.
-- Regla comercial aprobada: operador = solo mesas vacías; dueño y administrador = también con productos (con confirmación en la app).
-- Qué hace (aditivo, idempotente, SIN tocar ninguna política existente): agrega dos políticas RESTRICTIVAS (se combinan con AND con las vigentes, sin depender de sus nombres)
-- y una función auxiliar de solo lectura.
--   * UPDATE de public.open_orders: si el cambio deja la mesa fuera de 'open' (cerrar/cancelar), solo owner/admin, o una mesa sin ítems, o una mesa YA COBRADA (existe una venta con ese open_order_id).
--   * DELETE de public.open_orders: solo owner/admin, o una mesa que ya no está 'open', o una mesa sin ítems, o ya cobrada.
-- No afecta: el cobro (el trigger trg_close_open_order_after_sale es SECURITY DEFINER y además la venta ya existe), la edición de ítems (replace_open_order_items sigue igual),
-- comandas (open_order_dispatches), historial (sales/sale_items/sale_payments) ni Stock Durability (no se toca nada de stock_*).
-- LÍMITE CONOCIDO: un operador puede quitar los productos uno a uno (edición normal) y luego eliminar la mesa ya vacía; eso es indistinguible de editar el pedido.
-- Reversa: open_orders_operator_guard_rollback.sql. Ejecutar PRIMERO en staging; producción solo con autorización expresa.
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.open_orders') is null or to_regclass('public.open_order_items') is null or to_regclass('public.sales') is null then raise exception 'B5_GUARD_ESQUEMA: faltan tablas'; end if;
  if to_regprocedure('public.has_store_role(uuid,public.store_user_role[])') is null then raise exception 'B5_GUARD_ESQUEMA: falta public.has_store_role(uuid, store_user_role[])'; end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.sales'::regclass and attname = 'open_order_id' and not attisdropped) then raise exception 'B5_GUARD_ESQUEMA: sales.open_order_id no existe'; end if;
end $$;

-- ¿Se puede cerrar/borrar esta mesa siendo operador? Sin ítems, o ya cobrada. SECURITY DEFINER para que el resultado no dependa de lo que el rol pueda leer (p. ej. sales).
create or replace function public.open_order_operador_puede_cerrar(p_open_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.open_order_items i where i.open_order_id = p_open_order_id)
      -- la venta debe ser DEL MISMO LOCAL que la mesa: una venta de otro local que apunte a esta mesa no cuenta como cobro
      or exists (select 1 from public.sales s join public.open_orders o on o.id = s.open_order_id and o.store_id = s.store_id where s.open_order_id = p_open_order_id);
$$;
revoke all on function public.open_order_operador_puede_cerrar(uuid) from public, anon;
grant execute on function public.open_order_operador_puede_cerrar(uuid) to authenticated, service_role;

drop policy if exists open_orders_update_guard_operador on public.open_orders;
create policy open_orders_update_guard_operador on public.open_orders
  as restrictive for update to authenticated
  using (true)
  with check (
    status::text = 'open'
    or public.has_store_role(store_id, array['owner','admin']::public.store_user_role[])
    or public.open_order_operador_puede_cerrar(id)
  );

drop policy if exists open_orders_delete_guard_operador on public.open_orders;
create policy open_orders_delete_guard_operador on public.open_orders
  as restrictive for delete to authenticated
  using (
    status::text <> 'open'
    or public.has_store_role(store_id, array['owner','admin']::public.store_user_role[])
    or public.open_order_operador_puede_cerrar(id)
  );

notify pgrst, 'reload schema';
commit;
```

## Apéndice B — Reversa exacta (`open_orders_operator_guard_rollback.sql`, SHA-256 `c674ce95bc29f1e2730036416396a72f000105084a60db0e5ae6b3f9c58e829f`)
```sql
-- Colo Café · B5 (servidor) · REVERSA de open_orders_operator_guard.sql. Quita solo lo que ese script agregó; no toca ninguna otra política ni dato.
begin;
drop policy if exists open_orders_update_guard_operador on public.open_orders;
drop policy if exists open_orders_delete_guard_operador on public.open_orders;
drop function if exists public.open_order_operador_puede_cerrar(uuid);
notify pgrst, 'reload schema';
commit;
```
