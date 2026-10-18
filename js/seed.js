/* Datos de demostración (solo se cargan si no hay datos guardados) */
const Seed = (() => {
  // Portada ilustrada en SVG (funciona sin internet)
  function cover(emoji, c1, c2, variant = 0) {
    const shapes = [
      `<circle cx="650" cy="110" r="170" fill="#fff" opacity=".12"/><circle cx="120" cy="520" r="200" fill="#fff" opacity=".08"/>`,
      `<rect x="520" y="-60" width="360" height="360" rx="80" fill="#fff" opacity=".1" transform="rotate(20 700 120)"/><circle cx="90" cy="90" r="120" fill="#fff" opacity=".1"/>`,
      `<circle cx="400" cy="300" r="250" fill="#fff" opacity=".08"/><circle cx="400" cy="300" r="170" fill="#fff" opacity=".08"/>`,
    ][variant % 3];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      <filter id="s"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-opacity=".3"/></filter></defs>
      <rect width="800" height="600" fill="url(#g)"/>${shapes}
      <text x="400" y="375" font-size="230" text-anchor="middle" filter="url(#s)">${emoji}</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  const B = '#1E4FD8', DB = '#0A2463', R = '#EF233C', P = '#5B3FE0', T = '#0EA5E9', O = '#F97316', G = '#10B981';
  const DAY = 86400000;

  async function run() {
    if (Store.get('ut_seeded', false)) return;
    const pass = await Auth.hash('demo123');
    const users = [
      { id: 'u_demo', name: 'Demo Estudiante', email: 'demo@tecnologicocomfenalco.edu.co', career: 'Ingeniería de Sistemas', semester: '5', phone: '3001234567', instagram: 'utecno', facebook: '', tiktok: '' },
      { id: 'u_vale', name: 'Valentina Ríos', email: 'valentina.rios@tecnologicocomfenalco.edu.co', career: 'Ingeniería de Sistemas', semester: '7', phone: '3014567890', instagram: 'vale.codes', facebook: '', tiktok: 'valecodes' },
      { id: 'u_andres', name: 'Andrés Castillo', email: 'andres.castillo@tecnologicocomfenalco.edu.co', career: 'Administración de Empresas', semester: '4', phone: '3157894561', instagram: '', facebook: 'andres.castillo', tiktok: '' },
      { id: 'u_camila', name: 'Camila Herrera', email: 'camila.herrera@tecnologicocomfenalco.edu.co', career: 'Ingeniería Industrial', semester: '3', phone: '3209876543', instagram: 'cami.postres', facebook: '', tiktok: 'camipostres' },
      { id: 'u_sebas', name: 'Sebastián Mora', email: 'sebastian.mora@tecnologicocomfenalco.edu.co', career: 'Tecnología en Desarrollo de Software', semester: '6', phone: '3126549870', instagram: 'sebas.shots', facebook: '', tiktok: '' },
    ].map((u) => ({ ...u, passHash: pass, avatar: '', createdAt: Date.now() - 30 * DAY }));

    const now = Date.now();
    const L = (o, i) => ({ status: 'activo', unit: '', condition: '', views: 0, ...o, id: 'seed_' + i, createdAt: now - o.ago });
    const listings = [
      { ownerId: 'u_vale', type: 'servicio', title: 'Tutorías de Cálculo I y II', category: 'tutorias', price: 25000, unit: 'hora', images: [cover('📐', B, P, 0), cover('🧠', P, R, 1)], views: 58, ago: 2 * 3600e3,
        description: 'Te ayudo a preparar parciales de cálculo diferencial e integral. Explicaciones claras, ejercicios tipo examen y material de apoyo.\n\nHorarios: lunes a jueves en la tarde, en biblioteca o virtual por Meet.' },
      { ownerId: 'u_andres', type: 'producto', title: 'Calculadora Casio fx-991LA Plus', category: 'tecnologia', price: 65000, condition: 'usado', images: [cover('🧮', DB, B, 1)], views: 41, ago: 5 * 3600e3,
        description: 'En perfecto estado, con tapa protectora. Ideal para cálculo, física y estadística. Entrego en la sede principal.' },
      { ownerId: 'u_camila', type: 'producto', title: 'Brownies y cheesecake caseros 🍫', category: 'comida', price: 5000, condition: 'nuevo', images: [cover('🍰', R, O, 2), cover('🍫', O, R, 0)], views: 93, ago: 1 * DAY,
        description: 'Postres hechos en casa cada mañana. Brownie con arequipe, cheesecake de maracuyá y galletas. Pedidos por WhatsApp antes de las 9 a.m. y te lo entrego en la cafetería.' },
      { ownerId: 'u_sebas', type: 'servicio', title: 'Diseño de logos y piezas para redes', category: 'diseno', price: 40000, unit: 'proyecto', images: [cover('🎨', P, R, 1)], views: 36, ago: 2 * DAY,
        description: 'Diseño identidad visual para emprendimientos: logo, paleta de colores y 5 plantillas para Instagram. Entrega en 3 días hábiles.' },
      { ownerId: 'u_vale', type: 'servicio', title: 'Formateo y mantenimiento de laptops', category: 'reparaciones', price: 50000, images: [cover('🛠️', DB, T, 2)], views: 27, ago: 3 * DAY,
        description: 'Formateo con Windows/Linux, instalación de programas para la carrera, limpieza interna y cambio de pasta térmica. Diagnóstico gratis.' },
      { ownerId: 'u_andres', type: 'producto', title: 'Libro "Fundamentos de Administración"', category: 'libros', price: 30000, condition: 'usado', images: [cover('📚', B, T, 0)], views: 15, ago: 4 * DAY,
        description: 'Edición reciente, sin rayones ni hojas sueltas. Lo usamos en primer semestre de Administración.' },
      { ownerId: 'u_demo', type: 'producto', title: 'Hoodie FORMALIN edición campus', category: 'ropa', price: 45000, condition: 'nuevo', images: [cover('👕', DB, R, 1)], views: 64, ago: 5 * DAY,
        description: 'Hoodie azul con logo bordado. Tallas S, M y L disponibles. Tela perchada, súper cómodo para las clases con aire acondicionado 😅' },
      { ownerId: 'u_camila', type: 'servicio', title: 'Clases de inglés conversacional', category: 'tutorias', price: 20000, unit: 'sesión', images: [cover('🗣️', T, B, 2)], views: 22, ago: 6 * DAY,
        description: 'Sesiones de 1 hora para mejorar tu speaking. Nivel B2 certificado. Grupos de máximo 3 personas.' },
      { ownerId: 'u_sebas', type: 'producto', title: 'Audífonos Bluetooth con cancelación de ruido', category: 'tecnologia', price: 80000, condition: 'usado', images: [cover('🎧', DB, P, 0)], views: 49, ago: 7 * DAY,
        description: 'Batería de 30 horas, incluye estuche y cable USB-C. Poco uso.' },
      { ownerId: 'u_sebas', type: 'servicio', title: 'Fotografía para grados y eventos', category: 'diseno', price: 0, images: [cover('📸', R, P, 2)], views: 31, ago: 9 * DAY,
        description: 'Sesiones de fotos para grados, cumpleaños y eventos universitarios. Precio según duración, ¡escríbeme y cotizamos!' },
      { ownerId: 'u_demo', type: 'producto', title: 'Kit de marcadores y cuadernos', category: 'libros', price: 18000, condition: 'nuevo', images: [cover('✏️', G, T, 1)], views: 12, ago: 10 * DAY,
        description: 'Set de 12 marcadores punta fina + 2 cuadernos cuadriculados. Perfecto para tomar apuntes bonitos.' },
      { ownerId: 'u_andres', type: 'servicio', title: 'Asesoría para plan de negocios', category: 'otros', price: 35000, unit: 'sesión', images: [cover('📈', G, B, 0)], views: 19, ago: 12 * DAY,
        description: 'Te ayudo a estructurar tu plan de negocios, lienzo Canvas y proyecciones financieras básicas para tus proyectos de clase.' },
    ].map(L);

    Store.saveUsers([...Store.users(), ...users]);
    Store.saveListings([...Store.listings(), ...listings]);
    Store.set('ut_seeded', true);
  }

  return { run };
})();
