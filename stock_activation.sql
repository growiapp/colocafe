-- Protocolo de activación y desactivación del modelo de stock, por local. PREPARADO, NO EJECUTADO. Se corre a mano en el SQL Editor, paso por paso.
-- Reemplazar :store por el uuid del local.
--
-- ACTIVAR (ningún paso anterior al 5 cambia un saldo)
--   1. Pruebas SQL, de concurrencia y de rollback en PASS en staging. Preflight de esquema equivalente en producción.
--   2. Desplegar el cliente v0.2. Sin la migración o sin activar funciona en modo local, igual que hoy: no pide columnas que no existen.
--   3. Aplicar stock_durability.sql. Nada cambia: los ítems quedan 'inactive' y los clientes viejos siguen pudiendo escribir.
--   4. En el local, antes de abrir o con la caja quieta:
--        a. En cada dispositivo, abrir la app con el cliente v0.2 y confirmar "Ventas pendientes = 0" en Soporte.
--        b. Correr las consultas de PRECHECK de abajo. Un dispositivo sin drenar NO rompe el saldo (ver 7), pero queda para conciliar.
--   5. ACTIVAR (abajo). Desde este instante: el servidor descuenta, un cliente viejo no puede escribir stock (STOCK_DIRECT_WRITE) y el
--      cliente v0.2 pasa a modo servidor en la lectura siguiente.
--   6. Conteo físico de cada producto limitado, desde Menú, con el cliente v0.2 y rol owner/admin.
--   7. CONCILIAR (abajo): revisar lo que llegó tarde y corregir con ± lo que corresponda.
--
-- Por qué el corte de activación no descuenta dos veces: el descuento local del modo anterior vive solo en cada dispositivo y lo pisa la primera
-- lectura; en el servidor, lo vendido antes de la activación cae en before_count o count_review, nunca en applied. Un cliente viejo sigue vendiendo
-- bien (el servidor descuenta su ítem) pero no puede escribir saldos.
--
-- REQUISITO OPERATIVO DEL MODO SERVIDOR: el reloj de cada dispositivo dentro de ±5 minutos y conexión al vender. Una venta sin conexión sincronizada más
-- tarde, o con el reloj desviado, NO descuenta sola: queda count_review y se concilia con ±. No hay evidencia fiable para decidirlo de otra forma.
--
-- DESACTIVAR. STOP GATE: es una operación de mantenimiento con la caja cerrada. No se avanza de un paso al siguiente sin cumplir su condición.
-- Un cliente en modo servidor no descuenta en su dispositivo: si el servidor dejara de descontar sin que lo sepa, la venta no descontaría en ningún lado.
--   D1. Avisar y cerrar caja en todos los dispositivos. Condición: nadie cobrando.
--   D2. Con conexión, en cada dispositivo: "Ventas pendientes = 0" en Soporte. Sin poder lograrlo en alguno, anotar cuál: lo suyo entrará por D6.
--   D3. PAUSAR (abajo). Desde el commit el servidor rechaza cabeceras e ítems de ese local con STOCK_SALES_PAUSED, los ajustes con 'inactive' y las
--       escrituras directas. Una venta hecha igual queda guardada en el dispositivo, en error o partial_error, y R-B2a la reintenta: no se pierde.
--       Para abortar sin cambios: update ... set status = 'active'. El corte no se mueve.
--   D4. En cada dispositivo, recargar y confirmar el aviso de pausa en la pantalla de stock. Condición: todos lo muestran.
--       Un dispositivo apagado o sin conexión no se puede confirmar: anotarlo. No bloquea, porque D6 captura lo suyo; recargar no es la garantía.
--   D5. DESACTIVAR (abajo). El servidor deja de mover saldos y los clientes pasan a modo local en la lectura siguiente. Reabrir caja.
--   D6. CONCILIAR hasta que no aparezca nada nuevo y todos los dispositivos anotados hayan sincronizado. Una venta de un cliente que seguía en modo servidor, o
--       anterior a la desactivación, queda transition_review: sin descuento, visible y sin cerrarse sola. Corregir el saldo con el conteo del modo local.
-- REVERTIR EL ESQUEMA, recién después de D6 y con todos los locales en 'deactivated': stock_durability_rollback.sql. Con otro estado aborta.
-- REACTIVAR: repetir desde el paso 4; el update a 'active' marca un corte nuevo. El saldo ya no es confiable sin conteo.
--
-- R-B2a: las fixtures técnicas no deben mover inventario. El ejecutor congelado manda prodId null (quedaría 'unresolved', sin descuento).
-- Una fixture nueva con producto usa uno ilimitado. Correr R-B2a en un local sin activar evita además incidencias de prueba.

-- PRECHECK. Solo lectura.
select count(*) filter (where stock < 0) as saldos_negativos,
       count(*) filter (where not unlimited and stock_counted_at is null) as limitados_sin_conteo,
       count(*) filter (where not unlimited) as limitados
  from public.products where store_id = :store;
-- Ventas de la última semana sin ítems: posible sincronización parcial, conciliar antes de activar o pausar.
select s.id, s.sold_at, s.created_at from public.sales s
 where s.store_id = :store and s.created_at > now() - interval '7 days'
   and not exists (select 1 from public.sale_items i where i.sale_id = s.id);
-- Estado actual. Antes de activar: 0 filas, o 'deactivated'.
select * from public.stock_store_activation where store_id = :store;

-- ACTIVAR. Falla si la fila ya existe: no mueve el corte sin querer. Sobre un local ya desactivado, usar el update.
-- insert into public.stock_store_activation (store_id, activated_by) values (:store, 'responsable');
-- update public.stock_store_activation set status = 'active', activated_by = 'responsable' where store_id = :store;

-- PAUSAR. Solo desde 'active'.
-- update public.stock_store_activation set status = 'sales_paused' where store_id = :store;

-- DESACTIVAR. Solo desde 'sales_paused'.
-- update public.stock_store_activation set status = 'deactivated' where store_id = :store;

-- CONCILIAR. Solo lectura. Lo pendiente, sin límite de antigüedad. No hay marca de resuelto: la corrección se hace con ± y queda en stock_ledger.
select i.stock_applied_reason, i.product_name, i.quantity, i.stock_applied_at, s.sold_at, s.created_at as recibida
  from public.sale_items i join public.sales s on s.id = i.sale_id
 where i.store_id = :store and i.stock_applied_reason in ('before_count', 'count_review', 'transition_review', 'unresolved', 'store_mismatch', 'no_identity')
 order by i.stock_applied_at desc;
-- Después de revertir el esquema: ventas de un cliente que seguía en modo servidor, que ya nadie clasifica.
select i.product_name, i.quantity, i.created_at, s.sold_at
  from public.sale_items i join public.sales s on s.id = i.sale_id
 where i.store_id = :store and i.stock_applied_at is null and i.metadata->>'stock_client_mode' = 'server'
 order by i.created_at desc;
-- Conteos, ajustes y borrados, todos los del local.
select * from public.stock_ledger where store_id = :store order by id desc;
