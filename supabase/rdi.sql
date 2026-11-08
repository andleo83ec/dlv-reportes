-- =====================================================================
-- DLV Plataforma — RDI, actas y correspondencia
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

-- 1. Requerimientos de información (RDI) a fiscalización, diseñadores o mandante
create table if not exists public.rdis (
  id               uuid primary key default gen_random_uuid(),
  obra_id          uuid not null references public.obras(id) on delete cascade,
  numero           int not null,
  fecha            date not null,
  dirigido_a       text,            -- Fiscalización, Estructural, Arquitectura, Instalaciones, Mandante…
  disciplina       text,
  asunto           text not null,
  pregunta         text,
  referencia       text,            -- plano, lámina, especificación, eje
  propuesta        text,            -- solución que propone DLV
  urgencia         text not null default 'normal' check (urgencia in ('normal','urgente')),
  plazo            date,            -- fecha en que se necesita la respuesta
  estado           text not null default 'abierto' check (estado in ('abierto','respondido','cerrado')),
  respuesta        text,
  respondido_por   text,
  fecha_respuesta  date,
  impacto          text not null default 'ninguno' check (impacto in ('ninguno','costo','plazo','ambos')),
  fotos            jsonb not null default '[]'::jsonb,
  creado_por       uuid references public.perfiles(id) default auth.uid(),
  creado           timestamptz not null default now(),
  actualizado      timestamptz not null default now(),
  unique (obra_id, numero)
);

-- 2. Actas de reunión con asistentes y acuerdos (cada acuerdo con responsable, plazo y estado)
create table if not exists public.actas (
  id           uuid primary key default gen_random_uuid(),
  obra_id      uuid not null references public.obras(id) on delete cascade,
  numero       int not null,
  fecha        date not null,
  hora         text,
  lugar        text,
  tipo         text not null default 'obra',
  asistentes   jsonb not null default '[]'::jsonb,   -- [{nombre, cargo, empresa}]
  temas        text,
  acuerdos     jsonb not null default '[]'::jsonb,   -- [{id, texto, responsable, plazo, estado}]
  proxima      date,
  creado_por   uuid references public.perfiles(id) default auth.uid(),
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  unique (obra_id, numero)
);

-- 3. Registro de correspondencia (oficios y comunicaciones enviadas y recibidas)
create table if not exists public.correspondencia (
  id                  uuid primary key default gen_random_uuid(),
  obra_id             uuid not null references public.obras(id) on delete cascade,
  numero              int not null,
  fecha               date not null,
  direccion           text not null default 'enviada' check (direccion in ('enviada','recibida')),
  de                  text,
  para                text,
  asunto              text not null,
  referencia          text,         -- N.° de oficio, correo, etc.
  resumen             text,
  requiere_respuesta  boolean not null default false,
  plazo               date,
  estado              text not null default 'pendiente' check (estado in ('pendiente','respondida','archivada')),
  ubicacion           text,         -- dónde está el original
  creado_por          uuid references public.perfiles(id) default auth.uid(),
  creado              timestamptz not null default now(),
  unique (obra_id, direccion, numero)
);

alter table public.rdis            enable row level security;
alter table public.actas           enable row level security;
alter table public.correspondencia enable row level security;

do $$
declare t text;
begin
  foreach t in array array['rdis','actas','correspondencia'] loop
    execute format('drop policy if exists %1$s_ver on public.%1$s', t);
    execute format('create policy %1$s_ver on public.%1$s for select to authenticated using (public.es_admin() or public.es_miembro(obra_id))', t);
    execute format('drop policy if exists %1$s_crear on public.%1$s', t);
    execute format('create policy %1$s_crear on public.%1$s for insert to authenticated with check (public.es_admin() or public.es_miembro(obra_id))', t);
    execute format('drop policy if exists %1$s_editar on public.%1$s', t);
    execute format('create policy %1$s_editar on public.%1$s for update to authenticated using (public.es_admin() or public.es_miembro(obra_id))', t);
    execute format('drop policy if exists %1$s_borrar on public.%1$s', t);
    execute format('create policy %1$s_borrar on public.%1$s for delete to authenticated using (public.es_admin())', t);
  end loop;
end $$;

-- Activa el programa en el menú del portal
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/rdi', estado = 'beta', actualizado = now()
     where nombre = 'RDI, actas y correspondencia' and coalesce(url, '') = '';
  end if;
end $$;
