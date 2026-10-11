// Service worker: makes the game installable and lets pass-and-play run offline (FR-002, NFR-005).
// Bump VERSION whenever the shell file list changes; other files refresh in the background.
const VERSION = 'gb-v11';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/style.css',
  '/js/app.js',
  '/js/board.js',
  '/js/island.js',
  '/js/resort.js',
  '/js/harbour.js',
  '/js/models.js',
  '/js/strings.js',
  '/js/track.js',
  '/js/characters.js',
  '/js/cards.js', '/js/golf.js',
  '/shared/cards.js',
  '/js/character-meta.js',
  '/shared/config.js',
  '/shared/content.js',
  '/shared/engine.js',
  '/vendor/three/build/three.module.min.js',
  '/vendor/three/examples/jsm/geometries/RoundedBoxGeometry.js',
  '/socket.io/socket.io.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

// Character art: every expression, so tokens look right offline.
for (const id of ['redline', 'bug', 'ronin', 'moko', 'scorch', 'override', 'mort', 'talon']) {
  for (const expr of ['confident', 'angry', 'shocked', 'happy', 'sad']) SHELL.push(`/characters/${id}/${expr}.svg`);
}

// Property card landmark art.
for (const lm of ['vancouver', 'mexico', 'sao_paulo', 'rio', 'buenos_aires', 'berlin', 'munich', 'paris', 'rome', 'budapest',
  'london', 'manchester', 'birmingham', 'riyadh', 'doha', 'dubai', 'abu_dhabi', 'johannesburg', 'cape_town', 'lagos', 'abuja',
  'nairobi', 'jakarta', 'bangkok', 'kuala_lumpur', 'phuket', 'auckland', 'sydney', 'melbourne', 'delhi', 'mumbai', 'bangalore',
  'hyderabad', 'hydro', 'rail', 'refinery', 'solar', 'seaport', 'airport']) SHELL.push(`/cards/${lm}.svg`);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Live game traffic and health checks always go to the network.
  if (url.pathname.startsWith('/socket.io/') && url.pathname !== '/socket.io/socket.io.min.js') return;
  if (url.pathname === '/health') return;

  // Pages: network first so updates arrive quickly; fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/index.html', copy)); return res; })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Our own files: network first (so a refresh always picks up new versions), cache when offline.
  const ownFile = url.origin === location.origin && !url.pathname.startsWith('/vendor/');
  if (ownFile) {
    event.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req, { ignoreSearch: true })),
    );
    return;
  }

  // Three.js and Google Fonts rarely change: cached copy now, refreshed in the background.
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
