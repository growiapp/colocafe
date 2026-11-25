-- Colo Café · auditoría ola 1 · ACTIVIDAD EN public.profiles (SOLO LECTURA). UNA sola sentencia SELECT. Devuelve SOLO el prefijo del id (8 caracteres) y updated_at de cada fila.
-- Sirve para explicar una diferencia de huella en la línea base (profiles): cuándo se actualizó cada perfil.
select left(id::text, 8) as perfil, updated_at::text as actualizado from public.profiles order by 1;
