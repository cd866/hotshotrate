/* Black Ram Towing service worker.
   Bump CACHE when the shell changes so old caches are dropped.
   data/feed.json is network-first and falls back to the cached copy. */
var CACHE = 'blackram-v3';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './manifest.json?v=3',
  './manifest.webmanifest',
  './manifest.webmanifest?v=3',
  './brand/horizontal.svg',
  './brand/icon.svg',
  './brand/primary.svg',
  './favicon.ico',
  './favicon.ico?v=3',
  './icons/favicon-32.png',
  './icons/favicon-32.png?v=3',
  './icons/apple-touch-icon.png',
  './icons/apple-touch-icon.png?v=3',
  './icons/icon-192.png',
  './icons/icon-192.png?v=3',
  './icons/icon-512.png',
  './icons/icon-512.png?v=3',
  './icons/icon-192-maskable.png',
  './icons/icon-192-maskable.png?v=3',
  './icons/icon-512-maskable.png',
  './icons/icon-512-maskable.png?v=3',
  './fonts/oswald-500.woff2',
  './fonts/oswald-600.woff2',
  './fonts/oswald-700.woff2',
  './data/feed.json'
];

function isFeed(url) {
  return url.pathname.endsWith('/data/feed.json');
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function store(req, res) {
  if (!res || !res.ok) return res;
  var copy = res.clone();
  caches.open(CACHE).then(function (cache) {
    cache.put(req, copy);
  });
  return res;
}

function feedFromCache(req) {
  return caches.match(req).then(function (cached) {
    if (!cached) {
      return new Response('{"error":"offline"}', {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return cached.text().then(function (body) {
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Feed-Cache': '1'
        }
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  if (isFeed(url)) {
    event.respondWith(
      fetch(req).then(function (res) {
        return store(req, res);
      }).catch(function () {
        return feedFromCache(req);
      })
    );
    return;
  }

  event.respondWith(
    fetch(req).then(function (res) {
      return store(req, res);
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504 });
      });
    })
  );
});
