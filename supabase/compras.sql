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
