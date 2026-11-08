-- =====================================================================
-- DLV Plataforma — Integraciones: facturas de proveedores (correo + SRI) y pedidos por WhatsApp
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de compras.sql y costos.sql; se puede ejecutar más de una vez sin problema)
-- Las tablas las escribe el servicio "dlv-integraciones" con la clave de servicio; en la plataforma
-- solo las ven y cambian los administradores.
-- =====================================================================

-- ---------- 1. Facturas de proveedores (mismo diseño del lector dlv-facturas) ----------
create table if not exists public.facturas_proveedor (
  clave_acceso        text primary key check (clave_acceso ~ '^\d{49}$'),
  cod_doc             text not null,          -- 01 factura, 04 NC, 05 ND, 03 liquidación, 07 retención
  tipo                text not null,
  ruc_emisor          text not null,
  razon_social        text,
  numero              text not null,          -- 001-001-000000123
  fecha_emision       date not null,
  ambiente            text,
  id_receptor         text,
  subtotal            numeric(14,2),
  descuento           numeric(14,2),
  iva                 numeric(14,2),
  total               numeric(14,2),
  doc_modificado      text,                   -- en notas de crédito: factura que modifica
  info_adicional      jsonb not null default '[]',

  -- proceso
  estado              text not null default 'pendiente_sri'
                      check (estado in ('pendiente_sri','procesada','ajena','no_encontrada','no_autorizada','error')),
  estado_sri          text,
  numero_autorizacion text,
  fecha_autorizacion  text,
  intentos            int not null default 0,
  proximo_intento     timestamptz,
  ultimo_error        text,

  -- origen y archivos (R2)
  origen              text not null check (origen in ('correo','listado_sri','manual')),
  email_de            text,
  email_asunto        text,
  xml_key             text,
  pdf_key             text,
  en_listado_sri      boolean not null default false,

  -- asignación a obra (la confirma una persona en la app)
  obra_sugerida_id    uuid,
  obra_id             uuid,                   -- agrega FK a tu tabla de obras: references obras(id)
  asignada_por        text,
  asignada_en         timestamptz,

  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

create index if not exists facturas_proveedor_pend_idx on facturas_proveedor (estado, proximo_intento);
create index if not exists facturas_proveedor_fecha_idx on facturas_proveedor (fecha_emision);
create index if not exists facturas_proveedor_obra_idx on facturas_proveedor (obra_id);
create index if not exists facturas_proveedor_ruc_idx on facturas_proveedor (ruc_emisor);

create table if not exists public.facturas_proveedor_detalle (
  id               bigint generated always as identity primary key,
  clave_acceso     text not null references facturas_proveedor(clave_acceso) on delete cascade,
  linea            int not null,
  codigo           text,
  descripcion      text not null,
  cantidad         numeric(18,6),
  precio_unitario  numeric(18,6),
  descuento        numeric(14,2),
  subtotal         numeric(14,2),
  iva              numeric(14,2),
  tarifa_iva       numeric(5,2),
  rubro_id         uuid             -- opcional: para clasificar la línea en tu presupuesto/APU
);
create index if not exists facturas_detalle_clave_idx on facturas_proveedor_detalle (clave_acceso);

-- Reglas para sugerir obra: si el texto de "información adicional" o el asunto del correo
-- contiene el patrón (sin tildes, sin mayúsculas). Ej.: patron 'turi' → obra Edificio Turi.
create table if not exists reglas_obra (
  id          bigint generated always as identity primary key,
  patron      text not null,
  obra_id     uuid not null,
  ruc_emisor  text,              -- opcional: aplica solo a ese proveedor
  prioridad   int not null default 0,
  activa      boolean not null default true
);

-- Bitácora de correos recibidos (sirve para revisar los que no traían clave de acceso).
create table if not exists facturas_correos (
  id          bigint generated always as identity primary key,
  recibido_en timestamptz not null default now(),
  message_id  text,
  de          text,
  asunto      text,
  adjuntos    text[],
  claves      text[]
);

create or replace function tocar_actualizado() returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;
drop trigger if exists trg_facturas_actualizado on facturas_proveedor;
create trigger trg_facturas_actualizado before update on facturas_proveedor
  for each row execute function tocar_actualizado();

-- Vistas para la app
create or replace view v_facturas_resumen with (security_invoker = true) as
  select estado, count(*)::int as n from facturas_proveedor group by estado
  union all
  select 'por_asignar', count(*)::int from facturas_proveedor
   where estado = 'procesada' and obra_id is null;

create or replace view v_facturas_por_asignar with (security_invoker = true) as
  select clave_acceso, tipo, ruc_emisor, razon_social, numero, fecha_emision,
         subtotal, iva, total, obra_sugerida_id, email_asunto, pdf_key
    from facturas_proveedor
   where estado = 'procesada' and obra_id is null
   order by fecha_emision desc;

-- Seguridad: solo el Worker (service key) y usuarios autenticados de la app.

-- Vínculos con la plataforma: obra (ya existe la tabla obras) y gasto creado en Control de costos
alter table public.facturas_proveedor add column if not exists gasto_id uuid;
alter table public.facturas_proveedor add column if not exists categoria text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'facturas_proveedor_obra_fk') then
    alter table public.facturas_proveedor add constraint facturas_proveedor_obra_fk foreign key (obra_id) references public.obras(id) on delete set null;
  end if;
end $$;

-- ---------- 2. WhatsApp: números autorizados y bitácora de mensajes ----------
alter table public.obras add column if not exists alias text[] not null default '{}';   -- "turi", "lv": cómo la nombran en los mensajes

create table if not exists public.whatsapp_usuarios (
  telefono   text primary key check (telefono ~ '^\d{10,15}$'),  -- formato internacional sin +: 593999501112
  nombre     text not null,
  rol        text not null default 'residente' check (rol in ('residente','bodega','compras','gerente')),
  obra_id    uuid references public.obras(id),       -- obra por defecto (vacío = todas)
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create table if not exists public.whatsapp_mensajes (
  id               bigint generated always as identity primary key,
  wa_id            text unique,
  direccion        text not null check (direccion in ('entrada','salida')),
  telefono         text not null,
  nombre           text,
  tipo             text not null,
  texto            text,
  media_key        text,
  media_tipo       text,
  requerimiento_id uuid references public.compras_requerimientos(id) on delete set null,
  orden_id         uuid references public.compras_ordenes(id) on delete set null,
  resultado        text,
  error            text,
  created_at       timestamptz not null default now()
);
alter table public.whatsapp_mensajes add column if not exists transcripcion text;
create index if not exists whatsapp_mensajes_tel_idx on public.whatsapp_mensajes (telefono, created_at desc);
create index if not exists whatsapp_mensajes_req_idx on public.whatsapp_mensajes (requerimiento_id);

-- ---------- 3. Permisos: solo administradores (el servicio usa la clave de servicio) ----------
do $$
declare t text;
begin
  foreach t in array array['facturas_proveedor','facturas_proveedor_detalle','reglas_obra','facturas_correos','whatsapp_usuarios','whatsapp_mensajes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "lectura app" on public.%I', t);
    execute format('drop policy if exists "asignar obra" on public.%I', t);
    execute format('drop policy if exists "equipo dlv" on public.%I', t);
    execute format('drop policy if exists solo_admin on public.%I', t);
    execute format('create policy solo_admin on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- Activa el programa en el menú del portal
do $$
begin
  if to_regclass('public.programas') is not null then
    update public.programas set url = '/facturas', estado = 'beta', actualizado = now(),
           descripcion = 'Facturas que llegan por correo, validadas en el SRI: asignación a obra, cruce con órdenes y conciliación mensual.'
     where nombre = 'Facturas SRI' and coalesce(url, '') = '';
  end if;
end $$;
