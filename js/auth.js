/* Registro, inicio de sesión y perfil */
const Auth = (() => {
  async function hash(text) {
    const salted = 'utecno::' + text;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Respaldo si crypto.subtle no está disponible (contexto no seguro)
    let h = 5381;
    for (let i = 0; i < salted.length; i++) h = ((h << 5) + h + salted.charCodeAt(i)) | 0;
    return 'djb2-' + (h >>> 0).toString(16);
  }

  const normEmail = (e) => String(e || '').trim().toLowerCase();

  function current() {
    const id = Store.session();
    if (!id) return null;
    return Store.users().find((u) => u.id === id) || null;
  }

  function getUser(id) {
    return Store.users().find((u) => u.id === id) || null;
  }

  async function register(data) {
    const users = Store.users();
    const email = normEmail(data.email);
    if (users.some((u) => u.email === email)) throw new Error('Ya existe una cuenta con ese correo.');
    const user = {
      id: Store.uid(),
      name: data.name.trim(),
      email,
      passHash: await hash(data.password),
      career: (data.career || '').trim(),
      semester: data.semester || '',
      phone: (data.phone || '').trim(),
      instagram: cleanHandle(data.instagram),
      facebook: (data.facebook || '').trim(),
      tiktok: cleanHandle(data.tiktok),
      avatar: data.avatar || '',
      createdAt: Date.now(),
    };
    users.push(user);
    Store.saveUsers(users);
    Store.setSession(user.id);
    return user;
  }

  async function login(email, password) {
    const user = Store.users().find((u) => u.email === normEmail(email));
    if (!user || user.passHash !== (await hash(password))) throw new Error('Correo o contraseña incorrectos.');
    Store.setSession(user.id);
    return user;
  }

  function logout() {
    Store.setSession(null);
  }

  function updateProfile(patch) {
    const me = current();
    if (!me) throw new Error('No has iniciado sesión.');
    const users = Store.users();
    const i = users.findIndex((u) => u.id === me.id);
    if (patch.instagram !== undefined) patch.instagram = cleanHandle(patch.instagram);
    if (patch.tiktok !== undefined) patch.tiktok = cleanHandle(patch.tiktok);
    users[i] = { ...users[i], ...patch };
    Store.saveUsers(users);
    return users[i];
  }

  function cleanHandle(v) {
    return String(v || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, '').replace(/\/$/, '');
  }

  return { hash, current, getUser, register, login, logout, updateProfile };
})();
