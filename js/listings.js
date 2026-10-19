/* Publicaciones: CRUD, búsqueda, favoritos e imágenes sobre Supabase */
import { supabase, BUCKETS, publicUrl, dataUrlToBlob, friendlyError } from './supabase.js';
import { Auth } from './auth.js';

export const Listings = (() => {
  const CATEGORIES = [
    { id: 'tecnologia', label: 'Tecnología', emoji: '💻' },
    { id: 'libros', label: 'Libros y útiles', emoji: '📚' },
    { id: 'comida', label: 'Comida', emoji: '🍔' },
    { id: 'ropa', label: 'Ropa y accesorios', emoji: '👕' },
    { id: 'tutorias', label: 'Tutorías', emoji: '🎓' },
    { id: 'diseno', label: 'Diseño y foto', emoji: '🎨' },
    { id: 'reparaciones', label: 'Reparaciones', emoji: '🛠️' },
    { id: 'otros', label: 'Otros', emoji: '✨' },
  ];
  const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

  const SELECT = '*, owner:profiles!listings_owner_id_fkey(*), listing_images(path, position)';
  const cache = new Map(); // publicaciones ya cargadas, por id
  const favSet = new Set(); // ids favoritos del usuario con sesión

  // Fila de Supabase → objeto que usa la interfaz
  function mapRow(row) {
    if (row.owner) Auth.cacheProfile(row.owner);
    const imgs = [...(row.listing_images || [])].sort((a, b) => a.position - b.position);
    const l = {
      id: row.id,
      ownerId: row.owner_id,
      type: row.type,
      title: row.title,
      description: row.description,
      price: Number(row.price) || 0,
      unit: row.unit || '',
      condition: row.condition || '',
      category: row.category_id,
      status: row.status,
      views: row.views || 0,
      createdAt: Date.parse(row.created_at),
      images: imgs.map((i) => publicUrl(BUCKETS.listings, i.path)),
      imagePaths: imgs.map((i) => i.path),
    };
    cache.set(l.id, l);
    return l;
  }

  function check(error, fallback) {
    if (error) throw new Error(friendlyError(error, fallback));
  }

  const byId = (id) => cache.get(id) || null;

  async function fetchById(id) {
    const { data, error } = await supabase.from('listings').select(SELECT).eq('id', id).maybeSingle();
    check(error);
    return data ? mapRow(data) : null;
  }

  async function byOwner(ownerId) {
    const { data, error } = await supabase.from('listings').select(SELECT).eq('owner_id', ownerId).order('created_at', { ascending: false });
    check(error);
    return data.map(mapRow);
  }

  // Escapa los comodines de ILIKE y los separadores de filtros de PostgREST
  const likeTerm = (t) => `%${t.replace(/[\\%_]/g, (c) => '\\' + c).replace(/[,()]/g, ' ')}%`;

  async function query({ q = '', type = '', categories = [], min = '', max = '', hideSold = true, sort = 'recent', limit = 200 } = {}) {
    let req = supabase.from('listings').select(SELECT);
    if (hideSold) req = req.eq('status', 'activo');
    if (type) req = req.eq('type', type);
    if (categories.length) req = req.in('category_id', categories);
    if (min !== '' && min !== null) req = req.gte('price', Number(min));
    if (max !== '' && max !== null) req = req.lte('price', Number(max));
    // La columna "search" ya está en minúsculas y sin tildes
    normalize(q).split(/\s+/).filter(Boolean).forEach((t) => { req = req.ilike('search', likeTerm(t)); });

    const orders = {
      recent: ['created_at', false],
      'price-asc': ['price', true],
      'price-desc': ['price', false],
      popular: ['views', false],
    };
    const [col, ascending] = orders[sort] || orders.recent;
    req = req.order(col, { ascending });
    if (col !== 'created_at') req = req.order('created_at', { ascending: false });

    const { data, error } = await req.limit(limit);
    check(error, 'No se pudieron cargar las publicaciones.');
    return data.map(mapRow);
  }

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /* ---- Imágenes en Storage ---- */
  // Sube las imágenes nuevas (data URL) y conserva las que ya estaban en el bucket
  async function syncImages(listingId, images, oldPaths = []) {
    const me = Auth.current();
    const oldByUrl = new Map(oldPaths.map((p) => [publicUrl(BUCKETS.listings, p), p]));
    const paths = [];
    const uploaded = [];
    try {
      for (const src of images) {
        if (oldByUrl.has(src)) { paths.push(oldByUrl.get(src)); continue; }
        const path = `${me.id}/${listingId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error } = await supabase.storage.from(BUCKETS.listings).upload(path, await dataUrlToBlob(src), { contentType: 'image/jpeg' });
        check(error, 'No se pudo subir una imagen.');
        uploaded.push(path);
        paths.push(path);
      }
      const { error: delErr } = await supabase.from('listing_images').delete().eq('listing_id', listingId);
      check(delErr);
      if (paths.length) {
        const { error: insErr } = await supabase.from('listing_images').insert(paths.map((path, position) => ({ listing_id: listingId, path, position })));
        check(insErr);
      }
    } catch (err) {
      if (uploaded.length) await supabase.storage.from(BUCKETS.listings).remove(uploaded);
      throw err;
    }
    const removed = oldPaths.filter((p) => !paths.includes(p));
    if (removed.length) await supabase.storage.from(BUCKETS.listings).remove(removed);
  }

  function toRow(data) {
    return {
      type: data.type,
      title: data.title.trim(),
      description: data.description.trim(),
      price: Math.max(0, Number(data.price) || 0),
      unit: data.type === 'servicio' ? data.unit || '' : '',
      condition: data.type === 'producto' ? data.condition || '' : '',
      category_id: data.category,
    };
  }

  /* ---- CRUD ---- */
  async function create(data) {
    const me = Auth.current();
    if (!me) throw new Error('Debes iniciar sesión.');
    const { data: row, error } = await supabase.from('listings').insert({ ...toRow(data), owner_id: me.id }).select('id').single();
    check(error, 'No se pudo crear la publicación.');
    try {
      await syncImages(row.id, data.images || []);
    } catch (err) {
      // No dejar una publicación a medias si fallan las imágenes
      await supabase.from('listings').delete().eq('id', row.id);
      throw err;
    }
    return fetchById(row.id);
  }

  async function update(id, patch) {
    const me = Auth.current();
    const current = byId(id) || (await fetchById(id));
    if (!current) throw new Error('Publicación no encontrada.');
    if (!me || current.ownerId !== me.id) throw new Error('No tienes permiso para editar esto.');

    const row = {};
    if (patch.title !== undefined) Object.assign(row, toRow({ ...current, ...patch }));
    if (patch.status !== undefined) row.status = patch.status;
    if (Object.keys(row).length) {
      const { error } = await supabase.from('listings').update(row).eq('id', id);
      check(error, 'No se pudieron guardar los cambios.');
    }
    if (patch.images) await syncImages(id, patch.images, current.imagePaths);
    return fetchById(id);
  }

  async function remove(id) {
    const me = Auth.current();
    const l = byId(id) || (await fetchById(id));
    if (!me || !l || l.ownerId !== me.id) throw new Error('No tienes permiso para eliminar esto.');
    const { error } = await supabase.from('listings').delete().eq('id', id);
    check(error, 'No se pudo eliminar la publicación.');
    if (l.imagePaths.length) await supabase.storage.from(BUCKETS.listings).remove(l.imagePaths);
    cache.delete(id);
    favSet.delete(id);
  }

  function addView(id) {
    const l = byId(id);
    if (l) l.views += 1;
    supabase.rpc('increment_views', { listing_id: id }).then(({ error }) => error && console.warn('increment_views', error));
  }

  /* ---- Favoritos ---- */
  async function loadFavs() {
    favSet.clear();
    const me = Auth.current();
    if (!me) return;
    const { data, error } = await supabase.from('favorites').select('listing_id');
    if (error) return console.warn('No se pudieron cargar los favoritos', error);
    data.forEach((f) => favSet.add(f.listing_id));
  }

  const isFav = (id) => favSet.has(id);
  const favCount = () => favSet.size;

  async function toggleFav(id) {
    const me = Auth.current();
    if (!me) throw new Error('AUTH');
    const on = !favSet.has(id);
    on ? favSet.add(id) : favSet.delete(id); // respuesta inmediata en la interfaz
    const { error } = on
      ? await supabase.from('favorites').insert({ user_id: me.id, listing_id: id })
      : await supabase.from('favorites').delete().eq('user_id', me.id).eq('listing_id', id);
    if (error) {
      on ? favSet.delete(id) : favSet.add(id);
      throw new Error(friendlyError(error, 'No se pudo actualizar tus favoritos.'));
    }
    return on;
  }

  async function favorites() {
    if (!favSet.size) return [];
    const { data, error } = await supabase.from('listings').select(SELECT).in('id', [...favSet]).order('created_at', { ascending: false });
    check(error);
    return data.map(mapRow);
  }

  /* ---- Imágenes: redimensiona y comprime con canvas ---- */
  function compressImage(file, maxSize = 1000, quality = 0.75) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) return reject(new Error('El archivo no es una imagen.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Formato de imagen no soportado.'));
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  return { CATEGORIES, catById, byId, fetchById, byOwner, create, update, remove, addView, query, loadFavs, isFav, favCount, toggleFav, favorites, compressImage };
})();
