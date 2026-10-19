-- =========================================================
--  FORMALIN · Esquema de base de datos para Supabase
--  Ejecutar una sola vez en: Supabase → SQL Editor → New query
-- =========================================================

create extension if not exists unaccent with schema extensions;

-- unaccent() no es IMMUTABLE; este envoltorio sí, para usarlo en columnas generadas
create or replace function public.f_unaccent(text)
returns text
language sql immutable parallel safe strict
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- ---------------------------------------------------------
--  Tablas
-- ---------------------------------------------------------
create table if not exists public.categories (
  id    text primary key,
  label text not null,
  emoji text not null default '',
  sort  int  not null default 0
);

insert into public.categories (id, label, emoji, sort) values
  ('tecnologia',   'Tecnología',        '💻', 1),
  ('libros',       'Libros y útiles',   '📚', 2),
  ('comida',       'Comida',            '🍔', 3),
  ('ropa',         'Ropa y accesorios', '👕', 4),
  ('tutorias',     'Tutorías',          '🎓', 5),
  ('diseno',       'Diseño y foto',     '🎨', 6),
  ('reparaciones', 'Reparaciones',      '🛠️', 7),
  ('otros',        'Otros',             '✨', 8)
on conflict (id) do update set label = excluded.label, emoji = excluded.emoji, sort = excluded.sort;

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  email      text not null default '',
  account_type   text not null default 'estudiante' check (account_type in ('estudiante', 'negocio')),
  career     text not null default '',
  semester   text not null default '',
  business_name  text not null default '',
  business_about text not null default '',
  phone      text not null default '',
  instagram  text not null default '',
  facebook   text not null default '',
  tiktok     text not null default '',
  avatar_url text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in ('producto', 'servicio')),
  title       text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  price       numeric(12, 0) not null default 0 check (price >= 0),
  unit        text not null default '',
  condition   text not null default '',
  category_id text not null references public.categories (id),
  status      text not null default 'activo' check (status in ('activo', 'vendido')),
  views       int  not null default 0,
  created_at  timestamptz not null default now(),
  search      text generated always as (lower(public.f_unaccent(title || ' ' || description))) stored
);

create index if not exists listings_owner_idx    on public.listings (owner_id);
create index if not exists listings_category_idx on public.listings (category_id);
create index if not exists listings_status_idx   on public.listings (status);
create index if not exists listings_created_idx  on public.listings (created_at desc);
create index if not exists listings_price_idx    on public.listings (price);
create index if not exists listings_views_idx    on public.listings (views desc);

create table if not exists public.listing_images (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  path       text not null,           -- ruta dentro del bucket listing-images
  position   int  not null default 0
);
create index if not exists listing_images_listing_idx on public.listing_images (listing_id, position);

create table if not exists public.favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ---------------------------------------------------------
--  Auth: perfil automático al registrarse
-- ---------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, name, account_type, career, semester, business_name, business_about, phone, instagram, facebook, tiktok)
  values (
    new.id,
    lower(new.email),
    coalesce(m->>'name', ''),
    case when m->>'account_type' = 'negocio' then 'negocio' else 'estudiante' end,
    coalesce(m->>'career', ''),
    coalesce(m->>'semester', ''),
    coalesce(m->>'business_name', ''),
    coalesce(m->>'business_about', ''),
    coalesce(m->>'phone', ''),
    coalesce(m->>'instagram', ''),
    coalesce(m->>'facebook', ''),
    coalesce(m->>'tiktok', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Vistas: cualquiera puede sumar una vista sin tener permiso de UPDATE
create or replace function public.increment_views(listing_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ update public.listings set views = views + 1 where id = listing_id $$;

grant execute on function public.increment_views(uuid) to anon, authenticated;

-- ---------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------
alter table public.categories     enable row level security;
alter table public.profiles       enable row level security;
alter table public.listings       enable row level security;
alter table public.listing_images enable row level security;
alter table public.favorites      enable row level security;

-- Categorías: solo lectura
drop policy if exists "categories_select" on public.categories;
create policy "categories_select" on public.categories for select using (true);

-- Perfiles: lectura pública (el detalle muestra el contacto del vendedor); cada quien edita el suyo
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (true);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Publicaciones: lectura pública; solo el dueño crea, edita o elimina
drop policy if exists "listings_select" on public.listings;
create policy "listings_select" on public.listings for select using (true);
drop policy if exists "listings_insert_own" on public.listings;
create policy "listings_insert_own" on public.listings for insert
  with check ((select auth.uid()) = owner_id);
drop policy if exists "listings_update_own" on public.listings;
create policy "listings_update_own" on public.listings for update
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "listings_delete_own" on public.listings;
create policy "listings_delete_own" on public.listings for delete
  using ((select auth.uid()) = owner_id);

-- Imágenes de publicaciones: lectura pública; escritura solo si la publicación es tuya
drop policy if exists "listing_images_select" on public.listing_images;
create policy "listing_images_select" on public.listing_images for select using (true);
drop policy if exists "listing_images_write_own" on public.listing_images;
create policy "listing_images_write_own" on public.listing_images for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = (select auth.uid())));

-- Favoritos: privados de cada usuario
drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own" on public.favorites for select using ((select auth.uid()) = user_id);
drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own" on public.favorites for insert with check ((select auth.uid()) = user_id);
drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own" on public.favorites for delete using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------
--  Storage: imágenes de productos y avatares
--  Rutas: listing-images/{uid}/{listingId}/{archivo}  ·  avatars/{uid}/{archivo}
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('listing-images', 'listing-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars',        'avatars',        true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "formalin_images_read" on storage.objects;
create policy "formalin_images_read" on storage.objects for select
  using (bucket_id in ('listing-images', 'avatars'));

drop policy if exists "formalin_images_insert_own" on storage.objects;
create policy "formalin_images_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id in ('listing-images', 'avatars') and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "formalin_images_update_own" on storage.objects;
create policy "formalin_images_update_own" on storage.objects for update to authenticated
  using (bucket_id in ('listing-images', 'avatars') and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "formalin_images_delete_own" on storage.objects;
create policy "formalin_images_delete_own" on storage.objects for delete to authenticated
  using (bucket_id in ('listing-images', 'avatars') and (storage.foldername(name))[1] = (select auth.uid())::text);
