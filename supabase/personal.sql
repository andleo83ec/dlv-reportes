-- =====================================================================
-- DLV Plataforma — Personal: trabajadores, asistencia diaria y roles de pago
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

-- 1. Ficha de cada trabajador. "obra_id" = obra donde trabaja ahora.
create table if not exists public.trabajadores (
  id            uuid primary key default gen_random_uuid(),
  cedula        text,
  nombres       text not null,
  cargo         text,
  telefono      text,
  jornal        numeric not null default 0,       -- valor diario
  ingreso       date,
  salida        date,
  iess          boolean not null default false,   -- aviso de entrada al IESS hecho
  iess_fecha    date,
  obra_id       uuid references public.obras(id) on delete set null,
  activo        boolean not null default true,
  contacto      text,                             -- contacto de emergencia
  notas         text,
  creado_por    uuid references public.perfiles(id) default auth.uid(),
  creado        timestamptz not null default now()
);
create unique index if not exists trabajadores_cedula on public.trabajadores (cedula) where cedula is not null and cedula <> '';
create index if not exists trabajadores_obra on public.trabajadores (obra_id);

-- 2. Asistencia: una fila por obra y día. marcas = { "<trabajador_id>": { "e": "P" | "M" | "F", "hx": 2, "cargo": "Albañil" } }
create table if not exists public.asistencia (
  obra_id         uuid not null references public.obras(id) on delete cascade,
  fecha           date not null,
  marcas          jsonb not null default '{}'::jsonb,
  actualizado     timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id) default auth.uid(),
  primary key (obra_id, fecha)
);

-- 3. Roles de pago por obra (quincena, semana o mes). lineas = trabajadores con días, horas extra, descuentos y valores calculados.
create table if not exists public.roles_pago (
  id          uuid primary key default gen_random_uuid(),
  obra_id     uuid not null references public.obras(id) on delete cascade,
  numero      int not null,
  desde       date not null,
  hasta       date not null,
  estado      text not null default 'borrador' check (estado in ('borrador','aprobado','pagado')),
  lineas      jsonb not null default '[]'::jsonb,
  config      jsonb not null default '{}'::jsonb,
  totales     jsonb not null default '{}'::jsonb,
  nota        text,
  creado_por  uuid references public.perfiles(id) default auth.uid(),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (obra_id, numero)
);

alter table public.trabajadores enable row level security;
alter table public.asistencia   enable row level security;
alter table public.roles_pago   enable row level security;

-- Trabajadores: el residente ve y registra al personal de sus obras; solo el administrador borra o ve al personal sin obra
drop policy if exists trab_ver on public.trabajadores;
create policy trab_ver on public.trabajadores for select to authenticated using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists trab_crear on public.trabajadores;
create policy trab_crear on public.trabajadores for insert to authenticated with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists trab_editar on public.trabajadores;
create policy trab_editar on public.trabajadores for update to authenticated using (public.es_admin() or public.es_miembro(obra_id)) with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists trab_borrar on public.trabajadores;
create policy trab_borrar on public.trabajadores for delete to authenticated using (public.es_admin());

-- Asistencia: la toma el residente de la obra
drop policy if exists asis_ver on public.asistencia;
create policy asis_ver on public.asistencia for select to authenticated using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists asis_crear on public.asistencia;
create policy asis_crear on public.asistencia for insert to authenticated with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists asis_editar on public.asistencia;
create policy asis_editar on public.asistencia for update to authenticated using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists asis_borrar on public.asistencia;
create policy asis_borrar on public.asistencia for delete to authenticated using (public.es_admin());

-- Roles: el residente prepara el borrador; solo el administrador aprueba, marca como pagado o borra
drop policy if exists roles_ver on public.roles_pago;
create policy roles_ver on public.roles_pago for select to authenticated using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists roles_crear on public.roles_pago;
create policy roles_crear on public.roles_pago for insert to authenticated with check (public.es_admin() or (public.es_miembro(obra_id) and estado = 'borrador'));
drop policy if exists roles_editar on public.roles_pago;
create policy roles_editar on public.roles_pago for update to authenticated
  using (public.es_admin() or (public.es_miembro(obra_id) and estado = 'borrador'))
  with check (public.es_admin() or (public.es_miembro(obra_id) and estado = 'borrador'));
drop policy if exists roles_borrar on public.roles_pago;
create policy roles_borrar on public.roles_pago for delete to authenticated using (public.es_admin());

-- Activa el programa en el menú del portal
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/personal', estado = 'beta', actualizado = now(),
           descripcion = 'Trabajadores por obra, asistencia diaria, avisos de entrada al IESS y roles de pago con aportes y provisiones.'
     where nombre = 'Personal' and coalesce(url, '') = '';
  end if;
end $$;
