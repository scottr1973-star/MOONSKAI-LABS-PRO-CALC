/* ═══════════════════════════════════════════════════════
   MOONSKAI CORE — SERVICE WORKER v5.0
   © 2026 Moonskai Labs L.L.C.

   Strategy:
   - App shell (index.html):   Network-first → cache fallback
   - CDN scripts/fonts:        Cache-first   → network fallback → cache store
   - Plugin files (.js):       Network-first → cache
   - Everything else:          Network-first → cache fallback
═══════════════════════════════════════════════════════ */

const CACHE_VERSION = 'moonskai-core-v5.1';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const CDN_CACHE     = `${CACHE_VERSION}-cdn`;
const PLUGIN_CACHE  = `${CACHE_VERSION}-plugins`;

// App shell — precached on install
const SHELL_ASSETS = [
  './index.html',
  './manifest.json',
];

// CDN assets — cached on first fetch, served from cache thereafter
const CDN_ORIGINS = [
  'cdn.tailwindcss.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── INSTALL — precache shell ──────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())  // activate immediately
      .catch(err => console.warn('[SW] Precache partial failure:', err))
  );
});

// ── ACTIVATE — clean old caches ───────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_VERSION);
  const validCaches = [SHELL_CACHE, CDN_CACHE, PLUGIN_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !validCaches.includes(k))
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())  // take control immediately
  );
});

// ── FETCH — routing logic ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // Skip chrome-extension and non-http(s) schemes
  if (!url.protocol.startsWith('http')) return;

  const isCDN    = CDN_ORIGINS.some(o => url.hostname.includes(o));
  const isShell  = url.pathname.endsWith('index.html') || url.pathname === '/' || url.pathname.endsWith('/');
  const isPlugin = url.pathname.endsWith('.js') && !isCDN;

  if (isCDN) {
    // CACHE-FIRST for CDN: fast, reliable, works offline
    event.respondWith(cacheFirst(req, CDN_CACHE));
  } else if (isShell) {
    // NETWORK-FIRST for shell: always try to get latest index.html
    event.respondWith(networkFirst(req, SHELL_CACHE));
  } else if (isPlugin) {
    // NETWORK-FIRST for plugins: get latest version if possible
    event.respondWith(networkFirst(req, PLUGIN_CACHE));
  } else {
    // DEFAULT: network-first with shell cache fallback
    event.respondWith(networkFirst(req, SHELL_CACHE));
  }
});

// ── STRATEGIES ────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Resource unavailable offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Network failed — try cache
    const cached = await caches.match(request);
    if (cached) return cached;
    // Last resort: return the cached index.html for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response(JSON.stringify({ error: 'Offline', url: request.url }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── MESSAGE HANDLER — allow pages to trigger cache clear ─────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CDN_CACHE') {
    caches.delete(CDN_CACHE).then(() => {
      event.ports[0]?.postMessage({ done: true });
    });
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }
});
