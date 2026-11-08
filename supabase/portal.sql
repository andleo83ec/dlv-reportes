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

-- Programas iniciales (solo si la tabla está vacía)
insert into public.programas (nombre, descripcion, url, categoria, icono, estado, nueva_pestana, orden)
select * from (values
  ('Reporte diario de obra', 'Clima, personal, equipos, actividades, materiales y panel fotográfico. PDF de 2 hojas.', '/reportes', 'Obra', 'reporte', 'activo', false, 10),
  ('Visor 3D y avance', 'Modelo IFC de ArchiCAD: registra el avance por elemento con fotos y pásalo al reporte diario.', '/visor', 'Obra', 'cubo', 'beta', false, 20),
  ('Detector de EPP', 'Detección de casco y chaleco en las cámaras de obra.', '', 'Obra', 'casco', 'desarrollo', false, 30),
  ('Control de costos por obra', 'Presupuesto vs. real por rubro y obra.', '', 'Administración', 'grafico', 'desarrollo', false, 10),
  ('Compras', 'Cotización, comparativo de proformas, orden de pedido, guías y factura.', '', 'Administración', 'carrito', 'desarrollo', false, 20),
  ('Facturas SRI', 'Recepción por correo, validación contra el SRI y conciliación mensual.', '', 'Administración', 'factura', 'desarrollo', false, 30),
  ('Web Edificio La Vuelta', 'Landing del proyecto y registro de eventos.', 'https://www.edificiolavuelta.com', 'Comercial', 'web', 'activo', true, 10),
  ('Cotizador La Vuelta', 'Cotización por tipología y piso con forma de pago.', 'https://www.edificiolavuelta.com/cotizador', 'Comercial', 'calculadora', 'activo', true, 20),
  ('Web Ryō 5', 'Página del proyecto Ryō 5.', 'https://www.ryo5.com', 'Comercial', 'web', 'activo', true, 30)
) as v(nombre, descripcion, url, categoria, icono, estado, nueva_pestana, orden)
where not exists (select 1 from public.programas);
