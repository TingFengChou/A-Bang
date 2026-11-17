// Service Worker：App shell 預先快取（離線可開啟），API 一律走網路（即時資料不快取）
const VERSION = 'v0.3.3';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/manifest.webmanifest', '/icons/icon.svg', '/brand/abang-default.svg',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/icons.js', '/js/registry.js',
  '/js/pages/home.js', '/js/pages/nearby.js', '/js/pages/bus.js', '/js/pages/rail.js',
  '/css/agent.css', '/js/pages/agent.js', '/js/agent/client.js', '/ui/agent/decision-graph.js', '/core/decide.js',
  '/ui/cards/cards.css', '/ui/cards/index.js', '/ui/cards/dom.js', '/ui/cards/actions.js', '/ui/cards/countdown.js', '/ui/cards/host-web.js', '/ui/cards/i18n/zh-TW.js',
  '/ui/cards/cards/bus-route.js', '/ui/cards/cards/bus-station.js', '/ui/cards/cards/nearby.js', '/ui/cards/cards/youbike.js',
  '/ui/cards/cards/metro.js', '/ui/cards/cards/timetable.js', '/ui/cards/cards/trip.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // stale-while-revalidate
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
