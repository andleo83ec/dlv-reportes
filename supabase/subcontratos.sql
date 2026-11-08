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
