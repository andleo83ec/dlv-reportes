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
