-- Protocolo de activación del modelo de stock, por local. PREPARADO, NO EJECUTADO. Se corre a mano en el SQL Editor, paso por paso.
-- Reemplazar :store por el uuid del local.
--
-- ORDEN (ningún paso anterior al 5 cambia un saldo)
--   1. Pruebas SQL, de concurrencia y de rollback en PASS en staging. Preflight de esquema equivalente en producción.
--   2. Desplegar el cliente v0.2. Sin la migración o sin activar funciona en modo local, igual que hoy: no pide columnas que no existen.
--   3. Aplicar stock_durability.sql. Nada cambia: los ítems quedan 'inactive' y los clientes viejos siguen pudiendo escribir.
--   4. En el local, antes de abrir o con la caja quieta:
--        a. En cada dispositivo, abrir la app con el cliente v0.2 y confirmar "Ventas pendientes = 0" en Soporte.
--        b. Correr las consultas de PRECHECK de abajo. Un dispositivo sin drenar NO rompe el saldo (ver 7), pero queda para conciliar.
--   5. ACTIVAR (abajo). Desde este instante: el servidor descuenta, un cliente viejo no puede escribir stock (STOCK_DIRECT_WRITE) y el
--      cliente v0.2 pasa a modo servidor en la lectura siguiente. Una venta anterior a la activación no descuenta.
--   6. Conteo físico de cada producto limitado, desde Menú, con el cliente v0.2 y rol owner/admin.
--   7. CONCILIAR (abajo): revisar lo que llegó tarde y corregir con ± lo que corresponda.
--
-- Por qué el corte no descuenta dos veces: el descuento local del modo anterior vive solo en cada dispositivo y lo pisa la primera lectura;
-- en el servidor, lo vendido antes de la activación cae en before_count (o count_review, visible). Un cliente viejo sigue vendiendo bien
-- (el servidor descuenta su ítem) pero no puede escribir saldos.
--
-- DESACTIVAR un local, primer escalón de reversión. Sin tocar saldos, y los clientes vuelven a modo local en la lectura siguiente:
--   delete from public.stock_store_activation where store_id = :store;
-- Reversión del esquema: stock_durability_rollback.sql. Para reactivar, repetir desde el paso 4: el saldo ya no es confiable sin conteo.
--
-- R-B2a: las fixtures técnicas no deben mover inventario. El ejecutor congelado manda prodId null (quedaría 'unresolved', sin descuento).
-- Una fixture nueva con producto usa uno ilimitado. Correr R-B2a en un local sin activar evita además incidencias de prueba.

-- PRECHECK. Solo lectura.
select count(*) filter (where stock < 0) as saldos_negativos,
       count(*) filter (where not unlimited and stock_counted_at is null) as limitados_sin_conteo,
       count(*) filter (where not unlimited) as limitados
  from public.products where store_id = :store;
-- Ventas de la última semana sin ítems: posible sincronización parcial, conciliar antes de activar.
select s.id, s.sold_at, s.created_at from public.sales s
 where s.store_id = :store and s.created_at > now() - interval '7 days'
   and not exists (select 1 from public.sale_items i where i.sale_id = s.id);
-- Ya activado: debe devolver 0 filas.
select * from public.stock_store_activation where store_id = :store;

-- ACTIVAR. Falla si ya estaba activado: no mueve el corte sin querer.
-- insert into public.stock_store_activation (store_id, activated_by) values (:store, 'responsable');

-- CONCILIAR. Solo lectura. Después de la activación y del conteo; repetir hasta que no aparezca nada nuevo.
select i.stock_applied_reason, i.product_name, i.quantity, i.stock_applied_at, s.sold_at
  from public.sale_items i join public.sales s on s.id = i.sale_id
 where i.store_id = :store and i.stock_applied_reason in ('before_count', 'count_review', 'unresolved', 'store_mismatch', 'no_identity')
   and i.stock_applied_at >= (select activated_at from public.stock_store_activation where store_id = :store)
 order by i.stock_applied_at desc;
-- Conteos, ajustes y borrados desde la activación.
select * from public.stock_ledger
 where store_id = :store and created_at >= (select activated_at from public.stock_store_activation where store_id = :store)
 order by id desc;
