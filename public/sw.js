// Service Worker：App shell 預先快取（離線可開啟），API 一律走網路（即時資料不快取）
const VERSION = 'v0.7.7';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/manifest.webmanifest', '/icons/icon.svg', '/brand/abang-default.svg', '/brand/abang-think.svg', '/brand/abang-happy.svg',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/icons.js', '/js/registry.js',
  '/js/pages/home.js', '/js/pages/nearby.js', '/js/pages/bus.js', '/js/pages/rail.js',
  '/css/agent.css', '/js/pages/agent.js', '/js/agent/client.js', '/ui/agent/decision-graph.js', '/core/decide.js',
  '/ui/cards/cards.css', '/ui/cards/index.js', '/ui/cards/dom.js', '/ui/cards/actions.js', '/ui/cards/countdown.js', '/ui/cards/host-web.js', '/ui/cards/i18n/zh-TW.js', '/ui/cards/i18n/en.js', '/ui/cards/i18n/index.js',
  '/ui/cards/cards/bus-route.js', '/ui/cards/cards/bus-station.js', '/ui/cards/cards/nearby.js', '/ui/cards/cards/youbike.js',
  '/ui/cards/cards/metro.js', '/ui/cards/cards/timetable.js', '/ui/cards/cards/trip.js', '/ui/cards/cards/scam-risk.js',
  '/ui/cards/cards/weather.js', '/ui/cards/cards/aqi.js', '/ui/cards/cards/quake.js', '/ui/cards/cards/pharmacy.js', '/ui/cards/cards/garbage.js', '/ui/cards/cards/fuel.js', '/ui/cards/cards/invoice.js', '/ui/cards/cards/stock.js', '/ui/cards/cards/outing.js', '/ui/cards/mode-icons.js', '/ui/cards/motion.js', '/ui/cards/confetti.js', '/ui/cards/slide.js', '/ui/cards/gauge.js', '/ui/cards/bus-scene.js', '/img/scene/street.webp', '/img/scene/bus.webp', '/vendor/gsap.min.js', '/vendor/MotionPathPlugin.min.js', '/vendor/Flip.min.js', '/js/pages/service.js', '/js/invoice-wallet.js', '/js/invoice-qr.js', '/js/agent/next-steps.js', '/js/base.js', '/js/native-notify.js', '/js/edge-judge.js', '/js/keyboard.js', '/js/pages/settings.js', '/js/saved-places.js', '/js/onboarding.js', '/js/reminders.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload'：略過瀏覽器 HTTP 快取（max-age 300），避免新版本裝進舊檔
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
