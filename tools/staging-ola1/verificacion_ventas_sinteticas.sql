-- Colo Café · auditoría ola 1 · VERIFICACIÓN DE LAS VENTAS DE PRUEBA EN EL SERVIDOR (SOLO LECTURA). UNA sola sentencia SELECT.
-- Lee ÚNICAMENTE filas del local SINTÉTICO (store_id = e2e02026-1123-4122-8000-000000000001): por venta, el total, la suma de sus pagos, la suma de sus ítems,
-- los medios de pago, el operador y si quedó ligada a un turno. Sirve para comprobar la integridad de importes después de los cobros de prueba.
select 'VENTA' as tipo, s.table_label::text as mesa, s.payment_mode::text as modo, s.total_amount::text as total,
       (select coalesce(sum(p.amount), 0) from public.sale_payments p where p.sale_id = s.id and p.store_id = 'e2e02026-1123-4122-8000-000000000001')::text as suma_pagos,
       (select coalesce(sum(i.line_total), 0) from public.sale_items i where i.sale_id = s.id and i.store_id = 'e2e02026-1123-4122-8000-000000000001')::text as suma_items,
       coalesce((select string_agg(p.method::text || ':' || p.amount::text, ' + ' order by p.method) from public.sale_payments p where p.sale_id = s.id and p.store_id = 'e2e02026-1123-4122-8000-000000000001'), '-') as pagos,
       coalesce(s.operator_name, '-') as operador, (s.shift_id is not null)::text as con_turno
  from public.sales s where s.store_id = 'e2e02026-1123-4122-8000-000000000001'
union all
select 'MESAS_POR_ESTADO', o.status::text, count(*)::text, '', '', '', '', '', '' from public.open_orders o where o.store_id = 'e2e02026-1123-4122-8000-000000000001' group by o.status
union all
select 'TURNOS', sh.status::text, count(*)::text, '', '', '', '', '', '' from public.shifts sh where sh.store_id = 'e2e02026-1123-4122-8000-000000000001' group by sh.status
order by 1, 2;
