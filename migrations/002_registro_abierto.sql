-- =========================================================
--  FORMALIN · Migración 002: registro abierto a cualquier correo
--  y tipo de cuenta (estudiante / negocio)
--  Ejecutar una sola vez en: Supabase → SQL Editor → New query
-- =========================================================

-- Ya no se exige correo institucional
drop trigger if exists enforce_email_domain on auth.users;
drop function if exists public.enforce_email_domain();

-- Tipo de cuenta y datos del negocio (los perfiles existentes quedan como estudiante)
alter table public.profiles
  add column if not exists account_type text not null default 'estudiante',
  add column if not exists business_name text not null default '',
  add column if not exists business_about text not null default '';

alter table public.profiles drop constraint if exists profiles_account_type_check;
alter table public.profiles add constraint profiles_account_type_check
  check (account_type in ('estudiante', 'negocio'));

-- Perfil automático al registrarse, ahora con el tipo de cuenta
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
