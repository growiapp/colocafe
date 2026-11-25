# Colo Café · Auditoría 360° — ola 1 y fase de riesgos

Producción: `334df6c`. Candidata local: rama `audit/ola1-ux-operativa`. Sin push, sin merge, sin deploy. Supabase producción no modificado. Stock Durability no tocado.

## 0. Cómo leer este informe

Cada afirmación lleva su nivel de evidencia:

- **LOCAL**: reproducido o verificado en el navegador local con el arnés de demostración (datos ficticios, Supabase simulado) o con una prueba automática.
- **COPIA AISLADA**: verificado en un Postgres en memoria (PGlite) con un esquema **simulado**.
- **CÓDIGO**: confirmado leyendo `index.html` o el SQL versionado del repo (con línea). No equivale a ejecutarlo ni al estado desplegado.
- **HIPÓTESIS**: depende de algo no visible (estado desplegado de RLS, restricciones, comportamiento de navegadores/impresoras).
- **STAGING**: verificado contra el entorno de staging. **Hoy no hay ninguna verificación de este nivel** (ver §3).

## 1. Contrato de generación de `index.html`

`tools/carta-v2/apply.py` está **vigente** (corrige un error mío anterior). Genera el CSS entre `/*CARTA_V2_BEGIN*/…/*CARTA_V2_END*/` (desde `carta_overlay{,2,3}.css`) y el JS entre `<!--CARTA_JS_BEGIN-->…<!--CARTA_JS_END-->` (desde `carta_module.js`). Lo demás de `index.html` se edita directamente.

- **Historial (LOCAL):** `apply.py --check` commit por commit: `COINCIDE` en los 8 commits de `0ad24f1` a `a1f240e`; `DIFERENTE` desde mi `f338bce`. El mecanismo no se abandonó; lo rompí yo y se corrigió en `a26ad14` (fuentes alineadas, `COINCIDE`).
- **Guarda:** `tests/carta_sync.test.cjs` falla si `index.html` y las fuentes divergen. Todos los cambios de la fase de riesgos caen **fuera** de las regiones generadas, y `--check` sigue en `COINCIDE`.

## 2. Estado de las cinco mejoras

| # | Mejora | Estado | Evidencia |
|---|---|---|---|
| 1 | Vuelto en Cobrar (efectivo): «Paga con», atajos, informativo | Implementada | LOCAL: O1, O7 (centavos: en la versión previa «Justo» mostraba `Faltan $0` con total 12.400,4) |
| 2 | Cobrar a ancho completo en escritorio | Implementada | LOCAL: O4 |
| 3 | «Eliminar mesa» como botón accesible | Implementada | LOCAL: O2, O8 |
| 4 | Teclado y foco en controles `div` | Implementada | LOCAL: O3, O5, O8 |
| 5 | Nombre del local en móvil en dos líneas | Implementada | LOCAL: captura 390 px |

**Regresión propia hallada y corregida en esta fase (LOCAL):** al enfocar el × con teclado, un repintado periódico de las tarjetas (≈9,6 s) destruía el nodo y el foco caía a `<body>`; mi prueba O2 lo detectó de forma intermitente. `renderMesasSection` ahora conserva el foco en la misma tarjeta y control (O8: rojo en el commit anterior, verde ahora; medición real de 13 s sin pérdida). También se descubrió que mi atributo `data-solo-admin` en «Limpiar» rompía el contrato de `v2_roles` (exige exactamente 3); se reemplazó por `data-solo-admin-estricto`.

## 3. Staging

### 3.1 Fase 1: procedimiento seguro (hecho)

**Análisis de los scripts existentes** (`02_fixtures.sql`, `05_cleanup.sql`, `00_schema_gate.sql`, del worktree de la aceptación E2E de Stock Durability):

- `02_fixtures.sql` es seguro por diseño: un solo `begin/commit`, UUID fijos, precondiciones (el local y sus productos no existen; exactamente 3 usuarios; `stock_store_activation` vacío). Efecto lateral: las tres cuentas reales ganan membresía en el local sintético.
- `05_cleanup.sql` tiene buenas guardas, pero **borra sólo `stock_ledger` y `stores` y confía en cascadas que nadie verificó** (`00_schema_gate.sql` nunca se ejecutó), y aborta si existe **cualquier** trigger no interno con «stock» en el nombre (Stock Durability está instalado). Los propios scripts declaran «runtime no validado».
- **COPIA AISLADA:** el script anterior **abortó en los tres escenarios simulados** (FK en cascada → falso `COLLATERAL` por un registro con `store_id` nulo; sin cascada → violación de FK; trigger «stock» → `TRIGGERS_ACTIVE`). Fail-closed y sin daño, pero inutilizable.

**Procedimiento nuevo** (`tools/staging-ola1/`): `fixtures.sql`, `cleanup.sql` y sus versiones `*_ENSAYO.sql` (terminan siempre en error informando qué harían), más `esquema_gate.sql` y `politicas_rls.sql` (ambos de sólo lectura).

- `fixtures.sql` escribe únicamente: 1 local, 3 membresías, 1 categoría, 1 operador y 6 productos, todos con UUID `e2e02026-…` y `legacy_id` `ZZE2E-`.
- `cleanup.sql` exige identidad exacta (id + legacy_id + nombre), alcance único (`ZZ_E2E%`), rol con `BYPASSRLS`; toma una foto de conteos de **todas** las tablas públicas sin contar el local sintético; borra **sólo** filas con `store_id` del local sintético en pasadas tolerantes a FK (sin depender de cascadas); verifica 0 residuos y conteos idénticos; todo en una transacción. Nunca ejecuta un `DELETE` sin esa condición.
- **COPIA AISLADA (`verificar_sql.cjs`, 15/15 casos):** ciclo completo con FKs en cascada y sin cascada deja los datos preexistentes (otro local, ventas, clientes, una venta con `store_id` nulo) idénticos y 0 residuos; el ensayo no cambia nada; ejecución parcial (falla un producto) no deja nada; fixtures dos veces y limpieza dos veces abortan sin cambios; con un segundo `ZZ_E2E%`, un producto ajeno o Stock Durability **activo** en el local sintético la limpieza aborta; con el trigger «stock» **inactivo** corre; una tabla hija sin `store_id` con filas del local sintético aborta y revierte todo.
- **Recuperación ante ejecución parcial:** cada script es una transacción; ante cualquier error el estado queda como estaba (probado). Si la limpieza abortara tras las pruebas, el local sintético sigue identificado por su `store_id` y se puede reintentar sin pérdida.
- **Límite:** el esquema simulado no es el real. Los `INSERT` usan las columnas del script anterior; los scripts `*_ENSAYO` existen para detectar diferencias sin efectos. Rol requerido: `BYPASSRLS` o superusuario (SQL Editor).

**¿Reutilizar un local de staging existente?** No recomendado: la app no puede borrar ventas (RLS), así que cualquier venta de prueba quedaría mezclada con datos reales y su limpieza exigiría borrados por lista de ids en tablas compartidas. El local sintético se elimina entero por `store_id`. No se pudo evaluar qué locales existen (no hay sesión); el preflight de sólo lectura lo informará.

**Política de red del arnés (ampliación mínima, LOCAL):** «Eliminar mesa» emite `DELETE open_orders?id=eq.X&store_id=eq.F`, no permitido antes. Se permite **sólo** con `store_id` del local sintético **y** un `id` de mesa creada por la propia prueba, sin filtros extra ni cuerpo (13 casos en `tests/staging_policy.test.cjs`, incluidas negativas: mesa ajena, otro local, sin id, `in`, filtro extra, `store_id` repetido, modo lectura, producción). Producción se bloquea por ruta y por resolución DNS (heredado). **Atención:** la URL por defecto embebida en la app (`index.html:8243`) es la de producción.

**Límite caracterizado:** las escrituras de comandas (`open_order_dispatches`) y reservas no están en la política (las de reservas se deniegan a propósito). Ampliación mínima propuesta si se quiere probarlas: `POST open_order_dispatches` con `store_id` sintético y `open_order_id` de mesa de la prueba, mismo patrón que arriba.

### 3.1b Preflight de staging (sólo lectura) — **STAGING, ejecutado**

Entorno recuperado: el formulario local de la clave devolvía `ERR_BLOCKED_BY_CLIENT` porque el arnés bloqueaba **todo POST a su propio servidor** y el formulario se envía por POST (reproducido con un autotest y corregido permitiendo únicamente `POST /__setup` desde la ventana «setup»; un POST a otra ruta sigue bloqueado). También se corrigió el websocket `wss://` de realtime, que se bloqueaba siempre por comparar contra `https://`. Se acepta la clave pública *anon* clásica (JWT con `ref` y rol verificables) o la *publishable*; nunca service_role ni secret.

Resultado, tres cuentas con sesión real (barrera de sólo lectura, evidencia fuera del repo):

| Perfil (ventana) | Cuenta (usuario) | Proyecto | Local activo | Rol en el local |
|---|---|---|---|---|
| `owner` | `7cd84c4f…` | `wjymdgfqmqutihadffec` (staging) | `89401a44…` «Colo Café Staging» | **owner** |
| `caja` | `eef11ffb…` | staging | idem | **admin** |
| `admin` | `48075b31…` | staging | idem | **operator** |

Las ventanas `caja` y `admin` quedaron intercambiadas por la persona; no importa, se identifica a cada cuenta por su usuario.

- **Datos preexistentes:** el local «Colo Café Staging» tiene **15 mesas abiertas reales de staging**. Ninguna prueba debe tocarlas: por eso el plan sigue siendo un local sintético aparte (fixtures) y no reutilizar este.
- **Red:** todo el tráfico fue sólo a staging; **cero conexiones a producción**; **ninguna escritura**. 6 lecturas de `sales` por cuenta se bloquearon por la política del arnés (filtros repetidos y una cabecera no permitida): falla en modo seguro; **limita lo que se podrá validar de Reportes** hasta ampliar la política de lectura (ampliación mínima propuesta: permitir `GET sales` con los filtros de rango de fecha repetidos y la cabecera `Range`; no escribe nada).
- **`manifest.json` responde 500** en el servidor del arnés (hash distinto por CRLF del archivo en disco): sólo afecta al manifiesto PWA, sin impacto en la prueba.
- **B23 (STAGING):** las tres sesiones guardan su credencial en `localStorage` bajo `sb-wjymdg…-auth-token`, o sea que la **hipótesis queda confirmada**: el respaldo local la habría incluido sin la redacción de B23.
- **B4 (STAGING) — regresión mía hallada aquí:** la primera versión del guard de «Limpiar» leía `window.supabaseStores`, una variable que la app **no publica** (`index.html:8943`), por lo que habría negado a **todos, dueño incluido**. Mis pruebas la inyectaban a mano y no lo vieron. Corregido en `9ce1879` con `getActiveStoreRoleEstricto()` (lee la variable real de la sesión, sin caer al primer local). Verificado con sesiones reales: rol estricto `owner`/`admin`/`operator` y `puedeLimpiarHistorial` = **true / true / false**. Además se confirmó **B26**: `window.getActiveStoreRole()` devuelve vacío en las tres cuentas.

#### Cierre de los defectos del entorno
1. **Lecturas de `sales` (STAGING + política):** una sola consulta legítima, `GET sales?select=…&store_id=eq.<local>&order=sold_at.desc&business_date=gte.D&business_date=lte.D&limit=…`, se bloqueaba por **`business_date` repetido** (rango de fechas). Las 2 peticiones con `x-retry-count` eran un efecto: el cliente reintenta (con esa cabecera) lo que el arnés abortó. Ajuste mínimo: en **lecturas**, una clave de fecha (`business_date`, `sold_at`, `opened_at`, `created_at`, `spent_at`) puede repetirse **exactamente dos veces** como un límite inferior (`gte`/`gt`) y uno superior (`lte`/`lt`); `x-retry-count` se permite. Siguen bloqueados: cualquier otra clave repetida, tres ocurrencias, dos límites inferiores, `eq` repetido, valores que no son fecha, **escrituras con claves repetidas**, cabeceras desconocidas y **producción** (25 casos en `tests/staging_policy.test.cjs`). Re-medido con sesiones reales: **0 violaciones**.
2. **`manifest.json` HTTP 500 (causa y corrección):** en el disco `manifest.json` y `otra-pestana.html` están en CRLF (`autocrlf=true`) y el índice de git en LF; el arnés comparaba el hash del disco con el del blob. Ahora el servidor entrega **los bytes del commit** (`git show`), sólo del paquete que publica `static.yml`. Verificado por HTTP real: los 8 archivos dan 200 con el **mismo SHA-256 que el commit**; `tools/`, `.git` y rutas con `..` dan 404 (3 pruebas en `tests/staging_servidor.test.cjs`).
3. **Identidad de sesiones:** los recorridos y la evidencia ahora se asocian al **usuario autenticado** y su rol (`7cd84c4f`→owner, `eef11ffb`→admin, `48075b31`→operator), no al nombre de la ventana; además se intercambiaron los directorios de perfil `caja`↔`admin` (sin repetir logins) y un nuevo preflight confirmó etiquetas correctas, sesiones vivas, **0 violaciones, 0 errores de consola, 0 escrituras**.

### 3.1c Esquema real de staging (STAGING, solo lectura, ejecutado por el panel de Supabase autenticado)

Seis consultas `SELECT` sobre catálogos del sistema, cada una verificada por SHA-256 contra el archivo del commit antes de ejecutarla, en el proyecto `colo-cafe-staging` (`wjymdgfqmqutihadffec`). Resultados:

- **RLS activo y forzado** en las 8 tablas operativas. `open_orders`, `open_order_items`: SELECT/INSERT/UPDATE/DELETE para **owner, admin y operator** (políticas duplicadas «legacy» y `_ops`). `categories`, `products`: escribir sólo owner/admin. `sales`, `sale_items`, `sale_payments`: DELETE sólo owner/admin; lectura para cualquier miembro. `customers`, `reservations`, `open_order_dispatches`: operador puede escribir. → **confirma B1 (el operador escribe notas que el dueño verá) y B5 (el operador puede eliminar mesas)** como permisos reales del servidor, no sólo del cliente.
- **B2:** `products.price` es `numeric(12,2)` con `CHECK (price >= 0)` (el servidor ya rechaza negativos y **acepta 0**; no valida enteros: el rechazo de decimales y cero es regla del cliente).
- **Idempotencia de ventas:** índice único `sales_store_legacy_unique_idx (store_id, legacy_id) WHERE legacy_id IS NOT NULL`: la hipótesis sobre la restricción UNIQUE queda **confirmada**.
- `has_store_role`: `SECURITY DEFINER`, `search_path` fijo.
- **Esquema para la limpieza:** rol del editor `postgres` con `bypassrls`; **0 filas `STOP_*`** (no hay tablas hijas sin `store_id`; `reservations` existe); **0 FKs que bloqueen el borrado**; 17 tablas con `store_id` (incluye `audit_logs` y `stock_ledger`); **16 FKs hacia `stores`, todas `ON DELETE CASCADE`** (`stock_ledger` no tiene FK y la limpieza lo borra explícitamente); 11 FKs `SET NULL`, todas entre tablas del mismo local.
- **Triggers (20):** `updated_at`, versionado de ítems, etiquetas de pedido, `trg_close_open_order_after_sale` (el servidor cierra la mesa al entrar una venta con `open_order_id`) y `stores_create_owner_membership`, que crea membresía **sólo si `created_by` no es nulo**: `fixtures.sql` no lo informa, así que sus «exactamente 3 membresías» son correctas. **Ningún trigger escribe en `audit_logs` y `index.html` nunca la usa.** **No hay triggers de Stock Durability en `public`** (ver la corrección de la paridad en §3.1e: mi frase inicial «no está instalado» era una simplificación incorrecta).
- **`fixtures.sql` contra el esquema real (sin ejecutarlo):** las 56 columnas de `stores`, `store_users`, `categories`, `operators` y `products` se leyeron; **todas las columnas que el script informa existen y no falta ninguna obligatoria sin valor por defecto**; sus valores no chocan con `UNIQUE (store_id, name)`, `UNIQUE (store_id, normalized_name)`, `UNIQUE (slug)` (queda nulo), `CHECK price>=0` ni `CHECK stock>=0`.
- **Copia aislada con la topología real** (`verificar_sql.cjs`, ahora 31/31, ver §3.1f): fixtures → escrituras de la app (venta ligada a su mesa con el trigger de cierre, auditoría, `stock_ledger`) → ensayo → limpieza deja lo preexistente intacto (incluidos sus vínculos `SET NULL`) y 0 residuos.
- **Efecto lateral en el panel:** el SQL Editor guardó automáticamente un fragmento «Untitled query» con la última consulta (metadato del panel, no dato de la base). Se puede borrar a mano; no se borró.

### 3.1e Paridad de Stock Durability (STAGING, solo lectura) — corrige una afirmación mía

Consulta `stock_paridad.sql` (catálogos + sólo agregados de las dos tablas de configuración), ejecutada en staging y contrastada con lo que crea `stock_durability.sql` (2 tablas, 1 columna, 1 índice, 10 funciones, 9 triggers):

| Objeto | Esperado por `stock_durability.sql` | En staging |
|---|---|---|
| Tablas `stock_store_activation`, `stock_ledger` | 2 | **2 (existen, vacías: 0 filas de activación, 0 en el ledger)** |
| Columna `products.stock_counted_at` | 1 | **existe** |
| Índice `sale_items_stock_incidents_idx` | 1 | **existe** |
| Funciones (`sale_items_stock_*`, `sales_stock_*`, `products_stock_*`, `stock_apply_adjustment`, `stock_store_activation_guard`) | 10 | **0** |
| Triggers | 9 | **0** (y ningún otro trigger o función con «stock» en ningún esquema) |

**Diagnóstico:** Stock Durability **no está «no instalado»**: la **estructura** está (tablas, columna, índice) y falta **todo el comportamiento** (funciones y triggers). Es exactamente el estado que deja `stock_durability_rollback.sql`, que según su cabecera **conserva** tablas, columnas y `stock_ledger` «como registro inerte» y **borra** todos los triggers y funciones. También es compatible con una instalación que sólo recibió la parte estructural. **No se puede distinguir** entre esas dos historias sin el historial de migraciones de staging; lo que sí se sabe es que **nunca se movió stock desde el servidor** (ledger vacío, sin activación).

**Diferencia con el diagnóstico anterior («instalado e inactivo»):** esa fórmula describe la instalación **completa** con todos los locales sin activar (funciones y triggers presentes, inertes por estado). Staging está **un paso más atrás**: sin funciones ni triggers. La diferencia es de **nivel de instalación**, no de activación: en ambos casos Stock Durability está **inactivo**. **No se instaló ni se modificó nada.** La paridad con producción **no se verificó** (no se consultó producción).

**Efecto en el ciclo de staging:** ninguno negativo. `fixtures.sql` exige `stock_store_activation` vacío (se cumple: 0 filas), la limpieza borra `stock_ledger` por `store_id` (0 filas) y la guarda `OLA1_CLEANUP_STOCK_ACTIVO` no se dispara. **Contrapartida:** el comportamiento del servidor de Stock (compuertas de venta/producto) **no se puede probar en staging** tal como está; fuera del alcance de esta auditoría.

### 3.1f Recuperación ante interrupciones del ciclo de staging

**Cómo se identifica exactamente lo sintético:** por identidad fija, sin depender de ningún estado de la sesión: `id = e2e02026-1123-4122-8000-000000000001`, `legacy_id = 'ZZE2E-STORE'`, `name LIKE 'ZZ_E2E%'`, y dentro de él todas las filas con ese `store_id` (17 tablas). `inventario_sintetico.sql` (sólo lectura, sólo conteos) lista qué hay en cada tabla y confirma que no existe otro local `ZZ_E2E%`.

**Hallazgo real que corregí:** si el local se borrara a mano, `stock_ledger` (sin FK a `stores`) dejaría filas huérfanas y la limpieza **abortaba por «local inexistente» sin poder retirarlas**. Ahora `cleanup.sql` **se reanuda**: sin local pero con residuos por `store_id`, limpia sólo esos residuos; sin local y sin residuos, aborta con `OLA1_CLEANUP_NADA_QUE_LIMPIAR`. Además compara por **hash** el contenido de todos los demás locales y **todas las membresías** ajenas (`OLA1_CLEANUP_COLATERAL_LOCALES` / `_MEMBRESIAS`).

**Demostración en la copia aislada con la topología real (31/31 casos):**

| Interrupción | Resultado |
|---|---|
| A. Después de crear local, membresías y productos | La limpieza deja todo como antes |
| B. Después de crear mesas (pedidos, ítems, comandas) | Igual |
| C. Después de ventas, pagos, turno, auditoría y `stock_ledger` (con el trigger de cierre) | Igual |
| D. La **limpieza misma** se interrumpe a mitad (falla un borrado) | Se **revierte todo** (estado idéntico al anterior), se retira el obstáculo, se reanuda y termina |
| E. El local fue borrado a mano y quedan filas sin FK | **Rojo con la limpieza anterior, verde ahora**: se reanuda y borra sólo los residuos |
| F. Hijos ya borrados parcialmente a mano | Termina sin tocar lo ajeno |
| G. Ciclo repetido (crear → limpiar → crear → limpiar) y limpieza ya hecha | Repetible; la repetida aborta sin tocar nada |
| H. Una fila **ajena** colada en el local sintético | La limpieza **aborta y no borra nada** |

En **todos** se comprueba: (1) el **contenido completo** (hash de cada fila) de todo lo ajeno es idéntico al de **antes de crear** los fixtures; (2) las filas exactas de `store_users` del local preexistente no cambian; (3) las 3 cuentas conservan su membresía en el local preexistente; (4) 0 residuos del sintético.

**Línea base real de staging (STAGING, solo lectura):** `linea_base.sql` registró, antes de crear nada, cantidad y huella md5 de las 19 tablas (`evid/linea_base_staging_2026-11-25.txt`: p. ej. 41 `open_orders`, 26 `sales`, 51 `sale_items`, 3 `store_users`); `inventario_sintetico.sql` confirma hoy **0 locales sintéticos, 0 filas del sintético en las 17 tablas** y **1 membresía de cada cuenta (owner, admin, operator) en el local preexistente**. Caveat: si alguien trabaja en «Colo Café Staging» durante el ciclo, los timestamps de las filas cambian y la huella puede diferir; en ese caso se revisa el motivo (la limpieza verifica por su cuenta, dentro de su transacción, los hashes de locales y membresías).

**Recuperación del cliente (STAGING, solo lectura):** con el local sintético «recordado» como activo pero inexistente, las 3 cuentas de prueba vuelven solas al local preexistente (`89401a44`), con su rol correcto (owner / admin / operator), 15 mesas, 0 violaciones y 0 errores de página.

**Procedimiento si el proceso se interrumpe (sin pedir tareas técnicas a la persona):** (1) `inventario_sintetico.sql` → qué hay; (2) `cleanup_ENSAYO.sql` → qué borraría (se revierte siempre); (3) `cleanup.sql` → borra sólo lo sintético; (4) `inventario_sintetico.sql` y `linea_base.sql` → cero residuos y huella ajena idéntica a la registrada; (5) `recuperacion_cliente.cjs` → las cuentas vuelven al local preexistente. Todo se ejecuta desde el panel ya autenticado y puede repetirse.

### 3.1d Validación en staging SIN escrituras — **STAGING, 66/66 comprobaciones OK**

`harness/validacion_solo_lectura.cjs`: local real «Colo Café Staging» (`89401a44…`), las tres cuentas (identificadas por usuario y rol), escritorio 1280×800 y móvil 390×844. Barrera `readonly` + freno dentro de la página que anula los clics en «Confirmar cobro», en el «Eliminar» del diálogo y en «Guardar». **Cero escrituras de datos**: sólo 288 GET, 12 HEAD, 3 websockets y 3 `POST /auth/v1/token` (refresco de sesión). Sólo se abre, se mide, se escribe en campos sin enviarlos y se **cancela**.

| Comprobación (cada cuenta: owner / admin / operator) | Resultado |
|---|---|
| Entorno: proyecto, usuario, rol y local | OK ×3 |
| **M1** Vuelto en efectivo sobre una mesa real (T15, $3.900): exacto `Vuelto $0`, superior `Vuelto $5.000`, insuficiente `Faltan $100`; el botón conserva el total | OK ×3 |
| **M1** Transferencia y mixto: sin cálculo de vuelto; el mixto muestra sus campos; Efectivo conserva el monto | OK ×3 |
| **M2** Cobrar a ancho completo en 1280×800: sin desborde, «Confirmar cobro» a la vista (columna 700 px) | OK ×3 |
| **M2** Cobrar en móvil 390×844: sin desborde horizontal | OK ×3 |
| **M3** Eliminar mesa: `<button>` con nombre, abre confirmación por teclado, **Cancelar no elimina** | OK ×3 |
| **M4** Foco: filtros (Enter/Espacio), × conservado tras 14 s de repintados reales, y el foco del importe sobrevive a la llegada real de los operadores | OK ×3 |
| **M5** Nombre del local en móvil: «Colo Café Staging» completo (2 líneas) | OK ×3 |
| **B4** «Limpiar historial» y edición de catálogo visibles sólo para owner/admin del local activo | OK ×3 (operator: oculto) |
| **B2** «2.500», «-100», «0», «12.5» se rechazan con aviso y no llegan al servidor | OK ×3 |
| **B23** La credencial `sb-…-auth-token` está en `localStorage` y el respaldo local **no** la contiene | OK ×3 |
| Reportes, Historial y Clientes cargan sin errores de página ni de red (lecturas de `sales` ya permitidas) | OK ×3 |
| Clics anulados por el freno / violaciones de red | 0 / 0 ×3 |

**Lo que esto NO demuestra** (requiere escribir datos sintéticos): que el cobro **persista** con los importes, descuentos y pagos correctos (y que el vuelto no los altere en el servidor), el caso de centavos con un total real, la eliminación real de una mesa por rol (y B5 con el servidor), B1 con una nota de un rol vista por otro, comandas, impresión y reservas.

### 3.2 Ciclo de validación con escrituras en staging — **EJECUTADO (2026-11-25), autorizado y acotado**

**Alcance autorizado:** crear únicamente el local `ZZ_E2E_OLA1` (`e2e02026-1123-4122-8000-000000000001`) y sus datos sintéticos; probar turno, mesas, productos y cobros (efectivo, transferencia, mixto, centavos) **sólo dentro de ese local**; verificar proyecto, usuario, rol y local antes de cada escritura; no tocar «Colo Café Staging»; limpiar al final; comparar la línea base; si hay una interrupción, recuperar y limpiar sólo lo sintético. Excluidos: producción, Stock Durability, SQL estructural, RLS, usuarios de Auth, respaldos y configuración.

**Secuencia (todo con el contenido verificado por SHA-256 contra el archivo del commit antes de cada ejecución):**
1. Pre-chequeo: línea base **idéntica** a la medición original (19/19), 0 locales sintéticos, 3 membresías.
2. `fixtures_ENSAYO.sql` (revierte siempre): pasó todas las guardas y los `INSERT` fueron válidos contra el esquema real; sin residuos.
3. `fixtures.sql`: `FIXTURES_OK` (1 local, 3 membresías, 1 categoría, 1 operador, 6 productos).
4. Recorridos con las 3 cuentas (cambio de local por el diálogo real «Elegí la tienda → Continuar», turno, 4 cobros por cuenta, eliminación de mesa). Barrera de red `fixture`: sólo se permite escribir en el local sintético y sobre pedidos creados por la propia prueba.
5. Verificación **en el servidor** de lo guardado (`verificacion_ventas_sinteticas.sql`).
6. Línea base «durante», `cleanup_ENSAYO.sql` (informó exactamente lo inventariado y no cambió nada) y `cleanup.sql`.
7. Inventario y línea base finales; recuperación del cliente.

**Verificación previa a escribir (condición 3):** antes de cada bloque de escrituras (turno, cada cobro, eliminación) el guion comprueba proyecto/URL (`wjymdgfqmqutihadffec`), usuario (por prefijo), rol estricto del local activo y nombre del local sintético; si algo no coincide no escribe. Resultado: 0 abortos y **0 violaciones de la barrera de red en las pasadas finales**.

#### Resultados de los cobros por medio de pago y rol (STAGING)

Pasadas finales limpias: **owner + operator 62/62** y **admin 31/31** (los intentos anteriores, con el arnés aún con defectos, están documentados abajo). Importes verificados dos veces: lo que **la app envió** (cuerpos de `POST sales/sale_items/sale_payments`) y lo que **el servidor guardó** (31 ventas, **las 31 con total = suma de pagos = suma de ítems**, todas con turno y operador).

| Medio | Mesa de prueba | Total | Lo que guarda el servidor | owner | admin | operator |
|---|---|---|---|---|---|---|
| Efectivo con vuelto («paga con» $5.000) | Café $2.200 + Medialuna $900 | $3.100 | `efectivo: 3100` (el vuelto **no** viaja ni se guarda) | OK | OK | OK |
| Transferencia | Tostado $4.500 | $4.500 | `transferencia: 4500` | OK | OK | OK |
| Mixto | Jugo $2.600 + Cien $100 | $2.700 | `efectivo: 1000 + transferencia: 1700` | OK | OK | OK |
| Descuento 12,5 % sobre $100 + «Justo» | Cien $100 | **$87** | `efectivo: 87` | OK | OK | OK |

- **Vuelto:** «Vuelto $1.900» sobre $3.100 con $5.000; sin cálculo de vuelto en transferencia ni mixto; ningún campo de «paga con»/vuelto aparece en los cuerpos enviados.
- **«Centavos» (aclaración):** el 12,5 % de $100 son $12,50 y la app **redondea el descuento a pesos enteros** ($13): el total mostrado, enviado y guardado es **$87**, sin centavos. Mi expectativa inicial (87,5) era incorrecta. **En esta app los totales persistidos no tienen centavos**; el caso de `Justo` con total fraccionario (O7) es un seguro que hoy no se alcanza desde la interfaz.
- **Permisos de cobro:** los tres roles (incluido el operador) cobran; el servidor lo permite (políticas `sales`/`sale_items`/`sale_payments`: insertar para owner, admin y operator).

#### Eliminación de mesas y permisos (STAGING)

| Rol | Botón accesible con nombre | Confirmación por teclado | «Cancelar» no elimina | Eliminación confirmada en el servidor |
|---|---|---|---|---|
| owner | OK | OK | OK | `PATCH` cierre 200 → `DELETE open_order_items` 204 → `DELETE open_orders` 204 |
| admin | OK | OK | OK | igual, 204 |
| operator | OK | OK | OK | igual, **204: el servidor permite al operador eliminar mesas** |

El operador **puede** eliminar mesas (coincide con las políticas RLS leídas); es la decisión D de B5 (¿debe poder?). Sin borrados accidentales: el diálogo se cancela sin efecto y la eliminación confirmada no dejó RPC tardío en las pasadas finales.

#### Evidencia de limpieza y comparación de la línea base (STAGING)

- **Plan del ensayo de limpieza:** `categories=1, open_order_items=2, open_orders=33, operators=1, products=6, sale_payments=38, sales=31, shifts=1, store_users=3` (+ `sale_items=48` por cascada desde `sales`), idéntico al inventario previo, y el ensayo **no cambió nada**.
- **Limpieza real:** el local sintético ya **no existe**, **0 filas** del sintético en las 17 tablas, 0 locales `ZZ_E2E%`, y cada cuenta (owner, admin, operator) conserva **1 membresía** en el local preexistente.
- **Línea base posterior vs. original: 18 de 19 tablas idénticas** (incluidas las 41 `open_orders`, 26 `sales`, 51 `sale_items` y las 15 mesas abiertas de «Colo Café Staging»). **Única diferencia: `profiles`** (3 filas, contenido distinto; misma huella antes y después de limpiar, o sea que la limpieza no la tocó). **Explicación verificada, no ajena a las pruebas:** el trigger `auth_users_profile_sync_update` (`AFTER UPDATE ON auth.users` → `handle_auth_user_change`) sincroniza `profiles` cuando Auth actualiza al usuario (inicio o refresco de sesión); los `updated_at` de las 3 filas coinciden con el inicio de sesión de cada cuenta de prueba en el arnés (16:58:40, 16:58:42, 16:59:54 UTC) y **no hubo ninguna petición no-GET a `profiles`** en los logs. Evidencia preservada en `evid/linea_base_staging_*.txt`.
- **Recuperación del cliente (corrige una conclusión mía anterior):** mi prueba previa «las cuentas vuelven solas al local real» era **vacua** (la app ignoraba el `activeStoreId` inyectado). Repetida correctamente tras el ciclo —con el local sintético ya «verificado» en el navegador de cada cuenta y eliminado— las 3 cuentas vuelven solas a «Colo Café Staging» con su rol, 15 mesas, 0 violaciones y 0 errores.

#### Defectos encontrados en este ciclo y correcciones

**Del arnés de pruebas (corregidos, con pruebas; ninguno afectó datos):** (1) el formulario local de la clave bloqueaba su propio `POST`; (2) el `wss` de realtime se bloqueaba siempre; (3) `manifest.json` daba 500 por CRLF del disco (ahora se sirven los bytes del commit); (4) la política de lectura de `sales` rechazaba el rango de fechas legítimo; (5) el arnés no reconocía los pedidos que la propia prueba creaba (la app pide `?select=id`) y bloqueó RPC legítimos —ahora registra el id desde la petición y lo recuerda en disco para poder **retomar**—; (6) carrera entre respuestas pendientes y la decisión de la política; (7) el guion no cerraba la pantalla «Venta guardada» ni cambiaba de local por el diálogo real. Todos fallaron en modo seguro (bloqueo sin escritura).

**Del producto (observaciones; ninguna impide publicar):**
- **B7 con evidencia en vivo (STAGING):** un envío de ítems pendiente que el arnés bloqueaba se **reintentó sin pausa (~2 peticiones/s; 3 RPC + PATCH por vuelta)**, el pedido «cambiaba» en cada vuelta y **Cobrar quedó rechazando con «El pedido cambió. Revisá el detalle y confirmá de nuevo»** junto al aviso «Error al sincronizar». Equivale a un rechazo persistente del servidor o a un corte de red prolongado. Es el hallazgo B7 (sin backoff ni tope): sube de prioridad (P2 alto) y conviene corregirlo en una versión posterior; el cobro se resolvió al permitir el reintento.
- **Descuentos sin centavos:** diseño actual (redondeo a pesos enteros); documentarlo, no es un defecto.
- **Operador puede eliminar mesas con ítems:** coincide con el servidor; decisión D de B5.

## 4. Investigaciones de riesgo (Fase 3)

Todas tienen prueba que **falla contra `334df6c` y pasa ahora** (`tests/ola2_riesgos.test.cjs`). «Servidor» = SQL versionado en el repo (`open_orders_schema_alignment.sql`, `open_orders_rls.sql`); el estado **desplegado** no está verificado: `politicas_rls.sql` (sólo lectura) lo comprobará.

### B1 · HTML/JavaScript en textos libres — **P1, corregido en local**
- **Código responsable (CÓDIGO):** 26 interpolaciones sin escapar (24 halladas por mí + 2 que mi barrido no vio y encontró la revisión independiente: el operador en el resumen del turno y el producto del ranking de Reportes): nombres de categoría/producto/cliente/local, teléfono, email, alergias, preferencias, variantes, y en el Historial producto, variante, **nota del ítem**, mesa y operador. Además el nombre de categoría iba dentro de un `onclick` (un apóstrofe rompía el borrado).
- **Demostrado (LOCAL):** con un payload inocuo (`<img onerror>` que sólo incrementa un contador), el código se **ejecutó** en Clientes, Categorías e Historial.
- **Impacto y alcance:** las notas de ítem **vuelven del servidor** (`item.note`, líneas 9437/15859/15943) y se pintan sin escapar en el Historial. **El servidor deja escribir `open_order_items` a owner, admin y operator** (CÓDIGO), y el operador escribe notas en su uso normal. Camino: operador → nota con HTML → dueño abre el Historial → JS en la sesión del dueño (que además guarda su sesión en `localStorage`, ver B23). Ejecución real en la sesión de otro rol: **HIPÓTESIS** hasta probarla en staging; la ejecución de JS en el propio navegador está demostrada.
- **Corrección:** escapar en todos los sitios y pasar el índice (no el nombre) al `onclick`. **Guarda estática** (`B1 (estático)`) que falla si reaparece una interpolación de texto libre sin escapar (ampliada tras la revisión a nombres cortos de variable). **Límite:** la guarda es heurística (patrones de nombres de campo); un campo con otro nombre podría escapársele.
- **Probabilidad:** media (requiere un nombre/nota maliciosa o accidental con `<`/comillas). **Gravedad:** alta si hay cuentas con roles distintos.

### B2 · Validación de precios — **P1, corregido en local**
- **Código (CÓDIGO):** `parseInt` en `guardarProducto` y `guardarProdRapido`. El campo es `type=number`, donde el navegador toma el punto como decimal.
- **Demostrado (LOCAL):** «2.500» se guardaba como **$2**; `-100` se aceptaba; `12.5` se truncaba a 12.
- **Servidor:** restricción sobre `products.price` **no verificada** (HIPÓTESIS); la consulta de `politicas_rls.sql` la lista.
- **Corrección:** sólo se guarda un entero positivo (`^\d{1,9}$`, >0); lo demás se rechaza con aviso claro. **No se tocó** el precio de las opciones de variantes (un modificador negativo puede ser intencional): pendiente de decisión.
- **Impacto:** subcobro silencioso con error de tipeo cotidiano. **Probabilidad:** media (separador de miles). **Alcance:** todos los locales una vez sincronizado.

### B4 · Limpiar historial — **P1, corregido en local**
- **Código (CÓDIGO):** `limpiarVentas()` sólo bloqueaba si había ventas pendientes; sin rol ni turno; el botón se veía a todos.
- **Alcance real:** borra el historial **local** (`ventas=[]`); no borra el servidor (HIPÓTESIS menor: el historial en línea no se afecta). El daño es el **cierre de turno sin conexión**, que se calcula con ese historial, y el respaldo/diagnóstico local.
- **Corrección (LOCAL):** sólo owner/admin **del local activo** (con `activeStoreId` explícito, sesión y rol propio de ese local; rol sin resolver = no), nunca con turno abierto (mismo criterio que DEC-07); el botón se oculta con un atributo propio. La primera versión usaba `getSupabaseActiveRole()`, que cae al rol del **primer local** de la lista si el local activo no tiene rol (Codex lo detectó): ver B25. **Decisión pendiente suya:** si un administrador debe poder hacerlo o sólo el dueño.
- **Impacto:** medio. **Probabilidad:** baja-media (botón visible, un clic y confirmación).

### B5 · Eliminación concurrente de mesas y snapshot — **P1, corregido en local**
- **Código (CÓDIGO):** `pedirEliminarMesa` guardaba un snapshot completo de `mesas` y, ante fallo o tiempo agotado (10 s) del borrado remoto, hacía `mesas=before`.
- **Demostrado (LOCAL):** con un borrado que falla tarde, un cambio en otra mesa y una mesa nueva creados mientras tanto **desaparecían**.
- **No demostrado (HIPÓTESIS):** el caso en que el servidor sí borró pero el tiempo se agotó (la mesa reaparecería como fantasma hasta la siguiente lectura; el anti-doble-cobro `checkOpenOrderStillOpen` la protege al cobrar).
- **Permisos (CÓDIGO):** el servidor permite `DELETE` sobre `open_orders` a owner, admin **y operator**; cliente y servidor coinciden. **Decisión pendiente suya:** si el operador debe poder eliminar una mesa con ítems.
- **Corrección (LOCAL):** se restaura **sólo** la mesa eliminada (copia y posición) y se dispara una relectura del servidor, que tiene la última palabra. **Si al fallar ya cambió la cuenta o el local, no se escribe nada en el contexto nuevo** (Codex: el cierre de sesión no espera al envío en curso). Control: el borrado exitoso no restaura nada.
- **Impacto:** medio (pérdida de trabajo sin sincronizar). **Probabilidad:** baja (falla de red + trabajo en paralelo en 10 s).

### B23 · Tokens de sesión en exportaciones locales — **P1, corregido en local**
- **Código (CÓDIGO):** `getLocalRecoveryBackupPayload` y `diagnoseLocalRecoveryData` vuelcan **todo** `localStorage`/`sessionStorage`; el cliente Supabase se crea con `persistSession:true` sin almacenamiento propio.
- **Demostrado (LOCAL):** con credenciales **sintéticas** con la forma `sb-<ref>-auth-token`, el respaldo las incluía.
- **HIPÓTESIS (a confirmar en staging):** que el supabase-js real guarde ahí el access/refresh token. El guion de staging lista **sólo los nombres** de las claves y comprueba que el respaldo no contiene el valor real, sin sacarlo de la página.
- **Acceso al respaldo (CÓDIGO):** sólo owner/admin con modo técnico (verificación en cliente).
- **Corrección (LOCAL):** se redactan `sb-*-auth-token` y claves con token/secret/password; los datos de operación siguen. **Límite:** no se redactan credenciales dentro de valores de otras claves.
- **Impacto:** alto si el archivo se comparte (refresh token = acceso a la cuenta). **Probabilidad:** baja (herramienta técnica).

## 4b. B26 — alcance real (no es inocuo)

**Qué pasa (STAGING, tres sesiones reales):** `getActiveStore()` devuelve `{id, name:'', role:''}`; `getActiveStoreRole()` devuelve `''`; `getActiveStoreName()` devuelve el **UUID** del local, no su nombre. Revisados **todos** los usos (`index.html:4768, 5353, 7463, 7755, 9315-9326, 9554, 10548, 11183, 11251, 11519, 11928, 15044-15052`):

| Consumidor | Efecto de devolver vacío / UUID | Gravedad |
|---|---|---|
| `isSupabaseAdminRole`, `puedeEditarCatalogo`, rol en diagnósticos (4768, 7755, 9554, 11928) | Usan `getSupabaseActiveRole()` primero; `getActiveStoreRole()` es el 2.º operando y siempre vacío: **sin efecto** propio (el problema ahí es B25, el fallback al primer local) | Ninguna adicional |
| **Nombre del local** (11251, 11519, 15049 → paneles técnicos, `context.storeName` del respaldo local, `currentStore.name` de exportes 17338/17357/17805) | Muestran/exportan el **UUID** en lugar del nombre. `salesCurrentStoreName` sí tiene el nombre correcto (`refreshSalesDiagnostics`) pero **nunca se usa**, porque `getActiveStoreName()` devuelve siempre algo | Defecto real (diagnóstico/exportes) |
| **Ticket impreso** (`nombreComercio`, 7463) | Alguien ya lo parchó con una guarda `isValidUuid` ("eso no va en un ticket"): el ticket dice **siempre «Colo Café»** sea cual sea el local. Arreglar B26 cambiaría el encabezado impreso | **Decisión suya** |
| **Herramientas técnicas de ventas** (`getSalesRole` → `getActiveStoreRole()||salesCurrentRole`, 15052; gatea `canSeeSalesTechnicalTools` y el respaldo/diagnóstico, 15303, 16672) | El rol sale **sólo** de la caché `salesCurrentRole`. Se refresca al iniciar, al iniciar/cerrar sesión y al cambiar de local, pero con `diag.role||salesCurrentRole` (15509): si el rol nuevo es vacío (cierre de sesión, cuenta sin membresía en el local activo) **se conserva el rol anterior**. Sólo gating de interfaz: el servidor (RLS) sigue siendo la barrera | Defecto real, baja probabilidad |
| **Escritura de catálogo** (`getCatalogWriteContext`, 11183) | Igual patrón con `catalogCurrentRole`: sólo se consulta el rol al servidor si la caché está vacía; tras cambiar de cuenta/local con caché no vacía se puede dar por bueno un rol obsoleto en el cliente (el servidor rechaza igual; cambia el mensaje de error) | Defecto real, baja probabilidad |

**Conclusión:** B26 introduce tres defectos adicionales reales (nombre/UUID en diagnósticos y exportes, rol obsoleto en las cachés de ventas y catálogo) y enmascara un cuarto efecto (el ticket). **Corrección mínima propuesta (no aplicada: el efecto sobre el ticket es una decisión suya):** leer la variable real dentro del mismo cierre (`supabaseStores` en vez de `window.supabaseStores` en `getActiveStore`) y reiniciar `salesCurrentRole`/`catalogCurrentRole` al cambiar de cuenta o de local.

## 5. Matriz de cobertura 360°

Leyenda: ● hecho · ◐ parcial · ○ no hecho. Funcional = recorrido real en navegador (arnés local, datos ficticios).

| Área | Funcional local | Sólo código | Pruebas automáticas | Staging |
|---|---|---|---|---|
| Caja | ● escritorio y móvil | ◐ | ● | ○ |
| Mesas | ● | ● eliminación, sync, concurrencia | ● | ○ |
| Comandas | ◐ botón y etiquetas | ● | ● | ○ (fuera de la política) |
| Cobros (3 medios, vuelto) | ● escritorio y móvil | ● idempotencia, cierre | ● | ○ |
| Reservas | ◐ tarjetas en Caja | ● | ● parcial | ○ (escrituras denegadas) |
| Clientes | ◐ lista; ● inyección B1 | ● | ● B1 | ○ |
| Reportes | ◐ Resumen | ◐ | ● | ○ |
| Gestión / Catálogo | ◐ categorías; ● precios B2 | ● | ● | ○ |
| Accesos rápidos | ○ | ● | ● | ○ |
| Roles y permisos | ◐ simulados | ● cliente y SQL del repo | ● `v2_roles` | ○ (RLS desplegado sin verificar) |
| Impresión | ○ | ● | ○ | ○ |
| Sincronización y colas | ○ | ● | ● mocks | ○ |
| Experiencia móvil | ◐ Caja, Cobrar, encabezado | ○ | ◐ | ○ |
| Oportunidades comerciales | — | ◐ | — | — (hipótesis) |

Sin cobertura funcional real: impresión, variantes de producto, accesos rápidos en pantalla, alta/edición de Clientes, vistas de Dueño/Administrador, Reportes (Ventas/Gastos/Turnos), móvil fuera de Caja/Cobrar.

## 6. Backlog priorizado

Criterio: impacto comercial/operativo/técnico, no facilidad. **A = corregir antes de publicar · F = futura versión · D = requiere decisión suya.**

### Corregidos en la candidata (revisar antes de publicar)
B1, B2, B4, B5, B23 (§4) y el foco al repintar tarjetas (§2).

### A · Antes de publicar (pendientes)
| ID | Hallazgo | Evidencia | Esf. |
|---|---|---|---|
| **S1** | **Verificar en staging** lo corregido y las cinco mejoras (rol por rol) | — | M |
| **S2** | **Confirmar RLS desplegado** con `politicas_rls.sql` (qué roles escriben notas/borran mesas; restricción de precio) | CÓDIGO sólo del repo | S |
| B6 | SDK de Supabase por CDN con `@2` flotante y sin SRI (`index.html:103`) | CÓDIGO | S · **D (infra)** |
| **B26** | `window.getActiveStore()` / `getActiveStoreRole()` / `getActiveStoreName()` leen `window.supabaseStores`, que la app **no publica a propósito** (`index.html:8950`): **no son inocuas**, ver §4b | STAGING + CÓDIGO | S–M · **D** |
| **B25** | **`getSupabaseActiveRole()` cae al rol del primer local si el local activo no tiene rol** (`index.html:8497-8505`); lo usan `isSupabaseAdminRole`, `puedeEditarCatalogo`, `canShowSupabaseTechnicalUi` y otros: la UI puede mostrar acciones de administración a quien no lo es en el local activo. El servidor (RLS por local) sigue siendo la barrera real. Hallazgo nuevo de la revisión independiente; sólo se corrigió en Limpiar | CÓDIGO | S–M · riesgo medio (muchos llamadores) |
| B3 | Reservas: editar fuerza `estado:'pendiente'`; admite fecha pasada; sin cancelar | CÓDIGO (7077 verificado) | S–M · **D** |
| B11 | Comprobante post-cobro se imprime aunque la venta no esté confirmada (el historial sí lo bloquea) | CÓDIGO | S |

### F · Futuras versiones (P2)
B7 reintento de ventas pendientes al reanudar y texto del banner · B8–B10 comandas (imprimir ≠ marcar enviada; «ANULAR» falso al cambiar sector; mesas sin id/reservas sólo imprimen el pedido completo) · B13 impresión sin manejo de errores y ancho fijo 72 mm · B14 «visitas» no se incrementa · B16 recordatorio se marca visto antes de verse · B17 borrar cliente deja reserva con vínculo roto · B18 operadores: activar/alta sin verificar rol al ejecutar · B19 guard de catálogo «fail-open» con rol vacío · B20 accesos rápidos: guardado no atómico · B21 `clockBad` fijo a UTC-3 · B22 `setInterval` de 3 s sin gate de visibilidad (medir) · B24 número de ticket no correlativo.

### D · Requieren decisión suya
B4 (¿admin además del dueño?) · B5 (¿operador elimina mesas con ítems?) · B2b (modificadores de variante negativos) · B12 (vuelto en el comprobante) · B15 (alergias visibles a todos los roles y en comanda: datos personales) · B6 (infra) · B3 (estados de reserva).

### P3
Bloque desactivado de 279 líneas; 50 `console.log`; tamaños 10–11 px; 4 diálogos nativos; chevrones de 4 px; título de Clientes pegado al borde; validar teléfono/email; `aria-pressed` en filtros.

### Oportunidades comerciales (todas HIPÓTESIS, sin datos de uso)
Venta adicional en Cobrar; fidelización con «visitas» (hoy inexistente, B14); alergias en cocina (B15); indicadores para el dueño.

## 7. Pruebas y revisiones

- **Regresión completa final (commit `2392533`):** 14 archivos, **220 pruebas, todas en verde**. En una corrida intermedia habían fallado 4 pruebas (3 de `v2_roles` por mi atributo `data-solo-admin` y 1 intermitente de O2 por la pérdida de foco): causas corregidas. `apply.py --check` → `COINCIDE`.
- **Pruebas nuevas rojo→verde:** O1–O8 (ola 1), `ola2_riesgos` (13: B1 ×5, B2 ×2, B4 ×2, B5 ×3 [una es control], B23), `carta_sync`, `staging_policy` (13).
- **Revisiones:** Codex adversarial (ola 1) y `/code-review` nativa (ola 1) conservadas sin repetir. Codex dirigida sobre la fase de riesgos: ver §7.1.
- **Copia aislada SQL:** `verificar_sql.cjs` 21/21 (incluye ahora los dos scripts de solo lectura).
- **SQL de solo lectura (`esquema_gate.sql`, `politicas_rls.sql`):** convertidos en **una sola sentencia SELECT sobre catálogos `pg_*`** (el SQL Editor sólo muestra el resultado de la última sentencia y los originales terminaban en `rollback`). Prueba estática con 11 mutantes rechazados, ejecución en sesión `READ ONLY` con datos y catálogo idénticos antes/después, y primera ejecución real de `esquema_gate.sql` (nunca se había corrido). No hay acceso autenticado al SQL Editor de staging: los ejecuta la persona (`tools/staging-ola1/README.md`, paso 1 detallado).

### 7.1 Revisión independiente (Codex) de la fase de riesgos
Veredicto: *needs-attention*, **3 hallazgos altos, los tres defectos reales, corregidos con prueba rojo→verde**:
1. **B1 incompleto:** `op` en `pintarResumenTurno` y `t.n` en Reportes seguían sin escapar (mi guarda estática no los veía por el nombre corto). Corregido y guarda ampliada; el recorrido de ambas vistas tiene prueba.
2. **B4 aceptaba el rol de otro local** (`getSupabaseActiveRole` cae a `stores[0]`). Corregido con guard estricto del local activo; prueba con «primer local owner + local activo sin rol».
3. **B5 podía insertar la mesa en la cuenta nueva** si se cambiaba de cuenta durante el borrado. Corregido; prueba con cambio de cuenta y de local en el instante del fallo (en la prueba el cambio se hace al fallar porque la app vuelve a fijar la sesión si se cambia antes).

Codex no ejecutó el navegador (revisión estática); las pruebas las corrí yo. No hubo hallazgos sobre B2, B23 ni el wrapper de foco.

## 8. Estado final y recomendación

**Recomendación de publicación: `GO` condicionado** (sobre el commit candidato indicado al final; no se publicó nada).

**Qué quedó verificado en staging real (STAGING):** las cinco mejoras de la ola 1 (vuelto sin alterar importes, Cobrar a ancho completo en escritorio y móvil, «Eliminar mesa» accesible y con confirmación, teclado y foco con operadores reales, nombre del local en móvil); la **persistencia íntegra** de los cobros en efectivo, transferencia, mixto y con descuento para **los tres roles** (31 ventas, 31 coherentes en el servidor); B2 (precios inválidos no llegan al servidor), B4 (permisos por rol del local activo), B23 (el respaldo no contiene el token) y la eliminación real de mesas por rol; limpieza completa con **18/19 tablas idénticas** (la diferencia de `profiles` está explicada) y recuperación del cliente.

**Condiciones para publicar (no son defectos del código, son decisiones o aceptaciones suyas):**
1. **B4:** confirmar que «Limpiar historial» sea sólo para owner/admin del local activo (hoy implementado así).
2. **B5:** confirmar si el operador puede eliminar mesas con ítems (hoy el servidor lo permite; la candidata no lo cambia).
3. **Aceptar el riesgo residual de B7** (reintentos sin retroceso, que pueden bloquear Cobrar mientras un envío falla de forma persistente) y programar su corrección.
4. **Aceptar lo que NO se probó:** B1 con una nota escrita por un rol y vista por otro en staging (probado en local y con permisos reales del servidor, pero no el recorrido completo entre cuentas), comandas, impresión, reservas, Reportes con ventas reales, producción (sólo lectura de código/SQL versionado) y el comportamiento de Stock Durability (en staging sólo existe la estructura, sin funciones ni triggers).

**Lo que NO justifica bloquear:** los defectos del arnés (corregidos), el redondeo de descuentos a pesos (diseño), ni la diferencia de `profiles` (efecto del trigger de Auth).

**Riesgos residuales:** B1–B2 extremos con datos reales de producción no probados; B25 y B26 (roles/nombre de local en cachés) siguen abiertos fuera de «Limpiar»; el panel de Supabase guardó fragmentos de consulta («Untitled query») que no son datos de la base.

## 9. Cierre de la candidata: B4, B5, B7 y versión (2026-11-25)

### 9.1 B7 — reintentos de ítems de mesa: **CORREGIDO y verificado**
**Corrección a mi diagnóstico anterior:** los reintentos reales de la app eran cada ~12 s fijos y no terminaban nunca (los «~2 peticiones/s» contaban todas las peticiones del arnés). Defecto: sin espera creciente, sin tope y sin distinguir un rechazo permanente del servidor de un corte de red.

**Reproducción sin residuos del arnés** (`tests/b7_reintentos.test.cjs`, app real + servidor simulado, reloj adelantado 1 h):

| Escenario (1 hora simulada) | Antes | Después |
|---|---|---|
| Red caída | **600** envíos | **6** y se detiene |
| Rechazo permanente (permiso, 42501) | **600** envíos | **1** y se detiene |
| Falla corta de red (2 fallos) | se recupera | se recupera sola |
| Conflicto de estado (otro dispositivo) | 0 reenvíos | 0 reenvíos |
| Respuesta perdida (el servidor aplicó, la app vio un corte) + 5 reintentos/reconexiones + edición intermedia | — | servidor = pantalla (4 unidades, 1 fila), 0 pendientes |
| 20 reintentos/reconexiones más tras recuperarse | — | 0 envíos, filas idénticas (idempotencia) |

**Qué cambia:** espera 12 s → 30 s → 1 min → 2 min → 5 min y tope de 6 fallos automáticos; un rechazo permanente (42xxx, 22xxx, P0xxx, PGRST1/2xx, 23xxx salvo 23505, 403) para de inmediato; la sesión vencida (401/PGRST3xx) y 23505 (carrera entre dispositivos) **no** son permanentes. Nada se descarta: el pendiente queda guardado y «Reintentar» (o volver la conexión, o reiniciar) lo reenvía. Mensajes claros al cajero («No pudimos guardar… tocá Reintentar cuando haya conexión» / «El servidor rechazó… avisá al administrador»), que desaparecen al resolverse. **No se modificó el camino de envío** (ids deterministas / versión base): no hay duplicados.

**Revisiones independientes (dos, coincidentes):**
- **Codex** (por la vía oficial del agente `codex:codex-rescue`, sin tocar permisos; en el primer intento el clasificador de permisos lo había bloqueado y en el segundo corrió en modo solo lectura): 3 hallazgos medios, ninguno en el SQL.
- **Revisión nativa independiente** (agente sin contexto previo): 2 defectos + 4 menores, ninguno en el SQL.
- **Todos verificados y corregidos con prueba:** (1) fallos contados sin haber intentado (mesa cobrada con cierre pendiente → mensaje falso tras ~9 min); (2) «Reintentar» manual durante un turno automático no reiniciaba nada; (3) sesión vencida tratada como rechazo permanente; (4) rechazo 42501 de crear/actualizar la mesa clasificado como corte de red; (5) el cartel ocultaba otros errores mientras hubiera una mesa detenida; (6) fallo contado a una edición aparecida durante la espera. **Dos probados que fallan en la versión anterior** (sesión vencida y Reintentar durante turno en curso).
- **Límites conocidos:** el estado de espera vive en memoria (recargar reinicia, a propósito); una mesa detenida no se reinicia sola con una edición nueva que vuelva a fallar (el cartel lo explica); la ruta de reemplazo sin función versionada (`delete+insert`) no se cubrió con el simulador; los cierres de mesa pendientes (`retryPendingOpenOrderClosures`) no se tocaron.

### 9.2 B4 — «Limpiar historial»
Decisión: sólo owner/admin del local activo y nunca con turno abierto. Ya estaba implementado y probado (operador, rol sin resolver y sin sesión no pueden; con turno abierto tampoco; el botón se oculta).

### 9.3 B5 — eliminar mesas: política y servidor
**Política aprobada:** operador = sólo mesas vacías; owner/admin = también con productos, con confirmación.
**Cliente (implementado):** con sesión, el operador no elimina una mesa con productos («pedí a un administrador que la cancele»). **Corregí además un hueco que encontré al diseñar el servidor:** si el servidor rechazaba el cierre de una eliminación, el «plan B» del cliente borraba igual los ítems y la fila; ahora ese plan B sólo corre para cobros ya registrados.
**Servidor (DISEÑADO Y PROBADO EN COPIA AISLADA; NO ejecutado en staging ni producción):** `open_orders_operator_guard.sql` (+ `..._rollback.sql`).
- **Inspección previa (repo):** políticas `open_orders_*_ops` (owner/admin/operator pueden todo), RPC `replace_open_order_items` (SECURITY INVOKER: borra ítems con los permisos del operador), trigger `trg_close_open_order_after_sale` (SECURITY DEFINER: cierra la mesa al registrar la venta), FK en cascada hacia ítems y comandas. Las definiciones vigentes en staging **no se volvieron a leer** (requiere SQL en staging: pendiente de tu autorización); la copia usa el texto de los `.sql` del repo y un `has_store_role` simulado.
- **Diseño mínimo:** dos políticas **RESTRICTIVAS** (se combinan con AND con las vigentes, sin depender de sus nombres, sin tocarlas) y una función auxiliar `open_order_operador_puede_cerrar(id)` (SECURITY DEFINER, sólo lectura: «sin ítems o ya cobrada»). El operador no puede **cerrar** (UPDATE a no-`open`) ni **borrar** una mesa `open` con ítems y sin venta; owner/admin no cambian. Falla de forma segura (aborta sin cambiar nada) si falta `has_store_role` u otra pieza.
- **Por qué no se bloquea el borrado de ítems:** la edición normal del pedido los borra con permisos del operador (RPC). Bloquearlo rompería la edición.
- **Verificado en la copia (8 pruebas, `tests/b5_servidor_rls.test.cjs`):** antes del guard el operador cancela mesas con productos; después no (ni directo ni con el flujo de la app); sí elimina vacías; owner/admin eliminan con productos; **el cobro del operador sigue funcionando** (venta → trigger cierra → ítems → fila), incluido el cierre tardío de una mesa ya cobrada; la edición de ítems por la RPC (incluso vaciar), las comandas (cascada) y otro local siguen igual; el cambio **agrega sólo 2 políticas y 1 función**, sin triggers ni nada de `stock_*` (Stock Durability intacto), es idempotente y la reversa deja el esquema idéntico.
- **LÍMITE (importante):** un operador puede quitar los productos uno a uno (edición normal) y luego eliminar la mesa ya vacía; el servidor no puede distinguirlo de editar el pedido. Cerrarlo del todo exigiría una función de cancelación con registro en `audit_logs` y quitar el borrado directo al operador (diseño mayor, no incluido). Un `INSERT` manual en `sales` con `open_order_id` también la saltearía (requiere una petición a medida).
- **Para aplicarlo (necesita tu autorización específica):** 1) leer en staging las políticas vigentes de `open_orders` (`politicas_rls.sql`, sólo lectura); 2) ejecutar el guard en staging; 3) repetir el ciclo corto (operador con mesa con productos / vacía; cobro del operador; admin). Producción sólo después.

### 9.3b Verificación del guard de B5 con las definiciones REALES de staging (2026-11-25, solo lectura)
Consulta `tools/staging-ola1/guard_referencia.sql` (catálogos; sólo texto de definiciones, ningún dato) ejecutada en staging (54 filas). **Lo que encontré y cómo cambió la copia aislada y el SQL:**
- `open_orders` y `open_order_items` tienen **dos juegos de políticas PERMISIVAS** (`open_orders_*` para `authenticated` y `open_orders_*_ops` para `public`), todas con `has_store_role(owner, admin, operator)`. Como las permisivas se combinan con OR, **sólo una política RESTRICTIVE restringe de verdad**: el guard usa `AS RESTRICTIVE` (no modifica ninguna existente). La copia aislada ahora carga **los dos juegos**.
- RLS **forzada** en las tablas; `has_store_role` es `SECURITY DEFINER` y usa `auth.uid()` (igual que la simulación). `sales`: insert/update para los 3 roles, select por `is_store_member`, delete sólo owner/admin.
- `replace_open_order_items` es **`SECURITY INVOKER`** (borra ítems con los permisos del operador). Las **únicas** funciones `SECURITY DEFINER` que tocan estas tablas son `bump_open_order_items_version`, `close_open_order_after_sale` y `has_store_role`; ninguna borra mesas ni ítems por orden de un usuario. Triggers: versión de ítems, totales de ítems, etiquetas, `updated_at`, cierre por venta. Nada de Stock Durability en estas tablas.
- **Hueco que encontré en MI diseño y corregí:** la función auxiliar aceptaba como «cobrada» una venta de **otro local** que apuntara a la mesa; ahora exige que la venta sea del mismo local que la mesa. La prueba de aislamiento falla si se vuelve a la versión anterior (mutación verificada).

**Las seis verificaciones pedidas, en la copia aislada y ejecutadas como cada usuario autenticado** (`SET ROLE authenticated` + `auth.uid()` de owner / admin / operator / operador de otro local; no con el rol privilegiado), `tests/b5_servidor_rls.test.cjs` (13 pruebas):
1. **Restringe a las existentes:** son RESTRICTIVE; conviven con los dos juegos permisivos sin modificarlos. ✔
2. **DELETE directo (y cierre/cancelación directos) del operador sobre mesa con productos:** negados; mesa e ítems intactos. ✔
3. **Elusión:** (a) funciones privilegiadas: sólo las esperadas, la auxiliar no es ejecutable por `anon`; (b) mecanismo alternativo del cliente: el plan B viejo (borrar ítems y luego la fila) **sí** pasaba en el servidor → ya corregido en el cliente (prueba en `b7_reintentos`); (c) **LÍMITES que el servidor no puede cerrar sin un diseño mayor:** vaciar con la RPC de edición y luego eliminar, borrar los ítems directamente y luego la fila (petición a medida), y fabricar una venta del mismo local a su nombre (queda en el historial). Los tres están **probados y documentados** como límite, no ocultos.
4. **Owner y admin conservan permisos** (cerrar, borrar, editar, con y sin productos); el operador conserva leer, crear y editar. ✔
5. **El operador elimina mesas vacías y cobra con normalidad** (venta → trigger → cierre → ítems → fila). ✔
6. **Aislamiento entre locales:** el operador de otro local no puede borrar, cerrar, vaciar ni mover (`store_id`) una mesa ajena; una venta fabricada en otro local que apunte a la mesa **no** la cierra ni habilita al operador. ✔

### 9.4 Versión de la aplicación
`APP_VERSION`: `2026-07-22-pending-banner-grace` → **`2026-11-25-b5-b7-consolidada`**. Mecanismo real (no hay consulta al servidor ni service worker): al cargar, la app compara la versión guardada en el dispositivo con la suya y, si difieren, muestra «Nueva versión disponible» con botón «Actualizar app». Verificado (`tests/app_version.test.cjs`): un dispositivo con la versión de producción ve el aviso una sola vez; un dispositivo nuevo o ya actualizado no lo ve; la nueva ordena después de la de producción. **Consecuencia a tener presente:** un dispositivo con la app ya abierta no se entera hasta recargar o reabrirla; conviene avisar a los cajeros.

### 9.5 Riesgos residuales
1. Revisión Codex hecha, pero la copia SQL usa `has_store_role` simulado y el esquema real de staging no está en el repo: la prueba real en staging sigue pendiente.
2. El guard del servidor no cierra el camino «vaciar y luego eliminar» ni el `INSERT` manual de ventas (ver 9.3).
3. Sin probar: nota escrita por un rol y vista por otro; comandas; impresión; reservas; Reportes con ventas reales; Stock Durability (staging sólo tiene la estructura); producción.
4. Un dispositivo con la app abierta no ve el aviso de versión hasta recargar.
5. Los pendientes del cierre de mesa (`retryPendingOpenOrderClosures`) siguen sin espera creciente (fuera de alcance).

### 9.6 Rollback
- **Cliente:** volver a publicar `334df6c` (sólo cambia `index.html`; no hay SQL de producción ni formato de colas modificado; B7 sólo agrega campos opcionales `last_error_code` / `_sync_error_code` que versiones anteriores ignoran). Con `APP_VERSION` distinto, los dispositivos verán el aviso también al volver atrás.
- **Servidor (cuando se aplique):** `open_orders_operator_guard_rollback.sql` quita las 2 políticas y la función; probado en la copia (esquema idéntico al previo).
