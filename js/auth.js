/* Registro, inicio de sesión y perfil con Supabase Auth */
import { supabase, BUCKETS, publicUrl, dataUrlToBlob, friendlyError } from './supabase.js';
import { Store } from './storage.js';

export const Auth = (() => {
  const PENDING_AVATAR = 'ut_pending_avatar';

  let me = null; // perfil del usuario con sesión activa
  let knownUserId = null; // último usuario cuya sesión ya conoce la app
  const profiles = new Map(); // caché de perfiles por id (dueños de publicaciones)

  const normEmail = (e) => String(e || '').trim().toLowerCase();

  // Fila de la tabla profiles → objeto usuario que usa la interfaz
  function mapProfile(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name || '',
      email: row.email || '',
      accountType: row.account_type === 'negocio' ? 'negocio' : 'estudiante',
      career: row.career || '',
      semester: row.semester || '',
      businessName: row.business_name || '',
      businessAbout: row.business_about || '',
      phone: row.phone || '',
      instagram: row.instagram || '',
      facebook: row.facebook || '',
      tiktok: row.tiktok || '',
      avatar: row.avatar_url || '',
      createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    };
  }

  function cacheProfile(row) {
    const u = mapProfile(row);
    if (u) profiles.set(u.id, u);
    return u;
  }

  const current = () => me;
  const getUser = (id) => (me && me.id === id ? me : profiles.get(id) || null);

  async function loadProfile(user) {
    if (!user) { me = null; return null; }
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    me = cacheProfile(data) || { ...mapProfile({ id: user.id, email: user.email }), name: user.user_metadata?.name || user.email };
    await uploadPendingAvatar(user);
    return me;
  }

  // Al iniciar la app: recupera la sesión y escucha cambios (login, logout, confirmación de correo)
  async function init(onChange) {
    const { data } = await supabase.auth.getSession();
    knownUserId = data.session?.user?.id || null;
    await loadProfile(data.session?.user);
    // Solo avisa de cambios externos (enlace de confirmación, otra pestaña, sesión expirada):
    // login(), register() y logout() actualizan knownUserId antes de que llegue el evento
    supabase.auth.onAuthStateChange((event, session) => {
      // Supabase recomienda no esperar otras llamadas dentro de este callback
      setTimeout(async () => {
        const id = session?.user?.id || null;
        if (id === knownUserId) return;
        knownUserId = id;
        await loadProfile(session?.user);
        onChange && onChange(event);
      }, 0);
    });
    return me;
  }

  async function register(data) {
    const email = normEmail(data.email);
    const isBusiness = data.account_type === 'negocio';
    const meta = {
      name: data.name.trim(),
      account_type: isBusiness ? 'negocio' : 'estudiante',
      career: isBusiness ? '' : (data.career || '').trim(),
      semester: isBusiness ? '' : data.semester || '',
      business_name: isBusiness ? (data.business_name || '').trim() : '',
      business_about: isBusiness ? (data.business_about || '').trim() : '',
      phone: (data.phone || '').trim(),
      instagram: cleanHandle(data.instagram),
      facebook: (data.facebook || '').trim(),
      tiktok: cleanHandle(data.tiktok),
    };
    const { data: res, error } = await supabase.auth.signUp({
      email,
      password: data.password,
      options: { data: meta, emailRedirectTo: location.origin + import.meta.env.BASE_URL },
    });
    if (error) throw new Error(friendlyError(error));
    // Supabase no revela si el correo ya existía: devuelve un usuario sin identidades
    if (res.user && Array.isArray(res.user.identities) && res.user.identities.length === 0) {
      throw new Error('Ya existe una cuenta con ese correo.');
    }
    // La foto se sube cuando haya sesión (después de confirmar el correo)
    if (data.avatar) Store.set(PENDING_AVATAR, { email, dataUrl: data.avatar });
    if (res.session) {
      knownUserId = res.user.id;
      await loadProfile(res.user);
      return { user: me, needsConfirmation: false };
    }
    return { user: { ...meta, email }, needsConfirmation: true };
  }

  async function login(email, password) {
    email = normEmail(email);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyError(error));
    knownUserId = data.user.id;
    return loadProfile(data.user);
  }

  async function logout() {
    await supabase.auth.signOut();
    knownUserId = null;
    me = null;
  }

  async function uploadAvatar(userId, dataUrl) {
    const path = `${userId}/avatar.jpg`;
    const { error } = await supabase.storage.from(BUCKETS.avatars).upload(path, await dataUrlToBlob(dataUrl), { upsert: true, contentType: 'image/jpeg' });
    if (error) throw new Error(friendlyError(error, 'No se pudo subir la foto.'));
    // El parámetro evita que el navegador muestre la foto anterior en caché
    return `${publicUrl(BUCKETS.avatars, path)}?v=${Date.now()}`;
  }

  async function uploadPendingAvatar(user) {
    const pending = Store.get(PENDING_AVATAR, null);
    if (!pending || normEmail(pending.email) !== normEmail(user.email)) return;
    try {
      const url = await uploadAvatar(user.id, pending.dataUrl);
      await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
      if (me) me.avatar = url;
      localStorage.removeItem(PENDING_AVATAR);
    } catch (e) {
      console.warn('No se pudo subir la foto de perfil pendiente', e);
    }
  }

  async function updateProfile(patch, avatarDataUrl) {
    if (!me) throw new Error('No has iniciado sesión.');
    const type = (patch.account_type ?? me.accountType) === 'negocio' ? 'negocio' : 'estudiante';
    const isBusiness = type === 'negocio';
    const row = {
      name: (patch.name ?? me.name).trim(),
      account_type: type,
      career: isBusiness ? '' : (patch.career ?? me.career).trim(),
      semester: isBusiness ? '' : patch.semester ?? me.semester,
      business_name: isBusiness ? (patch.business_name ?? me.businessName).trim() : '',
      business_about: isBusiness ? (patch.business_about ?? me.businessAbout).trim() : '',
      phone: (patch.phone ?? me.phone).trim(),
      instagram: cleanHandle(patch.instagram ?? me.instagram),
      facebook: (patch.facebook ?? me.facebook).trim(),
      tiktok: cleanHandle(patch.tiktok ?? me.tiktok),
    };
    if (avatarDataUrl) row.avatar_url = await uploadAvatar(me.id, avatarDataUrl);
    const { data, error } = await supabase.from('profiles').update(row).eq('id', me.id).select().single();
    if (error) throw new Error(friendlyError(error));
    me = cacheProfile(data);
    return me;
  }

  function cleanHandle(v) {
    return String(v || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, '').replace(/\/$/, '');
  }

  return { init, current, getUser, cacheProfile, register, login, logout, updateProfile };
})();
