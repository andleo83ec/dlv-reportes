-- =====================================================================
-- DLV Plataforma — Control de documentos (listado maestro, versiones y acuse de lectura)
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

-- 1. Listado maestro: un registro por documento con su versión vigente
create table if not exists public.documentos (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,                 -- PR-OBR-02, FO-ADM-03…
  titulo          text not null,
  tipo            text not null default 'procedimiento' check (tipo in ('manual','politica','procedimiento','instructivo','formato','externo')),
  area            text,                                 -- Gerencia, Oficina técnica, Obra, Administración, SSO, Calidad
  responsable     text,
  descripcion     text,
  programa        text,                                 -- programa de la plataforma que lo genera (/reportes…)
  estado          text not null default 'elaboracion' check (estado in ('elaboracion','vigente','obsoleto')),
  version         text,
  vigente_desde   date,
  revision_meses  int not null default 12,
  archivo_key     text,
  archivo_nombre  text,
  archivo_tipo    text,
  archivo_tamano  bigint,
  orden           int not null default 0,
  actualizado     timestamptz not null default now(),
  creado          timestamptz not null default now()
);

-- 2. Historial de versiones (la última publicada es la vigente; las anteriores quedan como obsoletas)
create table if not exists public.documento_versiones (
  id              uuid primary key default gen_random_uuid(),
  documento_id    uuid not null references public.documentos(id) on delete cascade,
  version         text not null,
  fecha           date not null default current_date,
  cambios         text,
  elaborado       text,
  revisado        text,
  aprobado        text,
  archivo_key     text,
  archivo_nombre  text,
  archivo_tipo    text,
  archivo_tamano  bigint,
  creado_por      uuid references public.perfiles(id) default auth.uid(),
  creado          timestamptz not null default now()
);
create index if not exists documento_versiones_doc on public.documento_versiones (documento_id, creado);

-- 3. Acuse de lectura: quién leyó cada versión
create table if not exists public.documento_lecturas (
  documento_id  uuid not null references public.documentos(id) on delete cascade,
  version       text not null,
  usuario_id    uuid not null references public.perfiles(id) on delete cascade default auth.uid(),
  nombre        text,
  fecha         timestamptz not null default now(),
  primary key (documento_id, version, usuario_id)
);

alter table public.documentos          enable row level security;
alter table public.documento_versiones enable row level security;
alter table public.documento_lecturas  enable row level security;

-- Todo el equipo consulta los documentos; solo el administrador los crea, cambia o borra
drop policy if exists docs_ver on public.documentos;
create policy docs_ver on public.documentos for select to authenticated using (true);
drop policy if exists docs_admin on public.documentos;
create policy docs_admin on public.documentos for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists docver_ver on public.documento_versiones;
create policy docver_ver on public.documento_versiones for select to authenticated using (true);
drop policy if exists docver_admin on public.documento_versiones;
create policy docver_admin on public.documento_versiones for all to authenticated using (public.es_admin()) with check (public.es_admin());
-- Cada persona registra solo su propia lectura
drop policy if exists doclec_ver on public.documento_lecturas;
create policy doclec_ver on public.documento_lecturas for select to authenticated using (true);
drop policy if exists doclec_crear on public.documento_lecturas;
create policy doclec_crear on public.documento_lecturas for insert to authenticated with check (usuario_id = auth.uid());
drop policy if exists doclec_borrar on public.documento_lecturas;
create policy doclec_borrar on public.documento_lecturas for delete to authenticated using (public.es_admin());

-- La función que sube archivos pregunta si el usuario es administrador
grant execute on function public.es_admin() to authenticated;

-- Activa el programa en el menú del portal
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/documentos', estado = 'beta', actualizado = now()
     where nombre = 'Control de documentos' and coalesce(url, '') = '';
  end if;
end $$;
