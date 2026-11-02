# D2 + D3 · validación local

Base: `cd4ef3a0f471071f25d2e7299f2cbd1684a0bfef`, rama `fix/stock-d2-d3-ux`. Solo se usó un servidor HTTP en `127.0.0.1`, Chromium aislado y clientes simulados. No se accedió a staging ni producción.

## Diagnóstico y reproducción anterior

- D2: `setProdStock` hacía `parseInt` y luego `Math.max(0, ...)`. Con `-5` se abría una confirmación para conteo 0; `onchange` y `onblur` podían volver a invocarla. El formulario de producto también convertía negativos en 0, y el formulario rápido convertía 0 en 10.
- D3: el aviso clasificaba como rechazo definitivo cualquier código salvo `READ_BACK*` y `23505`. Con `55000` (`STOCK_SALES_PAUSED`), `55P03` y `57014` mostraba “El servidor rechazó…” sin Reintentar. Un error sin código ya se mostraba pendiente.
- Ejecución contra `git show cd4ef3a:index.html`: `D2_D3_BASELINE=1 node --test tests/d2_d3_browser.test.cjs` falló como se esperaba. La captura de consola registró: `-5` con 1 confirmación, 55000/55P03/57014 como `rejected:1` sin botón, y un guardado de producto negativo que llamó a la escritura simulada.

## Cambio y resultado

- Los tres campos de conteo físico validan valor presente, finito y no negativo antes de confirmar o escribir. Cero es válido. El error queda junto al campo. El conteo inline usa un solo evento `change`; cancelar restaura el valor visible sin abrir otra confirmación. Los saldos teóricos negativos y los ajustes ± conservan su contrato.
- El aviso diferencia pausa identificada por código **y** mensaje, demoras `55P03`/`57014`, resultado desconocido y rechazos permanentes conocidos. Reintentar usa el camino R-B2a existente. El resultado del reintento de ventas ahora se devuelve al botón general para que no diga “Actualizado” si quedaron ventas pendientes.
- Ejecución actual de `node --test tests/d2_d3_browser.test.cjs`: pasó. `-5`, vacío, inválido y no finito hicieron 0 confirmaciones y 0 RPC; cancelar hizo 1 confirmación y 0 RPC; 0 produjo 1 RPC. Los formularios de producto rechazaron negativos y vacío; el rápido guardó 0. Pausa y demoras mostraron Reintentar; 403/42501 y una discrepancia comercial no lo mostraron. Un reintento fallido anunció avisos, sin afirmar éxito.
- La prueba R-B2a de `57014` después de persistir la cabecera confirma que se consulta por la misma identidad y se agregan solo los ítems y pagos ausentes: una fila de cada tipo. También se ejercitan 55000/55P03/57014 antes de la cabecera y con cabecera parcial, con recuperación tras resolver la causa.

## Aislamiento y regresión

La prueba de navegador intercepta **todas** las solicitudes. Solo permite `127.0.0.1`; aborta Google Fonts y sustituye la carga de jsDelivr por un stub local. Registró 2 solicitudes externas interceptadas, ninguna respuesta real de un servicio externo y ninguna solicitud a Supabase. El cliente simulado no contiene URL ni credencial real.

Regresión local: `node --test tests/stock_durability.test.cjs tests/r_b2a_sales_recovery.test.cjs tests/d3_gastos_1.test.cjs` (117/117), `node --test tests/d1_f1_f4.test.cjs tests/d1_browser.test.cjs` (2/2 suites, con los escenarios D1/F1–F4/F0-B), y la prueba D2/D3 (1/1). `git diff --check` pasó.

## Límite

La clasificación y el reintento se probaron con el HTML real y servidor simulado. En staging habrá que verificar la forma exacta de los errores HTTP y el texto que emite PostgREST, el permiso de roles y la interacción de una pausa/timeout real con el botón Reintentar. No se cambió SQL, RPC ni el contrato central de conciliación.
