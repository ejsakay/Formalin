# FORMALIN · Tu aliado para crecer formalmente

Marketplace para estudiantes y negocios de la comunidad del **Tecnológico Comfenalco (Cartagena)**: publica productos o servicios con imágenes y conversa con compradores y vendedores por el **chat interno** (tiempo real, con fotos). FORMALIN no muestra teléfonos, correos ni redes sociales: el contacto es solo por el chat.

Los datos (usuarios, publicaciones, imágenes, favoritos y mensajes) viven en **Supabase**. Cualquier persona puede registrarse con su correo (se confirma por email) eligiendo el tipo de cuenta: **Estudiante** o **Negocio / emprendedor**.

## Configurar Supabase (una sola vez)
1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor → New query**, pega el contenido de `schema.sql` y ejecútalo (crea tablas, RLS, triggers, funciones del chat, la publicación de Realtime y los buckets `listing-images`, `avatars` y `chat-attachments`).
   Si tu base se creó con una versión anterior de `schema.sql`, ejecuta también las migraciones de `migrations/` en orden.
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
index.html        Vistas (Inicio, Explorar, Publicar, Mensajes, Perfil) y modales
schema.sql        Tablas, políticas RLS, triggers y buckets de Supabase (estado completo)
migrations/       Cambios para bases creadas con versiones anteriores de schema.sql
css/styles.css    Diseño (colores del logo en :root → verde y azul)
js/supabase.js    Cliente de Supabase y utilidades (URLs públicas, errores)
js/auth.js        Registro / login / perfil con Supabase Auth
js/listings.js    Publicaciones, búsqueda, favoritos e imágenes en Storage
js/ui.js          Tarjetas, modales, toasts y detalle (botón Contactar por FORMALIN)
js/chat.js        Chat: conversaciones, mensajes, fotos privadas, no leídos, Realtime, bloqueos y reportes
js/storage.js     Preferencias locales (tema claro/oscuro)
js/app.js         Rutas (#/explorar, #/publicar, #/mensajes, #/perfil…) y lógica de vistas
```

## Chat interno
- **Tablas**: `conversations` (una por publicación y comprador; guarda una copia del título, precio y portada para conservar el historial si la publicación se elimina), `messages`, `message_attachments`, `user_blocks` y `conversation_reports` (para moderación futura).
- **Seguridad**: RLS en todas las tablas. Las conversaciones y los mensajes solo se escriben con las RPC `start_conversation`, `send_message` y `mark_conversation_read` (`security definer`), que usan `auth.uid()` como remitente y validan participación, bloqueos, longitud y adjuntos. No hay conversaciones duplicadas ni con uno mismo.
- **Fotos**: bucket **privado** `chat-attachments/{conversation_id}/{archivo}` (5 MB, JPG/PNG/WEBP). Solo los participantes pueden subir y leer; se muestran con URLs firmadas de 1 hora.
- **Realtime**: `messages` y `conversations` están en la publicación `supabase_realtime`. Cada usuario abre un único canal; RLS filtra los eventos. Al reconectar o volver a la pestaña se recargan los mensajes pendientes.
- Las notificaciones son internas (contador, título de la pestaña y avisos). Push y correo quedan para una fase futura.
