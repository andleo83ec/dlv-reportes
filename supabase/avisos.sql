-- =====================================================================
-- DLV Plataforma — Avisos en el celular (notificaciones push de la app instalada)
-- Pegar TODO este archivo en Supabase > SQL Editor > New query > Run
-- (después de compras.sql y oficios.sql; se puede ejecutar más de una vez)
--
-- Cómo funciona: cada celular que activa los avisos guarda aquí su suscripción.
-- Los disparadores de abajo crean un aviso para quien corresponde; justo después,
-- la misma pantalla de quien hizo el cambio pide al servidor (/api/push) que los envíe.
-- =====================================================================

create table if not exists public.push_suscripciones (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references public.perfiles(id) on delete cascade,
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null,
  agente    text,
  creado    timestamptz not null default now()
);
create index if not exists push_suscripciones_user on public.push_suscripciones (user_id);
alter table public.push_suscripciones enable row level security;
drop policy if exists push_propias on public.push_suscripciones;
create policy push_propias on public.push_suscripciones for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.avisos (
  id          bigserial primary key,
  user_id     uuid not null references public.perfiles(id) on delete cascade,   -- quien lo recibe
  titulo      text not null,
  cuerpo      text not null default '',
  url         text not null default '/',
  creado_por  uuid default auth.uid(),
  enviado     boolean not null default false,
  creado      timestamptz not null default now()
);
create index if not exists avisos_pendientes on public.avisos (creado_por, enviado, creado);
alter table public.avisos enable row level security;
drop policy if exists avisos_propios on public.avisos;
create policy avisos_propios on public.avisos for select using (user_id = auth.uid());

-- Crea un aviso para cada destinatario (nunca para quien hizo el cambio)
create or replace function public.avisar(p_usuarios uuid[], p_titulo text, p_cuerpo text, p_url text)
returns void language sql security definer set search_path = public as $$
  insert into public.avisos (user_id, titulo, cuerpo, url, creado_por)
  select distinct u, left(p_titulo, 120), left(coalesce(p_cuerpo, ''), 240), p_url, auth.uid()
  from unnest(p_usuarios) u
  where u is not null and u is distinct from auth.uid();
$$;

-- 1. Pedido de obra nuevo → administradores
create or replace function public.aviso_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_obra text;
begin
  if new.tipo = 'directo' and new.etapa = 'pedido' then
    select nombre into v_obra from public.obras where id = new.obra_id;
    perform public.avisar(array(select id from public.perfiles where rol = 'admin'),
      case when new.urgente then 'Pedido URGENTE por aprobar' else 'Pedido por aprobar' end,
      coalesce(v_obra, '') || ' · ' || coalesce(new.titulo, ''), '/compras');
  end if;
  return new;
end $$;
drop trigger if exists aviso_pedido on public.compras_requerimientos;
create trigger aviso_pedido after insert on public.compras_requerimientos
  for each row execute function public.aviso_pedido();

-- 2. Orden de compra emitida → residentes de la obra (para que la reciban)
create or replace function public.aviso_orden() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_obra text;
begin
  if new.estado = 'emitida' and (tg_op = 'INSERT' or old.estado is distinct from 'emitida') then
    select nombre into v_obra from public.obras where id = new.obra_id;
    perform public.avisar(array(select user_id from public.obra_miembros where obra_id = new.obra_id),
      'Orden emitida: ' || coalesce(new.numero, ''), coalesce(v_obra, '') || ' · por recibir en obra', '/compras');
  end if;
  return new;
end $$;
drop trigger if exists aviso_orden on public.compras_ordenes;
create trigger aviso_orden after insert or update of estado on public.compras_ordenes
  for each row execute function public.aviso_orden();

-- 3. Oficio emitido → quien debe firmarlo
create or replace function public.aviso_oficio() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_obra text;
begin
  if new.estado = 'pendiente_firma' and old.estado is distinct from 'pendiente_firma' then
    select nombre into v_obra from public.obras where id = new.obra_id;
    perform public.avisar(array[new.firmante_id], 'Oficio por firmar: ' || coalesce(new.codigo, ''),
      coalesce(v_obra, '') || ' · ' || coalesce(new.asunto, ''), '/oficios');
  end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.oficios') is not null then
    execute 'drop trigger if exists aviso_oficio on public.oficios';
    execute 'create trigger aviso_oficio after update of estado on public.oficios for each row execute function public.aviso_oficio()';
  end if;
end $$;

-- El servidor pide, con la sesión de quien hizo el cambio, los avisos que ese usuario generó
-- y aún no salieron, junto con los celulares de cada destinatario. Quedan marcados como enviados.
create or replace function public.push_pendientes()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  with tomados as (
    update public.avisos set enviado = true
    where creado_por = auth.uid() and not enviado and creado > now() - interval '2 hours'
    returning id, user_id, titulo, cuerpo, url
  )
  select coalesce(jsonb_agg(jsonb_build_object('titulo', t.titulo, 'cuerpo', t.cuerpo, 'url', t.url,
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    into r
  from tomados t join public.push_suscripciones s on s.user_id = t.user_id;
  return r;
end $$;
revoke all on function public.push_pendientes() from public, anon;
grant execute on function public.push_pendientes() to authenticated;

-- Borra suscripciones que el servicio de avisos del celular ya no reconoce (app desinstalada, permiso quitado)
create or replace function public.push_quitar(p_endpoints text[])
returns void language sql security definer set search_path = public as $$
  delete from public.push_suscripciones where endpoint = any(p_endpoints)
    and exists (select 1 from public.avisos a where a.creado_por = auth.uid() and a.creado > now() - interval '2 hours');
$$;
revoke all on function public.push_quitar(text[]) from public, anon;
grant execute on function public.push_quitar(text[]) to authenticated;

revoke all on function public.avisar(uuid[], text, text, text) from public, anon, authenticated;
