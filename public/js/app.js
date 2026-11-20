// App shell：hash router + 上方標題列 + 下方分頁列
import { icons } from './icons.js';
import { api, state } from './api.js';
import { esc } from './ui.js';
import { autoCheckOnOpen } from './invoice-wallet.js';
import { createWebHost } from '../ui/cards/host-web.js';
import { watchKeyboard } from './keyboard.js';
import { showOnboarding } from './onboarding.js';
import home from './pages/home.js';
import nearby from './pages/nearby.js';
import rail from './pages/rail.js';
import agent from './pages/agent.js';
import service from './pages/service.js';
import { settings, privacy } from './pages/settings.js';
import { busSearch, busRoute, busStation, favPage } from './pages/bus.js';

const routes = [
  [/^\/?$/, home],
  [/^\/nearby$/, nearby],
  [/^\/bus$/, busSearch],
  [/^\/bus\/([^/]+)\/([^/]+)$/, busRoute],
  [/^\/bus-station\/([^/]+)\/([^/]+)$/, busStation],
  [/^\/rail\/(thsr|tra)$/, rail],
  [/^\/favs$/, favPage],
  [/^\/agent(?:\/([a-z][a-z0-9-]*))?$/, agent],
  [/^\/settings$/, settings], // 設定與隱私（M11-04）
  [/^\/privacy$/, privacy],
  [/^\/s\/([a-z][a-z0-9-]*)$/, service], // 生活服務（天氣、捷運、空品…） // #/agent（生活）、#/agent/antifraud（防詐，M7）
];
const tabs = [['#/', '首頁', 'home'], ['#/nearby', '附近', 'pin'], ['#/bus', '公車', 'bus'], ['#/favs', '收藏', 'star']];

const root = document.getElementById('app');
root.innerHTML = `
  <button class="skip" id="skip" type="button">跳到主要內容</button>
  <header class="topbar">
    <button class="icon-btn" id="back" aria-label="返回">${icons.back}</button>
    <h1 id="title"></h1>
    <button class="icon-btn" id="action" hidden></button>
  </header>
  <div id="banner"></div>
  <main id="main" tabindex="-1"></main>
  <div class="tabbar"><nav>${tabs.map(([h, n, i]) => `<a href="${h}" data-h="${h}">${icons[i]}<span>${n}</span></a>`).join('')}</nav></div>`;

const $ = (id) => document.getElementById(id);
$('back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
$('skip').onclick = () => $('main').focus(); // hash 路由：不能用 href="#main"（會被當成頁面）

let cleanups = [];
function toast(msg, ms = 2200) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.setAttribute('role', 'status'); // 螢幕閱讀器會念出提示
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(var(--nav-h) + 24px);transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:12px;font-size:14px;z-index:99;max-width:85vw;text-align:center';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
// 公車到站提醒（L-14，host-web.js）：任何頁面都顯示（沒開通知權限也看得到）
window.addEventListener('abang:arrival', (e) => toast(`🚌 ${e.detail.text}`, 8000));

function navigate() {
  cleanups.forEach((f) => f()); cleanups = [];
  const [path, qs = ''] = location.hash.slice(1).split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  let page = home, params = [];
  for (const [re, p] of routes) { const m = path.match(re); if (m) { page = p; params = m.slice(1); break; } }

  $('title').textContent = page.title;
  $('back').hidden = !!page.root;
  const act = $('action'); act.hidden = true; act.onclick = null; act.classList.remove('on');
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const on = a.dataset.h === `#${path || '/'}` || (a.dataset.h === '#/' && !path);
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const main = $('main');
  main.innerHTML = '';
  window.scrollTo(0, 0);
  page.render({
    main, params, query, toast,
    setTitle: (t) => { $('title').textContent = t; document.title = t === 'Abang' ? t : `${t}｜Abang`; },
    setAction: (svg, fn, label, on = false) => { act.innerHTML = svg; act.onclick = fn; act.hidden = false; act.setAttribute('aria-label', label); act.classList.toggle('on', on); },
    onCleanup: (f) => cleanups.push(f),
  });
  paintBanner();
}

/** 頂端橫幅：依各類資料的真實／示範狀態說明（卡片與首頁格子另有標示） */
function paintBanner() {
  $('banner').innerHTML = bannerHtml(state);
}

function bannerHtml({ mode, sources }) {
  if (!sources) return mode === 'demo' ? '<div class="demo-banner">示範模式：目前都是示範資料，不是即時資訊。</div>' : '';
  const demo = sources.filter((s) => s.mode === 'demo').map((s) => s.name);
  if (!demo.length) return '';
  if (demo.length === sources.length) return '<div class="demo-banner">示範模式：目前都是示範資料，不是即時資訊。</div>';
  return `<div class="demo-banner">部分示範資料：<b>${esc(demo.join('、'))}</b>目前是示範資料（標「示範」），其他為政府開放資料。</div>`;
}

addEventListener('hashchange', navigate);
navigate();
api.status().then(() => paintBanner()).catch(() => {});
// 我的發票：開獎後打開 App 就自動對獎、中獎主動通知（本機資料，離線 Demo 沒有伺服器時不做）
const checkPrizes = () => {
  if (globalThis.__DEMO_SERVICES__) return;
  const web = createWebHost();
  autoCheckOnOpen((n, a) => web.callTool(n, a), { toast }).catch(() => {});
};
// 首次使用引導：只在首頁（深層連結直接打開的頁面不打斷）；看過就不再顯示。
// 引導開著時背後的頁面讀不到、提示也被蓋住：對獎等引導關掉再做（PR #49 審查）；引導出錯不能擋住啟動
let guide = null;
try { if (!location.hash || location.hash === '#/') guide = showOnboarding({ onClose: checkPrizes }); } catch { guide = null; }
if (!guide) checkPrizes();

// 手機 App（ADR-0013）不註冊：畫面已在 App 裡，iOS 的 capacitor:// 也不支援
// Android 返回鍵／手勢（@capacitor/app）：有上一頁就回上一頁，在首頁才離開 App（PR #31 審查：沒有這段在首頁按返回會卡住）
const cap = globalThis.Capacitor;
if (typeof cap?.addListener === 'function' && cap.getPlatform?.() === 'android') {
  cap.addListener('App', 'backButton', (e) => {
    const open = document.querySelector('dialog[open]'); // 對話框開著（使用說明、掃發票）：返回鍵先關它
    if (open) { open.close(); return; }
    if (e?.canGoBack) history.back(); else cap.nativePromise('App', 'exitApp', {}).catch(() => {});
  });
}

// 手機鍵盤打開時收起底部分頁列（css: html.kb-open）
watchKeyboard();

if ('serviceWorker' in navigator && !globalThis.__DEMO_SERVICES__ && !globalThis.__ABANG_APP__ && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
