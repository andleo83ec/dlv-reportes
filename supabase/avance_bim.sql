-- =====================================================================
-- DLV Reportes — Avance BIM (visor 3D del modelo IFC)
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

-- 1. Modelos IFC de cada obra (el archivo vive en R2; aquí solo los datos)
create table if not exists public.modelos (
  id             uuid primary key default gen_random_uuid(),
  obra_id        uuid not null references public.obras(id) on delete cascade,
  nombre         text,
  archivo        text,
  storage_key    text not null unique,
  tamano         bigint,
  comprimido     boolean not null default false,
  elementos      int,
  proyecto_guid  text,
  subido_por     uuid references public.perfiles(id) default auth.uid(),
  creado         timestamptz not null default now()
);
create index if not exists modelos_obra on public.modelos (obra_id, creado desc);

-- 2. Estado actual de cada elemento del modelo (uno por GUID del IFC)
create table if not exists public.avance_elementos (
  obra_id      uuid not null references public.obras(id) on delete cascade,
  guid         text not null,
  estado       text not null check (estado in ('ni','ej','ok','ob')),
  pct          numeric not null default 0,
  fecha        date not null,
  nota         text,
  autor        text,
  registro_id  uuid,
  actualizado  timestamptz not null default now(),
  primary key (obra_id, guid)
);

-- 3. Bitácora: cada vez que alguien registra avance (con sus fotos)
create table if not exists public.avance_registros (
  id          uuid primary key default gen_random_uuid(),
  obra_id     uuid not null references public.obras(id) on delete cascade,
  fecha       date not null,
  estado      text not null check (estado in ('ni','ej','ok','ob')),
  pct         numeric not null default 0,
  nota        text,
  guids       text[] not null,
  total       int not null default 0,
  resumen     text,
  niveles     text,
  volumen     numeric,
  fotos       jsonb not null default '[]'::jsonb,
  autor       text,
  creado_por  uuid references public.perfiles(id) default auth.uid(),
  creado      timestamptz not null default now()
);
create index if not exists avreg_obra_fecha on public.avance_registros (obra_id, fecha desc, creado desc);
create index if not exists avreg_guids on public.avance_registros using gin (guids);

-- =====================================================================
-- Seguridad: igual que los reportes (admin ve todo; cada residente sus obras)
-- =====================================================================
alter table public.modelos          enable row level security;
alter table public.avance_elementos enable row level security;
alter table public.avance_registros enable row level security;

drop policy if exists modelos_ver on public.modelos;
create policy modelos_ver on public.modelos for select to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists modelos_crear on public.modelos;
create policy modelos_crear on public.modelos for insert to authenticated
  with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists modelos_borrar on public.modelos;
create policy modelos_borrar on public.modelos for delete to authenticated
  using (public.es_admin());

drop policy if exists avel_ver on public.avance_elementos;
create policy avel_ver on public.avance_elementos for select to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists avel_crear on public.avance_elementos;
create policy avel_crear on public.avance_elementos for insert to authenticated
  with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists avel_editar on public.avance_elementos;
create policy avel_editar on public.avance_elementos for update to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));

drop policy if exists avreg_ver on public.avance_registros;
create policy avreg_ver on public.avance_registros for select to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists avreg_crear on public.avance_registros;
create policy avreg_crear on public.avance_registros for insert to authenticated
  with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists avreg_borrar on public.avance_registros;
create policy avreg_borrar on public.avance_registros for delete to authenticated
  using (public.es_admin() or creado_por = auth.uid());
