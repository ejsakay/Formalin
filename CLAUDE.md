# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

FORMALIN es un marketplace (productos y servicios) para estudiantes y negocios de la comunidad del Tecnológico Comfenalco (Cartagena). El único canal de contacto entre usuarios es el chat interno: la interfaz no muestra teléfonos, correos ni redes. Es un sitio estático con JavaScript vanilla (módulos ES, sin framework), compilado con Vite, con backend en Supabase (Postgres + Auth + Storage). Toda la interfaz y los mensajes están en español.

## Comandos

```bash
npm install
npm run dev      # http://localhost:5173/Formalin/  (la ruta base /Formalin/ es obligatoria, ver vite.config.js)
npm run build    # genera dist/
npm run preview  # sirve dist/ en http://localhost:4173/Formalin/
```

No hay linter ni suite de tests. Para comprobar un cambio:
- `npm run build` y `node --check js/<archivo>.js`.
- Si hace falta, scripts temporales con `@supabase/supabase-js` contra el proyecto real, o con `puppeteer-core` (instalado con `npm install --no-save` y usando el Edge del sistema) contra `npm run dev`. Se borran al terminar.
- En pruebas con navegador headless: usar `element.click()` vía `$eval`, porque `scroll-behavior: smooth` hace fallar los clics por coordenadas. También esperar unos 600 ms tras abrir un modal antes de escribir.

`.env` (ignorado por git) necesita `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Este último es la publishable key (`sb_publishable_…`). Nunca usar la secret / `service_role` en el cliente.

## Despliegue

Cada push a `main` ejecuta `.github/workflows/deploy.yml`: Vite compila con los secrets del repositorio `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, y publica en GitHub Pages (fuente "GitHub Actions"). URL: https://ejsakay.github.io/Formalin/.

Para hacer push de cambios en `.github/workflows/`, el token de `gh` necesita el scope `workflow`.

## Base de datos (Supabase)

- `schema.sql` describe el **estado completo** de la base: tablas, RLS, triggers, RPC y buckets.
- Cada cambio de esquema se refleja en `schema.sql` **y** en una migración nueva `migrations/NNN_descripcion.sql` para la base ya existente.
- La publishable key no puede ejecutar DDL. Las migraciones se corren en el SQL Editor de Supabase o con la Management API, usando un token personal que da el usuario y que luego borra.
- Si el cliente depende del cambio, hay que ejecutar la migración **antes** del push.

Puntos importantes del esquema:
- `profiles` se crea por el trigger `handle_new_user` a partir de `raw_user_meta_data` del `signUp`. Los campos nuevos del registro deben añadirse ahí.
- `account_type` es `'estudiante'` (con `career` y `semester`) o `'negocio'` (con `business_name` y `business_about`). El registro está abierto a cualquier correo y se confirma por email.
- `listings.search` es una columna generada `lower(f_unaccent(title || ' ' || description))`. La búsqueda hace `ilike` por término, después de normalizar el texto en el cliente (`normalize()` en `js/listings.js`).
- Las vistas se suman con la RPC `increment_views` (`security definer`), porque los visitantes no pueden hacer UPDATE.
- Hay dos relaciones entre `listings` y `profiles` (el dueño y, a través de `favorites`). Al embeber hay que usar `owner:profiles!listings_owner_id_fkey(${Auth.PROFILE_COLS})`; con `profiles(...)` sin el nombre de la FK, PostgREST da error de ambigüedad.
- Storage: buckets públicos `listing-images` (`{uid}/{listingId}/{archivo}`) y `avatars` (`{uid}/avatar.jpg`). Las políticas exigen que la primera carpeta de la ruta sea `auth.uid()`.
- **Privacidad de perfiles** (migración 004): `anon` y `authenticated` solo tienen SELECT por columnas en `profiles` (sin `email`, `phone`, `instagram`, `facebook`, `tiktok`). Por eso **nunca** se usa `select('*')` ni `profiles(*)` sobre perfiles: se usa `Auth.PROFILE_COLS`. El correo propio sale de la sesión (`session.user.email`). Las columnas de contacto siguen existiendo pero la UI ya no las escribe.
- **Chat** (migración 003): `conversations` (una por `(listing_id, buyer_id)`, con `buyer_id`/`seller_id` y copia `listing_title`/`listing_price`/`listing_cover`; `listing_id` es `on delete set null` para conservar el historial), `messages`, `message_attachments`, `user_blocks`, `conversation_reports`. Los clientes no hacen INSERT/UPDATE directos en conversaciones ni mensajes: todo pasa por las RPC `security definer` `start_conversation`, `send_message` (remitente = `auth.uid()`, valida bloqueo, longitud, `client_id` para no duplicar y que los adjuntos existan en su carpeta) y `mark_conversation_read`; `unread_counts()` cuenta no leídos. Las políticas usan `is_conversation_member()` / `chat_path_allowed()` (`security definer`) para evitar recursión de RLS.
- Bucket **privado** `chat-attachments` con rutas `{conversation_id}/{archivo}`; se lee con `createSignedUrls`. `messages` y `conversations` están en la publicación `supabase_realtime`.

## Arquitectura del cliente

Grafo de módulos: `supabase.js` ← `storage.js` / `auth.js` ← `listings.js` ← `ui.js` / `chat.js` ← `app.js`. `index.html` carga solo `js/app.js`. `auth.js` no importa `listings.js`, para evitar imports circulares.

- **`index.html`** contiene todas las vistas (`.view`: inicio, explorar, publicar, mensajes, perfil) y los modales. `app.js` las muestra u oculta. La regla `[hidden] { display: none !important; }` de `css/styles.css` hace que `hidden` funcione aunque el elemento tenga otro `display`.
- **`js/app.js`** es una IIFE con el enrutador por hash (`#/explorar?q=…`, `#/publicar`, `#/editar/:id`, `#/perfil?tab=favs`, `#/p/:id`, `#/mensajes`, `#/mensajes/:convId`, `#/contactar/:listingId`) y la lógica de todas las vistas, con delegación de eventos en `document`.
- **Caché síncrona sobre datos asíncronos.** `Auth.current()`, `Auth.getUser(id)`, `Listings.byId(id)` e `Listings.isFav(id)` son síncronas y leen de cachés en memoria, que llenan las consultas async (`Listings.query`, `fetchById`, `byOwner`, `loadFavs`). Las plantillas de `ui.js` (`cardHTML`, `openDetail`) dependen de esto.
- **`mapRow()` (`listings.js`) y `mapProfile()` (`auth.js`)** convierten las filas snake_case de Supabase a los objetos camelCase que usa la UI: `ownerId`, `category`, `createdAt` en ms, `images` como URLs públicas, `imagePaths` como rutas del bucket, `accountType`, etc.
- **Imágenes.** `compressImage()` devuelve data URLs, que van a `draft.images` mezcladas con las URLs públicas de las imágenes ya guardadas. `syncImages()` sube solo las `data:`, reconoce las existentes por su URL pública, reescribe `listing_images` con su `position` y borra del bucket las que se quitaron. Si fallan las imágenes al crear, se borra la publicación.
- **Sesión.** `Auth.init(onChange)` se suscribe a `onAuthStateChange`, pero solo avisa de cambios **externos**: enlace de confirmación, otra pestaña o sesión expirada. `login()`, `register()` y `logout()` actualizan `knownUserId` antes de que llegue el evento. Si se quita esto, el enrutador corre dos veces al iniciar sesión y borra un formulario de Publicar a medio llenar. En `app.js`, `syncSession()` recarga favoritos y la barra de navegación, y `onAuthSuccess()` gestiona los inicios de sesión hechos desde el modal.
- **Registro con confirmación de correo.** `register()` devuelve `{ needsConfirmation }`. La foto elegida se guarda en `localStorage` (`ut_pending_avatar`) y se sube en la primera sesión de ese correo.
- **Tipo de cuenta.** `setAccountType(form, type)` en `app.js` muestra u oculta los grupos `[data-for]` y pone o quita `required` en sus campos. Es necesario porque `validate()` revisa todos los `[required]`, incluso los ocultos. Se usa en el registro y en el formulario de perfil.
- **`localStorage`** solo guarda la preferencia de tema (`ut_theme`, leída también por un script inline en `<head>` para evitar parpadeo) y el avatar pendiente. Los datos viven en Supabase.
- **Chat (`js/chat.js`).** Capa de datos con cachés propias (`Chat.cached`, `Chat.unreadOf`, `Chat.isBlocked`) y un bus de eventos (`Chat.on`: `message`, `message:update`, `conversation`, `unread`, `blocks`, `resync`). `Chat.connect(userId)` abre un único canal Realtime por usuario (lo llama `syncSession()`; con `null` lo cierra al salir). Realtime confirma `SUBSCRIBED` antes de que los cambios de la base estén activos: el mensaje `system` «Subscribed to PostgreSQL» dispara `resync`, que recarga lo pendiente (también al volver a la pestaña o recuperar la red). En `app.js` los mensajes en envío viven en `chat.pending` por `client_id` hasta que llega la confirmación (por la RPC o por Realtime, lo que llegue antes). En móvil la conversación es `position: fixed` con alto `--vvh` (de `visualViewport`) para el teclado virtual.
- `friendlyError()` (`supabase.js`) traduce al español los errores de Supabase. Los errores de las capas de datos se lanzan como `Error` con mensaje listo para mostrar en `toast()`.

## Estilos

`css/styles.css` define la paleta del logo (verde esmeralda y azul) como tokens en `:root` y los redefine en `[data-theme="dark"]`. El rojo (`--red-*`) se reserva para errores, eliminar y favoritos.
