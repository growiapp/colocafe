-- Colo Café · auditoría ola 1 · DEFINICIÓN DE DOS FUNCIONES DE TRIGGER (SOLO LECTURA). UNA sola sentencia SELECT sobre pg_proc.
-- Muestra el texto de handle_store_created_owner (AFTER INSERT en stores: ¿crea membresías?) y close_open_order_after_sale (AFTER INSERT/UPDATE en sales).
-- No lee tablas de negocio. Responde si fixtures.sql (que exige exactamente 3 membresías) y los cobros de prueba se comportan como se supone.
select proname::text as funcion, left(pg_get_functiondef(oid), 1400) as definicion
  from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('handle_store_created_owner', 'close_open_order_after_sale')
 order by 1;
