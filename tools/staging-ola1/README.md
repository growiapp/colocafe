# Procedimiento de staging · auditoría ola 1

**Solo staging (`wjymdgfqmqutihadffec`). Nunca producción (`xhtpahjsddfkwsytubgu`).** Nada de esto se ejecutó todavía contra staging.

## Qué hay

| Archivo | Qué hace |
|---|---|
| `esquema_gate.sql` | **Solo lectura** (copia sin cambios de `00_schema_gate.sql`). Lista FKs y tablas hijas sin `store_id`. Revisar las filas `STOP_*`. |
| `politicas_rls.sql` | **Solo lectura.** Políticas RLS, restricciones de `products.price` e índice único de ventas desplegados: confirma qué roles pueden borrar mesas y escribir notas (B1, B5) y si el servidor valida precios (B2). |
| `fixtures_ENSAYO.sql` | Igual que `fixtures.sql` pero termina **siempre en error** (`ENSAYO_OK_SE_REVIERTE`): no deja nada. Detecta incompatibilidades de columnas. |
| `fixtures.sql` | Crea el local sintético: 1 local, 3 membresías (owner/admin/operator), 1 categoría, 1 operador, 6 productos. Atómico. |
| `cleanup_ENSAYO.sql` | Igual que `cleanup.sql` pero termina siempre en error e informa **cuántas filas borraría por tabla**. |
| `cleanup.sql` | Borra el local sintético y todo lo que cuelga de su `store_id`. Atómico, con verificación de residuos y de colaterales. |
| `verificar_sql.cjs` | Valida los scripts en una copia aislada (PGlite, esquema simulado). No toca staging ni producción. |
| `harness/` | Arnés de navegador (copia adaptada del E2E previo): sirve el commit exacto, bloquea producción por ruta y DNS, política positiva de escrituras. |

## Paso 1 detallado: los dos scripts de SOLO LECTURA (a cargo de la persona)

**Acceso:** quien audita no tiene acceso al SQL Editor de Supabase (sólo sesiones de la app con la clave pública), por lo que los ejecuta la persona. No se pide ninguna contraseña ni clave.

**Qué son:** `esquema_gate.sql` (relaciones y reglas de borrado entre tablas, rol del editor) y `politicas_rls.sql` (políticas RLS desplegadas, restricción de `products.price`, índice único de ventas, definición de `has_store_role`). Cada uno es **una sola sentencia `SELECT` sobre catálogos del sistema** (`pg_*`): no lee tablas de negocio, ni `auth.*`, ni credenciales; no escribe nada.

**Qué garantiza que no escriben:** (1) análisis estático (`tests/staging_sql_solo_lectura.test.cjs`: una sola sentencia, sin DDL/DML ni transacciones, sólo catálogos `pg_*`, sin funciones peligrosas; rechaza 11 mutantes); (2) ejecución en una sesión forzada a `READ ONLY` con datos y catálogo idénticos antes y después (`verificar_sql.cjs`, 21/21); (3) una sola sentencia no puede dejar nada a medias.

**Comprobaciones ANTES de ejecutar (30 segundos):**
1. En la barra de direcciones del dashboard debe leerse `/project/wjymdgfqmqutihadffec` (staging). **Si ves `xhtpahjsddfkwsytubgu` es producción: no ejecutes.**
2. El archivo empieza con `-- Colo Café · auditoría ola 1` y es **un solo `SELECT`** (sin `begin`, `commit`, `insert`, `update`, `delete`, `create`, `drop`, `alter`, `grant`). Buscá esas palabras con Ctrl+F en el editor antes de apretar *Run*: no debe haber ninguna fuera de los comentarios.
3. Pegá **un archivo por vez**, completo, y ejecutalo con *Run* (rol por defecto del editor).

**Qué enviarme:** copiá la tabla de resultados como texto. No contiene datos de clientes, ventas ni credenciales (sólo nombres de tablas/políticas, texto de condiciones RLS de hasta 240 caracteres y la definición de `has_store_role` de hasta 300). Si alguna fila te parece sensible, no la pegues y avisame.

**Cómo leer `esquema_gate.sql`:** filas `STOP_*` = detener y avisar (una tabla hija sin `store_id` impediría limpiar con seguridad); `ADVERTENCIA_*` = revisar (un borrado que bloquea o deja huérfanos); `ROL` debe indicar `bypassrls=true` o `super=true`.

## Orden (cada paso lo aprueba la persona)
1. `esquema_gate.sql` y `politicas_rls.sql` (ambos solo lectura) → revisar `STOP_*` y las políticas.
2. `fixtures_ENSAYO.sql` → debe fallar con `ENSAYO_OK_SE_REVIERTE`.
3. `fixtures.sql` → `FIXTURES_OK`.
4. Recorridos de navegador (sesiones aisladas por cuenta).
5. `cleanup_ENSAYO.sql` → debe fallar con `ENSAYO_OK_SE_REVIERTE: borraria …` (revisar la lista).
6. `cleanup.sql` → `CLEANUP_OK` (**requiere autorización explícita**).

## Garantías verificadas en copia aislada (`node tools/staging-ola1/verificar_sql.cjs`)
- Los datos preexistentes (otro local, ventas, clientes, una venta con `store_id` nulo) no cambian en el ciclo completo, con FKs en cascada y sin cascada.
- Ejecución parcial → no queda nada (una transacción). Ejecutar dos veces → la segunda aborta sin cambios.
- El ensayo no cambia nada. Stock Durability instalado (trigger `stock_*`) no bloquea la limpieza; **activo** en el local sintético sí la bloquea.
- Tabla hija sin `store_id` con filas del local sintético → aborta y revierte todo (fail-closed).
- El script de limpieza anterior (`05_cleanup.sql`) **abortó en los tres escenarios simulados** (cascadas, sin cascadas, trigger «stock»): era seguro pero inutilizable.

## Límites
- El esquema es una **simulación**; el real no está en el repo. Las columnas de los `INSERT` son las del script anterior. Los pasos de ensayo existen para detectar diferencias sin efectos.
- Rol requerido: con `BYPASSRLS` o superusuario (SQL Editor de Supabase). La limpieza lo verifica.
