# FORMALIN · Tu aliado para crecer formalmente

Marketplace para estudiantes del **Tecnológico Comfenalco (Cartagena)**: publica productos o servicios con imágenes y deja tu WhatsApp y redes para que te contacten.

## Cómo abrirlo
- Doble clic en `index.html`, **o**
- Servidor local: `python -m http.server 5500` y abre http://localhost:5500

Cuenta demo: `demo@tecnologicocomfenalco.edu.co` / `demo123`

## Estructura
```
index.html        Vistas (Inicio, Explorar, Publicar, Perfil) y modales
css/styles.css    Diseño (colores en :root → azul, blanco y rojo)
js/storage.js     Acceso a localStorage
js/auth.js        Registro / login / perfil
js/listings.js    Publicaciones, búsqueda, favoritos, compresión de imágenes
js/ui.js          Tarjetas, modales, toasts, detalle y contacto
js/seed.js        Datos de ejemplo (se cargan una sola vez)
js/app.js         Rutas (#/explorar, #/publicar, #/perfil…) y lógica de vistas
```

## Importante
Los datos se guardan en **localStorage**: solo existen en el navegador donde se crean (límite aprox. 5 MB; las imágenes se comprimen automáticamente).
Para que todos los estudiantes vean las mismas publicaciones hace falta un backend (p. ej. Firebase).
Para reiniciar los datos de ejemplo: en la consola del navegador ejecuta `localStorage.clear()` y recarga.
