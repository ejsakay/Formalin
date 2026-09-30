/* Publicaciones: CRUD, búsqueda, favoritos e imágenes */
const Listings = (() => {
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

  const all = () => Store.listings();
  const byId = (id) => all().find((l) => l.id === id) || null;
  const byOwner = (ownerId) => all().filter((l) => l.ownerId === ownerId).sort((a, b) => b.createdAt - a.createdAt);

  function create(data) {
    const me = Auth.current();
    if (!me) throw new Error('Debes iniciar sesión.');
    const listing = {
      id: Store.uid(),
      ownerId: me.id,
      type: data.type,
      title: data.title.trim(),
      description: data.description.trim(),
      price: Math.max(0, Number(data.price) || 0),
      unit: data.type === 'servicio' ? data.unit || '' : '',
      condition: data.type === 'producto' ? data.condition || '' : '',
      category: data.category,
      images: data.images || [],
      status: 'activo',
      views: 0,
      createdAt: Date.now(),
    };
    const list = all();
    list.unshift(listing);
    Store.saveListings(list);
    return listing;
  }

  function update(id, patch) {
    const list = all();
    const i = list.findIndex((l) => l.id === id);
    if (i < 0) throw new Error('Publicación no encontrada.');
    const me = Auth.current();
    if (!me || list[i].ownerId !== me.id) throw new Error('No tienes permiso para editar esto.');
    list[i] = { ...list[i], ...patch, id, ownerId: list[i].ownerId };
    Store.saveListings(list);
    return list[i];
  }

  function remove(id) {
    const me = Auth.current();
    const l = byId(id);
    if (!me || !l || l.ownerId !== me.id) throw new Error('No tienes permiso para eliminar esto.');
    Store.saveListings(all().filter((x) => x.id !== id));
  }

  function addView(id) {
    const list = all();
    const l = list.find((x) => x.id === id);
    if (!l) return;
    l.views = (l.views || 0) + 1;
    try { Store.saveListings(list); } catch (e) { /* ignorar */ }
  }

  function query({ q = '', type = '', categories = [], min = '', max = '', hideSold = true, sort = 'recent' } = {}) {
    const terms = normalize(q).split(/\s+/).filter(Boolean);
    let res = all().filter((l) => {
      if (hideSold && l.status === 'vendido') return false;
      if (type && l.type !== type) return false;
      if (categories.length && !categories.includes(l.category)) return false;
      if (min !== '' && l.price < Number(min)) return false;
      if (max !== '' && l.price > Number(max)) return false;
      if (terms.length) {
        const owner = Auth.getUser(l.ownerId);
        const hay = normalize([l.title, l.description, catById(l.category).label, owner && owner.name, owner && owner.career].join(' '));
        return terms.every((t) => hay.includes(t));
      }
      return true;
    });
    const sorters = {
      recent: (a, b) => b.createdAt - a.createdAt,
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      popular: (a, b) => (b.views || 0) - (a.views || 0),
    };
    return res.sort(sorters[sort] || sorters.recent);
  }

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /* ---- Favoritos ---- */
  function favIds() {
    const me = Auth.current();
    return me ? Store.favs()[me.id] || [] : [];
  }
  const isFav = (id) => favIds().includes(id);
  function toggleFav(id) {
    const me = Auth.current();
    if (!me) throw new Error('AUTH');
    const favs = Store.favs();
    const mine = new Set(favs[me.id] || []);
    mine.has(id) ? mine.delete(id) : mine.add(id);
    favs[me.id] = [...mine];
    Store.saveFavs(favs);
    return mine.has(id);
  }
  const favorites = () => favIds().map(byId).filter(Boolean);

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

  return { CATEGORIES, catById, all, byId, byOwner, create, update, remove, addView, query, isFav, toggleFav, favorites, compressImage };
})();
