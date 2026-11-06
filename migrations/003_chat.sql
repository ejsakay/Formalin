-- =========================================================
--  FORMALIN · Migración 003: chat interno
--  Conversaciones 1:1 por publicación, mensajes, fotos en bucket
--  privado, bloqueos y reportes. Solo agrega objetos nuevos: no
--  modifica ni borra tablas o datos existentes.
--  Ejecutar una sola vez en: Supabase → SQL Editor → New query
-- =========================================================

-- ---------------------------------------------------------
--  Tablas
-- ---------------------------------------------------------

-- Una conversación por (publicación, comprador). Si la publicación se
-- elimina, listing_id queda en null y se conserva una copia de sus datos.
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid references public.listings (id) on delete set null,
  buyer_id        uuid not null references public.profiles (id) on delete cascade,
  seller_id       uuid not null references public.profiles (id) on delete cascade,
  listing_title   text not null default '',
  listing_price   numeric(12, 0) not null default 0,
  listing_cover   text not null default '',          -- ruta en listing-images al iniciar el chat
  last_message_at timestamptz,
  last_message_preview text not null default '',
  last_sender_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint conversations_distinct_users check (buyer_id <> seller_id)
);
create unique index if not exists conversations_listing_buyer_uidx
  on public.conversations (listing_id, buyer_id) where listing_id is not null;
create index if not exists conversations_buyer_idx  on public.conversations (buyer_id, last_message_at desc);
create index if not exists conversations_seller_idx on public.conversations (seller_id, last_message_at desc);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  content         text not null default '' check (char_length(content) <= 2000),
  client_id       uuid,                               -- evita duplicados por reintentos
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_unread_idx on public.messages (conversation_id, sender_id) where read_at is null;
create unique index if not exists messages_client_uidx on public.messages (sender_id, client_id) where client_id is not null;

create table if not exists public.message_attachments (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  storage_path    text not null,                      -- ruta en chat-attachments: {conversation_id}/{archivo}
  file_name       text not null default '',
  mime_type       text not null default '',
  file_size       bigint not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists message_attachments_message_idx on public.message_attachments (message_id);
create index if not exists message_attachments_conversation_idx on public.message_attachments (conversation_id);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- Reportes: se conservan aunque se borre la conversación (para moderación futura)
create table if not exists public.conversation_reports (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations (id) on delete set null,
  reporter_id     uuid not null references public.profiles (id) on delete cascade,
  reported_id     uuid references public.profiles (id) on delete set null,
  reason          text not null check (reason in ('spam', 'acoso', 'estafa', 'inapropiado', 'suplantacion', 'otro')),
  details         text not null default '' check (char_length(details) <= 1000),
  status          text not null default 'pendiente' check (status in ('pendiente', 'revisado', 'descartado')),
  created_at      timestamptz not null default now()
);
create index if not exists conversation_reports_reporter_idx on public.conversation_reports (reporter_id);

-- ---------------------------------------------------------
--  Funciones auxiliares (security definer: no dependen de RLS,
--  así las políticas no se llaman entre sí en recursión)
-- ---------------------------------------------------------
create or replace function public.is_conversation_member(p_conv uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv and (select auth.uid()) in (c.buyer_id, c.seller_id)
  )
$$;

-- Para Storage: la primera carpeta de la ruta debe ser una conversación propia
create or replace function public.chat_path_allowed(p_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_conversation_member(v_folder::uuid);
end;
$$;

-- ¿Alguno de los dos bloqueó al otro?
create or replace function public.is_blocked(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  )
$$;

-- ---------------------------------------------------------
--  RPC
-- ---------------------------------------------------------

-- Devuelve la conversación del usuario con el dueño de la publicación;
-- la crea si no existe (atómico gracias al índice único)
create or replace function public.start_conversation(p_listing uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_title text;
  v_price numeric;
  v_cover text;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para escribir al vendedor.' using errcode = '42501';
  end if;

  select l.owner_id, l.title, l.price into v_owner, v_title, v_price
  from public.listings l where l.id = p_listing;
  if not found then
    raise exception 'Esta publicación ya no existe.';
  end if;
  if v_owner = v_uid then
    raise exception 'No puedes iniciar una conversación contigo mismo.';
  end if;

  select c.id into v_id from public.conversations c
  where c.listing_id = p_listing and c.buyer_id = v_uid;
  if v_id is not null then
    return v_id;
  end if;

  if public.is_blocked(v_uid, v_owner) then
    raise exception 'No puedes iniciar una conversación con este usuario.' using errcode = '42501';
  end if;

  select i.path into v_cover from public.listing_images i
  where i.listing_id = p_listing order by i.position limit 1;

  insert into public.conversations (listing_id, buyer_id, seller_id, listing_title, listing_price, listing_cover)
  values (p_listing, v_uid, v_owner, v_title, coalesce(v_price, 0), coalesce(v_cover, ''))
  on conflict (listing_id, buyer_id) where listing_id is not null do nothing
  returning id into v_id;

  if v_id is null then -- otra petición simultánea la creó primero
    select c.id into v_id from public.conversations c
    where c.listing_id = p_listing and c.buyer_id = v_uid;
  end if;
  return v_id;
end;
$$;

-- Envía un mensaje (texto y/o fotos ya subidas a chat-attachments).
-- El remitente siempre es auth.uid(): no se puede suplantar.
create or replace function public.send_message(
  p_conv uuid,
  p_content text,
  p_client_id uuid default null,
  p_attachments jsonb default '[]'::jsonb
)
returns public.messages
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_conv    public.conversations;
  v_other   uuid;
  v_msg     public.messages;
  v_content text := btrim(coalesce(p_content, ''));
  v_atts    jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_att     jsonb;
  v_path    text;
  v_meta    jsonb;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para enviar mensajes.' using errcode = '42501';
  end if;

  select * into v_conv from public.conversations c where c.id = p_conv;
  if not found or v_uid not in (v_conv.buyer_id, v_conv.seller_id) then
    raise exception 'No participas en esta conversación.' using errcode = '42501';
  end if;
  v_other := case when v_uid = v_conv.buyer_id then v_conv.seller_id else v_conv.buyer_id end;

  if public.is_blocked(v_uid, v_other) then
    raise exception 'No puedes enviar mensajes a este usuario.' using errcode = '42501';
  end if;

  if jsonb_typeof(v_atts) <> 'array' then
    raise exception 'Adjuntos no válidos.';
  end if;
  if v_content = '' and jsonb_array_length(v_atts) = 0 then
    raise exception 'El mensaje está vacío.';
  end if;
  if char_length(v_content) > 2000 then
    raise exception 'El mensaje es demasiado largo (máximo 2000 caracteres).';
  end if;
  if jsonb_array_length(v_atts) > 5 then
    raise exception 'Máximo 5 fotos por mensaje.';
  end if;

  -- Reintento del mismo envío: devuelve el mensaje ya guardado
  if p_client_id is not null then
    select * into v_msg from public.messages m where m.sender_id = v_uid and m.client_id = p_client_id;
    if found then
      return v_msg;
    end if;
  end if;

  -- Freno básico contra spam
  if (select count(*) from public.messages m
      where m.sender_id = v_uid and m.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Estás enviando mensajes muy rápido. Espera un momento.';
  end if;

  insert into public.messages (conversation_id, sender_id, content, client_id)
  values (p_conv, v_uid, v_content, p_client_id)
  returning * into v_msg;

  for v_att in select * from jsonb_array_elements(v_atts) loop
    v_path := v_att->>'path';
    if v_path is null or split_part(v_path, '/', 1) <> p_conv::text or position('..' in v_path) > 0 then
      raise exception 'Adjunto no válido.';
    end if;
    select o.metadata into v_meta from storage.objects o
    where o.bucket_id = 'chat-attachments' and o.name = v_path;
    if not found then
      raise exception 'No se encontró la foto adjunta. Inténtalo de nuevo.';
    end if;
    insert into public.message_attachments (message_id, conversation_id, storage_path, file_name, mime_type, file_size)
    values (
      v_msg.id, p_conv, v_path,
      left(coalesce(v_att->>'name', ''), 120),
      coalesce(v_meta->>'mimetype', ''),
      coalesce((v_meta->>'size')::bigint, 0)
    );
  end loop;

  update public.conversations
  set last_message_at = v_msg.created_at,
      last_message_preview = left(case when v_content = '' then '📷 Foto' else v_content end, 120),
      last_sender_id = v_uid,
      updated_at = now()
  where id = p_conv;

  return v_msg;
end;
$$;

-- Marca como leídos los mensajes recibidos en una conversación
create or replace function public.mark_conversation_read(p_conv uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null or not public.is_conversation_member(p_conv) then
    raise exception 'No participas en esta conversación.' using errcode = '42501';
  end if;
  update public.messages m
  set read_at = now()
  where m.conversation_id = p_conv and m.sender_id <> v_uid and m.read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Mensajes no leídos por conversación (respeta RLS: solo las propias)
create or replace function public.unread_counts()
returns table (conversation_id uuid, unread integer)
language sql stable security invoker
set search_path = ''
as $$
  select m.conversation_id, count(*)::integer
  from public.messages m
  where m.read_at is null and m.sender_id <> (select auth.uid())
  group by m.conversation_id
$$;

-- Permisos de ejecución: solo usuarios con sesión
revoke execute on function public.is_conversation_member(uuid) from public, anon;
revoke execute on function public.chat_path_allowed(text) from public, anon;
revoke execute on function public.is_blocked(uuid, uuid) from public, anon;
revoke execute on function public.start_conversation(uuid) from public, anon;
revoke execute on function public.send_message(uuid, text, uuid, jsonb) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.unread_counts() from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.chat_path_allowed(text) to authenticated;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;
grant execute on function public.start_conversation(uuid) to authenticated;
grant execute on function public.send_message(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.unread_counts() to authenticated;

-- ---------------------------------------------------------
--  Row Level Security
--  Escrituras de conversaciones y mensajes: solo por las RPC.
-- ---------------------------------------------------------
alter table public.conversations        enable row level security;
alter table public.messages             enable row level security;
alter table public.message_attachments  enable row level security;
alter table public.user_blocks          enable row level security;
alter table public.conversation_reports enable row level security;

drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member" on public.conversations for select to authenticated
  using ((select auth.uid()) in (buyer_id, seller_id));

drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "message_attachments_select_member" on public.message_attachments;
create policy "message_attachments_select_member" on public.message_attachments for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own" on public.user_blocks for select to authenticated
  using ((select auth.uid()) = blocker_id);
drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own" on public.user_blocks for insert to authenticated
  with check ((select auth.uid()) = blocker_id);
drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks for delete to authenticated
  using ((select auth.uid()) = blocker_id);

drop policy if exists "conversation_reports_select_own" on public.conversation_reports;
create policy "conversation_reports_select_own" on public.conversation_reports for select to authenticated
  using ((select auth.uid()) = reporter_id);
drop policy if exists "conversation_reports_insert_own" on public.conversation_reports;
create policy "conversation_reports_insert_own" on public.conversation_reports for insert to authenticated
  with check (
    (select auth.uid()) = reporter_id
    and status = 'pendiente'
    and public.is_conversation_member(conversation_id)
  );

-- ---------------------------------------------------------
--  Realtime: nuevos mensajes, lecturas y cambios en la bandeja
--  (Realtime aplica las políticas RLS de select a cada suscriptor)
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
end;
$$;

-- ---------------------------------------------------------
--  Storage: fotos del chat en bucket PRIVADO
--  Ruta: chat-attachments/{conversation_id}/{archivo}
--  Se leen con URLs firmadas; solo los participantes pueden firmarlas.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('chat-attachments', 'chat-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat_attachments_read_member" on storage.objects;
create policy "chat_attachments_read_member" on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and public.chat_path_allowed(name));

drop policy if exists "chat_attachments_insert_member" on storage.objects;
create policy "chat_attachments_insert_member" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments' and public.chat_path_allowed(name));

-- Solo quien subió el archivo puede borrarlo (limpieza de envíos fallidos)
drop policy if exists "chat_attachments_delete_own" on storage.objects;
create policy "chat_attachments_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-attachments' and owner = (select auth.uid()));
