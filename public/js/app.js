// App shell：hash router + 上方標題列 + 下方分頁列（首頁｜服務｜問阿幫（中央鍵）｜提醒｜我的，tabs.js）
import { icons } from './icons.js';
import { api, state } from './api.js';
import { esc, savedWhen } from './ui.js';
import { autoCheckOnOpen } from './invoice-wallet.js';
import { createWebHost } from '../ui/cards/host-web.js';
import { watchKeyboard } from './keyboard.js';
import { showOnboarding } from './onboarding.js';
import { resumeAlight } from './alight.js';
import { mountTripBar } from './trip-bar.js';
import { mountWaitDrama } from './wait-drama.js';
import { detachMain, attachMain, mountFab, syncFab, syncFabLabel, abangSays, keptIf } from './abang-dock.js';
import { shellT, shellLang, applyShell } from './shell-i18n.js';
import { pageHero, canMorph } from './page-hero.js';
import { miniApps } from './registry.js';
import { TABS, currentAttr, backTarget } from './tabs.js';
import { reminderItems } from './reminder-items.js';
import { listReminders, restoreReminders } from './reminders.js';
import { alightWatch } from './alight.js';
import { currentArrivalWatch, cancelArrivalWatch } from '../ui/cards/host-web.js';
import home from './pages/home.js';
import services from './pages/services.js';
import remindersPage from './pages/reminders.js';
import me from './pages/me.js';
import nearby from './pages/nearby.js';
import rail from './pages/rail.js';
import agent, { keptKey } from './pages/agent.js';
import service from './pages/service.js';
import ai from './pages/ai.js';
import { settings, privacy } from './pages/settings.js';
import { busSearch, busRoute, busStation, favPage } from './pages/bus.js';
import { startAppIntents } from './app-intents.js';

const routes = [
  [/^\/?$/, home],
  [/^\/services$/, services], // 服務總覽（原本分頁列的附近、公車在這裡）
  [/^\/reminders$/, remindersPage], // 進行中的提醒
  [/^\/me$/, me], // 我的：收藏、常用地點、發票、手機上的 AI、設定
  [/^\/nearby$/, nearby],
  [/^\/bus$/, busSearch],
  [/^\/bus\/([^/]+)\/([^/]+)$/, busRoute],
  [/^\/bus-station\/([^/]+)\/([^/]+)$/, busStation],
  [/^\/rail\/(thsr|tra)$/, rail],
  [/^\/favs$/, favPage],
  [/^\/agent(?:\/([a-z][a-z0-9-]*))?$/, agent],
  [/^\/settings$/, settings], // 設定與隱私（M11-04）
  [/^\/privacy$/, privacy],
  [/^\/ai$/, ai], // 阿幫的腦袋：裝置端 AI 的視覺與模型資訊（ADR-0014）
  [/^\/s\/([a-z][a-z0-9-]*)$/, service], // 生活服務（天氣、捷運、空品…） // #/agent（生活）、#/agent/antifraud（防詐，M7）
];
const zh = shellT(null); // 外殼一開始用中文；網址帶 lang=en 或問阿幫最近一輪是英文時換英文（shell-i18n.js）

/** 分頁列一格；中央鍵是按鈕（其他頁拉出對話、問阿幫頁回到輸入框，abang-dock.js），id 沿用 abang-fab */
function tabHtml(t) {
  if (t.center) return `<button id="abang-fab" class="tab-key" type="button" data-tab="${t.id}" aria-haspopup="dialog" aria-label="${zh('fab')}"><span class="key-disc"><img src="/brand/abang-default.svg" alt=""><i class="fab-dot" aria-hidden="true"></i></span><span class="key-label" data-shell="${t.key}">${zh(t.key)}</span></button>`;
  const badge = t.id === 'reminders' ? '<b class="tab-badge" aria-hidden="true" hidden></b><span class="sr-only tab-badge-sr"></span>' : '';
  return `<a href="${t.href}" data-h="${t.href}" data-tab="${t.id}"><span class="tab-ic">${icons[t.icon]}${badge}</span><span class="tab-label" data-shell="${t.key}">${zh(t.key)}</span></a>`;
}

const root = document.getElementById('app');
root.innerHTML = `
  <button class="skip" id="skip" type="button" data-shell="skip">${zh('skip')}</button>
  <header class="topbar">
    <button class="icon-btn" id="back" aria-label="${zh('back')}" data-shell-label="back">${icons.back}</button>
    <h1 id="title"></h1>
    <button class="icon-btn" id="action" hidden></button>
  </header>
  <div id="offline" class="offline-banner" role="status" hidden></div>
  <div id="banner"></div>
  <div id="tripbar" hidden></div>
  <div id="waitdrama" class="wait-drama" hidden></div>
  <div id="pagehero"></div>
  <main id="main" tabindex="-1"></main>
  <div class="abang-float"><div id="abang-bubble" class="fab-bubble" hidden></div></div>
  <div class="tabbar"><nav aria-label="${zh('tabsNav')}" data-shell-label="tabsNav">${TABS.map(tabHtml).join('')}</nav></div>
  <p id="abang-live" class="sr-only" aria-live="polite"></p>
  <dialog id="abang-sheet" class="abang-sheet" aria-labelledby="abang-sheet-title"><div class="sheet-head"><span class="sheet-grip" aria-hidden="true"></span><h2 id="abang-sheet-title" tabindex="-1" autofocus data-shell="sheetTitle">${zh('sheetTitle')}</h2><button type="button" class="btn small quiet sheet-full" data-shell="sheetFull">${zh('sheetFull')}</button><button type="button" class="icon-btn sheet-close" aria-label="${zh('sheetClose')}" data-shell-label="sheetClose"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></div><div class="sheet-body"></div></dialog>`;

const $ = (id) => document.getElementById(id);
$('back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
$('skip').onclick = () => $('main').focus(); // hash 路由：不能用 href="#main"（會被當成頁面）

let cleanups = [];
function toast(msg, ms = 2200, action = null) {
  const t = document.createElement('div');
  t.textContent = msg;
  if (action) { // 提示上的動作（例：公車一直不來 → 到問阿幫改其他方式）
    const a = Object.assign(document.createElement('a'), { href: action.href, textContent: action.label });
    a.style.cssText = 'display:inline-block;margin-left:10px;color:inherit;font-weight:700;text-decoration:underline;min-height:32px;line-height:32px';
    a.addEventListener('click', () => t.remove());
    t.append(a);
  }
  t.setAttribute('role', 'status'); // 螢幕閱讀器會念出提示
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(var(--nav-h) + 24px);transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:12px;font-size:14px;z-index:99;max-width:85vw;text-align:center';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
// 提醒由阿幫說（2026-11-21 Austin：阿幫要實體化、能提醒與互動）：記在對話裡；在其他頁面由浮動阿幫冒泡泡。
// 生活對話看得到（問阿幫頁或底部對話開著）就不再跳提示；防詐頁等看不到的地方用提示。
function remind(text, action, ms) {
  if (abangSays(text, action)) return; // 對話看得到、或浮動阿幫冒了泡泡
  toast(text, ms, action?.ask ? { label: action.label, href: `#/agent?q=${encodeURIComponent(action.ask)}` } : null);
}
// 公車到站提醒（L-14，host-web.js）：任何頁面都看得到（沒開通知權限也看得到）
window.addEventListener('abang:arrival', (e) => remind(`🚌 ${e.detail.text}`, null, 8000));
window.addEventListener('abang:alight', (e) => remind(`🔔 ${e.detail.text}`, null, 10000)); // 下車提醒
// 公車一直不來（S15）：可以改其他方式（點了打開對話直接問阿幫；卡片上也有按鈕）
// P1-5 v2（2026-11-28 Antigravity 第六輪）：有剛才的行程就直接說 B 方案（「可以改坐捷運，大約 10:42 到（比原本晚 10 分）」，在手機上重算、不打 API）；
// 按了用最新的資料重查那種方式，並先取消舊公車的到站提醒；「不用」就收起（同一個提醒只推一次：host-web 的 w.stuck）
window.addEventListener('abang:arrival-stuck', async (e) => {
  const en = e.detail.lang === 'en';
  const b = await keptIf('agent')?.api?.bPlan?.(e.detail.routeName, { lang: e.detail.lang, ended: !!e.detail.ended }).catch(() => null);
  if (b && !b.stale) {
    remind(b.text, { label: b.label, ask: b.ask, closeLabel: en ? 'No thanks' : '不用', before: () => cancelArrivalWatch() }, 15000);
    return;
  }
  if (e.detail.ended) { // 末班已過、今日未營運：提醒已自動取消
    remind(en ? `Bus ${e.detail.routeName} isn't running any more today, so I cancelled the reminder. Want another way?` : `${e.detail.routeName} 今天不會再來了（末班已過或沒有營運），到站提醒已取消。要我改其他方式嗎？`, { label: en ? 'Another way' : '改其他方式', ask: e.detail.ask }, 10000);
    return;
  }
  remind(en ? `Bus ${e.detail.routeName} isn't coming. Want me to find another way?` : `${e.detail.routeName} 一直沒來，要我幫你改其他方式嗎？`, { label: en ? 'Another way' : '改其他方式', ask: e.detail.ask }, 10000); // 阿幫自己說（不再說「到問阿幫」）
});

// 點首頁格子：用 View Transitions 讓格子的圖示飛進新頁面的頁首（home.js 送 abang:go；不支援時直接換頁）
let afterNav = null;
addEventListener('abang:go', (e) => {
  const hash = e.detail?.hash;
  if (!/^#\/[^\s<>"']*$/.test(hash || '')) return;
  if (typeof document.startViewTransition !== 'function') { location.hash = hash; return; }
  document.startViewTransition(() => new Promise((done) => { afterNav = done; location.hash = hash; setTimeout(done, 800); })); // 最多等 0.8 秒
});

/** 目前網址對應的頁面（換頁與浮動阿幫「你在看什麼」共用；頁面內改網址（換上車站）也讀得到） */
function resolve() {
  const [path, qs = ''] = location.hash.slice(1).split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  let page = home, params = [];
  for (const [re, p] of routes) { const m = path.match(re); if (m) { page = p; params = m.slice(1); break; } }
  return { path, query, page, params };
}

// 外殼語言（S12g）：每次換頁依網址決定（lang=en＝英文），不存設定；問阿幫（生活）頁另看最近一輪的語言（agent.js 送 abang:agent-lang）
let agentLang = null;
const onLifeAgent = ({ page, params }) => page === agent && keptKey(params[0]) === 'agent';
function langNow() {
  const r = resolve();
  return shellLang({ query: r.query, onLifeAgent: onLifeAgent(r), agentLang });
}
const setDocTitle = (t) => { $('title').textContent = t; document.title = t === 'Abang' ? t : `${t}｜Abang`; };
/** 外殼文字（分頁列、返回、浮動阿幫、底部對話）跟著語言；問阿幫頁的標題也是 */
function paintShell() {
  const lang = langNow();
  applyShell(lang, document, { docLang: resolve().query?.lang === 'en' ? 'en' : null });
  syncFabLabel();
  paintBadge();
  if (onLifeAgent(resolve())) setDocTitle(lang === 'en' ? shellT('en')('agentTitle') : agent.title);
}
addEventListener('abang:agent-lang', (e) => {
  agentLang = e.detail?.lang === 'en' ? 'en' : null;
  if (onLifeAgent(resolve())) { paintShell(); paintBanner(); }
  else { const sheet = document.getElementById('abang-sheet'); if (sheet?.open) applyShell(agentLang, document, { root: sheet, docLang: resolve().query?.lang === 'en' ? 'en' : null }); } // 浮動面板裡問英文：面板的字跟著（PR 審查）
});
addEventListener('abang:clear-local', () => { agentLang = null; if (onLifeAgent(resolve())) { paintShell(); paintBanner(); } });

// 從格子點進去的頁面回到首頁：圖示從頁首飛回格子（View Transitions；換頁前先拍舊畫面）
let heroNow = null;
addEventListener('abang:hero', (e) => { heroNow = e.detail || null; }); // 頁面內換頁首（附近切到 YouBike）
function navigate() {
  const to = resolve().page;
  const back = heroNow && (to === home || to === services) && canMorph(); // 回到有格子的頁面（首頁、服務）
  if (!back) { render(); return; }
  const id = heroNow;
  heroNow = null; // 連按兩次返回：第二次不再等這次的動畫（不會畫兩次）
  let ic = null;
  const vt = document.startViewTransition(() => {
    try { render(); } catch (e) { console.error(e); } // 換頁出錯照樣看得到（不吞掉）
    const a = miniApps.find((x) => x.id === id);
    ic = a && document.querySelector(`#main [data-app="${a.id}"] .ic`);
    if (ic) ic.style.viewTransitionName = 'ph-token'; // 新畫面裡同名的是那個格子的圖示
  });
  vt.finished.catch(() => {}).finally(() => { if (ic) ic.style.viewTransitionName = ''; }); // 飛完拿掉（同名只能有一個）
}

function render() {
  cleanups.forEach((f) => f()); cleanups = [];
  state.staleAt = null; // 舊資料標示只屬於那一頁；新頁面查詢失敗會再標
  const { path, query, page, params } = resolve();

  $('title').textContent = page.shellTitle ? shellT(langNow())(page.shellTitle) : page.title;
  $('back').hidden = !!page.root;
  const act = $('action'); act.hidden = true; act.onclick = null; act.classList.remove('on');
  // 分頁列：分頁本身 aria-current="page"；在這一區的子頁（公車頁屬於服務、設定屬於我的）aria-current="true"
  document.querySelectorAll('.tabbar [data-tab]').forEach((a) => {
    const cur = currentAttr(a.dataset.tab, path);
    a.classList.toggle('on', !!cur);
    if (cur) a.setAttribute('aria-current', cur); else a.removeAttribute('aria-current');
  });
  // 首頁格子點進來的頁面：頁首（立體圖示＋說明＋動畫，page-hero.js）
  const heroId = page.hero?.({ params, query });
  const hero = heroId && pageHero(heroId);
  $('pagehero').replaceChildren(...(hero ? [hero] : []));
  heroNow = hero ? heroId : null;
  const main = $('main');
  detachMain(); // 問阿幫的對話不清掉：先收起來，回來原樣接上
  main.innerHTML = '';
  applyShell(langNow(), document, { docLang: resolve().query?.lang === 'en' ? 'en' : null }); // 外殼文字跟著這一頁的語言（浮動阿幫的讀屏標籤在 syncFab 裡）
  syncFab();
  const setTitle = setDocTitle;
  const setAction = (svg, fn, label, on = false) => { act.innerHTML = svg; act.onclick = fn; act.hidden = false; act.setAttribute('aria-label', label); act.classList.toggle('on', on); };
  const key = page.keepAlive && keptKey(params[0]);
  if (key) { // 問阿幫（生活）：只建一次；卡片、決策圖、捲動位置都保留（防詐不保留：貼上的內容離開就清掉）
    const { k } = attachMain(main, key, ({ root, setTitle: keepTitle }) => page.render({ main: root, params, query, toast, setAction: () => {}, setTitle: (t) => { keepTitle(t); setTitle(t); }, onCleanup: () => {} }), query);
    setTitle(k.title || page.title);
    syncFab();
    if (onLifeAgent({ page, params })) paintShell(); // 最近一輪是英文：標題也英文
  } else {
    window.scrollTo(0, 0);
    setDocTitle($('title').textContent || 'Abang'); // 先用這一頁的預設標題：沒自己設標題的頁（首頁、服務、提醒、我的…）原本留著上一頁的（V3 巡檢 F4：讀屏換頁念錯頁名）
    page.render({ main, params, query, toast, setTitle, setAction, onCleanup: (f) => cleanups.push(f) });
  }
  paintBanner();
  paintBadge(); // 提醒數字的讀屏文字跟著這一頁的語言
  afterNav?.(); afterNav = null; // 圖示飛進頁首的換頁：新畫面好了
}

/** 頂端橫幅：依各類資料的真實／示範狀態說明（卡片與首頁格子另有標示） */
function paintBanner() {
  // 常駐的 live region（index 外殼裡），文字變了才換：讀屏不會每次換頁都重念
  const off = $('offline');
  const en = langNow() === 'en'; // 英文公車頁（S12g，?lang=en）、英文的問阿幫：頂端說明也用英文
  const text = offlineText(state, en);
  if (off.textContent !== text) off.textContent = text;
  off.hidden = !text;
  $('banner').innerHTML = bannerHtml(state, en);
}

/** 離線與弱網：沒有網路、或畫面是上次存下的資料時，在最上面說清楚。示範單檔版（全部在手機上）不顯示 */
function offlineText({ staleAt }, en = false) {
  if (globalThis.__DEMO_SERVICES__) return '';
  const off = globalThis.navigator?.onLine === false;
  if (en) {
    if (staleAt) return `${off ? 'Offline' : "Can't reach the server"}: showing data from ${savedWhen(staleAt, Date.now(), (hm) => `yesterday ${hm}`)}. It may not be the latest.`;
    return off ? 'Offline: connect to the internet and try again.' : '';
  }
  if (staleAt) return `${off ? '目前離線' : '目前連不上伺服器'}：顯示 ${savedWhen(staleAt)} 存下的資料，可能不是最新。`;
  return off ? '目前離線：連上網路後再查詢。' : '';
}

function bannerHtml({ mode, sources }, en = false) {
  const all = en ? '<div class="demo-banner">Demo mode: all data here is sample data, not live.</div>' : '<div class="demo-banner">示範模式：目前都是示範資料，不是即時資訊。</div>';
  if (!sources) return mode === 'demo' ? all : '';
  const demo = sources.filter((s) => s.mode === 'demo').map((s) => s.name);
  if (!demo.length) return '';
  if (demo.length === sources.length) return all;
  if (en) return '<div class="demo-banner">Some data here is demo data, not live. The rest is government open data.</div>';
  return `<div class="demo-banner">部分示範資料：<b>${esc(demo.join('、'))}</b>目前是示範資料（標「示範」），其他為政府開放資料。</div>`;
}

/** 提醒分頁上的數字：進行中的到站、下車、出門提醒有幾個 */
function paintBadge() {
  const n = reminderItems({ arrival: currentArrivalWatch(), alight: alightWatch(), leave: listReminders() }).length;
  const b = document.querySelector('.tabbar .tab-badge');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : String(n);
  document.querySelector('.tabbar .tab-badge-sr').textContent = n ? shellT(langNow())('tabBadge', { n }) : '';
}
for (const ev of ['abang:reminders', 'abang:alight-watch', 'abang:arrival-watch']) addEventListener(ev, paintBadge);

addEventListener('hashchange', navigate);
// 連回來：重新載入這一頁（時刻表等不會自動刷新的頁面也換成最新）
for (const ev of ['offline', 'abang:stale', 'abang:fresh']) addEventListener(ev, paintBanner);
addEventListener('online', () => { if (state.staleAt) navigate(); else paintBanner(); });
navigate();
api.status().then(() => paintBanner()).catch(() => {});
// 出門提醒（T7）：過期的取消（重開機後不補送）、網頁版重新整理後把還沒到的排回去
try { restoreReminders(); } catch { /* 無痕模式 */ }
paintBadge();
// 下車提醒：App 被系統關掉再打開時恢復（沒逾時才恢復）
mountTripBar($('tripbar')); // 行程中：每一頁上方可回到公車頁
mountWaitDrama($('waitdrama')); // 設了到站提醒、還要等一陣子：推一集短劇（車快到時會提醒）
// 中央「問阿幫」鍵：每一頁分頁列正中間，點了從下方拉出同一段對話（不用離開現在的頁面）
mountFab({
  // 問阿幫知道你在看哪一頁：建議問題＋這一頁的說明（跟下一個問題一起送出）
  pageAsk: () => { try { const { page, params, query } = resolve(); return page.askHint?.({ params: params.map((x) => (x == null ? x : decodeURIComponent(x))), query }) || null; } catch { return null; } },
  buildLife: ({ root, setTitle: keepTitle }) => agent.render({ main: root, params: [], query: {}, toast, setAction: () => {}, setTitle: keepTitle, onCleanup: () => {} }) });
if (globalThis.Capacitor?.isNativePlatform?.()) { const web = createWebHost(); resumeAlight((n, a) => web.callTool(n, a)); }
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
    const open = document.querySelector('dialog[open]'); // 對話框開著（底部對話、使用說明、掃發票）：返回鍵先關它
    if (open) { open.close(); return; }
    const to = backTarget(resolve().path, !!e?.canGoBack);
    if (to === 'exit') cap.nativePromise('App', 'exitApp', {}).catch(() => {});
    else if (to === 'back') history.back();
    else location.hash = to;  });
}

// Siri、捷徑、Spotlight 交給 App 的事（M16-02）：問阿幫、查詐騙、打開某一頁（只有 iOS App）
startAppIntents().catch(() => {});

// 手機鍵盤打開時收起底部分頁列（css: html.kb-open）
watchKeyboard();

if ('serviceWorker' in navigator && !globalThis.__DEMO_SERVICES__ && !globalThis.__ABANG_APP__ && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
