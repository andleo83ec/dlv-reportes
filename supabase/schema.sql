-- =====================================================================
-- DLV Reportes — base de datos (Supabase)
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- =====================================================================

-- 1. Perfiles de usuario (uno por cada persona que entra a la app)
create table if not exists public.perfiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  email   text,
  nombre  text,
  rol     text not null default 'residente' check (rol in ('admin','residente')),
  creado  timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando agregas un usuario
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- 2. Obras
create table if not exists public.obras (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  cliente      text,
  contrato     text,
  residente    text,
  fiscalizador text,
  ubicacion    text,
  inicio       date,
  plazo        int,
  gerente      text default 'Ing. Andrés León V.',
  activa       boolean not null default true,
  creado       timestamptz not null default now()
);

-- 3. Quién trabaja en qué obra
create table if not exists public.obra_miembros (
  obra_id  uuid references public.obras(id) on delete cascade,
  user_id  uuid references public.perfiles(id) on delete cascade,
  primary key (obra_id, user_id)
);

-- 4. Reportes diarios (el detalle del día va en "datos")
create table if not exists public.reportes (
  id          uuid primary key default gen_random_uuid(),
  obra_id     uuid not null references public.obras(id) on delete cascade,
  numero      int not null,
  fecha       date not null,
  turno       text default 'Día',
  datos       jsonb not null default '{}'::jsonb,
  creado_por  uuid references public.perfiles(id) default auth.uid(),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (obra_id, numero)
);
create index if not exists reportes_obra_fecha on public.reportes (obra_id, fecha desc);

-- =====================================================================
-- Seguridad (RLS): el admin ve todo; cada residente solo sus obras
-- =====================================================================
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

create or replace function public.es_miembro(o uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.obra_miembros where obra_id = o and user_id = auth.uid());
$$;

alter table public.perfiles      enable row level security;
alter table public.obras         enable row level security;
alter table public.obra_miembros enable row level security;
alter table public.reportes      enable row level security;

drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles for select to authenticated
  using (id = auth.uid() or public.es_admin());
drop policy if exists perfiles_admin on public.perfiles;
create policy perfiles_admin on public.perfiles for update to authenticated
  using (public.es_admin());

drop policy if exists obras_ver on public.obras;
create policy obras_ver on public.obras for select to authenticated
  using (public.es_admin() or public.es_miembro(id));
drop policy if exists obras_admin on public.obras;
create policy obras_admin on public.obras for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists miembros_ver on public.obra_miembros;
create policy miembros_ver on public.obra_miembros for select to authenticated
  using (public.es_admin() or user_id = auth.uid());
drop policy if exists miembros_admin on public.obra_miembros;
create policy miembros_admin on public.obra_miembros for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists reportes_ver on public.reportes;
create policy reportes_ver on public.reportes for select to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists reportes_crear on public.reportes;
create policy reportes_crear on public.reportes for insert to authenticated
  with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists reportes_editar on public.reportes;
create policy reportes_editar on public.reportes for update to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists reportes_borrar on public.reportes;
create policy reportes_borrar on public.reportes for delete to authenticated
  using (public.es_admin() or creado_por = auth.uid());

-- =====================================================================
-- DESPUÉS de crear tu usuario en Authentication > Users, vuelve aquí y
-- ejecuta esta línea con tu correo para hacerte administrador:
--
--   update public.perfiles set rol = 'admin' where email = 'tu-correo@ejemplo.com';
-- =====================================================================
