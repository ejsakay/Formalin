-- =========================================================
--  FORMALIN · Migración 004: privacidad de los perfiles
--  El contacto entre usuarios es solo por el chat interno, así que el
--  correo, el teléfono y las redes dejan de ser legibles desde la API
--  pública. Las columnas y sus datos se conservan (no se borra nada).
--  Requiere el cliente que lee perfiles con columnas explícitas
--  (Auth.PROFILE_COLS): publicar ese cliente ANTES de ejecutar esto.
--  Ejecutar una sola vez en: Supabase → SQL Editor → New query
-- =========================================================

revoke select on public.profiles from anon, authenticated;
grant select (id, name, account_type, career, semester, business_name, business_about, avatar_url, created_at)
  on public.profiles to anon, authenticated;

-- Para revertir (vuelve a exponer todas las columnas):
--   grant select on public.profiles to anon, authenticated;
