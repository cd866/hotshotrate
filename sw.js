/* Black Ram Logistics service worker.
   Bump CACHE and the ?v= query on CSS/JS when the shell changes so old
   caches are dropped and phones pick up the new build.
   Shell files (HTML, JS, CSS, the worker) are network-first with cache:
   'no-store', so GitHub Pages' max-age=600 cannot keep a stale copy.
   data/feed.json, data/load_searches.json, data/diesel_prices.json and data/stops.json are
   network-first with a 12 s timeout, then the cached copy. */
var CACHE = 'blackram-v27';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './styles.css?v=27',
  './app.js',
  './app.js?v=27',
  './stops.js',
  './stops.js?v=27',
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
  './data/feed.json',
  './data/load_searches.json',
  './data/diesel_prices.json',
  './data/stops.json',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png'
];

function isFreshData(url) {
  return url.pathname.endsWith('/data/feed.json') || url.pathname.endsWith('/data/load_searches.json') || url.pathname.endsWith('/data/diesel_prices.json') || url.pathname.endsWith('/data/stops.json');
}

function isShell(url, req) {
  if (req && req.mode === 'navigate') return true;
  var path = url.pathname;
  if (path.endsWith('/sw.js')) return true;
  if (path.endsWith('/index.html') || /\/$/.test(path)) return true;
  if (path.endsWith('/app.js') || path.endsWith('/styles.css') || path.endsWith('/stops.js')) return true;
  if (path.endsWith('/manifest.json') || path.endsWith('/manifest.webmanifest')) return true;
  return false;
}

function pathKey(url) {
  return new Request(url.origin + url.pathname);
}

self.addEventListener('install', function (event) {
  // Same sequence as v25, which does take control: precache, then skipWaiting.
  // A 404 on one asset must not block the skip (unlike cache.addAll).
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      // An older blackram-* cache means this is an update, not a first
      // install. The install-time isUpdate flag is lost if the worker is
      // killed and relaunched before activate.
      var isUpdate = keys.some(function (key) { return key !== CACHE; });
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      })).then(function () {
        return self.clients.claim();
      }).then(function () {
        if (!isUpdate) return;
        // v25 and earlier pages never reloaded on controllerchange, so a
        // new worker has to navigate open windows itself. Later builds also
        // reload from the page; the sessionStorage guard stops a loop.
        return self.clients.matchAll({ type: 'window' }).then(function (windows) {
          return Promise.all(windows.map(function (client) {
            if (typeof client.navigate === 'function') return client.navigate(client.url);
          }));
        });
      });
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

function fromCache(req, url, isNav) {
  return caches.match(req).then(function (cached) {
    if (cached) return cached;
    return caches.match(pathKey(url)).then(function (byPath) {
      if (byPath) return byPath;
      if (isNav) return caches.match('./index.html');
      return new Response('', { status: 504 });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  if (isFreshData(url)) {
    // One cache entry per data file (ignore the ?t= cache-buster) so the
    // cache does not grow with every refresh. Give the network 12 s, then
    // fall back to the saved copy instead of hanging on a weak signal.
    var key = pathKey(url);
    event.respondWith(
      new Promise(function (resolve) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          caches.match(key).then(function (hit) {
            if (settled || !hit) return;
            settled = true;
            resolve(feedFromCache(key));
          });
        }, 12000);
        fetch(req).then(function (res) {
          if (settled) { store(key, res); return; }
          settled = true;
          clearTimeout(timer);
          resolve(store(key, res));
        }).catch(function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(feedFromCache(key));
        });
      })
    );
    return;
  }

  var shell = isShell(url, req);
  var key = shell ? pathKey(url) : req;
  var opts = shell ? { cache: 'no-store' } : undefined;
  event.respondWith(
    fetch(req, opts).then(function (res) {
      store(key, res);
      if (shell && key.url !== req.url) store(req, res);
      return res;
    }).catch(function () {
      return fromCache(key, url, req.mode === 'navigate');
    })
  );
});
