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
