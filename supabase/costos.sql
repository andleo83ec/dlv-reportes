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
