// App shell：hash router + 上方標題列 + 下方分頁列
import { icons } from './icons.js';
import { api, state } from './api.js';
import home from './pages/home.js';
import nearby from './pages/nearby.js';
import rail from './pages/rail.js';
import { busSearch, busRoute, busStation, favPage } from './pages/bus.js';

const routes = [
  [/^\/?$/, home],
  [/^\/nearby$/, nearby],
  [/^\/bus$/, busSearch],
  [/^\/bus\/([^/]+)\/([^/]+)$/, busRoute],
  [/^\/bus-station\/([^/]+)\/([^/]+)$/, busStation],
  [/^\/rail\/(thsr|tra)$/, rail],
  [/^\/favs$/, favPage],
];
const tabs = [['#/', '首頁', 'home'], ['#/nearby', '附近', 'pin'], ['#/bus', '公車', 'bus'], ['#/favs', '收藏', 'star']];

const root = document.getElementById('app');
root.innerHTML = `
  <header class="topbar">
    <button class="icon-btn" id="back" aria-label="返回">${icons.back}</button>
    <h1 id="title"></h1>
    <button class="icon-btn" id="action" hidden></button>
  </header>
  <div id="banner"></div>
  <main id="main"></main>
  <div class="tabbar"><nav>${tabs.map(([h, n, i]) => `<a href="${h}" data-h="${h}">${icons[i]}<span>${n}</span></a>`).join('')}</nav></div>`;

const $ = (id) => document.getElementById(id);
$('back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));

let cleanups = [];
function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(var(--nav-h) + 24px);transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:12px;font-size:14px;z-index:99;max-width:85vw;text-align:center';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function navigate() {
  cleanups.forEach((f) => f()); cleanups = [];
  const [path, qs = ''] = location.hash.slice(1).split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  let page = home, params = [];
  for (const [re, p] of routes) { const m = path.match(re); if (m) { page = p; params = m.slice(1); break; } }

  $('title').textContent = page.title;
  $('back').hidden = !!page.root;
  const act = $('action'); act.hidden = true; act.onclick = null; act.classList.remove('on');
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.h === `#${path || '/'}` || (a.dataset.h === '#/' && !path)));
  const main = $('main');
  main.innerHTML = '';
  window.scrollTo(0, 0);
  page.render({
    main, params, query, toast,
    setTitle: (t) => { $('title').textContent = t; document.title = `${t}｜阿幫`; },
    setAction: (svg, fn, label, on = false) => { act.innerHTML = svg; act.onclick = fn; act.hidden = false; act.setAttribute('aria-label', label); act.classList.toggle('on', on); },
    onCleanup: (f) => cleanups.push(f),
  });
  paintBanner();
}

function paintBanner() {
  $('banner').innerHTML = state.mode === 'demo'
    ? `<div class="demo-banner">示範模式：目前為模擬資料。設定 TDX 金鑰後即顯示真實即時資訊。</div>` : '';
}

addEventListener('hashchange', navigate);
navigate();
api.status().then(() => paintBanner()).catch(() => {});

if ('serviceWorker' in navigator && !globalThis.__DEMO_SERVICES__ && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
