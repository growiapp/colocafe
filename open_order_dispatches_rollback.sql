-- Reversión de open_order_dispatches.sql. Borra el registro de comandas enviadas (las mesas y sus ítems no se tocan).
-- El frontend detecta que la tabla no existe y vuelve a imprimir la comanda completa.

begin;

drop table if exists public.open_order_dispatches;

notify pgrst, 'reload schema';

commit;
