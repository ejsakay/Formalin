/* Arranque, enrutador y lógica de vistas */
import { Store } from './storage.js';
import { Auth } from './auth.js';
import { Listings } from './listings.js';
import { UI } from './ui.js';
import { Chat } from './chat.js';
import { isConfigured } from './supabase.js';

(() => {
  const { $, $$, esc, icon, toast, openModal, closeModal } = UI;

  /* =========================================================
     Estado
     ========================================================= */
  const filters = { q: '', type: '', categories: [], min: '', max: '', hideSold: true, sort: 'recent' };
  const draft = { step: 1, images: [], editId: null };
  let afterLogin = null; // ruta a la que volver tras iniciar sesión

  /* =========================================================
     Enrutador por hash
     ========================================================= */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs = ''] = raw.split('?');
    const [route = '', param = ''] = path.split('/');
    return { route, param, params: new URLSearchParams(qs) };
  }

  function showView(id) {
    $$('.view').forEach((v) => (v.hidden = v.id !== id));
  }

  function setActiveNav(route) {
    $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
  }

  function requireAuth(route) {
    if (Auth.current()) return true;
    afterLogin = route;
    toast('Inicia sesión o crea tu cuenta para continuar.', 'info');
    openAuth('login');
    location.replace('#/');
    return false;
  }

  function router() {
    const { route, param, params } = parseHash();
    closeModal('detailModal');
    window.scrollTo(0, 0);
    if (route !== 'mensajes' && route !== 'contactar') {
      closeConversation();
      document.body.classList.remove('chat-mode', 'chat-open');
    }

    switch (route) {
      case 'explorar':
        showView('view-explore');
        setActiveNav('explorar');
        if (params.get('cat')) { filters.categories = [params.get('cat')]; }
        if (params.has('q')) { filters.q = params.get('q'); }
        syncFilterUI();
        renderExplore();
        break;
      case 'publicar':
      case 'editar':
        if (!requireAuth(location.hash)) return;
        showView('view-publish');
        setActiveNav('publicar');
        startPublish(route === 'editar' ? param : null);
        break;
      case 'perfil':
        if (!requireAuth(location.hash)) return;
        showView('view-profile');
        setActiveNav(params.get('tab') === 'favs' ? 'favs' : 'perfil');
        renderProfile(params.get('tab') || 'mine');
        break;
      case 'mensajes':
        if (!requireAuth(location.hash)) return;
        showView('view-messages');
        setActiveNav('mensajes');
        renderMessages(param || null);
        break;
      case 'contactar': // botón "Contactar por FORMALIN": abre o crea la conversación
        if (!requireAuth(location.hash)) return;
        startChat(param);
        break;
      case 'p': // enlace compartido a una publicación
        showView('view-home');
        setActiveNav('');
        renderHome();
        history.replaceState(null, '', '#/');
        UI.openDetail(param);
        break;
      default:
        showView('view-home');
        setActiveNav('');
        renderHome();
    }
    UI.reveal();
  }

  /* =========================================================
     Navbar / sesión
     ========================================================= */
  function renderNav() {
    const me = Auth.current();
    const box = $('#navAuth');
    $$('[data-auth-only]').forEach((el) => (el.hidden = !me));
    updateUnreadBadges();
    if (!me) {
      box.innerHTML = `
        <button class="btn btn-ghost btn-sm hide-sm" data-auth="login">Ingresar</button>
        <button class="btn btn-primary btn-sm" data-auth="register">Registrarse</button>`;
      return;
    }
    box.innerHTML = `
      <a href="#/publicar" class="btn btn-primary btn-sm hide-sm">${icon('plus')} Publicar</a>
      <div class="user-menu">
        <button class="user-chip" id="userChip" aria-haspopup="true" aria-expanded="false">${UI.avatarHTML(me, 'sm')}<span class="uname">${esc(me.name.split(' ')[0])}</span></button>
        <div class="dropdown" id="userDropdown" role="menu">
          <a href="#/perfil" role="menuitem">${icon('user')} Mi perfil</a>
          <a href="#/mensajes" role="menuitem">${icon('chat')} Mensajes <span class="unread-badge" data-unread hidden></span></a>
          <a href="#/perfil?tab=favs" role="menuitem">${icon('heart')} Favoritos</a>
          <a href="#/publicar" role="menuitem">${icon('plus')} Nueva publicación</a>
          <hr>
          <button class="danger" id="logoutBtn" role="menuitem">${icon('logout')} Cerrar sesión</button>
        </div>
      </div>`;
    updateUnreadBadges();
  }

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('#userChip');
    const dd = $('#userDropdown');
    if (chip && dd) {
      const open = dd.classList.toggle('open');
      chip.setAttribute('aria-expanded', open);
      return;
    }
    if (dd && !e.target.closest('#userDropdown')) dd.classList.remove('open');
    if (e.target.closest('#userDropdown a')) dd.classList.remove('open');

    const authBtn = e.target.closest('[data-auth]');
    if (authBtn) openAuth(authBtn.dataset.auth);

    if (e.target.closest('#logoutBtn')) {
      Auth.logout().finally(async () => {
        await syncSession();
        toast('Sesión cerrada. ¡Vuelve pronto!', 'info');
        location.hash = '#/';
        router();
      });
    }
  });

  /* =========================================================
     Autenticación (modal)
     ========================================================= */
  let pendingAvatar = '';

  function openAuth(tab = 'login') {
    switchAuthTab(tab);
    openModal('authModal');
  }

  function switchAuthTab(tab) {
    $$('#authTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#loginForm').hidden = tab !== 'login';
    $('#registerForm').hidden = tab !== 'register';
    $('#loginError').textContent = $('#registerError').textContent = '';
    $('#loginError').classList.remove('ok');
    setAccountType($('#registerForm'), 'estudiante');
  }

  // Tipo de cuenta: muestra los campos del tipo elegido y solo esos son obligatorios
  // (validate() revisa todos los [required], incluso los ocultos)
  function setAccountType(form, type) {
    type = type === 'negocio' ? 'negocio' : 'estudiante';
    form.account_type.value = type;
    $$('[data-account]', form).forEach((b) => b.classList.toggle('active', b.dataset.account === type));
    $$('[data-for]', form).forEach((group) => {
      const on = group.dataset.for === type;
      group.hidden = !on;
      $$('input, select', group).forEach((el) => {
        if (el.dataset.req === undefined) el.dataset.req = el.required ? '1' : '';
        el.required = on && el.dataset.req === '1';
        if (!on) el.classList.remove('invalid');
      });
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-account]');
    if (b) setAccountType(b.closest('form'), b.dataset.account);
  });

  $('#authTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) switchAuthTab(b.dataset.tab);
  });

  $('#rSemester').innerHTML = Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}°</option>`).join('');

  $('#rAvatar').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingAvatar = await Listings.compressImage(file, 320, 0.8);
      $('#rAvatarPreview').innerHTML = `<img src="${pendingAvatar}" alt="">`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#rPass').addEventListener('input', (e) => {
    const v = e.target.value;
    let score = 0;
    if (v.length >= 6) score++;
    if (v.length >= 10) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    const colors = ['#EF233C', '#F97316', '#EAB308', '#16A34A', '#16A34A'];
    const bar = $('#strengthBar');
    bar.style.width = `${Math.max(v ? 15 : 0, score * 25)}%`;
    bar.style.background = colors[score];
  });

  // Validación en vivo: quita el estado de error al escribir
  document.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('invalid') && e.target.checkValidity()) e.target.classList.remove('invalid');
  });

  function validate(form) {
    let ok = true;
    $$('input[required], textarea[required], select[required]', form).forEach((el) => {
      const valid = el.checkValidity() && el.value.trim() !== '';
      el.classList.toggle('invalid', !valid);
      if (!valid && ok) { el.focus(); ok = false; }
    });
    return ok;
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!validate(f)) return;
    $('#loginError').classList.remove('ok');
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const u = await Auth.login(f.email.value, f.password.value);
      await onAuthSuccess(`¡Hola de nuevo, ${u.name.split(' ')[0]}! 👋`);
      f.reset();
    } catch (err) {
      $('#loginError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!validate(f)) return;
    if (f.password.value.length < 6) {
      $('#registerError').textContent = 'La contraseña debe tener al menos 6 caracteres.';
      return;
    }
    const data = Object.fromEntries(new FormData(f));
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const { user: u, needsConfirmation } = await Auth.register({ ...data, avatar: pendingAvatar });
      f.reset();
      setAccountType(f, 'estudiante');
      pendingAvatar = '';
      $('#rAvatarPreview').innerHTML = icon('user');
      $('#strengthBar').style.width = '0';
      if (needsConfirmation) {
        // Supabase envía un enlace de confirmación; la sesión empieza al abrirlo
        switchAuthTab('login');
        $('#lEmail').value = u.email;
        $('#loginError').classList.add('ok');
        $('#loginError').textContent = `¡Listo, ${u.name.split(' ')[0]}! Te enviamos un correo a ${u.email}. Ábrelo y confirma tu cuenta para iniciar sesión.`;
        return;
      }
      await onAuthSuccess(`¡Bienvenido a FORMALIN, ${u.name.split(' ')[0]}! 🎉`);
    } catch (err) {
      $('#registerError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Recarga favoritos y navbar según el usuario con sesión
  let sessionUserId = null;
  async function syncSession() {
    sessionUserId = Auth.current()?.id || null;
    Chat.connect(sessionUserId); // abre (o cierra) el canal de tiempo real del chat
    await Listings.loadFavs();
    renderNav();
  }

  // Cambios de sesión que no vienen del modal (confirmación de correo, otra pestaña, expiración)
  async function onAuthChange() {
    if ((Auth.current()?.id || null) === sessionUserId) return;
    await syncSession();
    const { route } = parseHash();
    if (!Auth.current() && ['publicar', 'editar', 'perfil', 'mensajes', 'contactar'].includes(route)) location.hash = '#/';
    else router();
  }

  async function onAuthSuccess(msg) {
    await syncSession();
    closeModal('authModal');
    toast(msg, 'success');
    if (afterLogin) {
      const target = afterLogin;
      afterLogin = null;
      location.hash = target;
    } else {
      router();
    }
  }

  /* =========================================================
     Inicio
     ========================================================= */
  const QUICK_TAGS = ['Tutorías', 'Calculadora', 'Postres', 'Diseño', 'Portátil', 'Inglés'];

  async function renderHome() {
    $('#heroTags').innerHTML = QUICK_TAGS.map((t) => `<button type="button" data-q="${esc(t)}">${esc(t)}</button>`).join('');
    $('#featured').innerHTML = UI.skeletons(4);
    $('#latest').innerHTML = UI.skeletons(8);

    let active, popular;
    try {
      [active, popular] = await Promise.all([Listings.query({ hideSold: true }), Listings.query({ sort: 'popular', limit: 8 })]);
    } catch (err) {
      $('#featured').innerHTML = '';
      $('#latest').innerHTML = UI.emptyHTML('⚠️', 'No se pudieron cargar las publicaciones', esc(err.message));
      return;
    }

    // Estadísticas animadas
    const counts = {
      listings: active.length,
      sellers: new Set(active.map((l) => l.ownerId)).size,
      services: active.filter((l) => l.type === 'servicio').length,
    };
    $$('[data-count]').forEach((el) => UI.countUp(el, counts[el.dataset.count]));

    // Tarjetas flotantes del hero
    $('#heroVisual').innerHTML = popular.slice(0, 3).map((l) => `
      <div class="float-card" data-id="${l.id}">
        <img src="${esc(l.images[0] || '')}" alt="">
        <div><strong>${esc(l.title)}</strong><span>${l.price ? UI.money.format(l.price) : 'A convenir'}</span></div>
      </div>`).join('');

    // Categorías con conteo
    $('#catGrid').innerHTML = Listings.CATEGORIES.map((c, i) => {
      const n = active.filter((l) => l.category === c.id).length;
      return `<button class="cat-card reveal" style="transition-delay:${i * 40}ms" data-cat="${c.id}">
        <span class="cat-emoji">${c.emoji}</span><strong>${esc(c.label)}</strong><small>${n} ${n === 1 ? 'publicación' : 'publicaciones'}</small>
      </button>`;
    }).join('');

    // Carrusel y recientes
    $('#featured').innerHTML = popular.length ? popular.map((l) => UI.cardHTML(l)).join('') : UI.emptyHTML('🌱', 'Aún no hay publicaciones', 'Sé el primero en publicar algo en FORMALIN.');
    const latest = active.slice(0, 8);
    $('#latest').innerHTML = latest.length
      ? latest.map((l) => UI.cardHTML(l)).join('')
      : UI.emptyHTML('🛍️', 'El marketplace está vacío', 'Publica tu primer producto o servicio y empieza a vender.', `<a href="#/publicar" class="btn btn-primary">${icon('plus')} Publicar</a>`);
    UI.reveal();
  }

  $('#heroSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    goSearch($('#heroSearchInput').value);
  });
  $('#heroTags').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (b) goSearch(b.dataset.q);
  });
  $('#catGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    resetFilters();
    location.hash = `#/explorar?cat=${b.dataset.cat}`;
  });
  $$('[data-scroll]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = $('#featured');
      c.scrollBy({ left: Number(b.dataset.scroll) * c.clientWidth * 0.8, behavior: 'smooth' });
    })
  );

  function goSearch(q) {
    resetFilters();
    location.hash = `#/explorar?q=${encodeURIComponent(q.trim())}`;
  }

  /* =========================================================
     Explorar
     ========================================================= */
  function resetFilters() {
    Object.assign(filters, { q: '', type: '', categories: [], min: '', max: '', hideSold: true, sort: 'recent' });
  }

  function syncFilterUI() {
    $('#fQuery').value = filters.q;
    $('#fMin').value = filters.min;
    $('#fMax').value = filters.max;
    $('#fSort').value = filters.sort;
    $('#fHideSold').checked = filters.hideSold;
    $$('#fType button').forEach((b) => b.classList.toggle('active', b.dataset.v === filters.type));
    $('#fCats').innerHTML = Listings.CATEGORIES.map((c) =>
      `<button class="chip ${filters.categories.includes(c.id) ? 'active' : ''}" data-c="${c.id}">${c.emoji} ${esc(c.label)}</button>`).join('');
  }

  let exploreReq = 0; // evita que una respuesta lenta pise a una más reciente
  async function renderExplore() {
    const req = ++exploreReq;
    $('#exploreGrid').innerHTML = UI.skeletons(8);
    let res;
    try {
      res = await Listings.query(filters);
    } catch (err) {
      if (req !== exploreReq) return;
      $('#resultCount').textContent = '';
      $('#exploreGrid').innerHTML = UI.emptyHTML('⚠️', 'No se pudieron cargar las publicaciones', esc(err.message));
      return;
    }
    if (req !== exploreReq) return;
    $('#resultCount').textContent = `${res.length} ${res.length === 1 ? 'resultado' : 'resultados'}${filters.q ? ` para “${filters.q}”` : ''}`;
    $('#exploreGrid').innerHTML = res.length
      ? res.map((l) => UI.cardHTML(l)).join('')
      : UI.emptyHTML('🔍', 'No encontramos resultados', 'Prueba con otras palabras o quita algunos filtros.', `<button class="btn btn-ghost" id="emptyClear">Limpiar filtros</button>`);
  }

  let debounce;
  $('#fQuery').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { filters.q = e.target.value; renderExplore(); }, 220);
  });
  $('#fType').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    filters.type = b.dataset.v;
    $$('#fType button').forEach((x) => x.classList.toggle('active', x === b));
    renderExplore();
  });
  $('#fCats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const c = b.dataset.c;
    filters.categories = filters.categories.includes(c) ? filters.categories.filter((x) => x !== c) : [...filters.categories, c];
    b.classList.toggle('active');
    renderExplore();
  });
  ['fMin', 'fMax'].forEach((id) =>
    $('#' + id).addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { filters[id === 'fMin' ? 'min' : 'max'] = e.target.value; renderExplore(); }, 300);
    })
  );
  $('#fSort').addEventListener('change', (e) => { filters.sort = e.target.value; renderExplore(); });
  $('#fHideSold').addEventListener('change', (e) => { filters.hideSold = e.target.checked; renderExplore(); });
  const clearAll = () => {
    resetFilters();
    syncFilterUI();
    renderExplore();
    if (location.hash !== '#/explorar') history.replaceState(null, '', '#/explorar');
  };
  $('#clearFilters').addEventListener('click', clearAll);
  document.addEventListener('click', (e) => { if (e.target.closest('#emptyClear')) clearAll(); });
  $('#filterToggle').addEventListener('click', () => $('#filters').classList.toggle('open'));
  document.addEventListener('click', (e) => {
    const f = $('#filters');
    if (f.classList.contains('open') && !e.target.closest('#filters') && !e.target.closest('#filterToggle')) f.classList.remove('open');
  });

  /* =========================================================
     Interacción con tarjetas (delegada)
     ========================================================= */
  document.addEventListener('click', async (e) => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      e.stopPropagation();
      return handleFav(favBtn.dataset.fav);
    }
    const share = e.target.closest('[data-share]');
    if (share) return shareListing(share.dataset.share);

    const edit = e.target.closest('[data-edit]');
    if (edit) { location.hash = `#/editar/${edit.dataset.edit}`; return; }

    const sold = e.target.closest('[data-sold]');
    if (sold) {
      const l = Listings.byId(sold.dataset.sold);
      try {
        await Listings.update(l.id, { status: l.status === 'vendido' ? 'activo' : 'vendido' });
        toast(l.status === 'vendido' ? 'Publicación reactivada.' : 'Marcada como no disponible.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
      return renderProfile('mine');
    }

    const del = e.target.closest('[data-del]');
    if (del) {
      const ok = await UI.confirmDialog('Esta acción no se puede deshacer.', { title: '¿Eliminar publicación?', okText: 'Eliminar' });
      if (ok) {
        try {
          await Listings.remove(del.dataset.del);
          toast('Publicación eliminada.', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
        renderProfile('mine');
      }
      return;
    }

    const card = e.target.closest('.card[data-id], .float-card[data-id]');
    if (card) UI.openDetail(card.dataset.id);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.card[data-id]')) UI.openDetail(e.target.dataset.id);
    if (e.key === 'Escape') {
      const open = $$('.modal.open').pop();
      if (open) closeModal(open);
      $('#filters').classList.remove('open');
    }
  });

  async function handleFav(id) {
    if (!Auth.current()) {
      toast('Inicia sesión para guardar favoritos.', 'info');
      return openAuth('login');
    }
    let on;
    try {
      on = await Listings.toggleFav(id);
    } catch (err) {
      return toast(err.message, 'error');
    }
    toast(on ? 'Guardado en favoritos ❤️' : 'Eliminado de favoritos', on ? 'success' : 'info');
    // Actualiza todos los botones de esa publicación en pantalla
    $$(`[data-fav="${id}"]`).forEach((b) => {
      b.classList.toggle('on', on);
      const isCardBtn = b.classList.contains('fav-btn');
      b.innerHTML = isCardBtn ? icon(on ? 'heart-fill' : 'heart') : `${icon(on ? 'heart-fill' : 'heart')} ${on ? 'Guardado' : 'Guardar'}`;
    });
    if (parseHash().route === 'perfil' && !$('[data-panel="favs"]').hidden) renderProfile('favs');
  }

  async function shareListing(id) {
    const url = `${location.href.split('#')[0]}#/p/${id}`;
    const l = Listings.byId(id) || (await Listings.fetchById(id).catch(() => null));
    if (!l) return toast('Esta publicación ya no existe.', 'error');
    try {
      if (navigator.share) {
        await navigator.share({ title: l.title, text: `Mira esto en FORMALIN: ${l.title}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast('Enlace copiado al portapapeles 🔗', 'success');
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('No se pudo compartir el enlace.', 'error');
    }
  }

  // Cerrar modales con backdrop / botón
  $$('.modal').forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(m); })
  );

  /* =========================================================
     Publicar / editar (wizard por pasos)
     ========================================================= */
  const form = $('#publishForm');
  $('#pCategory').innerHTML = Listings.CATEGORIES.map((c) => `<option value="${c.id}">${c.emoji} ${esc(c.label)}</option>`).join('');

  async function startPublish(editId) {
    form.reset();
    draft.images = [];
    draft.editId = null;
    $('#publishTitle').textContent = 'Publicar';
    $('#submitPublish').innerHTML = `${icon('check')} Publicar`;

    if (editId) {
      const l = Listings.byId(editId) || (await Listings.fetchById(editId).catch(() => null));
      const me = Auth.current();
      if (!l || l.ownerId !== me.id) {
        toast('No puedes editar esta publicación.', 'error');
        location.hash = '#/perfil';
        return;
      }
      draft.editId = editId;
      draft.images = [...l.images];
      form.type.value = l.type;
      form.title.value = l.title;
      form.category.value = l.category;
      form.condition.value = l.condition || 'nuevo';
      form.price.value = l.price || '';
      form.unit.value = l.unit || '';
      form.description.value = l.description;
      $('#publishTitle').textContent = 'Editar publicación';
      $('#submitPublish').innerHTML = `${icon('check')} Guardar cambios`;
    }
    onTypeChange();
    $('#titleCount').textContent = form.title.value.length;
    renderThumbs();
    goStep(1);
  }

  function onTypeChange() {
    const isService = form.type.value === 'servicio';
    $('#unitField').hidden = !isService;
    $('#conditionField').hidden = isService;
    // Sugiere una categoría coherente al cambiar de tipo en una publicación nueva
    if (!draft.editId && !form.title.value) form.category.value = isService ? 'tutorias' : 'tecnologia';
  }
  $$('input[name="type"]', form).forEach((r) => r.addEventListener('change', onTypeChange));
  form.title.addEventListener('input', () => ($('#titleCount').textContent = form.title.value.length));

  function goStep(n) {
    draft.step = n;
    $$('.step', form).forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
    $$('#stepper li').forEach((li, i) => {
      li.classList.toggle('active', i + 1 === n);
      li.classList.toggle('done', i + 1 < n);
    });
    $('#prevStep').style.visibility = n === 1 ? 'hidden' : 'visible';
    $('#nextStep').hidden = n === 4;
    $('#submitPublish').hidden = n !== 4;
    if (n === 4) renderPreview();
  }

  function validateStep(n) {
    if (n === 2) return validate($('[data-step="2"]', form));
    if (n === 3 && !draft.images.length) {
      toast('Agrega al menos una imagen para que tu publicación destaque.', 'error');
      return false;
    }
    return true;
  }

  $('#nextStep').addEventListener('click', () => { if (validateStep(draft.step)) goStep(draft.step + 1); });
  $('#prevStep').addEventListener('click', () => goStep(Math.max(1, draft.step - 1)));
  $('#stepper').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const target = $$('#stepper li').indexOf(li) + 1;
    if (target < draft.step) return goStep(target);
    for (let s = draft.step; s < target; s++) if (!validateStep(s)) return goStep(s);
    goStep(target);
  });

  // Imágenes: selector y drag & drop
  const dz = $('#dropzone');
  $('#pImages').addEventListener('change', (e) => { addImages(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => addImages(e.dataTransfer.files));

  async function addImages(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    const room = 5 - draft.images.length;
    if (!files.length) return;
    if (room <= 0) return toast('Máximo 5 imágenes por publicación.', 'error');
    if (files.length > room) toast(`Solo se agregarán ${room} imagen(es) más (máximo 5).`, 'info');
    const batch = files.slice(0, room);
    $('#thumbs').insertAdjacentHTML('beforeend', batch.map(() => `<div class="thumb loading"><span class="spinner"></span></div>`).join(''));
    for (const f of batch) {
      try {
        draft.images.push(await Listings.compressImage(f));
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    renderThumbs();
  }

  function renderThumbs() {
    $('#thumbs').innerHTML = draft.images.map((src, i) => `
      <div class="thumb">
        <img src="${src}" alt="Imagen ${i + 1}">
        ${i === 0 ? '<span class="cover-tag">Portada</span>' : ''}
        <button type="button" data-rm="${i}" aria-label="Quitar imagen">${icon('x')}</button>
      </div>`).join('');
  }
  $('#thumbs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { draft.images.splice(Number(b.dataset.rm), 1); renderThumbs(); return; }
    // Clic en una miniatura: la convierte en portada
    const t = e.target.closest('.thumb img');
    if (t) {
      const i = $$('#thumbs .thumb img').indexOf(t);
      if (i > 0) { draft.images.unshift(...draft.images.splice(i, 1)); renderThumbs(); toast('Portada actualizada.', 'success'); }
    }
  });

  function formData() {
    return {
      type: form.type.value,
      title: form.title.value,
      category: form.category.value,
      condition: form.condition.value,
      price: form.price.value,
      unit: form.type.value === 'servicio' ? form.unit.value : '',
      description: form.description.value,
      images: draft.images,
    };
  }

  function renderPreview() {
    const me = Auth.current();
    const d = formData();
    const fake = { ...d, id: 'preview', ownerId: me.id, price: Number(d.price) || 0, status: 'activo', createdAt: Date.now() };
    $('#previewWrap').innerHTML = UI.cardHTML(fake, { owner: false }).replace(/<button class="fav-btn[\s\S]*?<\/button>/, '');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateStep(2)) return goStep(2);
    if (!validateStep(3)) return goStep(3);
    const d = formData();
    const btn = $('#submitPublish');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Guardando…`;
    try {
      if (draft.editId) {
        await Listings.update(draft.editId, {
          ...d,
          price: Math.max(0, Number(d.price) || 0),
          unit: d.type === 'servicio' ? d.unit : '',
          condition: d.type === 'producto' ? d.condition : '',
          title: d.title.trim(),
          description: d.description.trim(),
        });
        toast('Cambios guardados ✨', 'success');
      } else {
        await Listings.create(d);
        toast('¡Tu publicación ya está en FORMALIN! 🚀', 'success');
      }
      location.hash = '#/perfil';
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });

  /* =========================================================
     Perfil
     ========================================================= */
  async function renderProfile(tab = 'mine') {
    const me = Auth.current();
    if (!me) return;
    $$('#profileTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    if (tab === 'mine') $('#myGrid').innerHTML = UI.skeletons(4);
    if (tab === 'favs') $('#favGrid').innerHTML = UI.skeletons(4);

    let mine;
    try {
      mine = await Listings.byOwner(me.id);
    } catch (err) {
      toast(err.message, 'error');
      mine = [];
    }
    const views = mine.reduce((s, l) => s + (l.views || 0), 0);

    $('#profileHeader').innerHTML = `
      ${UI.avatarHTML(me, 'xxl')}
      <div>
        <h1>${esc(me.name)}</h1>
        <p>${esc(me.email)}</p>
        <div class="profile-meta">
          ${me.accountType === 'negocio'
            ? `${me.businessName ? `<span>🏪 ${esc(me.businessName)}</span>` : ''}${me.businessAbout ? `<span>${esc(me.businessAbout)}</span>` : ''}`
            : `${me.career ? `<span>🎓 ${esc(me.career)}</span>` : ''}${me.semester ? `<span>📅 ${esc(me.semester)}° semestre</span>` : ''}`}
        </div>
      </div>
      <div class="profile-stats">
        <div><strong>${mine.length}</strong><span>Publicaciones</span></div>
        <div><strong>${views}</strong><span>Vistas</span></div>
        <div><strong>${Listings.favCount()}</strong><span>Favoritos</span></div>
      </div>`;

    if (tab === 'mine') {
      $('#myGrid').innerHTML = mine.length
        ? mine.map((l) => UI.cardHTML(l, { owner: true })).join('')
        : UI.emptyHTML('📦', 'Aún no has publicado nada', 'Vende lo que ya no usas u ofrece tus habilidades a la comunidad.', `<a href="#/publicar" class="btn btn-primary">${icon('plus')} Crear publicación</a>`);
    } else if (tab === 'favs') {
      const favs = await Listings.favorites().catch((err) => { toast(err.message, 'error'); return []; });
      $('#favGrid').innerHTML = favs.length
        ? favs.map((l) => UI.cardHTML(l)).join('')
        : UI.emptyHTML('💙', 'No tienes favoritos', 'Toca el corazón en cualquier publicación para guardarla aquí.', `<a href="#/explorar" class="btn btn-primary">Explorar</a>`);
    } else {
      renderProfileForm(me);
    }
  }

  $('#profileTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const tab = b.dataset.tab;
    history.replaceState(null, '', tab === 'mine' ? '#/perfil' : `#/perfil?tab=${tab}`);
    setActiveNav(tab === 'favs' ? 'favs' : 'perfil');
    renderProfile(tab);
  });

  let profileAvatar = null;
  function renderProfileForm(me) {
    profileAvatar = null;
    const f = $('#profileForm');
    f.innerHTML = `
      <div class="avatar-pick">
        <label class="avatar-input">
          <input type="file" accept="image/*" id="pfAvatar" hidden />
          <span id="pfAvatarPreview">${UI.avatarHTML(me, 'xl')}</span>
          <span class="avatar-edit">${icon('edit')}</span>
        </label>
        <small class="hint">Toca para cambiar tu foto</small>
      </div>
      <div class="field">
        <label>Tipo de cuenta</label>
        <div class="segmented account-pick" role="group" aria-label="Tipo de cuenta">
          <button type="button" data-account="estudiante">🎓 Estudiante</button>
          <button type="button" data-account="negocio">🏪 Negocio / emprendedor</button>
        </div>
        <input type="hidden" name="account_type" />
      </div>
      <div class="field"><label for="pfName">Nombre completo</label><input id="pfName" name="name" value="${esc(me.name)}" required /></div>
      <div class="row-2" data-for="estudiante">
        <div class="field"><label for="pfCareer">Programa</label><input id="pfCareer" name="career" list="careers" value="${esc(me.career)}" required /></div>
        <div class="field"><label for="pfSem">Semestre</label><select id="pfSem" name="semester">${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${String(i + 1) === String(me.semester) ? 'selected' : ''}>${i + 1}°</option>`).join('')}</select></div>
      </div>
      <div data-for="negocio">
        <div class="field"><label for="pfBusiness">Nombre del negocio</label><input id="pfBusiness" name="business_name" value="${esc(me.businessName)}" required /></div>
        <div class="field"><label for="pfAbout">¿Qué ofreces? <small>(opcional)</small></label><input id="pfAbout" name="business_about" maxlength="120" value="${esc(me.businessAbout)}" placeholder="Ej: Papelería, fotocopias y útiles" /></div>
      </div>
      <p class="hint">Por tu seguridad, en FORMALIN no se muestran teléfonos ni redes sociales: los interesados te escriben por el chat.</p>
      <div class="form-nav"><span></span><button class="btn btn-primary" type="submit">${icon('check')} Guardar perfil</button></div>`;
    setAccountType(f, me.accountType);

    $('#pfAvatar').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        profileAvatar = await Listings.compressImage(file, 320, 0.8);
        $('#pfAvatarPreview').innerHTML = `<span class="avatar xl"><img src="${profileAvatar}" alt=""></span>`;
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!validate(f)) return;
    const data = Object.fromEntries(new FormData(f));
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await Auth.updateProfile(data, profileAvatar);
      renderNav();
      renderProfile('edit');
      toast('Perfil actualizado ✅', 'success');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  /* =========================================================
     Mensajes (chat interno)
     ========================================================= */
  const chat = { convId: null, msgs: [], pending: new Map(), hasMore: false, photos: [], search: '', loadingOlder: false, seen: new Set() };
  const timeFmt = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });
  const dayFmt = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const messagesVisible = () => !$('#view-messages').hidden;

  function shortTime(ts) {
    if (sameDay(ts, Date.now())) return timeFmt.format(ts);
    if (sameDay(ts, Date.now() - 86400000)) return 'Ayer';
    return dateFmt.format(ts);
  }
  function dayLabel(ts) {
    if (sameDay(ts, Date.now())) return 'Hoy';
    if (sameDay(ts, Date.now() - 86400000)) return 'Ayer';
    return dayFmt.format(ts);
  }

  // Contador global en la navegación y en el título de la pestaña
  const baseTitle = document.title;
  function updateUnreadBadges() {
    const n = Auth.current() ? Chat.totalUnread() : 0;
    $$('[data-unread]').forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; });
    document.title = n ? `(${n}) ${baseTitle}` : baseTitle;
  }

  async function renderMessages(convId) {
    document.body.classList.add('chat-mode');
    document.body.classList.toggle('chat-open', Boolean(convId));
    $('#chatLayout').classList.toggle('has-conv', Boolean(convId));
    if (!Chat.list().length) $('#inboxList').innerHTML = inboxSkeleton();
    else renderInbox();
    const loadInbox = reloadInbox();
    if (convId) {
      if (convId !== chat.convId || !$('#chatThread')) await openConversation(convId);
    } else {
      closeConversation();
      renderPaneEmpty();
    }
    await loadInbox;
  }

  function inboxSkeleton() {
    return Array.from({ length: 4 }, () => `<div class="inbox-item sk-item"><span class="sk sk-avatar"></span><div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div></div>`).join('');
  }

  let inboxReq = 0;
  async function reloadInbox() {
    const req = ++inboxReq;
    try {
      await Chat.inbox();
    } catch (err) {
      if (req === inboxReq) $('#inboxList').innerHTML = `<p class="inbox-empty">${esc(err.message)}</p>`;
      return;
    }
    if (req === inboxReq && messagesVisible()) renderInbox();
  }

  function renderInbox() {
    const me = Auth.current();
    if (!me) return;
    const q = Listings.normalize(chat.search.trim());
    // El vendedor no ve conversaciones vacías (el comprador abrió el chat pero aún no escribió)
    const items = Chat.list().filter((c) => c.hasMessages || !c.iAmSeller).filter((c) => {
      if (!q) return true;
      const other = Auth.getUser(c.otherId);
      return Listings.normalize(`${other?.name || ''} ${c.listing.title} ${c.preview}`).includes(q);
    });
    if (!items.length) {
      $('#inboxList').innerHTML = q
        ? `<p class="inbox-empty">No hay conversaciones que coincidan.</p>`
        : `<div class="inbox-empty"><span class="empty-emoji">💬</span><strong>Aún no tienes mensajes</strong><p>Cuando escribas a un vendedor o alguien te escriba, la conversación aparecerá aquí.</p><a href="#/explorar" class="btn btn-primary btn-sm">Explorar publicaciones</a></div>`;
      return;
    }
    $('#inboxList').innerHTML = items.map((c) => {
      const other = Auth.getUser(c.otherId);
      const n = Chat.unreadOf(c.id);
      const mine = c.lastSenderId === me.id;
      return `
        <a class="inbox-item ${c.id === chat.convId ? 'active' : ''} ${n ? 'unread' : ''}" href="#/mensajes/${c.id}" role="listitem">
          ${UI.avatarHTML(other)}
          <div class="inbox-main">
            <div class="inbox-top"><strong>${esc(other?.name || 'Usuario')}</strong><time>${c.hasMessages ? shortTime(c.lastAt) : ''}</time></div>
            <span class="inbox-listing">${c.iAmSeller ? '🏷️' : '🛍️'} ${esc(c.listing.title)}</span>
            <div class="inbox-bottom"><span class="inbox-preview">${c.hasMessages ? `${mine ? 'Tú: ' : ''}${esc(c.preview)}` : '<em>Escribe el primer mensaje</em>'}</span>${n ? `<span class="unread-badge">${n > 99 ? '99+' : n}</span>` : ''}</div>
          </div>
        </a>`;
    }).join('');
  }

  $('#inboxSearch').addEventListener('input', (e) => { chat.search = e.target.value; renderInbox(); });

  function renderPaneEmpty() {
    $('#chatPane').innerHTML = `
      <div class="chat-placeholder">
        <span class="empty-emoji">💬</span>
        <h3>Tus conversaciones</h3>
        <p>Elige una conversación para leerla. Para escribir a un vendedor, abre una publicación y pulsa <strong>Contactar por FORMALIN</strong>.</p>
      </div>`;
  }

  function closeConversation() {
    chat.convId = null;
    chat.msgs = [];
    chat.pending.clear();
    chat.photos = [];
    chat.hasMore = false;
    chat.seen.clear();
  }

  let openReq = 0;
  async function openConversation(id) {
    const req = ++openReq;
    closeConversation();
    chat.convId = id;
    $('#chatPane').innerHTML = `<div class="chat-placeholder"><span class="spinner"></span></div>`;
    try {
      const c = await Chat.get(id, { fresh: true });
      if (req !== openReq) return;
      if (!c) throw new Error('Esta conversación no existe o no tienes acceso.');
      renderPane(c);
      const page = await Chat.messages(id);
      if (req !== openReq) return;
      chat.msgs = page.messages;
      chat.hasMore = page.hasMore;
      page.messages.forEach((m) => chat.seen.add(m.clientId || m.id));
      renderThread({ toBottom: true });
      markReadIfVisible();
      renderInbox();
      if (window.matchMedia('(min-width: 721px)').matches) $('#composeText')?.focus();
    } catch (err) {
      if (req !== openReq) return;
      toast(err.message, 'error');
      location.replace('#/mensajes');
    }
  }

  function listingCardHTML(c) {
    const l = c.listing;
    const status = !l.exists ? 'Publicación eliminada' : l.status === 'vendido' ? 'No disponible' : '';
    const img = l.image ? `<img src="${esc(l.image)}" alt="">` : `<span class="chat-listing-ph">📦</span>`;
    const inner = `${img}<div><small>Publicación relacionada</small><strong>${esc(l.title)}</strong><span>${l.price ? UI.money.format(l.price) : 'A convenir'}${status ? ` · <em>${status}</em>` : ''}</span></div>${l.exists ? icon('chev-r') : ''}`;
    return l.exists
      ? `<button class="chat-listing" data-open-listing="${c.listingId}">${inner}</button>`
      : `<div class="chat-listing off">${inner}</div>`;
  }

  function renderPane(c) {
    const other = Auth.getUser(c.otherId);
    const info = UI.sellerInfo(other);
    $('#chatPane').innerHTML = `
      <header class="chat-head">
        <a href="#/mensajes" class="icon-btn chat-back" aria-label="Volver a la bandeja">${icon('arrow-l')}</a>
        ${UI.avatarHTML(other)}
        <div class="chat-who">
          <strong>${esc(other?.name || 'Usuario')}</strong>
          <small>${c.iAmSeller ? 'Interesado en tu publicación' : 'Vendedor'}${info ? ` · ${esc(info)}` : ''}</small>
        </div>
        <div class="user-menu">
          <button class="icon-btn" id="chatMenuBtn" aria-label="Opciones de la conversación" aria-haspopup="true">${icon('more')}</button>
          <div class="dropdown" id="chatMenu" role="menu"></div>
        </div>
      </header>
      ${listingCardHTML(c)}
      <div class="chat-thread" id="chatThread"></div>
      <div class="chat-bottom" id="chatBottom"></div>`;
    renderComposer();
  }

  function renderComposer() {
    const c = Chat.cached(chat.convId);
    if (!c || !$('#chatBottom')) return;
    const blocked = Chat.isBlocked(c.otherId);
    $('#chatMenu').innerHTML = `
      <button role="menuitem" data-chat-block>${icon('block')} ${blocked ? 'Desbloquear usuario' : 'Bloquear usuario'}</button>
      <button role="menuitem" class="danger" data-chat-report>${icon('flag')} Reportar conversación</button>`;
    if (blocked) {
      $('#chatBottom').innerHTML = `<div class="chat-blocked">${icon('block')} <span>Bloqueaste a este usuario. No puede escribirte.</span> <button class="link-btn" data-chat-block>Desbloquear</button></div>`;
      return;
    }
    if ($('#chatCompose')) return; // ya existe: conserva lo que se está escribiendo
    $('#chatBottom').innerHTML = `
      <div class="compose-photos" id="composePhotos" hidden></div>
      <form class="chat-compose" id="chatCompose" novalidate>
        <label class="icon-btn compose-attach" aria-label="Adjuntar fotos" title="Adjuntar fotos">
          ${icon('image')}<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden id="composeFile" />
        </label>
        <textarea id="composeText" rows="1" maxlength="${Chat.MAX_LEN}" placeholder="Escribe un mensaje…" aria-label="Mensaje" enterkeyhint="send"></textarea>
        <button class="btn btn-primary compose-send" type="submit" aria-label="Enviar">${icon('send')}</button>
      </form>
      <small class="compose-hint">Enter para enviar · Shift + Enter para nueva línea · Nunca compartas contraseñas ni datos bancarios.</small>`;
  }

  // Burbujas: mensajes confirmados + los que se están enviando
  function renderThread({ toBottom = false, keepFrom = null } = {}) {
    const box = $('#chatThread');
    if (!box) return;
    const me = Auth.current();
    const all = [...chat.msgs, ...chat.pending.values()].sort((a, b) => a.createdAt - b.createdAt);
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    let html = chat.hasMore ? `<button class="btn btn-ghost btn-sm load-older" data-load-older>${chat.loadingOlder ? '<span class="spinner"></span>' : 'Ver mensajes anteriores'}</button>` : '';
    if (!all.length) html += `<div class="chat-hello">👋 Saluda y pregunta lo que necesites sobre la publicación.</div>`;
    let prev = null;
    for (const m of all) {
      if (!prev || !sameDay(prev.createdAt, m.createdAt)) html += `<div class="day-sep"><span>${dayLabel(m.createdAt)}</span></div>`;
      html += bubbleHTML(m, m.senderId === me.id);
      prev = m;
    }
    const oldHeight = box.scrollHeight;
    box.innerHTML = html;
    if (keepFrom !== null) box.scrollTop = box.scrollHeight - oldHeight + keepFrom;
    else if (toBottom || nearBottom) box.scrollTop = box.scrollHeight;
  }

  function bubbleHTML(m, mine) {
    const key = m.clientId || m.id;
    const isNew = !chat.seen.has(key);
    chat.seen.add(key);
    const photos = m.photos.length
      ? `<div class="bubble-photos n${Math.min(m.photos.length, 3)}">${m.photos.map((p) => p.url
        ? `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="Foto adjunta" loading="lazy"></a>`
        : `<span class="photo-missing">📷</span>`).join('')}</div>`
      : '';
    let status = '';
    if (mine) {
      if (m.status === 'sending') status = `<span class="msg-status" title="Enviando">🕓</span>`;
      else if (m.status === 'error') status = `<span class="msg-status err">No se envió · <button class="link-btn" data-retry="${m.clientId}">Reintentar</button></span>`;
      else status = `<span class="msg-status ${m.readAt ? 'read' : ''}" title="${m.readAt ? 'Leído' : 'Enviado'}">${icon(m.readAt ? 'checks' : 'check')}</span>`;
    }
    return `
      <div class="bubble-row ${mine ? 'mine' : ''} ${isNew ? 'anim' : ''}" data-msg="${m.id}">
        <div class="bubble ${m.status === 'error' ? 'failed' : ''}">
          ${photos}
          ${m.content ? `<p>${esc(m.content)}</p>` : ''}
          <span class="bubble-meta">${timeFmt.format(m.createdAt)} ${status}</span>
        </div>
      </div>`;
  }

  function upsertMessage(m) {
    if (m.convId !== chat.convId) return;
    if (m.clientId) chat.pending.delete(m.clientId);
    const i = chat.msgs.findIndex((x) => x.id === m.id);
    if (i >= 0) {
      const old = chat.msgs[i];
      const photos = m.photos.length && m.photos.every((p) => p.url) ? m.photos : old.photos;
      chat.msgs[i] = { ...old, ...m, photos };
    } else {
      chat.msgs.push(m);
    }
    chat.msgs.sort((a, b) => a.createdAt - b.createdAt);
  }

  function markReadIfVisible() {
    if (chat.convId && messagesVisible() && document.visibilityState === 'visible' && Chat.unreadOf(chat.convId)) {
      Chat.markRead(chat.convId).then(renderInbox);
    }
  }

  async function sendMessage(retryId = null) {
    const convId = chat.convId;
    if (!convId) return;
    let item;
    if (retryId) {
      item = chat.pending.get(retryId);
      if (!item || item.status === 'sending') return;
      item.status = 'sending';
    } else {
      const ta = $('#composeText');
      const text = ta.value.trim();
      if (!text && !chat.photos.length) return;
      if (text.length > Chat.MAX_LEN) return toast(`Máximo ${Chat.MAX_LEN} caracteres.`, 'error');
      const clientId = crypto.randomUUID();
      item = {
        id: clientId, clientId, convId, senderId: Auth.current().id, content: text, createdAt: Date.now(), readAt: null,
        status: 'sending', dataUrls: [...chat.photos], photos: chat.photos.map((url) => ({ path: '', url })),
      };
      chat.pending.set(clientId, item);
      ta.value = '';
      autoGrow(ta);
      chat.photos = [];
      renderComposePhotos();
    }
    renderThread({ toBottom: true });
    try {
      const msg = await Chat.send(convId, { text: item.content, photos: item.dataUrls, clientId: item.clientId });
      if (chat.convId !== convId) return;
      upsertMessage(msg);
    } catch (err) {
      if (chat.convId !== convId) return;
      item.status = 'error';
      toast(err.message, 'error');
    }
    renderThread();
    renderInbox();
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }

  function renderComposePhotos() {
    const box = $('#composePhotos');
    if (!box) return;
    box.hidden = !chat.photos.length;
    box.innerHTML = chat.photos.map((src, i) => `<div class="thumb"><img src="${src}" alt="Foto ${i + 1}"><button type="button" data-rm-photo="${i}" aria-label="Quitar foto">${icon('x')}</button></div>`).join('');
  }

  async function addChatPhotos(fileList) {
    const files = [...fileList];
    const valid = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (valid.length < files.length) toast('Solo se permiten fotos JPG, PNG o WEBP.', 'error');
    const room = Chat.MAX_PHOTOS - chat.photos.length;
    if (room <= 0) return toast(`Máximo ${Chat.MAX_PHOTOS} fotos por mensaje.`, 'error');
    if (valid.length > room) toast(`Solo se agregarán ${room} foto(s) (máximo ${Chat.MAX_PHOTOS}).`, 'info');
    for (const f of valid.slice(0, room)) {
      if (f.size > 15 * 1024 * 1024) { toast('Esa foto es demasiado grande (máximo 15 MB).', 'error'); continue; }
      try {
        chat.photos.push(await Listings.compressImage(f, 1280, 0.82));
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    renderComposePhotos();
  }

  // Eventos del panel de chat (delegados)
  const pane = $('#chatPane');
  pane.addEventListener('submit', (e) => {
    if (e.target.id !== 'chatCompose') return;
    e.preventDefault();
    sendMessage();
  });
  pane.addEventListener('keydown', (e) => {
    if (e.target.id === 'composeText' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  pane.addEventListener('input', (e) => { if (e.target.id === 'composeText') autoGrow(e.target); });
  pane.addEventListener('change', (e) => {
    if (e.target.id === 'composeFile') { addChatPhotos(e.target.files); e.target.value = ''; }
  });
  pane.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm-photo]');
    if (rm) { chat.photos.splice(Number(rm.dataset.rmPhoto), 1); return renderComposePhotos(); }
    const retry = e.target.closest('[data-retry]');
    if (retry) return sendMessage(retry.dataset.retry);
    const listing = e.target.closest('[data-open-listing]');
    if (listing) return UI.openDetail(listing.dataset.openListing);
    if (e.target.closest('#chatMenuBtn')) return $('#chatMenu').classList.toggle('open');
    $('#chatMenu')?.classList.remove('open');
    if (e.target.closest('[data-chat-block]')) return toggleBlock();
    if (e.target.closest('[data-chat-report]')) return openReport();
    if (e.target.closest('[data-load-older]') && !chat.loadingOlder && chat.msgs.length) {
      const convId = chat.convId;
      chat.loadingOlder = true;
      renderThread({ keepFrom: $('#chatThread').scrollTop });
      try {
        const page = await Chat.messages(convId, { before: chat.msgs[0].createdAt });
        if (chat.convId !== convId) return;
        chat.msgs = [...page.messages, ...chat.msgs];
        page.messages.forEach((m) => chat.seen.add(m.clientId || m.id));
        chat.hasMore = page.hasMore;
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        chat.loadingOlder = false;
      }
      renderThread({ keepFrom: $('#chatThread').scrollTop });
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#chatPane')) $('#chatMenu')?.classList.remove('open');
  });

  // Botón "Contactar por FORMALIN" del detalle de una publicación
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chat]');
    if (b) location.hash = `#/contactar/${b.dataset.chat}`;
  });

  async function startChat(listingId) {
    showView('view-messages');
    setActiveNav('mensajes');
    document.body.classList.add('chat-mode', 'chat-open');
    $('#chatLayout').classList.add('has-conv');
    $('#chatPane').innerHTML = `<div class="chat-placeholder"><span class="spinner"></span></div>`;
    try {
      const id = await Chat.start(listingId);
      location.replace(`#/mensajes/${id}`);
    } catch (err) {
      toast(err.message, 'error');
      location.replace('#/mensajes');
    }
  }

  /* ---- Bloqueos y reportes ---- */
  async function toggleBlock() {
    const c = Chat.cached(chat.convId);
    if (!c) return;
    const other = Auth.getUser(c.otherId);
    const name = other ? other.name.split(' ')[0] : 'este usuario';
    try {
      if (Chat.isBlocked(c.otherId)) {
        await Chat.unblock(c.otherId);
        toast(`Desbloqueaste a ${name}.`, 'success');
      } else {
        const ok = await UI.confirmDialog(`${name} no podrá escribirte ni iniciar conversaciones contigo. Puedes desbloquearlo cuando quieras.`, { title: `¿Bloquear a ${name}?`, okText: 'Bloquear' });
        if (!ok) return;
        await Chat.block(c.otherId);
        toast(`Bloqueaste a ${name}.`, 'success');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    renderComposer();
  }

  function openReport() {
    if (!chat.convId) return;
    const f = $('#reportForm');
    f.reset();
    $('#reportReasons').innerHTML = Chat.REPORT_REASONS.map((r, i) => `<label class="chip-radio"><input type="radio" name="reason" value="${r.id}" ${i === 0 ? 'checked' : ''}><span>${esc(r.label)}</span></label>`).join('');
    f.dataset.conv = chat.convId;
    openModal('reportModal');
  }

  $('#reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await Chat.report(f.dataset.conv, f.reason.value, f.details.value);
      const c = Chat.cached(f.dataset.conv);
      if (f.block.checked && c && !Chat.isBlocked(c.otherId)) await Chat.block(c.otherId);
      closeModal('reportModal');
      toast('Gracias. Recibimos tu reporte y lo revisaremos.', 'success');
      renderComposer();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  async function openBlocked() {
    $('#blockedList').innerHTML = `<span class="spinner"></span>`;
    openModal('blockedModal');
    renderBlocked(await Chat.blockedUsers().catch(() => []));
  }
  function renderBlocked(users) {
    $('#blockedList').innerHTML = users.length
      ? users.map((u) => `<div class="blocked-item">${UI.avatarHTML(u, 'sm')}<span>${esc(u.name || 'Usuario')}</span><button class="btn btn-ghost btn-sm" data-unblock="${u.id}">Desbloquear</button></div>`).join('')
      : `<p class="hint">No has bloqueado a nadie.</p>`;
  }
  $('#blockedBtn').addEventListener('click', openBlocked);
  $('#blockedList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-unblock]');
    if (!b) return;
    b.disabled = true;
    try {
      await Chat.unblock(b.dataset.unblock);
      toast('Usuario desbloqueado.', 'success');
      renderBlocked(await Chat.blockedUsers());
      renderComposer();
    } catch (err) {
      toast(err.message, 'error');
      b.disabled = false;
    }
  });

  /* ---- Tiempo real ---- */
  Chat.on(async (type, data) => {
    if (!Auth.current()) return updateUnreadBadges();
    if (type === 'unread') {
      updateUnreadBadges();
      if (messagesVisible()) renderInbox();
    } else if (type === 'message') {
      const { msg, mine, known } = data;
      const open = msg.convId === chat.convId && messagesVisible();
      if (open) {
        upsertMessage(msg);
        renderThread();
        if (!mine) markReadIfVisible();
      } else if (!mine) {
        const c = Chat.cached(msg.convId) || (await Chat.get(msg.convId).catch(() => null));
        const other = c && Auth.getUser(c.otherId);
        toast(`Nuevo mensaje de ${other ? other.name.split(' ')[0] : 'un usuario'}${msg.content ? `: ${msg.content.slice(0, 60)}` : ' (foto)'}`, 'info');
      }
      if (messagesVisible()) (known ? renderInbox() : reloadInbox());
    } else if (type === 'message:update') {
      const m = chat.msgs.find((x) => x.id === data.id);
      if (m && m.readAt !== data.readAt) { m.readAt = data.readAt; renderThread(); }
    } else if (type === 'conversation') {
      if (messagesVisible()) (data.known ? renderInbox() : reloadInbox());
    } else if (type === 'blocks') {
      renderComposer();
    } else if (type === 'resync') {
      // Tras (re)conectar: recupera lo que haya llegado mientras tanto
      if (!messagesVisible()) return;
      reloadInbox();
      const convId = chat.convId;
      if (!convId || !$('#chatThread')) return;
      const page = await Chat.messages(convId).catch(() => null);
      if (!page || chat.convId !== convId) return;
      page.messages.forEach(upsertMessage);
      renderThread();
      markReadIfVisible();
    }
  });
  document.addEventListener('visibilitychange', markReadIfVisible);

  // Teclado virtual en móvil: el alto visible real se expone como --vvh
  if (window.visualViewport) {
    const setVvh = () => {
      const st = document.documentElement.style;
      st.setProperty('--vvh', `${window.visualViewport.height}px`);
      st.setProperty('--vvt', `${window.visualViewport.offsetTop}px`);
    };
    window.visualViewport.addEventListener('resize', setVvh);
    window.visualViewport.addEventListener('scroll', setVvh);
    setVvh();
  }

  /* =========================================================
     Tema y navbar
     ========================================================= */
  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    Store.set(Store.KEYS.theme, next);
  });

  const onScroll = () => $('#navbar').classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });

  /* =========================================================
     Inicio de la app
     ========================================================= */
  (async () => {
    if (!isConfigured) toast('La app no está conectada a Supabase. Revisa el archivo .env.', 'error');
    try {
      await Auth.init(onAuthChange);
    } catch (err) {
      console.warn('No se pudo recuperar la sesión', err);
    }
    await syncSession();
    onScroll();
    window.addEventListener('hashchange', router);
    router();
  })();
})();
