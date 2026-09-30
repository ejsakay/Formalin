/* Utilidades de interfaz: render, modales, toasts, animaciones */
const UI = (() => {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const icon = (id, cls = 'ic') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;

  const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  function priceHTML(l) {
    if (!l.price) return `<span class="price">A convenir</span>`;
    const unit = l.unit ? ` <small>/ ${esc(l.unit)}</small>` : '';
    return `<span class="price">${money.format(l.price)}${unit}</span>`;
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    const units = [[31536000, 'año', 'años'], [2592000, 'mes', 'meses'], [604800, 'semana', 'semanas'], [86400, 'día', 'días'], [3600, 'hora', 'horas'], [60, 'minuto', 'minutos']];
    for (const [sec, one, many] of units) {
      const n = Math.floor(s / sec);
      if (n >= 1) return `hace ${n} ${n === 1 ? one : many}`;
    }
    return 'justo ahora';
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }

  function avatarHTML(user, size = '') {
    const cls = `avatar ${size}`.trim();
    if (!user) return `<span class="${cls}">?</span>`;
    if (user.avatar) return `<span class="${cls}"><img src="${esc(user.avatar)}" alt="" loading="lazy"></span>`;
    return `<span class="${cls}">${esc(initials(user.name))}</span>`;
  }

  const placeholderImg =
    'data:image/svg+xml,' +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#E7EEFF"/><text x="200" y="170" font-size="64" text-anchor="middle">📦</text></svg>`);

  /* ---- Tarjeta de publicación ---- */
  function cardHTML(l, { owner = false } = {}) {
    const user = Auth.getUser(l.ownerId);
    const cat = Listings.catById(l.category);
    const fav = Listings.isFav(l.id);
    const img = l.images[0] || placeholderImg;
    return `
      <article class="card" data-id="${l.id}" tabindex="0" aria-label="${esc(l.title)}">
        <div class="card-media">
          <img src="${esc(img)}" alt="${esc(l.title)}" loading="lazy">
          <span class="badge badge-${l.type}">${l.type === 'servicio' ? 'Servicio' : 'Producto'}</span>
          ${owner ? '' : `<button class="fav-btn ${fav ? 'on' : ''}" data-fav="${l.id}" aria-label="Guardar en favoritos">${icon(fav ? 'heart-fill' : 'heart')}</button>`}
          ${l.status === 'vendido' ? `<div class="sold-overlay">${l.type === 'servicio' ? 'NO DISPONIBLE' : 'VENDIDO'}</div>` : ''}
        </div>
        <div class="card-body">
          <span class="card-cat">${cat.emoji} ${esc(cat.label)}</span>
          <h3 class="card-title">${esc(l.title)}</h3>
          ${priceHTML(l)}
          <div class="card-foot">
            ${avatarHTML(user, 'sm')}
            <span class="seller">${esc(user ? user.name.split(' ')[0] : 'Estudiante')}</span>
            <span>${timeAgo(l.createdAt)}</span>
          </div>
        </div>
        ${owner ? `
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${l.id}" aria-label="Editar">${icon('edit')}</button>
          <button class="btn btn-ghost btn-sm" data-sold="${l.id}">${icon('check')} ${l.status === 'vendido' ? 'Reactivar' : l.type === 'servicio' ? 'Pausar' : 'Vendido'}</button>
          <button class="btn btn-ghost btn-sm" data-del="${l.id}" aria-label="Eliminar">${icon('trash')}</button>
        </div>` : ''}
      </article>`;
  }

  function skeletons(n = 4) {
    return Array.from({ length: n }, () => `<div class="skeleton"><div class="sk sk-img"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div>`).join('');
  }

  function emptyHTML(emoji, title, text, action = '') {
    return `<div class="empty"><span class="empty-emoji">${emoji}</span><h3>${title}</h3><p>${text}</p>${action}</div>`;
  }

  /* ---- Toasts ---- */
  function toast(msg, type = 'info') {
    const icons = { success: '✅', error: '⚠️', info: '💬' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-ic">${icons[type] || icons.info}</span><span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      el.addEventListener('animationend', () => el.remove());
    }, 3200);
  }

  /* ---- Modales ---- */
  let lastFocus = null;
  function openModal(id) {
    const m = document.getElementById(id);
    lastFocus = document.activeElement;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const f = m.querySelector('input:not([hidden]):not([type=file]), button:not(.modal-close)');
      f && f.focus();
    }, 60);
  }
  function closeModal(id) {
    const m = typeof id === 'string' ? document.getElementById(id) : id;
    if (!m || !m.classList.contains('open')) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    if (!$('.modal.open')) document.body.style.overflow = '';
    m.dispatchEvent(new CustomEvent('modal:close'));
    lastFocus && lastFocus.focus && lastFocus.focus();
  }

  function confirmDialog(text, { title = '¿Estás seguro?', okText = 'Confirmar' } = {}) {
    return new Promise((resolve) => {
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      $('#confirmYes').textContent = okText;
      openModal('confirmModal');
      const m = $('#confirmModal');
      const done = (v) => {
        m.removeEventListener('modal:close', onClose);
        $('#confirmYes').onclick = $('#confirmNo').onclick = null;
        closeModal('confirmModal');
        resolve(v);
      };
      const onClose = () => resolve(false);
      m.addEventListener('modal:close', onClose, { once: true });
      $('#confirmYes').onclick = () => done(true);
      $('#confirmNo').onclick = () => done(false);
    });
  }

  /* ---- Enlaces de contacto ---- */
  function waNumber(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.length === 10) d = '57' + d; // número colombiano sin indicativo
    return d;
  }

  function contactHTML(user, listing) {
    if (!user) return '';
    const msg = encodeURIComponent(`¡Hola ${user.name.split(' ')[0]}! Vi tu publicación "${listing.title}" en U Tecno y me interesa 🙌`);
    const links = [];
    if (user.phone) {
      links.push(`<a class="contact-btn wa" href="https://wa.me/${waNumber(user.phone)}?text=${msg}" target="_blank" rel="noopener">${icon('whatsapp')} Escribir por WhatsApp</a>`);
      links.push(`<a class="contact-btn tel" href="tel:${esc(user.phone.replace(/\s/g, ''))}">${icon('phone')} Llamar</a>`);
    }
    if (user.instagram) links.push(`<a class="contact-btn ig" href="https://instagram.com/${encodeURIComponent(user.instagram)}" target="_blank" rel="noopener">${icon('instagram')} Instagram</a>`);
    if (user.facebook) {
      const fb = /^https?:\/\//i.test(user.facebook) ? user.facebook : `https://facebook.com/${encodeURIComponent(user.facebook)}`;
      links.push(`<a class="contact-btn fb" href="${esc(fb)}" target="_blank" rel="noopener">${icon('facebook')} Facebook</a>`);
    }
    if (user.tiktok) links.push(`<a class="contact-btn tt" href="https://tiktok.com/@${encodeURIComponent(user.tiktok)}" target="_blank" rel="noopener">${icon('tiktok')} TikTok</a>`);
    if (user.email) links.push(`<a class="contact-btn mail" href="mailto:${esc(user.email)}?subject=${encodeURIComponent('U Tecno: ' + listing.title)}">${icon('mail')} Correo</a>`);
    return `<div class="contact-grid">${links.join('')}</div>`;
  }

  /* ---- Modal de detalle ---- */
  function openDetail(id) {
    const l = Listings.byId(id);
    if (!l) return toast('Esta publicación ya no existe.', 'error');
    Listings.addView(id);
    const user = Auth.getUser(l.ownerId);
    const me = Auth.current();
    const cat = Listings.catById(l.category);
    const imgs = l.images.length ? l.images : [placeholderImg];
    const fav = Listings.isFav(l.id);
    const isMine = me && me.id === l.ownerId;

    $('#detailBody').innerHTML = `
      <div class="detail">
        <div class="gallery">
          <div class="gallery-main">
            <img id="galleryImg" src="${esc(imgs[0])}" alt="${esc(l.title)}">
            ${imgs.length > 1 ? `
              <button class="gallery-nav prev" data-g="-1" aria-label="Anterior">${icon('chev-l')}</button>
              <button class="gallery-nav next" data-g="1" aria-label="Siguiente">${icon('chev-r')}</button>` : ''}
          </div>
          ${imgs.length > 1 ? `<div class="gallery-thumbs">${imgs.map((src, i) => `<button class="${i === 0 ? 'active' : ''}" data-gi="${i}" aria-label="Imagen ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
        </div>
        <div class="detail-info">
          <div class="detail-tags">
            <span class="badge badge-${l.type}">${l.type === 'servicio' ? 'Servicio' : 'Producto'}</span>
            <span class="badge badge-producto" style="text-transform:none">${cat.emoji} ${esc(cat.label)}</span>
            ${l.condition ? `<span class="badge badge-servicio" style="text-transform:none">${l.condition === 'nuevo' ? '✨ Nuevo' : '♻️ Usado'}</span>` : ''}
            ${l.status === 'vendido' ? `<span class="badge badge-servicio">No disponible</span>` : ''}
          </div>
          <h2>${esc(l.title)}</h2>
          ${priceHTML(l)}
          <div class="meta-line"><span>${icon('eye')} ${(l.views || 0) + 1} vistas</span><span>🕒 ${timeAgo(l.createdAt)}</span></div>
          <p class="detail-desc">${esc(l.description)}</p>
          <div class="seller-card">
            ${avatarHTML(user, 'lg')}
            <div>
              <strong>${esc(user ? user.name : 'Estudiante')}</strong>
              <small>${esc(user ? [user.career, user.semester && user.semester + '° semestre'].filter(Boolean).join(' · ') : '')}</small>
            </div>
          </div>
          ${isMine ? `<a class="btn btn-ghost" href="#/editar/${l.id}" data-close-detail>${icon('edit')} Editar publicación</a>` : contactHTML(user, l)}
          <div class="detail-actions">
            ${isMine ? '' : `<button class="btn btn-ghost" data-fav="${l.id}">${icon(fav ? 'heart-fill' : 'heart')} ${fav ? 'Guardado' : 'Guardar'}</button>`}
            <button class="btn btn-ghost" data-share="${l.id}">${icon('share')} Compartir</button>
          </div>
        </div>
      </div>`;

    // Galería
    let idx = 0;
    const body = $('#detailBody');
    const show = (i) => {
      idx = (i + imgs.length) % imgs.length;
      const img = $('#galleryImg');
      img.style.animation = 'none';
      img.offsetHeight; // reinicia animación
      img.style.animation = '';
      img.src = imgs[idx];
      $$('.gallery-thumbs button', body).forEach((b, j) => b.classList.toggle('active', j === idx));
    };
    body.onclick = (e) => {
      const g = e.target.closest('[data-g]');
      const gi = e.target.closest('[data-gi]');
      if (g) show(idx + Number(g.dataset.g));
      if (gi) show(Number(gi.dataset.gi));
      if (e.target.closest('[data-close-detail]')) closeModal('detailModal');
    };
    openModal('detailModal');
  }

  /* ---- Animaciones al hacer scroll ---- */
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); } }), { threshold: 0.12 })
    : null;
  function reveal(ctx = document) {
    $$('.reveal:not(.in)', ctx).forEach((el) => {
      // Lo que ya está en pantalla se muestra sin esperar al observer
      const r = el.getBoundingClientRect();
      if (!observer || (r.top < window.innerHeight && r.bottom > 0)) requestAnimationFrame(() => el.classList.add('in'));
      else observer.observe(el);
    });
  }

  function countUp(el, to) {
    const dur = 1200;
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Efecto ripple en botones
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn');
    if (!b) return;
    const r = b.getBoundingClientRect();
    const s = Math.max(r.width, r.height);
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.appendChild(span);
    setTimeout(() => span.remove(), 600);
  });

  return { $, $$, esc, icon, money, priceHTML, timeAgo, avatarHTML, cardHTML, skeletons, emptyHTML, toast, openModal, closeModal, confirmDialog, openDetail, reveal, countUp };
})();
