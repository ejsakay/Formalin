# FORMALIN · Tu aliado para crecer formalmente

Marketplace para estudiantes del **Tecnológico Comfenalco (Cartagena)**: publica productos o servicios con imágenes y deja tu WhatsApp y redes para que te contacten.

Los datos (usuarios, publicaciones, imágenes y favoritos) viven en **Supabase**. Solo se pueden registrar correos `@comfenalco.edu.co` o `@tecnologicocomfenalco.edu.co`.

## Configurar Supabase (una sola vez)
1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor → New query**, pega el contenido de `schema.sql` y ejecútalo (crea tablas, RLS, triggers y los buckets `listing-images` y `avatars`).
3. En **Authentication → URL Configuration**:
   - Site URL: `https://ejsakay.github.io/Formalin/`
   - Redirect URLs: añade `http://localhost:5173/Formalin/`
4. Copia `.env.example` como `.env` y completa los valores de **Project Settings → API** (`Project URL` y `anon public key`).

## Desarrollo local
```bash
npm install
npm run dev      # http://localhost:5173/Formalin/
npm run build    # genera dist/
```

## Despliegue
Cada push a `main` ejecuta `.github/workflows/deploy.yml`, que compila con Vite y publica en GitHub Pages.
El repositorio necesita los secrets `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions) y Pages configurado con la fuente **GitHub Actions**.

## Estructura
```
index.html        Vistas (Inicio, Explorar, Publicar, Perfil) y modales
schema.sql        Tablas, políticas RLS, triggers y buckets de Supabase
css/styles.css    Diseño (colores del logo en :root → verde y azul)
js/supabase.js    Cliente de Supabase y utilidades (URLs públicas, errores)
js/auth.js        Registro / login / perfil con Supabase Auth
js/listings.js    Publicaciones, búsqueda, favoritos e imágenes en Storage
js/ui.js          Tarjetas, modales, toasts, detalle y contacto
js/storage.js     Preferencias locales (tema claro/oscuro)
js/app.js         Rutas (#/explorar, #/publicar, #/perfil…) y lógica de vistas
```
