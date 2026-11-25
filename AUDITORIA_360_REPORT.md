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

### 3.2 Fase 2: validación funcional en staging — **NO EJECUTADA**

Bloqueo real: requiere (a) la clave anon pública de staging y las contraseñas de las tres cuentas tipeadas por la persona en ventanas locales, y (b) que la persona ejecute `fixtures.sql` en el SQL Editor (y `cleanup.sql` al final, con su autorización explícita). El guion está listo (`harness/escenarios_ola1.cjs`): verifica proyecto, URL, usuario, rol y local **antes de escribir** y aborta la cuenta si algo no coincide; mide violaciones de red; registra por rol (owner, admin, operator) y dispositivo (escritorio 1280×800, móvil 390×844). **No se ha corrido ni una vez contra staging, y su primera ejecución puede requerir ajustes de selectores.**

#### Resultado por rol y dispositivo
| Cuenta | Escritorio | Móvil |
|---|---|---|
| owner | no ejecutado | no ejecutado |
| admin | no ejecutado | no ejecutado |
| operator (caja) | no ejecutado | no ejecutado |

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
| **B26** | `window.getActiveStore()` / `getActiveStoreRole()` leen `window.supabaseStores`, que la app no publica: devuelven rol vacío siempre (confirmado con sesiones reales de staging). Sus llamadores caen a otras fuentes (`catalogCurrentRole`, `getSupabaseActiveRole`), así que hoy no rompe lo visible, pero engaña a cualquier código nuevo que confíe en ellas | STAGING | S |
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
- **Copia aislada SQL:** `verificar_sql.cjs` 15/15.

### 7.1 Revisión independiente (Codex) de la fase de riesgos
Veredicto: *needs-attention*, **3 hallazgos altos, los tres defectos reales, corregidos con prueba rojo→verde**:
1. **B1 incompleto:** `op` en `pintarResumenTurno` y `t.n` en Reportes seguían sin escapar (mi guarda estática no los veía por el nombre corto). Corregido y guarda ampliada; el recorrido de ambas vistas tiene prueba.
2. **B4 aceptaba el rol de otro local** (`getSupabaseActiveRole` cae a `stores[0]`). Corregido con guard estricto del local activo; prueba con «primer local owner + local activo sin rol».
3. **B5 podía insertar la mesa en la cuenta nueva** si se cambiaba de cuenta durante el borrado. Corregido; prueba con cambio de cuenta y de local en el instante del fallo (en la prueba el cambio se hace al fallar porque la app vuelve a fijar la sesión si se cambia antes).

Codex no ejecutó el navegador (revisión estática); las pruebas las corrí yo. No hubo hallazgos sobre B2, B23 ni el wrapper de foco.

## 8. Estado final y recomendación

**Recomendación de publicación: `BLOCKED`.** `STAGING_VERIFIED` **no** se declara.

Motivos concretos:
1. **Ninguna de las cinco mejoras ni de las correcciones B1/B2/B4/B5/B23 pasó por staging.** Faltan la autenticación humana de las tres cuentas (clave anon pública + contraseñas tipeadas por la persona) y la ejecución por la persona de `fixtures.sql` en el SQL Editor de staging. No hay ningún bloqueo técnico del lado de la candidata.
2. **RLS desplegado sin verificar** (`politicas_rls.sql`, sólo lectura): el análisis de B1/B5 se apoya en el SQL versionado del repo, no en el estado real.
3. **Decisiones suyas pendientes que afectan lo implementado:** B4 (¿admin además del dueño?), B5 (¿operador elimina mesas con ítems?), B2b (modificadores de variante negativos).

Lo que **sí** está listo para publicar desde el punto de vista del código: 14 archivos de prueba / 220 pruebas en verde, `apply.py` sincronizado, tres revisiones independientes resueltas (Codex ola 1, nativa ola 1, Codex fase de riesgos).

### Para pasar a GO
1. Login manual de `owner`, `admin` y `caja` (ventanas locales; la persona pega la clave anon y tipea contraseñas).
2. La persona corre, en este orden: `esquema_gate.sql` y `politicas_rls.sql` (sólo lectura) → `fixtures_ENSAYO.sql` → `fixtures.sql`.
3. Se ejecuta `harness/escenarios_ola1.cjs` (primera ejecución: puede requerir ajustes de selectores).
4. Con autorización explícita: `cleanup_ENSAYO.sql` → `cleanup.sql`, y verificación de que no quedan residuos.
