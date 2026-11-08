-- =====================================================================
-- DLV Plataforma — Inicio y cierre de obra
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

-- Una fila por obra con el estado de sus listas de inicio y cierre, la recepción y la encuesta al cliente.
-- "items" = { "<clave del punto>": { hecho, fecha, responsable, nota } }; "extra" = puntos propios de la obra.
create table if not exists public.ciclo_obra (
  obra_id       uuid primary key references public.obras(id) on delete cascade,
  items         jsonb not null default '{}'::jsonb,
  extra         jsonb not null default '[]'::jsonb,
  recepcion     jsonb not null default '{}'::jsonb,   -- provisional, definitiva, observaciones
  encuesta      jsonb,                                -- notas 1-5 del cliente, recomendaría, comentario
  lecciones     text,
  actualizado   timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id) default auth.uid()
);

alter table public.ciclo_obra enable row level security;
drop policy if exists ciclo_ver on public.ciclo_obra;
create policy ciclo_ver on public.ciclo_obra for select to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists ciclo_crear on public.ciclo_obra;
create policy ciclo_crear on public.ciclo_obra for insert to authenticated
  with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists ciclo_editar on public.ciclo_obra;
create policy ciclo_editar on public.ciclo_obra for update to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists ciclo_borrar on public.ciclo_obra;
create policy ciclo_borrar on public.ciclo_obra for delete to authenticated
  using (public.es_admin());

-- Activa el programa en el menú del portal
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/ciclo', estado = 'beta', actualizado = now()
     where nombre = 'Inicio y cierre de obra' and coalesce(url, '') = '';
  end if;
end $$;
