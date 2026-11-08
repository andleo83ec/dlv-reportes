-- =====================================================================
-- DLV Plataforma — INSTALACIÓN COMPLETA (todos los módulos en orden)
-- Pegar TODO en Supabase > SQL Editor > New query > Run. Se puede volver a ejecutar sin perder datos.
-- =====================================================================

-- >>>>>>>>>>>>>>>>>>>> schema.sql
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

-- >>>>>>>>>>>>>>>>>>>> portal.sql
-- =====================================================================
-- DLV Plataforma — menú de programas del portal de inicio
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

create table if not exists public.programas (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  descripcion    text,
  url            text,                         -- /ruta interna o https://… externa
  categoria      text not null default 'Obra',
  icono          text not null default 'app',
  estado         text not null default 'activo' check (estado in ('activo','beta','desarrollo')),
  solo_admin     boolean not null default false,
  nueva_pestana  boolean not null default false,
  orden          int not null default 100,
  creado         timestamptz not null default now(),
  actualizado    timestamptz not null default now()
);
create index if not exists programas_orden on public.programas (categoria, orden, nombre);

alter table public.programas enable row level security;

-- Todos los usuarios ven los programas (menos los marcados solo para admin); solo el admin los edita
drop policy if exists programas_ver on public.programas;
create policy programas_ver on public.programas for select to authenticated
  using (not solo_admin or public.es_admin());
drop policy if exists programas_admin on public.programas;
create policy programas_admin on public.programas for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Programas del menú: se agregan los que falten (por nombre); los que ya existen no se tocan
insert into public.programas (nombre, descripcion, url, categoria, icono, estado, nueva_pestana, orden)
select v.* from (values
  ('Reporte diario de obra', 'Clima, personal, equipos, actividades, materiales y panel fotográfico. PDF de 2 hojas.', '/reportes', 'Obra', 'reporte', 'activo', false, 10),
  ('Visor 3D y avance', 'Modelo IFC de ArchiCAD: registra el avance por elemento con fotos y pásalo al reporte diario.', '/visor', 'Obra', 'cubo', 'beta', false, 20),
  ('RDI, actas y correspondencia', 'Requerimientos de información numerados con plazo de respuesta, actas de reunión con acuerdos y responsables.', '', 'Obra', 'carpeta', 'desarrollo', false, 30),
  ('Inicio y cierre de obra', 'Entrega de obra adjudicada, análisis previo, desmovilización, balance final, recepción y encuesta al cliente.', '', 'Obra', 'calendario', 'desarrollo', false, 40),
  ('Detector de EPP', 'Detección de casco y chaleco en las cámaras de obra.', '', 'Obra', 'casco', 'desarrollo', false, 50),
  ('Estado de pago (planillas)', 'Presupuesto por obra, planillas al mandante con anterior, presente y acumulado, anticipo, garantía e IVA. PDF.', '/planillas', 'Oficina técnica', 'presupuesto', 'beta', false, 10),
  ('Subcontratos y garantías', 'Cuadro de contratos, planillas de subcontratistas, pólizas con alertas de vencimiento y evaluación al cierre.', '', 'Oficina técnica', 'personas', 'desarrollo', false, 20),
  ('Estudio de propuestas', 'Cotizaciones, comparativos, cubicaciones y seguimiento de cada propuesta hasta su adjudicación.', '', 'Oficina técnica', 'calculadora', 'desarrollo', false, 30),
  ('Control de documentos', 'Listado maestro de procedimientos y formatos de DLV con su versión vigente.', '', 'Oficina técnica', 'carpeta', 'desarrollo', false, 40),
  ('Tablero gerencial', 'Plazo, avance, costos, accidentabilidad y satisfacción del cliente por obra; informe semanal automático.', '', 'Administración', 'grafico', 'desarrollo', false, 5),
  ('Control de costos por obra', 'Presupuesto vs. real por rubro y obra.', '', 'Administración', 'grafico', 'desarrollo', false, 10),
  ('Compras', 'Cotización, comparativo de proformas, orden de pedido, guías y factura.', '', 'Administración', 'carrito', 'desarrollo', false, 20),
  ('Facturas SRI', 'Recepción por correo, validación contra el SRI y conciliación mensual.', '', 'Administración', 'factura', 'desarrollo', false, 30),
  ('Personal', 'Vacaciones, solicitudes de documentos, calendario de pagos, contratación e inducción.', '', 'Administración', 'personas', 'desarrollo', false, 40),
  ('Web Edificio La Vuelta', 'Landing del proyecto y registro de eventos.', 'https://www.edificiolavuelta.com', 'Comercial', 'web', 'activo', true, 10),
  ('Cotizador La Vuelta', 'Cotización por tipología y piso con forma de pago.', 'https://www.edificiolavuelta.com/cotizador', 'Comercial', 'calculadora', 'activo', true, 20),
  ('Web Ryō 5', 'Página del proyecto Ryō 5.', 'https://www.ryo5.com', 'Comercial', 'web', 'activo', true, 30)
) as v(nombre, descripcion, url, categoria, icono, estado, nueva_pestana, orden)
where not exists (select 1 from public.programas p where p.nombre = v.nombre);

-- >>>>>>>>>>>>>>>>>>>> avance_bim.sql
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

-- >>>>>>>>>>>>>>>>>>>> planillas.sql
-- =====================================================================
-- DLV Plataforma — Estado de pago (planillas al mandante)
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

-- 1. Presupuesto contractual de cada obra (rubros) + obras adicionales
create table if not exists public.rubros (
  id           uuid primary key default gen_random_uuid(),
  obra_id      uuid not null references public.obras(id) on delete cascade,
  codigo       text,
  descripcion  text not null,
  unidad       text,
  cantidad     numeric not null default 0,
  precio       numeric not null default 0,
  capitulo     text,
  adicional    boolean not null default false,
  orden        int not null default 0,
  creado       timestamptz not null default now()
);
create index if not exists rubros_obra on public.rubros (obra_id, orden);

-- 2. Planillas (estados de pago). "cantidades" guarda la cantidad del período por rubro: { "<rubro_id>": 12.5 }
create table if not exists public.planillas (
  id           uuid primary key default gen_random_uuid(),
  obra_id      uuid not null references public.obras(id) on delete cascade,
  numero       int not null,
  fecha        date not null,
  desde        date,
  hasta        date,
  estado       text not null default 'borrador' check (estado in ('borrador','presentada','aprobada','pagada')),
  cantidades   jsonb not null default '{}'::jsonb,
  config       jsonb not null default '{}'::jsonb,
  totales      jsonb,
  creado_por   uuid references public.perfiles(id) default auth.uid(),
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  unique (obra_id, numero)
);
create index if not exists planillas_obra on public.planillas (obra_id, numero);

alter table public.rubros    enable row level security;
alter table public.planillas enable row level security;

-- El equipo de la obra ve el presupuesto y las planillas; el presupuesto solo lo cambia el admin
drop policy if exists rubros_ver on public.rubros;
create policy rubros_ver on public.rubros for select to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists rubros_admin on public.rubros;
create policy rubros_admin on public.rubros for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Las planillas las prepara el equipo de la obra; solo el admin las borra
drop policy if exists planillas_ver on public.planillas;
create policy planillas_ver on public.planillas for select to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists planillas_crear on public.planillas;
create policy planillas_crear on public.planillas for insert to authenticated
  with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists planillas_editar on public.planillas;
create policy planillas_editar on public.planillas for update to authenticated
  using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists planillas_borrar on public.planillas;
create policy planillas_borrar on public.planillas for delete to authenticated
  using (public.es_admin());

-- >>>>>>>>>>>>>>>>>>>> subcontratos.sql
-- =====================================================================
-- DLV Plataforma — Subcontratos y garantías
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

-- 1. Subcontratos de cada obra. "items" = rubros del contrato: [{id, codigo, descripcion, unidad, cantidad, precio}]
create table if not exists public.subcontratos (
  id           uuid primary key default gen_random_uuid(),
  obra_id      uuid not null references public.obras(id) on delete cascade,
  numero       int not null,
  contratista  text not null,
  ruc          text,
  contacto     text,
  telefono     text,
  email        text,
  alcance      text,
  items        jsonb not null default '[]'::jsonb,
  monto        numeric not null default 0,
  condiciones  jsonb not null default '{}'::jsonb,   -- anticipo_pct, ret_pct, iva_pct, ret_renta_pct, ret_iva_pct
  checklist    jsonb not null default '{}'::jsonb,   -- revisión del contrato antes de firmar
  evaluacion   jsonb,                                -- notas 1-5 al cierre
  inicio       date,
  fin          date,
  estado       text not null default 'borrador' check (estado in ('borrador','vigente','terminado','anulado')),
  notas        text,
  creado_por   uuid references public.perfiles(id) default auth.uid(),
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  unique (obra_id, numero)
);
create index if not exists subcontratos_obra on public.subcontratos (obra_id, numero);

-- 2. Planillas de cada subcontrato. "cantidades" = { "<item id>": cantidad del período }
create table if not exists public.subcontrato_planillas (
  id              uuid primary key default gen_random_uuid(),
  subcontrato_id  uuid not null references public.subcontratos(id) on delete cascade,
  obra_id         uuid not null references public.obras(id) on delete cascade,
  numero          int not null,
  fecha           date not null,
  desde           date,
  hasta           date,
  estado          text not null default 'borrador' check (estado in ('borrador','presentada','aprobada','pagada')),
  cantidades      jsonb not null default '{}'::jsonb,
  config          jsonb not null default '{}'::jsonb,   -- multas, descuentos, nota
  totales         jsonb,
  creado_por      uuid references public.perfiles(id) default auth.uid(),
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  unique (subcontrato_id, numero)
);
create index if not exists subpl_sub on public.subcontrato_planillas (subcontrato_id, numero);

-- 3. Garantías y pólizas: las que recibimos de subcontratistas y las que DLV entrega al mandante
create table if not exists public.garantias (
  id              uuid primary key default gen_random_uuid(),
  obra_id         uuid not null references public.obras(id) on delete cascade,
  subcontrato_id  uuid references public.subcontratos(id) on delete set null,
  direccion       text not null default 'recibida' check (direccion in ('recibida','entregada')),
  tipo            text not null default 'fiel_cumplimiento',
  emisor          text,          -- aseguradora o banco
  numero          text,
  monto           numeric not null default 0,
  emision         date,
  vencimiento     date,
  estado          text not null default 'vigente' check (estado in ('vigente','devuelta','ejecutada')),
  notas           text,
  creado          timestamptz not null default now()
);
create index if not exists garantias_venc on public.garantias (obra_id, vencimiento);

alter table public.subcontratos          enable row level security;
alter table public.subcontrato_planillas enable row level security;
alter table public.garantias             enable row level security;

do $$
declare t text;
begin
  foreach t in array array['subcontratos','subcontrato_planillas','garantias'] loop
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
    update public.programas set url = '/subcontratos', estado = 'beta', actualizado = now()
     where nombre = 'Subcontratos y garantías' and coalesce(url, '') = '';
  end if;
end $$;

-- >>>>>>>>>>>>>>>>>>>> rdi.sql
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

-- >>>>>>>>>>>>>>>>>>>> tablero.sql
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

-- >>>>>>>>>>>>>>>>>>>> propuestas.sql
-- =====================================================================
-- DLV Plataforma — Estudio de propuestas
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; se puede ejecutar más de una vez sin problema)
-- Información comercial: solo la ven y editan los administradores.
-- =====================================================================

-- 1. Propuestas (proformas y licitaciones) con su presupuesto de costos
create table if not exists public.propuestas (
  id               uuid primary key default gen_random_uuid(),
  numero           int not null unique,
  codigo           text,                 -- Ej.: PROFORMA 015-2026
  nombre           text not null,        -- proyecto
  cliente          text,
  contacto         text,
  ubicacion        text,
  tipo             text not null default 'privada' check (tipo in ('privada','publica')),
  recepcion        date,
  entrega          date,                 -- fecha límite para presentar
  presentada       date,
  estado           text not null default 'estudio' check (estado in ('estudio','presentada','adjudicada','perdida','desistida')),
  responsable      text,
  plazo_dias       int,
  rubros           jsonb not null default '[]'::jsonb,   -- [{id, codigo, descripcion, unidad, cantidad, costo, capitulo}]
  indirectos_pct   numeric not null default 18,
  utilidad_pct     numeric not null default 10,
  iva_pct          numeric not null default 15,
  monto_oferta     numeric,              -- total sin IVA (se guarda al calcular)
  monto_costo      numeric,              -- costo directo
  ganador          text,                 -- si se perdió: quién ganó
  monto_ganador    numeric,
  motivo           text,
  notas            text,
  obra_id          uuid references public.obras(id) on delete set null,
  creado_por       uuid references public.perfiles(id) default auth.uid(),
  creado           timestamptz not null default now(),
  actualizado      timestamptz not null default now()
);

-- 2. Cotizaciones de proveedores y subcontratistas para cada propuesta (cuadro comparativo)
create table if not exists public.cotizaciones (
  id            uuid primary key default gen_random_uuid(),
  propuesta_id  uuid not null references public.propuestas(id) on delete cascade,
  grupo         text not null,          -- lo que se compara: "Hormigón premezclado", "Mampostería"
  tipo          text not null default 'material' check (tipo in ('material','subcontrato','equipo')),
  proveedor     text not null,
  contacto      text,
  total         numeric not null default 0,  -- sin IVA
  validez       date,
  plazo         text,
  pago          text,
  notas         text,
  seleccionada  boolean not null default false,
  creado        timestamptz not null default now()
);
create index if not exists cotizaciones_prop on public.cotizaciones (propuesta_id, grupo);

alter table public.propuestas   enable row level security;
alter table public.cotizaciones enable row level security;

drop policy if exists propuestas_admin on public.propuestas;
create policy propuestas_admin on public.propuestas for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
drop policy if exists cotizaciones_admin on public.cotizaciones;
create policy cotizaciones_admin on public.cotizaciones for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Activa el programa en el menú del portal (solo visible para administradores)
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/propuestas', estado = 'beta', solo_admin = true, actualizado = now()
     where nombre = 'Estudio de propuestas' and coalesce(url, '') = '';
  end if;
end $$;

-- >>>>>>>>>>>>>>>>>>>> ciclo.sql
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

-- >>>>>>>>>>>>>>>>>>>> costos.sql
-- =====================================================================
-- DLV Plataforma — Control de costos por obra
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql y planillas.sql; se puede ejecutar más de una vez)
-- =====================================================================

-- 1. Costo unitario presupuestado en cada rubro (lo llena el estudio de propuestas al adjudicar)
alter table if exists public.rubros add column if not exists costo numeric;

-- 2. Gastos reales de la obra (los subcontratos se toman de sus planillas, no se registran aquí)
create table if not exists public.gastos (
  id           uuid primary key default gen_random_uuid(),
  obra_id      uuid not null references public.obras(id) on delete cascade,
  fecha        date not null,
  categoria    text not null default 'materiales' check (categoria in ('materiales','mano_obra','equipos','indirectos','otros')),
  proveedor    text,
  documento    text,          -- N.° de factura, nota de venta, rol de pagos
  descripcion  text,
  capitulo     text,          -- capítulo o rubro del presupuesto al que se carga
  monto        numeric not null default 0,   -- sin IVA
  pagado       boolean not null default false,
  fecha_pago   date,
  origen       text not null default 'manual',
  creado_por   uuid references public.perfiles(id) default auth.uid(),
  creado       timestamptz not null default now()
);
create index if not exists gastos_obra on public.gastos (obra_id, fecha);

-- 3. Presupuesto meta de costo por categoría (solo administradores)
create table if not exists public.costos_meta (
  obra_id      uuid primary key references public.obras(id) on delete cascade,
  materiales   numeric not null default 0,
  mano_obra    numeric not null default 0,
  subcontratos numeric not null default 0,
  equipos      numeric not null default 0,
  indirectos   numeric not null default 0,
  otros        numeric not null default 0,
  actualizado  timestamptz not null default now()
);

alter table public.gastos      enable row level security;
alter table public.costos_meta enable row level security;

-- Los residentes registran y ven los gastos de sus obras (caja chica, compras en obra); solo el admin borra
drop policy if exists gastos_ver on public.gastos;
create policy gastos_ver on public.gastos for select to authenticated using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists gastos_crear on public.gastos;
create policy gastos_crear on public.gastos for insert to authenticated with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists gastos_editar on public.gastos;
create policy gastos_editar on public.gastos for update to authenticated using (public.es_admin() or (public.es_miembro(obra_id) and creado_por = auth.uid()));
drop policy if exists gastos_borrar on public.gastos;
create policy gastos_borrar on public.gastos for delete to authenticated using (public.es_admin());

-- La meta de costos y los márgenes son solo para administradores
drop policy if exists costos_meta_admin on public.costos_meta;
create policy costos_meta_admin on public.costos_meta for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Activa el programa en el menú del portal
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/costos', estado = 'beta', actualizado = now()
     where nombre = 'Control de costos por obra' and coalesce(url, '') = '';
  end if;
end $$;

-- >>>>>>>>>>>>>>>>>>>> personal.sql
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

-- >>>>>>>>>>>>>>>>>>>> documentos.sql
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

-- >>>>>>>>>>>>>>>>>>>> compras.sql
-- =====================================================================
-- DLV Plataforma — Compras: pedido de obra o solicitud de cotización → comparativo → orden de pedido
--                  → recepción con guía de remisión → factura (se carga sola a Control de costos)
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql; mejor también después de costos.sql; se puede ejecutar más de una vez)
--
-- Usa las mismas tablas y numeración (SC, PD, OC, GE) del módulo dlv-compras. Si ya ejecutaste
-- 002_compras.sql / 003_pedidos_directos_whatsapp.sql, este archivo las completa y CORRIGE sus permisos:
-- aquellos daban a cualquier usuario con sesión acceso total a obras, compras y facturas.
-- =====================================================================

-- 0. Proveedores (misma tabla que usa el lector de facturas dlv-facturas)
create table if not exists public.proveedores (
  ruc               text primary key,
  razon_social      text not null,
  nombre_comercial  text,
  obra_sugerida_id  uuid,
  creado_en         timestamptz not null default now()
);
alter table public.proveedores add column if not exists email     text;
alter table public.proveedores add column if not exists telefono  text;
alter table public.proveedores add column if not exists contacto  text;
alter table public.proveedores add column if not exists categoria text;
alter table public.proveedores add column if not exists notas     text;

-- 1. Numeración automática SC-2026-0001 (cotización), PD-2026-0001 (pedido de obra), OC (orden), GE (recepción)
create table if not exists public.compras_contadores (prefijo text, anio int, ultimo int not null default 0, primary key (prefijo, anio));
create or replace function public.compras_siguiente(p text) returns text
language plpgsql security definer set search_path = public as $$
declare n int; a int := extract(year from now())::int;
begin
  insert into compras_contadores (prefijo, anio, ultimo) values (p, a, 1)
  on conflict (prefijo, anio) do update set ultimo = compras_contadores.ultimo + 1 returning ultimo into n;
  return p || '-' || a || '-' || lpad(n::text, 4, '0');
end $$;
create or replace function public.compras_numerar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null or new.numero = '' then new.numero := compras_siguiente(tg_argv[0]); end if;
  return new;
end $$;
create or replace function public.compras_numerar_req() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null or new.numero = '' then new.numero := compras_siguiente(case when new.tipo = 'directo' then 'PD' else 'SC' end); end if;
  return new;
end $$;

-- 2. Proceso de compra (pedido de obra o solicitud de cotización) e ítems
create table if not exists public.compras_requerimientos (
  id             uuid primary key default gen_random_uuid(),
  numero         text unique,
  obra_id        uuid not null references public.obras(id),
  titulo         text not null,
  descripcion    text,
  fecha          date not null default current_date,
  fecha_limite   date,
  lugar_entrega  text,
  etapa          text not null default 'cotizacion',
  justificacion  text,
  adjudicado_en  timestamptz,
  creado_por     text,
  created_at     timestamptz not null default now()
);
alter table public.compras_requerimientos add column if not exists tipo text not null default 'cotizacion';
alter table public.compras_requerimientos add column if not exists origen text not null default 'app';
alter table public.compras_requerimientos add column if not exists solicitado_por text;
alter table public.compras_requerimientos add column if not exists solicitado_tel text;
alter table public.compras_requerimientos add column if not exists urgente boolean not null default false;
alter table public.compras_requerimientos add column if not exists motivo_rechazo text;
alter table public.compras_requerimientos add column if not exists notas_pedido text;
alter table public.compras_requerimientos add column if not exists proveedor_sugerido text;
alter table public.compras_requerimientos add column if not exists usuario_id uuid default auth.uid();
alter table public.compras_requerimientos drop constraint if exists compras_requerimientos_tipo_check;
alter table public.compras_requerimientos add constraint compras_requerimientos_tipo_check check (tipo in ('cotizacion','directo'));
alter table public.compras_requerimientos drop constraint if exists compras_requerimientos_etapa_check;
alter table public.compras_requerimientos add constraint compras_requerimientos_etapa_check
  check (etapa in ('pedido','cotizacion','comparativo','orden','entrega','factura','cerrado','rechazado'));
drop trigger if exists trg_num_req on public.compras_requerimientos;
create trigger trg_num_req before insert on public.compras_requerimientos for each row execute function public.compras_numerar_req();

create table if not exists public.compras_req_items (
  id               uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references public.compras_requerimientos(id) on delete cascade,
  linea            int not null,
  descripcion      text not null,
  unidad           text not null default 'u',
  cantidad         numeric(14,3) not null check (cantidad > 0),
  especificacion   text,
  adjudicado_a     uuid
);

-- 3. Proveedores invitados y proformas recibidas (base del comparativo)
create table if not exists public.compras_invitados (
  id               uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references public.compras_requerimientos(id) on delete cascade,
  proveedor_ruc    text not null references public.proveedores(ruc),
  unique (requerimiento_id, proveedor_ruc)
);
create table if not exists public.compras_proformas (
  id                  uuid primary key default gen_random_uuid(),
  requerimiento_id    uuid not null references public.compras_requerimientos(id) on delete cascade,
  proveedor_ruc       text not null references public.proveedores(ruc),
  numero_proforma     text,
  fecha               date not null default current_date,
  validez_dias        int,
  plazo_entrega_dias  int,
  forma_pago          text,
  transporte_incluido boolean not null default true,
  iva_pct             numeric(5,2) not null default 15,
  observaciones       text,
  created_at          timestamptz not null default now(),
  unique (requerimiento_id, proveedor_ruc)
);
create table if not exists public.compras_proforma_items (
  id              uuid primary key default gen_random_uuid(),
  proforma_id     uuid not null references public.compras_proformas(id) on delete cascade,
  req_item_id     uuid not null references public.compras_req_items(id) on delete cascade,
  precio_unitario numeric(14,4) not null check (precio_unitario >= 0),
  marca           text,
  cumple          boolean not null default true,
  nota            text,
  unique (proforma_id, req_item_id)
);

-- 4. Órdenes de pedido (una por proveedor)
create table if not exists public.compras_ordenes (
  id               uuid primary key default gen_random_uuid(),
  numero           text unique,
  requerimiento_id uuid not null references public.compras_requerimientos(id),
  obra_id          uuid not null references public.obras(id),
  proveedor_ruc    text not null references public.proveedores(ruc),
  proforma_id      uuid references public.compras_proformas(id),
  fecha            date not null default current_date,
  fecha_entrega    date,
  lugar_entrega    text,
  forma_pago       text,
  iva_pct          numeric(5,2) not null default 15,
  subtotal         numeric(14,2) not null default 0,
  iva              numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  estado           text not null default 'borrador' check (estado in ('borrador','emitida','parcial','recibida','facturada','anulada')),
  emitida_por      text,
  emitida_en       timestamptz,
  created_at       timestamptz not null default now()
);
alter table public.compras_ordenes add column if not exists categoria text not null default 'materiales';  -- categoría del gasto en Control de costos
alter table public.compras_ordenes add column if not exists capitulo text;
alter table public.compras_ordenes add column if not exists notas text;
drop trigger if exists trg_num_oc on public.compras_ordenes;
create trigger trg_num_oc before insert on public.compras_ordenes for each row execute function public.compras_numerar('OC');

create table if not exists public.compras_orden_items (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references public.compras_ordenes(id) on delete cascade,
  req_item_id     uuid references public.compras_req_items(id),
  linea           int not null,
  descripcion     text not null,
  unidad          text not null,
  cantidad        numeric(14,3) not null,
  precio_unitario numeric(14,4) not null
);

-- 5. Recepción en obra (guía de entrega GE) con la guía de remisión del proveedor
create table if not exists public.compras_entregas (
  id             uuid primary key default gen_random_uuid(),
  numero         text unique,
  orden_id       uuid not null references public.compras_ordenes(id) on delete cascade,
  fecha          date not null default current_date,
  recibido_por   text not null,
  guia_remision  text,
  guia_clave     text check (guia_clave is null or guia_clave ~ '^\d{49}$'),
  transportista  text,
  placa          text,
  observaciones  text,
  created_at     timestamptz not null default now()
);
alter table public.compras_entregas add column if not exists foto_key text;
alter table public.compras_entregas add column if not exists origen text not null default 'app';
drop trigger if exists trg_num_ge on public.compras_entregas;
create trigger trg_num_ge before insert on public.compras_entregas for each row execute function public.compras_numerar('GE');

create table if not exists public.compras_entrega_items (
  id                 uuid primary key default gen_random_uuid(),
  entrega_id         uuid not null references public.compras_entregas(id) on delete cascade,
  orden_item_id      uuid not null references public.compras_orden_items(id) on delete cascade,
  cantidad_recibida  numeric(14,3) not null default 0,
  cantidad_rechazada numeric(14,3) not null default 0,
  nota               text
);

-- 6. Factura de la orden. Se registra a mano o se toma del lector de facturas (facturas_proveedor), y crea el gasto en Control de costos.
create table if not exists public.compras_orden_facturas (
  id           uuid primary key default gen_random_uuid(),
  orden_id     uuid not null references public.compras_ordenes(id) on delete cascade,
  clave_acceso text unique,
  created_at   timestamptz not null default now()
);
alter table public.compras_orden_facturas alter column clave_acceso drop not null;
alter table public.compras_orden_facturas drop constraint if exists compras_orden_facturas_clave_acceso_fkey; -- ya no exige el módulo de facturas
alter table public.compras_orden_facturas add column if not exists numero   text;
alter table public.compras_orden_facturas add column if not exists fecha    date;
alter table public.compras_orden_facturas add column if not exists subtotal numeric(14,2);
alter table public.compras_orden_facturas add column if not exists iva      numeric(14,2);
alter table public.compras_orden_facturas add column if not exists total    numeric(14,2);
alter table public.compras_orden_facturas add column if not exists gasto_id uuid;

create index if not exists compras_req_obra_idx on public.compras_requerimientos (obra_id, etapa);
create index if not exists compras_oc_req_idx on public.compras_ordenes (requerimiento_id);
create index if not exists compras_oc_obra_idx on public.compras_ordenes (obra_id, estado);
create index if not exists compras_ge_oc_idx on public.compras_entregas (orden_id);

-- 7. Permisos
-- Quita las políticas abiertas "equipo dlv" del módulo anterior (incluida la que abría la tabla obras a todos)
do $$
declare t text;
begin
  foreach t in array array['obras','compras_contadores','compras_requerimientos','compras_req_items','compras_invitados','compras_proformas',
    'compras_proforma_items','compras_ordenes','compras_orden_items','compras_entregas','compras_entrega_items','compras_orden_facturas',
    'whatsapp_usuarios','whatsapp_mensajes']
  loop
    if to_regclass('public.' || t) is not null then execute format('drop policy if exists "equipo dlv" on public.%I', t); end if;
  end loop;
end $$;

alter table public.proveedores            enable row level security;
alter table public.compras_contadores     enable row level security;  -- solo la función de numeración la usa
alter table public.compras_requerimientos enable row level security;
alter table public.compras_req_items      enable row level security;
alter table public.compras_invitados      enable row level security;
alter table public.compras_proformas      enable row level security;
alter table public.compras_proforma_items enable row level security;
alter table public.compras_ordenes        enable row level security;
alter table public.compras_orden_items    enable row level security;
alter table public.compras_entregas       enable row level security;
alter table public.compras_entrega_items  enable row level security;
alter table public.compras_orden_facturas enable row level security;

-- Proveedores: todos los consultan, el administrador los mantiene
drop policy if exists "lectura app" on public.proveedores;
drop policy if exists prov_ver on public.proveedores;
create policy prov_ver on public.proveedores for select to authenticated using (true);
drop policy if exists prov_admin on public.proveedores;
create policy prov_admin on public.proveedores for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Pedidos: el residente los crea y corrige mientras están por aprobar; el administrador hace todo lo demás
drop policy if exists req_ver on public.compras_requerimientos;
create policy req_ver on public.compras_requerimientos for select to authenticated using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists req_crear on public.compras_requerimientos;
create policy req_crear on public.compras_requerimientos for insert to authenticated with check (public.es_admin() or (public.es_miembro(obra_id) and tipo = 'directo' and etapa = 'pedido'));
drop policy if exists req_editar on public.compras_requerimientos;
create policy req_editar on public.compras_requerimientos for update to authenticated
  using (public.es_admin() or (public.es_miembro(obra_id) and etapa = 'pedido')) with check (public.es_admin() or (public.es_miembro(obra_id) and etapa = 'pedido'));
drop policy if exists req_borrar on public.compras_requerimientos;
create policy req_borrar on public.compras_requerimientos for delete to authenticated using (public.es_admin() or (public.es_miembro(obra_id) and etapa = 'pedido'));

drop policy if exists reqit_ver on public.compras_req_items;
create policy reqit_ver on public.compras_req_items for select to authenticated
  using (exists (select 1 from public.compras_requerimientos r where r.id = requerimiento_id and (public.es_admin() or public.es_miembro(r.obra_id))));
drop policy if exists reqit_editar on public.compras_req_items;
create policy reqit_editar on public.compras_req_items for all to authenticated
  using (exists (select 1 from public.compras_requerimientos r where r.id = requerimiento_id and (public.es_admin() or (public.es_miembro(r.obra_id) and r.etapa = 'pedido'))))
  with check (exists (select 1 from public.compras_requerimientos r where r.id = requerimiento_id and (public.es_admin() or (public.es_miembro(r.obra_id) and r.etapa = 'pedido'))));

-- Cotización, comparativo y facturas: solo administradores
do $$
declare t text;
begin
  foreach t in array array['compras_invitados','compras_proformas','compras_proforma_items','compras_orden_facturas']
  loop
    execute format('drop policy if exists solo_admin on public.%I', t);
    execute format('create policy solo_admin on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- Órdenes: el residente ve las de su obra; el administrador las crea, emite y anula
drop policy if exists oc_ver on public.compras_ordenes;
create policy oc_ver on public.compras_ordenes for select to authenticated using (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists oc_admin on public.compras_ordenes;
create policy oc_admin on public.compras_ordenes for all to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists ocit_ver on public.compras_orden_items;
create policy ocit_ver on public.compras_orden_items for select to authenticated
  using (exists (select 1 from public.compras_ordenes o where o.id = orden_id and (public.es_admin() or public.es_miembro(o.obra_id))));
drop policy if exists ocit_admin on public.compras_orden_items;
create policy ocit_admin on public.compras_orden_items for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Recepción: la registra el residente de la obra (o el administrador); solo el administrador corrige o borra
drop policy if exists ge_ver on public.compras_entregas;
create policy ge_ver on public.compras_entregas for select to authenticated
  using (exists (select 1 from public.compras_ordenes o where o.id = orden_id and (public.es_admin() or public.es_miembro(o.obra_id))));
drop policy if exists ge_crear on public.compras_entregas;
create policy ge_crear on public.compras_entregas for insert to authenticated
  with check (exists (select 1 from public.compras_ordenes o where o.id = orden_id and o.estado in ('emitida','parcial','recibida') and (public.es_admin() or public.es_miembro(o.obra_id))));
drop policy if exists ge_admin on public.compras_entregas;
create policy ge_admin on public.compras_entregas for update to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists ge_borrar on public.compras_entregas;
create policy ge_borrar on public.compras_entregas for delete to authenticated using (public.es_admin());
drop policy if exists geit_ver on public.compras_entrega_items;
create policy geit_ver on public.compras_entrega_items for select to authenticated
  using (exists (select 1 from public.compras_entregas e join public.compras_ordenes o on o.id = e.orden_id where e.id = entrega_id and (public.es_admin() or public.es_miembro(o.obra_id))));
drop policy if exists geit_crear on public.compras_entrega_items;
create policy geit_crear on public.compras_entrega_items for insert to authenticated
  with check (exists (select 1 from public.compras_entregas e join public.compras_ordenes o on o.id = e.orden_id where e.id = entrega_id and (public.es_admin() or public.es_miembro(o.obra_id))));
drop policy if exists geit_admin on public.compras_entrega_items;
create policy geit_admin on public.compras_entrega_items for delete to authenticated using (public.es_admin());

-- 8. Si está instalado el lector de facturas (dlv-facturas), sus tablas quedan solo para administradores.
--    El lector usa la clave de servicio, así que sigue funcionando igual.
do $$
declare t text;
begin
  foreach t in array array['facturas_proveedor','facturas_proveedor_detalle','reglas_obra','facturas_correos']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "lectura app" on public.%I', t);
      execute format('drop policy if exists "asignar obra" on public.%I', t);
      execute format('drop policy if exists solo_admin on public.%I', t);
      execute format('create policy solo_admin on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
    end if;
  end loop;
end $$;

-- 9. El gasto de cada factura en Control de costos lleva el origen 'compra'
do $$
begin
  if to_regclass('public.gastos') is not null then
    alter table public.gastos add column if not exists orden_id uuid;
  end if;
end $$;

-- Activa el programa en el menú del portal
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/compras', estado = 'beta', actualizado = now(),
           descripcion = 'Pedido de obra o cotización, comparativo de proformas, orden de pedido, recepción con guía de remisión y factura; carga el gasto a la obra.'
     where nombre = 'Compras' and coalesce(url, '') = '';
  end if;
end $$;
