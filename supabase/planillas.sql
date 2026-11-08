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
