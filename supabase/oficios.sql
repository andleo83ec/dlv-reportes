-- =====================================================================
-- DLV Plataforma — Oficios con numeración por obra, redacción con Claude,
-- firma electrónica (agente local con pyHanko) y verificación por QR
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de schema.sql y rdi.sql; se puede ejecutar más de una vez sin problema)
-- =====================================================================

-- 1. Datos que necesitan los oficios en obras y perfiles
alter table public.obras    add column if not exists codigo text;          -- TUR, GSAL… forma DLV-TUR-OF-001-2026
alter table public.obras    add column if not exists ciudad text not null default 'Cuenca';
alter table public.perfiles add column if not exists titulo text;          -- Ing., Arq.
alter table public.perfiles add column if not exists cargo text;           -- Gerente de Proyectos
alter table public.perfiles add column if not exists puede_firmar boolean not null default false;

do $$ begin
  alter table public.obras add constraint obras_codigo_formato check (codigo is null or codigo ~ '^[A-Z0-9]{2,10}$');
exception when duplicate_object then null; end $$;
create unique index if not exists obras_codigo_unico on public.obras (codigo) where codigo is not null;

-- 2. Oficios
create table if not exists public.oficios (
  id                        uuid primary key default gen_random_uuid(),
  obra_id                   uuid not null references public.obras(id) on delete restrict,
  numero                    int,                 -- se asigna SOLO al emitir (mismo correlativo que la correspondencia enviada)
  codigo                    text unique,         -- DLV-TUR-OF-014-2026
  estado                    text not null default 'borrador'
                            check (estado in ('borrador', 'pendiente_firma', 'firmado', 'anulado')),
  destinatario_titulo       text not null default '',
  destinatario_nombre       text not null default '',
  destinatario_cargo        text not null default '',
  destinatario_institucion  text not null default '',
  asunto                    text not null default '',
  referencia                text not null default '',
  cuerpo                    text not null default '',
  anexos                    text not null default '',
  con_copia                 text not null default '',
  requiere_respuesta        boolean not null default false,
  plazo_respuesta           date,
  autor_id                  uuid not null references public.perfiles(id) default auth.uid(),
  autor_nombre              text,
  firmante_id               uuid references public.perfiles(id),
  firmante_nombre           text,               -- copia: los residentes no ven perfiles ajenos
  firmante_cargo            text,
  fecha_emision             date,
  emitido_en                timestamptz,
  firmado_en                timestamptz,
  pdf_key                   text,               -- R2: obras/<obra>/oficios/DLV-TUR-OF-014-2026.pdf
  docx_key                  text,
  hash_sha256               text,
  certificado_info          text,
  correspondencia_id        uuid references public.correspondencia(id) on delete set null,
  token_verificacion        text not null unique default encode(gen_random_bytes(16), 'hex'),
  motivo_anulacion          text,
  creado                    timestamptz not null default now(),
  actualizado               timestamptz not null default now(),
  unique (obra_id, numero)
);
create index if not exists oficios_obra on public.oficios (obra_id, numero desc);
create index if not exists oficios_firmante on public.oficios (firmante_id, estado);

create table if not exists public.oficio_eventos (
  id         bigserial primary key,
  oficio_id  uuid not null references public.oficios(id) on delete cascade,
  usuario_id uuid references public.perfiles(id),
  usuario    text,
  accion     text not null,
  detalle    jsonb not null default '{}'::jsonb,
  creado     timestamptz not null default now()
);
create index if not exists oficio_eventos_of on public.oficio_eventos (oficio_id, creado);

create or replace function public.nombre_perfil(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select trim(concat_ws(' ', nullif(titulo, ''), coalesce(nullif(nombre, ''), email))) from public.perfiles where id = p;
$$;

create or replace function public.oficio_evento(p_oficio uuid, p_accion text, p_detalle jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.oficio_eventos (oficio_id, usuario_id, usuario, accion, detalle)
  values (p_oficio, auth.uid(), public.nombre_perfil(auth.uid()), p_accion, coalesce(p_detalle, '{}'::jsonb));
$$;
revoke execute on function public.oficio_evento(uuid, text, jsonb) from public, anon, authenticated;

-- 3. Protección: número, código, estado, archivos y token solo cambian por las funciones oficiales
create or replace function public.oficios_proteger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('dlv.oficios', true), '') = 'on' then
    new.actualizado := now(); return new;
  end if;
  if tg_op = 'INSERT' then
    new.numero := null; new.codigo := null; new.estado := 'borrador';
    new.pdf_key := null; new.docx_key := null; new.hash_sha256 := null; new.certificado_info := null;
    new.fecha_emision := null; new.emitido_en := null; new.firmado_en := null; new.correspondencia_id := null;
    new.token_verificacion := encode(gen_random_bytes(16), 'hex');
    new.autor_id := coalesce(auth.uid(), new.autor_id);
    new.autor_nombre := public.nombre_perfil(new.autor_id);
  elsif new.numero is distinct from old.numero or new.codigo is distinct from old.codigo
     or new.estado is distinct from old.estado or new.obra_id is distinct from old.obra_id
     or new.autor_id is distinct from old.autor_id or new.pdf_key is distinct from old.pdf_key
     or new.docx_key is distinct from old.docx_key or new.hash_sha256 is distinct from old.hash_sha256
     or new.token_verificacion is distinct from old.token_verificacion
     or new.fecha_emision is distinct from old.fecha_emision or new.correspondencia_id is distinct from old.correspondencia_id then
    raise exception 'Campo protegido del oficio: use Emitir o Anular';
  end if;
  new.firmante_nombre := public.nombre_perfil(new.firmante_id);
  new.firmante_cargo := (select cargo from public.perfiles where id = new.firmante_id);
  new.actualizado := now();
  return new;
end $$;
drop trigger if exists oficios_proteger on public.oficios;
create trigger oficios_proteger before insert or update on public.oficios
  for each row execute function public.oficios_proteger();

create or replace function public.oficios_creado()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.oficio_evento(new.id, 'Creado'); return new; end $$;
drop trigger if exists oficios_creado on public.oficios;
create trigger oficios_creado after insert on public.oficios
  for each row execute function public.oficios_creado();

-- 4. Firmantes disponibles en una obra (los residentes no pueden leer perfiles ajenos)
create or replace function public.oficio_firmantes(p_obra uuid)
returns table (id uuid, nombre text, cargo text)
language sql stable security definer set search_path = public as $$
  select p.id, public.nombre_perfil(p.id), coalesce(p.cargo, '')
    from public.perfiles p
   where p.puede_firmar
     and (public.es_admin() or public.es_miembro(p_obra))
     and (p.rol = 'admin' or exists (select 1 from public.obra_miembros m where m.obra_id = p_obra and m.user_id = p.id))
   order by 2;
$$;

-- 5. EMITIR: número correlativo de la obra, sin repetir ni saltar.
-- Bloquea la fila de la obra mientras asigna, y usa el mismo correlativo que la
-- correspondencia enviada de /rdi (OF-001…): el oficio queda registrado allí también.
create or replace function public.emitir_oficio(p_oficio uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  o public.oficios%rowtype;
  ob public.obras%rowtype;
  v_num int; v_cod text; v_corr uuid;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  select * into o from public.oficios where id = p_oficio for update;
  if not found then raise exception 'Oficio no encontrado'; end if;
  if o.estado <> 'borrador' then raise exception 'El oficio ya fue emitido (%)', o.codigo; end if;
  if not (public.es_admin() or (o.autor_id = auth.uid() and public.es_miembro(o.obra_id))) then
    raise exception 'Solo el autor o un administrador pueden emitir';
  end if;
  if trim(o.destinatario_nombre) = '' or trim(o.asunto) = '' or trim(o.cuerpo) = '' then
    raise exception 'Faltan datos: destinatario, asunto y cuerpo son obligatorios';
  end if;
  if o.cuerpo ~ '\[[^\]]{2,40}\]' then
    raise exception 'El cuerpo tiene datos por completar entre corchetes, por ejemplo [fecha]';
  end if;
  if o.firmante_id is null or not exists (select 1 from public.oficio_firmantes(o.obra_id) f where f.id = o.firmante_id) then
    raise exception 'Elija un firmante habilitado para esta obra';
  end if;

  select * into ob from public.obras where id = o.obra_id for update;   -- turno de la obra
  if coalesce(ob.codigo, '') = '' then
    raise exception 'La obra no tiene código para los oficios. Un administrador debe asignarlo en Oficios → Configuración';
  end if;

  select greatest(
           coalesce((select max(numero) from public.correspondencia where obra_id = o.obra_id and direccion = 'enviada'), 0),
           coalesce((select max(numero) from public.oficios where obra_id = o.obra_id), 0)) + 1
    into v_num;
  v_cod := format('DLV-%s-OF-%s-%s', ob.codigo, lpad(v_num::text, 3, '0'), extract(year from v_hoy)::int);

  insert into public.correspondencia (obra_id, numero, fecha, direccion, de, para, asunto, referencia, resumen,
                                      requiere_respuesta, plazo, estado, ubicacion, creado_por)
  values (o.obra_id, v_num, v_hoy, 'enviada', 'DLV Construcciones',
          trim(concat_ws(' ', nullif(o.destinatario_titulo, ''), o.destinatario_nombre)) ||
            case when o.destinatario_institucion <> '' then ' — ' || o.destinatario_institucion else '' end,
          o.asunto, v_cod, left(regexp_replace(o.cuerpo, '\s+', ' ', 'g'), 400),
          o.requiere_respuesta, case when o.requiere_respuesta then o.plazo_respuesta end,
          case when o.requiere_respuesta then 'pendiente' else 'archivada' end,
          'Plataforma DLV · Oficios (pendiente de firma)', auth.uid())
  returning id into v_corr;

  perform set_config('dlv.oficios', 'on', true);
  update public.oficios set numero = v_num, codigo = v_cod, estado = 'pendiente_firma',
         fecha_emision = v_hoy, emitido_en = now(), correspondencia_id = v_corr
   where id = p_oficio;
  perform set_config('dlv.oficios', 'off', true);
  perform public.oficio_evento(p_oficio, 'Emitido · ' || v_cod);
  return v_cod;
end $$;

-- 6. REGISTRAR FIRMA: la llama el servidor con la sesión del firmante, después de guardar el PDF en R2
create or replace function public.registrar_firma_oficio(p_oficio uuid, p_pdf_key text, p_docx_key text, p_hash text, p_cert text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.oficios%rowtype;
begin
  select * into o from public.oficios where id = p_oficio for update;
  if not found then raise exception 'Oficio no encontrado'; end if;
  if o.estado <> 'pendiente_firma' then raise exception 'El oficio no está pendiente de firma'; end if;
  if o.firmante_id is distinct from auth.uid() then raise exception 'Usted no es el firmante asignado'; end if;
  if p_pdf_key is distinct from format('obras/%s/oficios/%s.pdf', o.obra_id, o.codigo) or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Archivo firmado inválido';
  end if;
  perform set_config('dlv.oficios', 'on', true);
  update public.oficios set estado = 'firmado', firmado_en = now(), pdf_key = p_pdf_key,
         docx_key = nullif(p_docx_key, ''), hash_sha256 = p_hash, certificado_info = left(p_cert, 300)
   where id = p_oficio;
  perform set_config('dlv.oficios', 'off', true);
  update public.correspondencia set ubicacion = 'Plataforma DLV · ' || p_pdf_key where id = o.correspondencia_id;
  perform public.oficio_evento(p_oficio, 'Firmado electrónicamente', jsonb_build_object('hash', p_hash, 'certificado', p_cert));
end $$;

-- 7. ANULAR: el número queda registrado como anulado (sin huecos en la secuencia)
create or replace function public.anular_oficio(p_oficio uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.oficios%rowtype;
begin
  select * into o from public.oficios where id = p_oficio for update;
  if not found then raise exception 'Oficio no encontrado'; end if;
  if o.estado = 'borrador' then raise exception 'Un borrador se elimina, no se anula'; end if;
  if o.estado = 'anulado' then raise exception 'El oficio ya está anulado'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo de la anulación'; end if;
  if not (public.es_admin() or (o.estado = 'pendiente_firma' and o.autor_id = auth.uid())) then
    raise exception 'Solo un administrador puede anular un oficio firmado';
  end if;
  perform set_config('dlv.oficios', 'on', true);
  update public.oficios set estado = 'anulado', motivo_anulacion = trim(p_motivo) where id = p_oficio;
  perform set_config('dlv.oficios', 'off', true);
  update public.correspondencia set asunto = 'ANULADO · ' || asunto, estado = 'archivada', requiere_respuesta = false
   where id = o.correspondencia_id and asunto not like 'ANULADO · %';
  perform public.oficio_evento(p_oficio, 'Anulado', jsonb_build_object('motivo', p_motivo));
end $$;

-- 8. VERIFICACIÓN PÚBLICA (destino del QR): solo datos básicos de oficios emitidos
create or replace function public.verificar_oficio(p_token text)
returns table (codigo text, estado text, asunto text, destinatario text, obra text, fecha_emision date,
               firmado_en timestamptz, firmante text, firmante_cargo text, certificado text, hash_sha256 text,
               motivo_anulacion text, pdf_key text)
language sql stable security definer set search_path = public as $$
  select o.codigo, o.estado, o.asunto,
         trim(concat_ws(' ', nullif(o.destinatario_titulo, ''), o.destinatario_nombre)) ||
           case when o.destinatario_institucion <> '' then ' — ' || o.destinatario_institucion else '' end,
         ob.nombre, o.fecha_emision, o.firmado_en, o.firmante_nombre, o.firmante_cargo, o.certificado_info,
         o.hash_sha256, o.motivo_anulacion, case when o.estado = 'firmado' then o.pdf_key end
    from public.oficios o join public.obras ob on ob.id = o.obra_id
   where o.token_verificacion = p_token and o.estado <> 'borrador' and p_token ~ '^[0-9a-f]{32}$';
$$;
grant execute on function public.verificar_oficio(text) to anon, authenticated;

-- 9. Seguridad (RLS)
alter table public.oficios        enable row level security;
alter table public.oficio_eventos enable row level security;

drop policy if exists oficios_ver on public.oficios;
create policy oficios_ver on public.oficios for select to authenticated
  using ((public.es_admin() or public.es_miembro(obra_id))
         and (estado <> 'borrador' or autor_id = auth.uid() or public.es_admin()));
drop policy if exists oficios_crear on public.oficios;
create policy oficios_crear on public.oficios for insert to authenticated
  with check (public.es_admin() or public.es_miembro(obra_id));
drop policy if exists oficios_editar on public.oficios;
create policy oficios_editar on public.oficios for update to authenticated
  using (estado = 'borrador' and (autor_id = auth.uid() or public.es_admin()))
  with check (estado = 'borrador');
drop policy if exists oficios_borrar on public.oficios;
create policy oficios_borrar on public.oficios for delete to authenticated
  using (estado = 'borrador' and (autor_id = auth.uid() or public.es_admin()));

drop policy if exists oficio_eventos_ver on public.oficio_eventos;
create policy oficio_eventos_ver on public.oficio_eventos for select to authenticated
  using (exists (select 1 from public.oficios o where o.id = oficio_id));
revoke insert, update, delete on public.oficio_eventos from anon, authenticated;
revoke all on public.oficios from anon;

-- 10. Activa el programa en el menú del portal
do $$
begin
  if to_regclass('public.programas') is not null then
    insert into public.programas (nombre, descripcion, url, categoria, icono, estado, orden)
    select 'Oficios', 'Oficios numerados por obra con la plantilla DLV, redacción con Claude, firma electrónica y verificación por QR.',
           '/oficios', 'Obra', 'reporte', 'beta', 35
     where not exists (select 1 from public.programas where nombre = 'Oficios');
  end if;
end $$;

-- Para habilitar a alguien como firmante (o desde Oficios → Configuración):
--   update public.perfiles set puede_firmar = true, titulo = 'Ing.', cargo = 'Gerente de Proyectos'
--    where email = 'su-correo@dominio.com';
