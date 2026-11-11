/* Offline support: the app shell is cached at install; the screenshot reader (~11 MB) is cached the first time it is used.
   Only same-origin GETs are handled. Requests to GitHub are never touched. */
const BUILD = '20261111124140'; const CORE = 'bt-core-' + BUILD; const RUN = 'bt-run';
const SHELL = ["./","core/util.js","core/categories.js","core/parse.js","core/csv.js","core/ledger.js","core/analytics.js","core/ocr.js","core/seal.js","web/css/app.css","web/js/ui.js","web/js/charts.js","web/js/app.js","web/js/views-home.js","web/js/views-add.js","web/js/views-txns.js","web/js/views-insights.js","web/js/views-settings.js","web/vendor/ocr/tesseract.min.js","index.html","backend-phone.js","gate.js","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CORE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('bt-core-') && k !== CORE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return; const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('index.html'))); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => { if (res.ok && /vendor\/ocr\//.test(url.pathname)) { const copy = res.clone(); caches.open(RUN).then((c) => c.put(req, copy)); } return res; })));
});
