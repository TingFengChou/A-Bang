// 首頁 #/「夜色與光」（2026-11-29 首頁改版 H2，ADR-0023；規格 docs/HOME_REDESIGN.md；原型 docs/prototypes/home-night-light.html）。
// 一片依台灣時間變化的天空，上面只有一個焦點：「現在的建議」卡（core/home-suggest.js 決定，程式判斷、不讓模型編數字）。
// 由上而下：日期與兩個圖示鍵（提醒、個人）→ 手機上的 AI 核心（只連這次用到的訊號）＋金色頭腦 → 建議卡（出發地可切換）
//   → 即時資料兩格 → 服務列（依時段排）＋全部服務 → 更多功能（只列這支手機做得到的）→ 底部「您可能想問」＋輸入列。
// 舊首頁的功能都還在：功能對照表見規格 §2（今天卡 → 日期與天氣一行、範例問題 → 您可能想問、格子 → 服務列與全部服務、
//   收藏 → 即時資料、AI 一行 → 金色頭腦、阿幫記得你 → 為何顯示此建議、散步小卡 → 散步建議情境）。
import { TILE_COLOR } from '../registry.js';
import { canMorph } from '../page-hero.js';
import { icons } from '../icons.js';
import { esc, favs, FALLBACK } from '../ui.js';
import { api, state } from '../api.js';
import { edgeEnabled, edgeStatus, EDGE_ENGINE_NAME } from '../edge-judge.js';
import { loadNow, peekNow } from '../home-now.js';
import { reminderItems } from '../reminder-items.js';
import { listReminders } from '../reminders.js';
import { alightWatch } from '../alight.js';
import { createWebHost, currentArrivalWatch } from '../../ui/cards/host-web.js';
import { locationGranted, browserLocation } from '../agent/client.js';
import { homeNudge } from '../health.js';
import { renderMoveCard } from '../health-ui.js';
import { twClock } from '../../../core/suggest.js';
import { homeSuggest, homeAsks, placeName } from '../../../core/home-suggest.js';
import { loadPlaces } from '../saved-places.js';
import { todayPlan } from '../today.js';
import { pushTodayWidget } from '../today-widget.js';
import { openMemorySheet } from '../memory-sheet.js';
import { homeArea, areaLabel } from '../home-area.js';
import { onboarded } from '../onboarding.js';
import { loadChat } from '../chat-store.js';
import { tripOf } from '../trip-bar.js';
import { starsHtml, skylineSvg, CORE_SVG, BRAIN_SVG, BIRD_SVG, threads, fullIntroToday } from '../home-sky.js';
import { loadCommute, snapshotOf, lastAsk, tilePlan, loadTransit, svcOrder, capsFor } from '../home-data.js';

const WEEK = '日一二三四五六';
/** 捷運路線色（路線列的小標籤；公車一律藍） */
const LINE_COLOR = { BR: '#9A6B1F', R: '#E3002C', G: '#008659', O: '#F8B61C', BL: '#0070BD', Y: '#C9A800', K: '#C3B091', V: '#A4CE4E' };
const ASK_ICON = { clock: 'clock', bus: 'bus', metro: 'metro', umbrella: 'umbrella', air: 'air', garbage: 'trash', walk: 'walk', clinic: 'pharmacy', pharmacy: 'pharmacy', bike: 'bike', shield: 'shield' };
const platform = () => globalThis.Capacitor?.getPlatform?.() || 'web';
const reduced = () => document.documentElement.classList.contains('lite-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const askHref = (q) => `#/agent?q=${encodeURIComponent(q)}`;

/** 主按鈕要去哪：通勤與返家用固定的兩個地點問阿幫（行程卡上有出門倒數、行事曆、分享） */
export function ctaHref(d) {
  if (d.cta?.href) return d.cta.href;
  if (d.kind === 'commute' || d.kind === 'home') {
    const from = d.route[0], to = d.route[d.route.length - 1];
    const f = from === '目前位置' ? '目前位置' : from === '住家' ? '家' : from;
    const t = to === '住家' ? '家' : to;
    return askHref(`從${f}到${t}怎麼走？`);
  }
  return '#/agent';
}

export default {
  title: 'Abang', // App 名稱（2026-11-20 Austin 決定）；吉祥物與對話裡仍叫「阿幫」
  root: true,
  immersive: true, // 外殼不畫標題列與分頁列：首頁自己有日期列、提醒與個人鍵、輸入列（ADR-0023 §3）
  render({ main, toast, onCleanup }) {
    const offline = !!globalThis.__DEMO_SERVICES__; // 離線 Demo（沒有伺服器）：輸入框仍是公車搜尋
    const now0 = Date.now();
    const { hour, min } = twClock(now0); // 台灣時間（不受手機或瀏覽器時區影響）
    const d0 = new Date(now0 + 8 * 3600e3);
    const full = !reduced() && fullIntroToday(`${d0.getUTCFullYear()}-${d0.getUTCMonth() + 1}-${d0.getUTCDate()}`);
    main.innerHTML = `
      <div class="hs${full ? ' play' : ' calm'}" id="hs">
        <div class="hs-sky" aria-hidden="true"><div class="hs-tint"></div><div class="hs-stars">${starsHtml()}</div><div class="hs-shoot"><i></i></div></div>
        <header class="hs-head">
          <h1 class="hs-date e" style="--a:hs-drop"><b id="hs-dateB"></b><span id="hs-dateS"></span></h1>
          <nav class="hs-hb e" style="--a:hs-drop;--t:.05s" aria-label="提醒與個人">
            <a href="#/reminders" class="hs-ib" id="hs-bell" aria-label="提醒">${icons.bell}<b class="hs-badge" hidden></b></a>
            <a href="#/me" class="hs-ib" aria-label="個人與設定">${icons.user}</a>
          </nav>
        </header>
        <section class="hs-stage" id="hs-stage" aria-label="手機上的 AI 這次用到的資訊">
          <div class="hs-back" aria-hidden="true"><div class="hs-aura"></div><div class="hs-glow"></div>${skylineSvg()}</div>
          <div class="hs-lamp" aria-hidden="true">
            <div class="hs-cone e" style="--a:hs-coneIn;--t:.8s;--d:.45s"><i></i></div>
            <div class="hs-halo e" style="--a:hs-haloUp;--t:.15s;--d:.7s"><i class="far"></i><i class="near"></i></div>
            <div class="hs-markW e" style="--a:hs-markIn;--t:.05s;--d:.45s">${CORE_SVG}</div>
            <div class="hs-flash"></div>
          </div>
          <div class="hs-threads" aria-hidden="true"></div>
          <ul class="hs-sigs" id="hs-sigs"></ul>
          <button type="button" class="hs-brain e" id="hs-brain" style="--a:hs-pop;--t:.2s" aria-label="手機上的 AI">${BRAIN_SVG}</button>
          <p class="hs-tip" id="hs-tip" role="status"></p>
          <p class="hs-wx e" id="hs-wx" style="--a:hs-fade;--t:.3s"></p>
        </section>
        <section class="hs-sugg" aria-labelledby="hs-ttl">
          <div class="hs-under e" style="--a:hs-cardIn;--t:.8s;--d:.45s"></div>
          <div class="hs-birdW e" style="--a:hs-birdUp;--t:1s;--d:.45s" aria-hidden="true"><div class="hs-birdB">${BIRD_SVG}</div></div>
          <article class="hs-card e" id="hs-card" style="--a:hs-cardIn;--t:.8s;--d:.45s" aria-busy="true"><div class="hs-glowC"></div><p class="hs-otip" id="hs-otip" role="status">${icons.locate}將取得一次目前位置，僅用於本次計算</p><div id="hs-cc"></div></article>
        </section>
        <div class="hs-cheer" id="hs-cheer" hidden></div>
        <section class="hs-live e" id="hs-live" style="--t:.3s" aria-label="即時資料"></section>
        <nav class="hs-svc e" style="--t:.4s" aria-label="服務">
          <div class="hs-svcR" id="hs-svcR"></div>
          <a class="hs-all" href="#/services">全部<br>服務 ›</a>
        </nav>
        <section class="hs-caps e" style="--t:.5s" aria-labelledby="hs-capsH">
          <div class="hs-capsH"><h2 id="hs-capsH">更多功能<small id="hs-capN"></small></h2><span class="hs-dots" id="hs-dots"></span></div>
          <div class="hs-capsV" id="hs-capsV"><div class="hs-capsT" id="hs-capsT"></div></div>
        </section>
        <p class="hs-src">資料來源：交通部 TDX、中央氣象署、環境部、政府資料開放平臺・<a href="#/me">關於與設定</a></p>
        <div class="hs-dockW">
          <div class="hs-asks" id="hs-asks" role="group" aria-label="您可能想問"></div>
          <form class="hs-dock" id="q" role="search">
            <a class="hs-cam" href="${offline ? '#/bus' : '#/agent?act=cam'}" aria-label="拍照查詢">${icons.cam}</a>
            <input name="q" maxlength="500" placeholder="${offline ? '搜尋公車路線，例如 307' : '拍照、語音或輸入，例如 307'}" enterkeyhint="${offline ? 'search' : 'send'}" autocomplete="off" aria-label="${offline ? '搜尋公車路線' : '問阿幫'}">
            <a class="hs-mic" href="${offline ? '#/bus' : '#/agent?act=mic'}" aria-label="語音查詢">${icons.mic}</a>
          </form>
        </div>
        <div class="hs-scrim" id="hs-scrim" hidden></div>
        <section class="hs-panel" id="hs-panel" aria-label="其他建議與您可能想問" hidden></section>
        <dialog class="hs-sheet" id="hs-why" aria-labelledby="hs-why-h"></dialog>
        <dialog class="hs-sheet" id="hs-info" aria-labelledby="hs-info-h"></dialog>
      </div>`;
    const $ = (s) => main.querySelector(s);
    const root = $('#hs');
    const host = createWebHost();
    const ui = { override: null, prefer: null, nowData: peekNow(), transit: { transit: {}, bike: null, fav: null, quotaOut: false }, walk: null, d: null };

    // 日期列
    const paintDate = (d) => {
      const dt = new Date(Date.now() + 8 * 3600e3);
      $('#hs-dateB').textContent = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
      $('#hs-dateS').textContent = `週${WEEK[dt.getUTCDay()]}・${d?.day?.label || ''}`.replace(/・$/, '');
    };

    // 建議（每次資料或切換變了就重算；同一份結果不重畫，焦點不會掉）
    const compute = () => {
      const chat = loadChat();
      const trip = tripOf({ alight: alightWatch(), arrival: currentArrivalWatch() });
      const snap = snapshotOf({
        now: Date.now(), nowData: ui.nowData, places: loadPlaces(), commute: loadCommute(), override: ui.override, transit: ui.transit.transit,
        trip: trip ? { href: trip.href } : null, walk: ui.walk?.kind === 'go' ? { kind: 'go', text: ui.walk.text, spot: ui.walk.spot ? { name: ui.walk.spot.name } : null } : null,
        last: lastAsk(chat), onboarded: onboarded(), demo: isDemo('transit'), quotaOut: ui.transit.quotaOut,
      });
      const d = homeSuggest({ ...snap, prefer: ui.prefer });
      return { d, asks: homeAsks(snap, d) };
    };
    const paint = () => {
      if (!main.isConnected) return;
      const { d, asks } = compute();
      ui.d = d;
      root.dataset.sky = d.sky;
      paintDate(d);
      paintSignals(root, d);
      paintCard($('#hs-cc'), d, { demo: isDemo('transit') && !allDemo() }); // 全部都是示範：頂端橫幅已說，卡片不再標
      $('#hs-card').classList.toggle('warn', d.status === 'warn');
      $('#hs-card').classList.toggle('fix', !!d.legs);
      $('#hs-card').setAttribute('aria-busy', 'false');
      // 散步建議（ADR-0018）：判斷在手機上；卡片裡就是原本的散步小卡（走過去、今天不用、示範標示、合作 App 連結）
      const moveOpts = { openLink: (url) => host.openLink(url), openApp: (t) => host.openApp(t), toast };
      const slot = $('#hs-move');
      if (slot) renderMoveCard(slot, ui.walk?.kind === 'go' ? ui.walk : null, moveOpts);
      renderMoveCard($('#hs-cheer'), ui.walk?.kind === 'cheer' ? ui.walk : null, moveOpts);
      paintAsks($('#hs-asks'), asks);
      paintPanel($('#hs-panel'), d, asks);
      paintLive($('#hs-live'), d, ui.transit);
      paintWx($('#hs-wx'), ui.nowData);
      paintBadge($('#hs-bell'));
      if (!ui.nowLoading) pushWidget(ui.nowData);
    };

    // 服務列、更多功能（不隨資料變）
    $('#hs-svcR').innerHTML = svcOrder(hour * 60 + min).slice(0, 8).map((a) => `<a class="hs-si" href="${a.route}" data-app="${esc(a.id)}"><span class="ic ab-token" style="--c:${TILE_COLOR[a.id] || '#0f766e'}">${icons[a.icon]}</span>${esc(a.name === '發票對獎' ? '發票' : a.name === '空氣品質' ? '空品' : a.name)}</a>`).join('');
    morphTiles(main, 'a.hs-si');
    mountCaps(root, capsFor(platform()), { toast, info: (c) => openInfo($('#hs-info'), c), pin: () => pinWidget(toast) });

    // 互動
    $('#hs-cc').addEventListener('click', (e) => {
      const seg = e.target.closest('[data-o]');
      if (seg) { setOrigin(seg.dataset.o); return; }
      if (e.target.closest('#hs-sum')) { const w = $('#hs-steps'); const on = !w.classList.contains('open'); w.classList.toggle('open', on); e.target.closest('#hs-sum').setAttribute('aria-expanded', String(on)); return; }
      if (e.target.closest('#hs-why-btn')) { openWhy($('#hs-why'), ui.d, toast); return; }
      if (e.target.closest('#hs-other')) { setPanel(true); return; }
    });
    const setOrigin = (o) => {
      const was = ui.d?.origin?.mode;
      if (o === was) return;
      ui.override = o;
      if (o === 'here' && ui.d?.origin && !ui.nowData?.pos) { // 沒有位置：說明只取得一次，再問手機
        const c = $('#hs-card'); c.classList.add('tipOrg'); setTimeout(() => c.classList.remove('tipOrg'), 2500);
        browserLocation(6000).then((p) => { if (p) ui.nowData = { ...(ui.nowData || {}), pos: { lat: p.lat, lon: p.lon } }; paint(); }).catch(() => { toast('沒有取得位置，先用固定地點'); ui.override = 'fixed'; paint(); });
      }
      paint();
      pulse(root);
    };
    const setPanel = (on) => { $('#hs-panel').hidden = !on; $('#hs-scrim').hidden = !on; root.classList.toggle('askOn', on); $('#hs-other')?.setAttribute('aria-expanded', String(on)); if (on) $('#hs-panel').querySelector('button, a')?.focus(); };
    $('#hs-scrim').addEventListener('click', () => setPanel(false));
    $('#hs-panel').addEventListener('click', (e) => {
      if (e.target.closest('#hs-panelX')) { setPanel(false); $('#hs-other')?.focus(); return; }
      const alt = e.target.closest('[data-prefer]');
      if (alt) { ui.prefer = alt.dataset.prefer; setPanel(false); paint(); pulse(root); }
    });
    main.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#hs-panel').hidden) { setPanel(false); $('#hs-other')?.focus(); } });
    $('#q').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = new FormData(e.target).get('q').trim();
      if (q) location.hash = offline ? `#/bus?q=${encodeURIComponent(q)}` : askHref(q);
    });
    mountBrain($('#hs-brain'), $('#hs-tip'), root, onCleanup);

    // 先用手上有的畫（不等網路）；再查天氣空品與辦公日曆、交通即時、散步判斷
    paint();
    if (full) introPulse(root);
    api.status().then(paint).catch(() => {});
    (async () => {
      if (offline) return;
      ui.nowLoading = !ui.nowData;
      const area = homeArea();
      ui.nowData = await loadNow({ callTool: (n, a) => host.callTool(n, a), granted: locationGranted, locate: () => browserLocation(4000), fallback: area || FALLBACK, ...(area && { fallbackName: areaLabel(area) }) }).catch(() => null);
      ui.nowLoading = false;
      paint();
      const pos = ui.nowData?.pos || null;
      const commute = loadCommute();
      const plan = tilePlan({ commute, legIndex: ui.d?.kind === 'home' ? commute?.legs?.length - 1 : 0, pos, fav: favs.list()[0] });
      if (plan.length) { ui.transit = await loadTransit({ callTool: (n, a) => host.callTool(n, a), plan, pos }).catch(() => ui.transit); paint(); }
      const n = ui.nowData && !ui.nowData.offline ? await homeNudge({ weather: ui.nowData.weather, air: ui.nowData.aqi?.nearest || null, pos }).catch(() => null) : null;
      if (n) { ui.walk = n; paint(); }
    })().catch(() => {});

    // 提醒、行程、記得的東西變了就重算；每分鐘更新一次時間
    const repaint = () => paint();
    const EVS = ['abang:reminders', 'abang:alight-watch', 'abang:arrival-watch', 'abang:memory', 'abang:onboarded'];
    for (const ev of EVS) addEventListener(ev, repaint);
    // 散步：開關或「今天不用」變了就重新判斷（在手機上）
    const renudge = async () => { const v = ui.nowData; ui.walk = v && !v.offline ? await homeNudge({ weather: v.weather, air: v.aqi?.nearest || null, pos: v.pos || null }).catch(() => null) : null; paint(); };
    for (const ev of ['abang:health-setting', 'abang:health-day']) addEventListener(ev, renudge);
    onCleanup(() => { for (const ev of ['abang:health-setting', 'abang:health-day']) removeEventListener(ev, renudge); });
    const tick = setInterval(repaint, 60_000);
    const relayout = () => paintSignals(root, ui.d, true);
    addEventListener('resize', relayout);
    onCleanup(() => { for (const ev of EVS) removeEventListener(ev, repaint); clearInterval(tick); removeEventListener('resize', relayout); });
  },
};

/** 點服務：圖示飛進下一頁的頁首（View Transitions；不支援或減少動態時照常換頁）。服務總覽頁共用 */
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

/** 那一類資料是示範的（/api/v1/status 的 sources；還沒查到時看整體模式） */
const allDemo = () => (!state.sources ? state.mode === 'demo' : state.sources.length > 0 && state.sources.every((x) => x.mode === 'demo'));
const isDemo = (id) => (state.sources ? state.sources.some((x) => x.id === id && x.mode === 'demo') : state.mode === 'demo');

/** 核心旁的訊號與連線（只連這次用到的；ADR-0023 §1） */
function paintSignals(root, d, relayoutOnly = false) {
  if (!d) return;
  const ul = root.querySelector('#hs-sigs');
  const sig = JSON.stringify(d.signals);
  if (!relayoutOnly && ul.dataset.sig !== sig) {
    ul.dataset.sig = sig;
    ul.classList.toggle('n4', d.signals.length > 3);
    ul.innerHTML = d.signals.map((s, i) => `<li class="hs-sig e${s.tone === 'warn' ? ' warn' : ''}" style="--a:hs-sigL;--t:${(0.15 + i * 0.13).toFixed(2)}s;--d:.35s"><small>${esc(s.label)}</small><b>${esc(s.value)}</b></li>`).join('');
  }
  requestAnimationFrame(() => {
    const st = root.querySelector('#hs-stage');
    const box = root.querySelector('.hs-threads');
    const mark = root.querySelector('.hs-markW');
    if (!st || !box || !mark) return;
    const sr = st.getBoundingClientRect(), mr = mark.getBoundingClientRect();
    const core = { x: mr.left - sr.left + mr.width / 2, y: mr.top - sr.top + mr.height * 0.68 };
    const from = [...ul.children].map((li) => { const r = li.getBoundingClientRect(); return { x: r.right - sr.left + 10, y: r.top - sr.top + r.height / 2 }; });
    box.innerHTML = threads(from, core).map((t, i) => `<div class="hs-th" style="left:${t.left}px;top:${t.top}px;width:${t.len}px;transform:rotate(${t.deg}deg)"><i class="ln e" style="--a:hs-lineIn;--t:${(0.23 + i * 0.13).toFixed(2)}s;--d:.3s"></i><i class="dot e" style="--a:hs-pop;--t:${(0.15 + i * 0.13).toFixed(2)}s;--d:.3s"></i></div>`).join('');
  });
}

/** 建議卡 */
function paintCard(cc, d, { demo = false } = {}) {
  const html = cardHtml(d, { demo });
  if (cc.dataset.sig === html) return;
  const open = cc.querySelector('#hs-steps.open') != null;
  cc.dataset.sig = html;
  cc.innerHTML = html;
  if (open) { cc.querySelector('#hs-steps')?.classList.add('open'); cc.querySelector('#hs-sum')?.setAttribute('aria-expanded', 'true'); }
}
export function cardHtml(d, { demo = false } = {}) {
  const chip = (x) => {
    if (x === d.route?.[0] || x === d.route?.[d.route.length - 1]) return `<span class="hs-pl">${esc(x)}</span>`;
    const leg = d.legs?.find((l) => (l.mode === 'bus' ? l.route : l.name || l.line) === x);
    const bad = leg?.status?.long;
    const c = leg?.mode === 'metro' ? LINE_COLOR[leg.line] || '#0e7490' : '#2563EB';
    return `<span class="hs-rl${bad ? ' bad' : ''}" style="background:${c}">${esc(x)}</span>`;
  };
  const seg = d.origin ? `<div class="hs-org"><div class="hs-seg" role="group" aria-label="出發地">${[['fixed', d.origin.fixedKey ? placeName(d.origin.fixedKey) : ''], ['here', '目前位置']].filter(([, t]) => t).map(([o, t]) => `<button type="button" data-o="${o}" class="${d.origin.mode === o ? 'on' : ''}" aria-pressed="${d.origin.mode === o}">${esc(t)}</button>`).join('')}</div><small>${esc(d.origin.sub)}</small></div>` : '';
  const arrow = `<span class="hs-ar" aria-hidden="true">${icons.chev}</span>`;
  const route = d.legs ? `<div class="hs-route">${seg}<div class="hs-rn">${d.route.slice(1).map((x) => arrow + chip(x)).join('')}</div></div>`
    : d.origin ? `<div class="hs-od">${seg || `<b>${esc(d.origin.label)}</b>`}<span class="hs-odA" aria-hidden="true"></span><div class="hs-odT"><span class="hs-odI">${icons.home}</span><b>住家</b></div></div>` : '';
  const r = d.readout;
  const read = r ? `<div class="hs-read"><div class="hs-big${r.big != null ? '' : ' ic'}">${r.big != null ? `${r.big}<small>${esc(r.unit)}</small>` : icons[d.legs?.[0]?.mode === 'metro' ? 'metro' : 'bus']}</div><div class="hs-rr"><p>${esc(r.line)}<small>・${esc(r.note)}</small></p><p>${esc(d.origin?.mode === 'here' ? '從目前位置出發' : `從${d.route[0]}出發`)}・${esc(d.statusText || '')}</p></div></div>` : d.kind === 'walk' ? '<div class="hs-move" id="hs-move"></div>' : '';
  const steps = d.cta?.steps || [];
  const tag = d.legs ? `<span class="hs-tag${d.origin?.mode === 'here' ? ' here' : ''}">${d.origin?.mode === 'here' ? '依目前位置' : '固定方式'}</span>` : '';
  const stat = d.statusText ? `<span class="hs-stat"><i></i>${esc(d.statusText)}</span>` : '';
  const eye = d.eyebrow === '已依目前位置調整' ? `<em class="hs-adj">・${esc(d.eyebrow)}</em>` : `<small>・${esc(d.eyebrow)}</small>`;
  return `<div class="hs-eye ci"><span class="l">現在的建議${eye}${demo ? '<span class="tag demo" title="目前是示範資料，不是即時資料">示範</span>' : ''}</span><button type="button" class="hs-lnk" id="hs-why-btn" aria-haspopup="dialog">為何顯示此建議${icons.chev}</button></div>
    <div class="hs-trow ci"><h2 class="hs-ttl" id="hs-ttl">${esc(d.title)}</h2>${tag}${stat}</div>
    ${route}${read}
    ${d.kind === 'walk' ? '' : `<a class="hs-cta ci" href="${esc(ctaHref(d))}">${esc(d.cta?.label || '問阿幫')}${icons.chev}<span class="shine" aria-hidden="true"></span></a>`}
    ${steps.length && d.kind !== 'walk' ? `<div class="hs-steps ci" id="hs-steps"><button type="button" class="hs-sum" id="hs-sum" aria-expanded="false" aria-controls="hs-stepsL"><b>按下後：</b><span>${esc(steps.map((s) => s.replace(/，.*$/, '')).join(' → '))}</span>${icons.down}</button><div class="hs-more"><div><ol id="hs-stepsL">${steps.map((s, i) => `<li><i>${i + 1}</i>${esc(s)}</li>`).join('')}</ol></div></div></div>` : ''}
    <div class="hs-foot ci">${d.cta?.alt ? `<a class="hs-lnk" href="${esc(ctaHref(d))}">${esc(d.cta.alt.label)}${icons.chev}</a>` : '<span></span>'}<button type="button" class="hs-lnk" id="hs-other" aria-expanded="false" aria-controls="hs-panel">其他建議${icons.chev}</button></div>`;
}

/** 您可能想問（輸入列上方；可左右滑） */
function paintAsks(box, asks) {
  const html = `<span class="hs-askL">您可能想問</span>${asks.map((a) => `<a class="hs-chip${a.resume ? ' cont' : ''}" href="${esc(a.href)}">${icons[ASK_ICON[a.icon]] || icons.chev}${esc(a.q)}</a>`).join('')}`;
  if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
}
/** 其他建議面板（跟您可能想問同一份清單） */
function paintPanel(p, d, asks) {
  const ALT = { safety: 'info', trip: 'bus', new: 'home', commute: 'office', home: 'home', late: 'metro', out: 'home', walk: 'walk', tomorrow: 'umbrella' };
  p.innerHTML = `<div class="hs-apH"><span>其他建議</span><button type="button" id="hs-panelX" aria-label="收起">${icons.down}</button></div>
    ${d.alt.length ? `<div class="hs-apS">${d.alt.map((a) => `<button type="button" data-prefer="${esc(a.kind)}"><span class="oi">${icons[ALT[a.kind]] || icons.info}</span>${esc(a.title)}${icons.chev}</button>`).join('')}</div>` : '<p class="hs-apE">現在沒有其他建議</p>'}
    <div class="hs-apH"><span>您可能想問</span></div><div class="hs-apC">${asks.map((a) => `<a class="hs-chip${a.resume ? ' cont' : ''}" href="${esc(a.href)}">${icons[ASK_ICON[a.icon]] || icons.chev}${esc(a.q)}</a>`).join('')}</div>`;
}

/** 即時資料兩格：查得到才寫數字；沒有就是可以按的空格（教怎麼設） */
function paintLive(box, d, t) {
  const tile = (c, ic, k, num, unit, sub, href, live = true) => `<a class="hs-tile" href="${href}"><span class="k"><span class="ab-token sm" style="--c:${c}">${icons[ic]}</span>${k}</span><span class="v">${num != null ? `<span class="num">${num}</span><span class="unit">${esc(unit)}</span>` : ''}<span class="sub">${sub}</span></span>${live ? '<i class="hs-liveDot" aria-hidden="true"></i>' : ''}</a>`;
  const empty = (k, p, href) => `<a class="hs-tile empty" href="${href}"><span class="k"><span class="pl">${icons.plus}</span>${esc(k)}</span><p>${esc(p)}</p></a>`;
  const out = [];
  const second = d.legs?.[1];
  if (second?.mode === 'metro') out.push(tile(LINE_COLOR[second.line] || '#0e7490', 'metro', `${esc(second.name || second.line)}${second.station ? ` ${esc(second.station)}站` : ''}`, null, '', '依時刻表', '#/s/metro', false));
  else if (second?.mode === 'bus') { const b = t.transit?.bus?.find((x) => x.route === second.route); out.push(tile('#0f766e', 'bus', `轉乘<span class="rt">${esc(second.route)}</span>`, b ? b.mins : null, '分', b ? esc(second.stop ? `${second.stop}上車` : '即時') : '按了再查', '#/bus', !!b)); }
  else if (t.fav) out.push(tile('#0f766e', 'bus', `常用<span class="rt">${esc(t.fav.route)}</span>`, t.fav.mins, '分', esc(t.fav.title), t.fav.href || '#/favs'));
  else if (favs.list()[0]) { const f = favs.list()[0]; out.push(tile('#0f766e', 'bus', esc(f.title).slice(0, 12), null, '', '按了查到站時間', f.href, false)); }
  else out.push(empty('選擇常用路線', '首頁直接顯示到站時間', '#/bus'));
  if (t.bike) out.push(tile('#d97706', 'bike', `YouBike ${esc(String(t.bike.name || '').replace(/^YouBike\s*2\.0_/, '').slice(0, 8))}`, t.bike.rent ?? null, '台', Number.isFinite(t.bike.returnSlots) ? `可還 <b>${t.bike.returnSlots}</b> 位` : '', '#/nearby?tab=bike'));
  else if (!loadPlaces()['家']) out.push(empty('設定住家', '之後直接建議返家路線', '#/settings'));
  else out.push(tile('#d97706', 'bike', 'YouBike', null, '', '附近可借可還', '#/nearby?tab=bike', false));
  const html = out.join('');
  if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
}

/** 天空下的天氣一行（查不到就說查不到，不說成沒有） */
function paintWx(p, v) {
  const w = v?.weather;
  let text;
  if (v?.offline) text = '離線中，連上網路再看天氣';
  else if (!v) text = '正在看天氣…';
  else if (!w) text = '天氣這次查不到';
  else {
    const t = Number.isFinite(w.tempC) ? `${Math.round(w.tempC)}°` : '';
    const sky = String(w.summary || '').split(/[，,、\s]/)[0].replace(/[0-9.]+°C?/, '').slice(0, 6); // 「多雲，15.6°C，3 小時降雨…」只取「多雲」
    const rain = w.rainMm1h > 0 ? '正在下雨' : w.raining ? '可能會下雨' : Number.isFinite(w.pop3h) ? `降雨機率 ${w.pop3h}%` : '';
    const aqi = v.aqi?.nearest?.aqi;
    const parts = [`${t} ${sky}`.trim(), rain, aqi != null && aqi !== '' ? `AQI ${aqi}` : ''].filter(Boolean);
    text = !parts.length ? '天氣這次查不到' : v.pos ? parts.join('・') : [v.place || '台北車站附近', ...parts.slice(0, 2)].join('・'); // 沒定位：照實寫是哪裡的天氣
  }
  const html = `${icons.sun}<span>${esc(text)}</span>`;
  if (p.dataset.sig !== html) { p.dataset.sig = html; p.innerHTML = html; }
}

/** 提醒鍵上的數字 */
function paintBadge(a) {
  const n = reminderItems({ arrival: currentArrivalWatch(), alight: alightWatch(), leave: listReminders() }).length;
  const b = a?.querySelector('.hs-badge');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : String(n);
  a.setAttribute('aria-label', n ? `提醒，進行中 ${n} 個` : '提醒');
}

/** Android 主畫面小工具「阿幫・今天」：沿用今天卡的內容（之後改成新的建議規則，ADR-0023 影響） */
function pushWidget(v) {
  try {
    const p = todayPlan({ day: v?.day || null, weather: v?.weather || null, aqi: v?.aqi || null, offline: !!v?.offline, places: loadPlaces(), area: homeArea(), located: !!v?.pos, onboarded: onboarded(), loading: false });
    if (p.show) pushTodayWidget(p);
  } catch { /* 小工具失敗不影響首頁 */ }
}
async function pinWidget(toast) {
  const sys = globalThis.Capacitor?.Plugins?.AbangSystem;
  try { const r = await sys?.pinTodayWidget?.(); toast(r?.ok === false ? '這支手機不支援直接加入，請長按主畫面 → 小工具 → 阿幫・今天' : '請在系統畫面確認加入主畫面'); } catch { toast('請長按主畫面 → 小工具 → 阿幫・今天'); }
}

/** 金色頭腦：點一下浮出「手機上的 AI・引擎」2.5 秒；浮出時再點進阿幫的腦袋 */
function mountBrain(btn, tip, root, onCleanup) {
  let text = '手機上的 AI', t = 0;
  const put = (st) => {
    const on = st?.available && edgeEnabled();
    text = on ? `手機上的 AI・<b>${esc(EDGE_ENGINE_NAME[st.engine] || '手機內建模型')}</b>` : st?.reason === 'web' ? '網頁版・<b>由阿幫伺服器判斷</b>' : st ? '手機上的 AI・<b>目前由伺服器判斷</b>' : '手機上的 AI・<b>檢查中</b>';
    btn.setAttribute('aria-label', `${text.replace(/<[^>]+>/g, '')}。看說明`);
    btn.classList.toggle('off', !on);
  };
  put(null);
  edgeStatus().then(put, () => put({ available: false, reason: 'no-plugin' }));
  btn.addEventListener('click', () => {
    if (root.classList.contains('tipOn')) { location.hash = '#/ai'; return; }
    tip.innerHTML = text;
    root.classList.add('tipOn');
    clearTimeout(t);
    t = setTimeout(() => root.classList.remove('tipOn'), 2500);
    pulse(root);
  });
  onCleanup(() => clearTimeout(t));
}

/** 核心亮一下（減少動態時不做） */
function pulse(root) {
  if (reduced()) return;
  const core = root.querySelector('.coreP'), flash = root.querySelector('.hs-flash');
  core?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
  flash?.animate?.([{ opacity: 0.9, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(2.6)' }], { duration: 640, easing: 'ease-out' });
  root.querySelector('.hs-bird')?.animate?.([{ transform: 'none' }, { transform: 'translateY(-8px)' }, { transform: 'none' }], { duration: 480, easing: 'ease-out' });
}
function introPulse(root) {
  setTimeout(() => pulse(root), 800);
  setTimeout(() => root.classList.remove('play'), 2200); // 進場跑完：之後的重畫不再重跑進場動畫
}

/** 更多功能：不自動輪播；左右滑或點圓點 */
function mountCaps(root, caps, { info, pin }) {
  const SC = { cam: `${icons.receipt}<b class="scan"></b>`, siri: '<i></i><i></i><i></i><i></i><i></i>', widget: icons.grid, lock: `${icons.lock}<b>3 分</b>`, cal: `${icons.cal}`, walk: `${icons.walk}` };
  const track = root.querySelector('#hs-capsT');
  track.innerHTML = caps.map((c, i) => `<article class="hs-cap${i ? '' : ' on'}" data-cap="${c.id}"><div class="sc sc-${c.id}" aria-hidden="true">${SC[c.id] || ''}</div><div class="ct"><h3>${esc(c.title)}</h3><p>${esc(c.text).replace('\n', '<br>')}</p></div>${c.href ? `<a class="try" href="${esc(c.href)}">試用</a>` : `<button type="button" class="try${c.act === 'info' ? ' info' : ''}">${c.act === 'info' ? '了解' : '試用'}</button>`}</article>`).join('');
  const dots = root.querySelector('#hs-dots');
  dots.innerHTML = caps.map((c, k) => `<button type="button" aria-label="第 ${k + 1} 項：${esc(c.title)}"${k ? '' : ' aria-current="true"'}><i></i></button>`).join('');
  const n = root.querySelector('#hs-capN');
  const view = root.querySelector('#hs-capsV');
  let idx = 0;
  const go = (i) => {
    idx = Math.max(0, Math.min(caps.length - 1, i));
    const card = track.children[idx];
    track.style.transform = `translateX(${-Math.min(card.offsetLeft, Math.max(0, track.scrollWidth - view.clientWidth))}px)`;
    [...track.children].forEach((c, k) => c.classList.toggle('on', k === idx));
    [...dots.children].forEach((d, k) => { if (k === idx) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    n.textContent = `${idx + 1}／${caps.length}`;
  };
  go(0);
  dots.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go([...dots.children].indexOf(b)); });
  let x0 = null;
  view.addEventListener('pointerdown', (e) => { if (!e.target.closest('.try')) x0 = e.clientX; });
  view.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 36) go(idx - Math.sign(dx)); else { const c = e.target.closest('.hs-cap'); if (c) go([...track.children].indexOf(c)); } });
  view.addEventListener('pointercancel', () => { x0 = null; });
  track.addEventListener('click', (e) => {
    const b = e.target.closest('button.try');
    if (!b) return;
    const c = caps[[...track.children].indexOf(b.closest('.hs-cap'))];
    if (c.id === 'widget') pin(); else info(c);
  });
  track.addEventListener('focusin', (e) => { const c = e.target.closest('.hs-cap'); if (c) go([...track.children].indexOf(c)); });
}

/** 「了解」：一段說明（不跳離首頁） */
function openInfo(dlg, c) {
  dlg.innerHTML = `<h2 id="hs-info-h">${esc(c.title)}</h2><p>${esc(c.info || c.text)}</p><form method="dialog"><button class="btn">知道了</button></form>`;
  dlg.showModal?.();
}

/** 為何顯示此建議：這次用了哪些資料；阿幫記得的東西在這裡看、在這裡刪（ADR-0023 §6） */
function openWhy(dlg, d, toast) {
  if (!d) return;
  dlg.innerHTML = `<h2 id="hs-why-h">為何顯示此建議</h2>
    <p class="hs-whyT">「${esc(d.title)}」是依這些資料判斷的（判斷在這支手機上用固定的規則，不是模型猜的）：</p>
    <ul class="hs-whyL">${d.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <h3>這次用到的資訊</h3>
    <ul class="hs-whyL">${d.signals.map((s) => `<li><b>${esc(s.label)}</b> ${esc(s.value)}</li>`).join('')}</ul>
    <p class="hs-whyN">住家、公司、固定通勤方式、上次的對話都只存在這支手機。</p>
    <div class="hs-whyA"><button type="button" class="btn quiet" id="hs-mem">看或刪除阿幫記得的東西</button><form method="dialog"><button class="btn">知道了</button></form></div>`;
  dlg.querySelector('#hs-mem').addEventListener('click', () => { dlg.close(); openMemorySheet({ toast }); });
  dlg.showModal?.();
}

