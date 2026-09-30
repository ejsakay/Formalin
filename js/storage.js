/* Capa de datos sobre localStorage */
const Store = (() => {
  const KEYS = {
    users: 'ut_users',
    listings: 'ut_listings',
    session: 'ut_session',
    favs: 'ut_favs',
    theme: 'ut_theme',
  };

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // Lanza un Error con code 'QUOTA' si el almacenamiento está lleno
  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      const err = new Error('Espacio de almacenamiento lleno');
      err.code = 'QUOTA';
      throw err;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    KEYS,
    get,
    set,
    uid,
    users: () => get(KEYS.users, []),
    saveUsers: (u) => set(KEYS.users, u),
    listings: () => get(KEYS.listings, []),
    saveListings: (l) => set(KEYS.listings, l),
    session: () => get(KEYS.session, null),
    setSession: (id) => (id ? set(KEYS.session, id) : localStorage.removeItem(KEYS.session)),
    // Favoritos por usuario: { [userId]: [listingId, ...] }
    favs: () => get(KEYS.favs, {}),
    saveFavs: (f) => set(KEYS.favs, f),
  };
})();
