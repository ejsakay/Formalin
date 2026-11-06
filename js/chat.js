/* Chat interno: conversaciones, mensajes, fotos privadas, no leídos, Realtime, bloqueos y reportes */
import { supabase, BUCKETS, publicUrl, dataUrlToBlob, friendlyError } from './supabase.js';
import { Auth } from './auth.js';

export const Chat = (() => {
  const BUCKET = 'chat-attachments';
  const PAGE = 30; // mensajes por página
  const MAX_LEN = 2000;
  const MAX_PHOTOS = 5;
  const CONV_SELECT = '*, listing:listings(id, title, price, status, listing_images(path, position))';
  const MSG_SELECT = 'id, conversation_id, sender_id, content, client_id, created_at, read_at, message_attachments(id, storage_path, file_name, mime_type)';

  const convs = new Map(); // conversaciones del usuario, por id
  const unread = new Map(); // no leídos por conversación
  const blocked = new Set(); // ids que el usuario bloqueó
  const signed = new Map(); // ruta → { url, exp }
  const listeners = new Set();

  let userId = null;
  let channel = null;

  const emit = (type, data) => listeners.forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } });
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const fail = (error, fallback) => { if (error) throw new Error(friendlyError(error, fallback)); };

  /* ---------- Conversaciones ---------- */
  function mapConv(row) {
    const me = Auth.current()?.id;
    const l = row.listing;
    const imgs = l ? [...(l.listing_images || [])].sort((a, b) => a.position - b.position) : [];
    const c = {
      id: row.id,
      listingId: row.listing_id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      otherId: row.buyer_id === me ? row.seller_id : row.buyer_id,
      iAmSeller: row.seller_id === me,
      // Datos de la publicación: en vivo si existe, si no la copia guardada al iniciar el chat
      listing: {
        exists: Boolean(l),
        title: l ? l.title : row.listing_title,
        price: Number(l ? l.price : row.listing_price) || 0,
        status: l ? l.status : 'eliminada',
        image: imgs.length ? publicUrl(BUCKETS.listings, imgs[0].path) : '',
      },
      lastAt: Date.parse(row.last_message_at || row.created_at),
      preview: row.last_message_preview || '',
      lastSenderId: row.last_sender_id,
      hasMessages: Boolean(row.last_message_at),
    };
    convs.set(c.id, c);
    return c;
  }

  // Carga los perfiles públicos de los interlocutores que aún no están en caché
  async function loadProfiles(ids) {
    const missing = [...new Set(ids)].filter((id) => id && !Auth.getUser(id));
    if (!missing.length) return;
    const { data } = await supabase.from('profiles').select(Auth.PROFILE_COLS).in('id', missing);
    (data || []).forEach((p) => Auth.cacheProfile(p));
  }

  async function inbox() {
    const { data, error } = await supabase
      .from('conversations')
      .select(CONV_SELECT)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(200);
    fail(error, 'No se pudieron cargar tus conversaciones.');
    convs.clear();
    const list = data.map(mapConv);
    await loadProfiles(list.map((c) => c.otherId));
    return list;
  }

  async function get(id, { fresh = false } = {}) {
    if (!fresh && convs.has(id)) return convs.get(id);
    const { data, error } = await supabase.from('conversations').select(CONV_SELECT).eq('id', id).maybeSingle();
    fail(error);
    if (!data) return null;
    const c = mapConv(data);
    await loadProfiles([c.otherId]);
    return c;
  }

  const cached = (id) => convs.get(id) || null;
  const list = () => [...convs.values()].sort((a, b) => b.lastAt - a.lastAt);

  // Abre (o crea) la conversación con el dueño de una publicación
  async function start(listingId) {
    const { data, error } = await supabase.rpc('start_conversation', { p_listing: listingId });
    fail(error, 'No se pudo abrir la conversación.');
    return data;
  }

  /* ---------- Mensajes ---------- */
  function mapMsg(row) {
    return {
      id: row.id,
      convId: row.conversation_id,
      senderId: row.sender_id,
      content: row.content || '',
      clientId: row.client_id,
      createdAt: Date.parse(row.created_at),
      readAt: row.read_at ? Date.parse(row.read_at) : null,
      photos: (row.message_attachments || []).map((a) => ({ path: a.storage_path, name: a.file_name, url: '' })),
    };
  }

  // URLs firmadas (1 h) para las fotos; se reutilizan mientras no estén por vencer
  async function signPhotos(msgs) {
    const now = Date.now();
    const need = [...new Set(msgs.flatMap((m) => m.photos.map((p) => p.path)))].filter((p) => !(signed.get(p)?.exp > now + 60000));
    if (need.length) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(need, 3600);
      (data || []).forEach((d) => { if (d.signedUrl) signed.set(d.path, { url: d.signedUrl, exp: now + 3600 * 1000 }); });
    }
    msgs.forEach((m) => m.photos.forEach((p) => { p.url = signed.get(p.path)?.url || ''; }));
    return msgs;
  }

  // Página de mensajes, del más antiguo al más reciente. `before` = createdAt (ms) del primero mostrado
  async function messages(convId, { before = null, limit = PAGE } = {}) {
    let q = supabase.from('messages').select(MSG_SELECT).eq('conversation_id', convId).order('created_at', { ascending: false }).limit(limit);
    if (before) q = q.lt('created_at', new Date(before).toISOString());
    const { data, error } = await q;
    fail(error, 'No se pudieron cargar los mensajes.');
    const msgs = data.map(mapMsg).reverse();
    await signPhotos(msgs);
    return { messages: msgs, hasMore: data.length === limit };
  }

  async function fetchMessage(id) {
    const { data } = await supabase.from('messages').select(MSG_SELECT).eq('id', id).maybeSingle();
    if (!data) return null;
    const [m] = await signPhotos([mapMsg(data)]);
    return m;
  }

  function validateText(text) {
    const t = String(text || '').trim();
    if (t.length > MAX_LEN) throw new Error(`El mensaje es demasiado largo (máximo ${MAX_LEN} caracteres).`);
    return t;
  }

  // Envía texto y/o fotos (data URLs ya comprimidas). clientId evita duplicados al reintentar.
  async function send(convId, { text = '', photos = [], clientId }) {
    const content = validateText(text);
    if (!content && !photos.length) throw new Error('Escribe un mensaje o adjunta una foto.');
    if (photos.length > MAX_PHOTOS) throw new Error(`Máximo ${MAX_PHOTOS} fotos por mensaje.`);
    const uploaded = [];
    try {
      for (const dataUrl of photos) {
        const path = `${convId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, await dataUrlToBlob(dataUrl), { contentType: 'image/jpeg' });
        fail(error, 'No se pudo subir la foto.');
        uploaded.push(path);
        signed.set(path, { url: dataUrl, exp: Date.now() + 3600 * 1000 }); // vista local mientras tanto
      }
      const { data, error } = await supabase.rpc('send_message', {
        p_conv: convId,
        p_content: content,
        p_client_id: clientId,
        p_attachments: uploaded.map((path) => ({ path, name: path.split('/').pop() })),
      });
      fail(error, 'No se pudo enviar el mensaje.');
      const msg = mapMsg({ ...data, message_attachments: uploaded.map((p) => ({ storage_path: p, file_name: p.split('/').pop() })) });
      msg.photos.forEach((p) => { p.url = signed.get(p.path)?.url || ''; });
      // Las fotos locales (data URL) se sustituyen por URLs firmadas al recargar
      uploaded.forEach((p) => signed.delete(p));
      const c = convs.get(convId);
      if (c) Object.assign(c, { lastAt: msg.createdAt, preview: content || '📷 Foto', lastSenderId: msg.senderId, hasMessages: true });
      return msg;
    } catch (err) {
      if (uploaded.length) supabase.storage.from(BUCKET).remove(uploaded).catch(() => {});
      throw err;
    }
  }

  /* ---------- No leídos ---------- */
  async function refreshUnread() {
    if (!userId) { unread.clear(); emit('unread'); return; }
    const { data, error } = await supabase.rpc('unread_counts');
    if (error) return console.warn('No se pudieron contar los no leídos', error);
    unread.clear();
    (data || []).forEach((r) => unread.set(r.conversation_id, r.unread));
    emit('unread');
  }

  async function markRead(convId) {
    if (!unread.get(convId)) return;
    unread.delete(convId);
    emit('unread');
    const { error } = await supabase.rpc('mark_conversation_read', { p_conv: convId });
    if (error) console.warn('No se pudo marcar como leído', error);
  }

  const unreadOf = (convId) => unread.get(convId) || 0;
  const totalUnread = () => [...unread.values()].reduce((s, n) => s + n, 0);

  /* ---------- Realtime ---------- */
  // Un solo canal por usuario. RLS hace que solo lleguen eventos de sus conversaciones.
  // Las llamadas se encadenan para que dos syncSession() seguidas no abran canales duplicados
  let queue = Promise.resolve();
  const connect = (id) => (queue = queue.then(() => doConnect(id || null)).catch((e) => console.warn('[chat] connect', e)));

  async function doConnect(id) {
    if (userId === id && (channel || !id)) return;
    if (channel) await supabase.removeChannel(channel);
    channel = null;
    // Al cambiar de usuario (o cerrar sesión) se vacían las cachés del anterior
    if (userId && userId !== id) clearCaches();
    userId = id;
    if (!id) { emit('unread'); return; }
    await Promise.all([refreshUnread(), loadBlocks()]);
    await supabase.realtime.setAuth();
    channel = supabase
      .channel(`chat:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, onMessageInsert)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => emit('message:update', mapMsg(p.new)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, (p) => {
        if (p.new?.id) {
          const c = convs.get(p.new.id);
          if (c) Object.assign(c, { lastAt: Date.parse(p.new.last_message_at || p.new.created_at), preview: p.new.last_message_preview || '', lastSenderId: p.new.last_sender_id, hasMessages: Boolean(p.new.last_message_at) });
          emit('conversation', { id: p.new.id, known: Boolean(c) });
        }
      })
      // "Subscribed to PostgreSQL" llega después de SUBSCRIBED: desde ahí no se pierden eventos,
      // así que es el momento de ponerse al día con lo que llegó mientras tanto
      .on('system', {}, (p) => { if (p?.extension === 'postgres_changes' && p.status === 'ok') resync(); })
      .subscribe((status) => {
        emit('status', status);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[chat] Realtime:', status, '(se reintenta solo)');
      });
  }

  function clearCaches() {
    convs.clear();
    unread.clear();
    blocked.clear();
    signed.clear();
  }

  const disconnect = () => connect(null);

  async function onMessageInsert(p) {
    const row = p.new;
    if (!row?.id) return;
    // Trae el mensaje completo (con fotos): el evento no incluye los adjuntos
    const msg = (await fetchMessage(row.id)) || mapMsg(row);
    const mine = msg.senderId === userId;
    if (!mine) unread.set(msg.convId, unreadOf(msg.convId) + 1);
    const c = convs.get(msg.convId);
    if (c) Object.assign(c, { lastAt: msg.createdAt, preview: msg.content || '📷 Foto', lastSenderId: msg.senderId, hasMessages: true });
    emit('message', { msg, mine, known: Boolean(c) });
    if (!mine) emit('unread');
  }

  let resyncTimer;
  function resync() {
    clearTimeout(resyncTimer);
    resyncTimer = setTimeout(async () => {
      if (!userId) return;
      await refreshUnread();
      emit('resync');
    }, 150);
  }

  // Al volver a la pestaña o recuperar la conexión se recarga lo pendiente
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resync(); });
  window.addEventListener('online', resync);

  /* ---------- Bloqueos ---------- */
  async function loadBlocks() {
    blocked.clear();
    if (!userId) return;
    const { data } = await supabase.from('user_blocks').select('blocked_id');
    (data || []).forEach((r) => blocked.add(r.blocked_id));
  }

  const isBlocked = (id) => blocked.has(id);

  async function block(id) {
    const { error } = await supabase.from('user_blocks').insert({ blocker_id: userId, blocked_id: id });
    if (error && error.code !== '23505') fail(error, 'No se pudo bloquear al usuario.');
    blocked.add(id);
    emit('blocks');
  }

  async function unblock(id) {
    const { error } = await supabase.from('user_blocks').delete().eq('blocker_id', userId).eq('blocked_id', id);
    fail(error, 'No se pudo desbloquear al usuario.');
    blocked.delete(id);
    emit('blocks');
  }

  async function blockedUsers() {
    await loadBlocks();
    await loadProfiles([...blocked]);
    return [...blocked].map((id) => Auth.getUser(id) || { id, name: 'Usuario', avatar: '' });
  }

  /* ---------- Reportes ---------- */
  const REPORT_REASONS = [
    { id: 'spam', label: 'Spam o publicidad' },
    { id: 'acoso', label: 'Acoso u ofensas' },
    { id: 'estafa', label: 'Posible estafa' },
    { id: 'inapropiado', label: 'Contenido inapropiado' },
    { id: 'suplantacion', label: 'Suplantación de identidad' },
    { id: 'otro', label: 'Otro motivo' },
  ];

  async function report(convId, reason, details = '') {
    const c = convs.get(convId);
    const { error } = await supabase.from('conversation_reports').insert({
      conversation_id: convId,
      reporter_id: userId,
      reported_id: c ? c.otherId : null,
      reason,
      details: String(details).trim().slice(0, 1000),
    });
    fail(error, 'No se pudo enviar el reporte.');
  }

  return {
    MAX_LEN, MAX_PHOTOS, REPORT_REASONS,
    on, connect, disconnect, inbox, get, cached, list, start,
    messages, send, markRead, refreshUnread, unreadOf, totalUnread,
    isBlocked, block, unblock, blockedUsers, report,
  };
})();
