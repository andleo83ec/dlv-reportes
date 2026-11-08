-- =====================================================================
-- DLV Plataforma — Tablero gerencial
-- No crea tablas: lee los datos de los demás programas. Solo lo activa en el menú.
-- Pegar en Supabase > SQL Editor > New query > Run
-- =====================================================================
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/tablero', estado = 'beta', actualizado = now()
     where nombre = 'Tablero gerencial' and coalesce(url, '') = '';
  end if;
end $$;
