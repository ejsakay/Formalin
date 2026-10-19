/* Preferencias locales del navegador (solo el tema; los datos viven en Supabase) */
export const Store = (() => {
  const KEYS = { theme: 'ut_theme' };

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* preferencia no esencial: ignorar si el navegador no permite guardar */
    }
  }

  return { KEYS, get, set };
})();
