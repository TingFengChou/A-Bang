// 首頁 #/（2026-11-21 重新設計：阿幫為中心）。由上而下：
//   手機上的 AI（誰在判斷）→ 問阿幫主視覺（輸入框＋各領域範例）→ 現在（天氣、空品、最近一個提醒）→ 收藏 → 防詐 → 交通、生活、消費與政府格子。
// 主視覺與格子是「問」和「直接看」兩條路；所有服務另在 #/services 有一句說明的總覽。
import { miniApps, groups, TILE_COLOR } from '../registry.js';
import { canMorph } from '../page-hero.js';
import { icons } from '../icons.js';
import { esc, favs, etaBadge, chev, FALLBACK } from '../ui.js';
import { api, state } from '../api.js';
import { edgeEnabled, edgeStatus } from '../edge-judge.js';
import { edgeLine, nowItems, loadNow, peekNow } from '../home-now.js';
import { reminderItems } from '../reminder-items.js';
import { listReminders } from '../reminders.js';
import { alightWatch } from '../alight.js';
import { createWebHost, currentArrivalWatch } from '../../ui/cards/host-web.js';
import { locationGranted, browserLocation } from '../agent/client.js';
import { homeNudge } from '../health.js';
import { renderMoveCard } from '../health-ui.js';
import { suggestContext, homeAsks } from '../agent/suggest.js';
import { twClock } from '../../../core/suggest.js';
import { loadPlaces } from '../saved-places.js';

const EX_ICON = { trip: 'route', bus_route: 'bus', metro: 'metro', youbike: 'bike', nearby_bus: 'bus', rail: 'train', weather: 'sun', aqi: 'air', outing: 'sun', quake: 'quake', pharmacy: 'pharmacy', garbage: 'trash', invoice: 'receipt', fuel: 'fuel', stock: 'chart' };
const EX_COLOR = { transit: '#1d4ed8', life: '#0284c7', money: '#7c3aed' };
/**
 * 範例問題：依時段（早上通勤、深夜…）與「現在」的天氣空品、常用地點，交通、生活、消費各一句（agent/suggest.js 規則，都是阿幫查得到的）；
 * 防詐要貼訊息，固定開防詐頁。
 */
export function homeExamples({ now = Date.now(), nowData = peekNow() } = {}) {
  const ctx = suggestContext({ now, saved: Object.keys(loadPlaces()), watching: currentArrivalWatch() || null, nowData });
  return [...homeAsks(ctx).map((x) => ({ q: x.q, icon: EX_ICON[x.intent] || 'route', c: EX_COLOR[x.domain] })), { q: '這則簡訊是詐騙嗎？', icon: 'shield', c: '#b91c1c', href: '#/agent/antifraud' }];
}
const exampleHtml = (list) => list.map((x) => `<a class="chip" href="${x.href || `#/agent?q=${encodeURIComponent(x.q)}`}"><span class="chip-ic" style="--c:${x.c}" aria-hidden="true">${icons[x.icon]}</span>${esc(x.q)}</a>`).join('');
/** 「現在」的天氣查到後：範例跟著變（例：下雨）。一樣就不動；焦點在範例上不換；reduced motion 不淡入 */
function repaintExamples(main, nowData) {
  const box = main.querySelector('.hero-ask');
  if (!box || box.contains(document.activeElement)) return;
  const list = homeExamples({ nowData });
  const sig = list.map((x) => x.q).join('|');
  if ((box.dataset.sig || '') === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = exampleHtml(list);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { box.classList.remove('fade-in'); void box.offsetWidth; box.classList.add('fade-in'); }
}

export default {
  title: 'Abang', // App 名稱（2026-11-20 Austin 決定）；吉祥物與對話裡仍叫「阿幫」
  root: true,
  render({ main, toast, onCleanup }) {
    const { hour } = twClock(); // 台灣時間（不受手機或瀏覽器時區影響）
    const greet = hour < 5 ? '夜深了' : hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安';
    // 離線 Demo（沒有伺服器）：輸入框仍是公車搜尋
    const offline = !!globalThis.__DEMO_SERVICES__;
    const safe = miniApps.find((a) => a.id === 'antifraud');
    main.innerHTML = `
      <a class="ai-line" id="ai-line" href="#/ai" data-tone="wait">
        <span class="ai-ic" aria-hidden="true">${icons.chip}</span>
        <span class="ai-txt"><b id="ai-label">手機上的 AI</b><small id="ai-text">檢查中…</small></span>${chev}
      </a>
      <section class="hero" aria-labelledby="hero-big">
        <span class="mascot-3d" aria-hidden="true"><i class="mascot-shadow"></i><img class="mascot main" src="/brand/abang-default.svg" alt=""><img class="mascot alt" src="/brand/abang-think.svg" alt=""></span>
        <small>${greet}！我是阿幫</small>
        <h2 class="big" id="hero-big">${offline ? '即時公車・YouBike・高鐵台鐵' : '有事問阿幫'}</h2>
        ${offline ? '' : '<p class="hero-sub">交通、生活、消費、防詐，一句話幫你查</p>'}
        <form class="search" id="q" role="search">${icons.search}<input name="q" maxlength="500" placeholder="${offline ? '搜尋公車路線，例如 307' : '想查什麼？'}" enterkeyhint="${offline ? 'search' : 'send'}" autocomplete="off" aria-label="${offline ? '搜尋公車路線' : '問阿幫：想查什麼？'}"></form>
        ${offline ? '' : (() => { const ex = homeExamples(); return `<div class="hero-ask" role="group" aria-label="範例問題" data-sig="${esc(ex.map((x) => x.q).join('|'))}">${exampleHtml(ex)}</div>`; })()}
      </section>
      <section class="now" aria-labelledby="now-h">
        <div class="section-title"><h2 id="now-h">現在</h2><span id="now-when"></span></div>
        <div class="now-row" id="now" aria-busy="true"></div>
        <div id="move" class="move-wrap" hidden></div>
      </section>
      <div id="favs"></div>
      <section class="group safe" aria-labelledby="g-safe">
        <div class="section-title"><h2 id="g-safe">防詐</h2><span>165 全民防騙網</span></div>
        <a class="tile feature" href="${safe.route}" data-app="antifraud" data-source="${esc(safe.source)}">
          <span class="ic ab-token" style="--c:${TILE_COLOR.antifraud}">${icons.shield}</span>
          <span class="ft"><b>收到可疑訊息？</b><small>簡訊、電話、網址貼給阿幫看，看出哪裡不對勁</small></span>
          <span class="go" aria-hidden="true">檢查 ›</span>
        </a>
      </section>
      ${groups.filter((g) => g.id !== 'safe').map((g) => `
        <section class="group" aria-labelledby="g-${g.id}">
          <div class="section-title"><h2 id="g-${g.id}">${esc(g.name)}</h2><span>${esc(g.note)}</span></div>
          <div class="grid panel">${miniApps.filter((a) => a.group === g.id).map((a, i) => tile(a, i)).join('')}</div>
        </section>`).join('')}
      <p class="more-svc"><a class="btn quiet small link-btn" href="#/services">全部服務與說明 ›</a></p>
      <p class="updated">資料來源：交通部 TDX、中央氣象署、環境部、政府資料開放平臺・<a href="#/me">關於與設定</a></p>`;

    main.querySelector('#q').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = new FormData(e.target).get('q').trim();
      if (q) location.hash = offline ? `#/bus?q=${encodeURIComponent(q)}` : `#/agent?q=${encodeURIComponent(q)}`;
    });
    morphTiles(main);
    main.querySelectorAll('.tile.soon').forEach((el) =>
      el.addEventListener('click', () => toast(`「${el.dataset.name}」規劃中`)));
    // 示範資料的服務在格子上標「示範」（依 /api/v1/status 的 sources）
    api.status().then(() => { markDemoTiles(main); paintNow(main, offline, { quick: true }); }).catch(() => {}); // 現在的天氣空品也標示範

    paintAi(main);
    paintNow(main, offline).catch(() => {}).then(() => paintMove(main, toast));
    const repaintNow = () => paintNow(main, offline, { quick: true });
    for (const ev of ['abang:reminders', 'abang:alight-watch', 'abang:arrival-watch']) addEventListener(ev, repaintNow);
    onCleanup(() => { for (const ev of ['abang:reminders', 'abang:alight-watch', 'abang:arrival-watch']) removeEventListener(ev, repaintNow); });
    // 散步小卡（ADR-0018）：開關或「今天不用」變了就重算（判斷在手機上）
    const repaintMove = () => paintMove(main, toast);
    for (const ev of ['abang:health-setting', 'abang:health-day']) addEventListener(ev, repaintMove);
    onCleanup(() => { for (const ev of ['abang:health-setting', 'abang:health-day']) removeEventListener(ev, repaintMove); });

    renderFavs(main.querySelector('#favs'));
    const t = setInterval(() => renderFavs(main.querySelector('#favs')), 30000);
    onCleanup(() => clearInterval(t));
    tiltMascot(main.querySelector('.hero'), onCleanup);
  },
};

/** 點格子：格子的圖示飛進下一頁的頁首（View Transitions；不支援或減少動態時照常換頁）。服務總覽頁共用 */
export function morphTiles(main, sel = 'a.tile, a.svc') {
  main.querySelectorAll(sel).forEach((a) => a.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || !canMorph()) return;
    const ic = a.querySelector('.ic');
    if (!ic) return;
    e.preventDefault();
    main.querySelectorAll('.ic').forEach((x) => { x.style.viewTransitionName = ''; });
    ic.style.viewTransitionName = 'ph-token';
    dispatchEvent(new CustomEvent('abang:go', { detail: { hash: a.getAttribute('href') } }));
  }));
}

/** 手機上的 AI：照實說誰在判斷 */
function paintAi(main) {
  const box = main.querySelector('#ai-line');
  const put = (st) => {
    const l = edgeLine(st, edgeEnabled());
    box.dataset.tone = l.tone;
    box.querySelector('#ai-label').textContent = l.label;
    box.querySelector('#ai-text').textContent = l.text;
    box.setAttribute('aria-label', `${l.label}：${l.text}。看說明`);
  };
  put(null);
  edgeStatus().then(put, () => put({ available: false, reason: 'no-plugin' }));
}

/** 那一類資料是示範的（/api/v1/status 的 sources；還沒查到時看整體模式） */
const isDemo = (id) => (state.sources ? state.sources.some((x) => x.id === id && x.mode === 'demo') : state.mode === 'demo');

/**
 * 現在：提醒那格是本機的（立刻有）；天氣空品有效的上次結果就直接畫，沒有才先放佔位、查到再補。
 * quick：只換提醒（提醒變了）。內容跟上次一樣就不動 DOM（到站、下車提醒每 20 秒送事件：不能讓鍵盤與讀屏的焦點掉）
 */
let lastNow = null;
let nowLoading = false;
async function paintNow(main, offline, { quick = false } = {}) {
  const box = main.querySelector('#now');
  if (!box) return;
  const next = reminderItems({ arrival: currentArrivalWatch(), alight: alightWatch(), leave: listReminders() })[0] || null;
  const draw = (v, loading) => {
    const items = nowItems({ ...(v || {}), next, demo: { weather: isDemo('weather'), aqi: isDemo('aqi') } });
    const sig = JSON.stringify([items, !!loading]);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = (loading ? '<span class="now-item skel" aria-hidden="true"></span><span class="now-item skel" aria-hidden="true"></span>' : '')
      + items.map((x) => `<a class="now-item" href="${x.href}" data-now="${x.id}"><span class="ab-token sm" style="--c:${NOW_COLOR[x.id] || '#0f766e'}" aria-hidden="true">${icons[x.icon]}</span><span class="now-t"><b>${esc(x.main)}</b><small>${esc(x.sub)}</small></span>${x.demo ? '<span class="tag demo" title="目前是示範資料，不是即時資料">示範</span>' : ''}</a>`).join('');
    box.setAttribute('aria-busy', String(!!loading));
  };
  const when = main.querySelector('#now-when');
  if (when && !quick) when.textContent = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (quick || offline) { draw(offline ? null : lastNow, !offline && nowLoading); return; }
  const seen = peekNow();
  if (seen) { lastNow = seen; draw(seen, false); } else draw(null, true); // 回首頁：上次的結果還有效就不閃骨架
  const host = createWebHost();
  nowLoading = !seen;
  lastNow = await loadNow({ callTool: (n, a) => host.callTool(n, a), granted: locationGranted, locate: () => browserLocation(4000), fallback: FALLBACK }).catch(() => null);
  nowLoading = false;
  if (main.isConnected) { draw(lastNow, false); repaintExamples(main, lastNow); }
}
/**
 * 散步小卡（ADR-0018）：天氣、空品用「現在」已經查好的（不另外查），步數在手機上讀、在手機上判斷；沒打開就什麼都不做。
 * 位置只在有定位時才拿來找附近的公園（沒定位就只給一句建議）。
 */
let moveSeq = 0;
async function paintMove(main, toast) {
  const box = main.querySelector('#move');
  if (!box) return;
  const my = ++moveSeq;
  const v = lastNow || peekNow();
  const n = v && !v.offline ? await homeNudge({ weather: v.weather, air: v.aqi?.nearest || null, pos: v.pos || null }).catch(() => null) : null;
  if (my !== moveSeq || !main.isConnected) return;
  const host = createWebHost();
  renderMoveCard(box, n, { openLink: (url) => host.openLink(url), openApp: (t) => host.openApp(t), toast });
}
const NOW_COLOR = { weather: '#0284c7', aqi: '#0d9488', reminder: '#b45309', offline: '#5d6966' };

/** 資料是示範的服務：格子右上角標「示範」（離線 Demo 全部是示範） */
function markDemoTiles(main) {
  const demo = new Set((state.sources || []).filter((x) => x.mode === 'demo').map((x) => x.id));
  // 全部都是示範資料：頁首已有示範橫幅，格子不再一個個標（設計第二輪：14 個 9.5px 的小標）；真假混在一起才標
  const allDemo = (!state.sources && state.mode === 'demo') || (state.sources?.length > 0 && demo.size === state.sources.length);
  for (const el of main.querySelectorAll('a.tile[data-source]')) {
    el.querySelector('.tag.demo')?.remove();
    if (!allDemo && demo.has(el.dataset.source)) el.insertAdjacentHTML('beforeend', '<span class="tag demo" title="目前是示範資料，不是即時資料">示範</span>');
  }
}

function tile(a, i = 0) {
  const inner = `<span class="ic ab-token" style="--c:${TILE_COLOR[a.id] || '#0f766e'}">${icons[a.icon]}</span>${esc(a.name)}`;
  return a.status === 'soon'
    ? `<button class="tile soon" data-name="${esc(a.name)}"><span class="tag">規劃中</span>${inner}</button>`
    : `<a class="tile" style="--i:${i}" href="${a.route}" data-app="${esc(a.id)}" data-source="${esc(a.source)}">${inner}</a>`;
}

async function renderFavs(el) {
  if (!el) return;
  const list = favs.list().slice(0, 3);
  if (!list.length) { el.innerHTML = ''; return; }
  const rows = await Promise.all(list.map(async (f) => {
    if (f.type !== 'station') return `<a href="${f.href}"><div class="grow"><div class="title">${esc(f.title)}</div><div class="sub">${esc(f.sub)}</div></div>${chev}</a>`;
    const etas = await api.busStationEta(f.city, f.stationId).catch(() => []);
    const top = etas[0];
    return `<a href="${f.href}"><div class="grow"><div class="title">${esc(f.title)}</div><div class="sub">${top ? `${esc(top.routeName)} 最快` : esc(f.sub)}</div></div>${top ? etaBadge(top) : chev}</a>`;
  }));
  el.innerHTML = `<div class="section-title"><h2>我的收藏</h2><a href="#/favs"><span>全部</span></a></div><div class="card list">${rows.join('')}</div>`;
}

/** 3D 吉祥物：手指／滑鼠在首頁橫幅上移動時，阿幫轉頭看過去（±12°），陰影跟著偏；離開後回到自己輕輕轉身 */
function tiltMascot(hero, onCleanup) {
  const m = hero?.querySelector('.mascot-3d');
  if (!m || document.documentElement.classList.contains('lite-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const move = (e) => {
    const r = hero.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    m.classList.add('looking');
    m.style.setProperty('--ry', `${(x * 12).toFixed(1)}deg`);
    m.style.setProperty('--rx', `${(-y * 8).toFixed(1)}deg`);
    m.style.setProperty('--sx', `${(-x * 5).toFixed(1)}px`);
  };
  const leave = () => { m.classList.remove('looking'); m.style.removeProperty('--ry'); m.style.removeProperty('--rx'); m.style.removeProperty('--sx'); };
  hero.addEventListener('pointermove', move);
  hero.addEventListener('pointerleave', leave);
  onCleanup?.(() => { hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', leave); });
}
