/* Cliente de Supabase (configurado con las variables VITE_ de .env) */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  console.error('[FORMALIN] Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. Copia .env.example como .env y completa los valores.');
}

export const supabase = createClient(url || 'http://localhost', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const BUCKETS = { listings: 'listing-images', avatars: 'avatars' };

export const publicUrl = (bucket, path) => (path ? supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : '');

// Convierte el data URL que produce compressImage() en un Blob para subirlo a Storage
export async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

// Traduce los errores más comunes de Supabase a mensajes en español
export function friendlyError(err, fallback = 'Algo salió mal. Inténtalo de nuevo.') {
  const msg = String((err && err.message) || '');
  if (!isConfigured) return 'La app no está conectada a Supabase todavía.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No hay conexión con el servidor. Revisa tu internet.';
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'Aún no confirmas tu correo. Revisa tu bandeja de entrada (y la carpeta de spam).';
  if (/already registered|already been registered/i.test(msg)) return 'Ya existe una cuenta con ese correo.';
  if (/Solo se permiten correos|Database error saving new user/i.test(msg)) return 'Solo se permiten correos @comfenalco.edu.co o @tecnologicocomfenalco.edu.co.';
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  if (/row-level security|permission denied/i.test(msg)) return 'No tienes permiso para hacer esto.';
  return msg || fallback;
}
