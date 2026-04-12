/**
 * PACCMAN - Service Worker
 * Cache-first para assets estáticos, network-first para API
 * Usa rutas relativas al scope del SW para funcionar en cualquier subdirectorio
 */

const CACHE_NAME = 'paccman-v6';

// ===== INSTALL: cachear assets estáticos =====
self.addEventListener('install', (event) => {
    // Calcular base path relativa al SW
    const swUrl = new URL(self.registration.scope);
    const base = swUrl.pathname; // ej: "/chatbot/" o "/"

    const staticAssets = [
        base,
        base + 'index.html',
        base + 'chatbot.js',
        base + 'styles.css',
        base + 'avatar.jpg',
        base + 'wallpaper.png',
        base + 'manifest.json',
        base + 'offline.html',
    ];

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Cacheando assets estáticos desde:', base);
                // Cachear cada archivo individualmente para no fallar si alguno no existe
                return Promise.allSettled(
                    staticAssets.map(url => cache.add(url).catch(err => {
                        console.warn('[SW] No se pudo cachear:', url, err.message);
                    }))
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ===== ACTIVATE: limpiar cachés antiguos =====
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log('[SW] Eliminando caché antiguo:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// ===== FETCH: estrategia de caché según tipo de petición =====
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // API calls → network-first (siempre necesitan datos frescos)
    if (url.pathname.includes('/api/')) {
        event.respondWith(networkFirst(request));
        return;
    }

    // env.js → network-first (puede cambiar la config)
    if (url.pathname.endsWith('env.js')) {
        event.respondWith(networkFirst(request));
        return;
    }

    // HTML/CSS/JS propios → network-first (para que las actualizaciones se vean inmediatamente)
    const swScope = new URL(self.registration.scope).pathname;
    if ((url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) && url.pathname.startsWith(swScope)) {
        event.respondWith(networkFirst(request));
        return;
    }

    // Navegación (F5 en la raíz) → network-first
    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
        return;
    }

    // Resto de assets estáticos (imágenes, fuentes, CDN) → cache-first (rápido)
    event.respondWith(cacheFirst(request));
});

/**
 * Cache-first: busca en caché, si no está va a la red
 */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        // Si es una navegación (HTML), mostrar página offline
        if (request.mode === 'navigate') {
            const offlinePage = await caches.match('offline.html') || await caches.match(new URL('offline.html', self.registration.scope).href);
            if (offlinePage) return offlinePage;
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * Network-first: intenta la red, si falla busca en caché
 */
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === 'navigate') {
            const offlinePage = await caches.match('offline.html') || await caches.match(new URL('offline.html', self.registration.scope).href);
            if (offlinePage) return offlinePage;
        }

        return new Response(
            JSON.stringify({ error: 'Sin conexión a internet' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
