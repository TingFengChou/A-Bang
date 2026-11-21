import { api, state as apiState } from '../api.js';
import { icons } from '../icons.js';
import { esc, loading, errorBox, empty, etaBadge, fmtTime, favs, prefs, chev, staleNote } from '../ui.js';
import { createWebHost } from '../../ui/cards/host-web.js';
import { modeSvg } from '../../ui/cards/mode-icons.js';
import { t as cardT } from '../../ui/cards/i18n/zh-TW.js';
import { snapshot, slide } from '../../ui/cards/slide.js';
import { busScene } from '../../ui/cards/bus-scene.js';
import { railOf } from '../../ui/cards/cards/bus-route.js';
import { watchAlight, stopAlight, alightWatch, rideEstimate, rideLeftText, rideLeftSec, busToDest } from '../alight.js';

/** 街景左上角放得下的短說法（站名已在站牌上） */
const rideLeftShort = (w) => { const s = rideLeftSec(w); return s == null ? '坐車中' : s < 60 ? '快到了' : `約 ${Math.round(s / 60)} 分`; };

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const CITY_CHIPS = [['Taipei', '臺北'], ['NewTaipei', '新北'], ['Taoyuan', '桃園'], ['Taichung', '臺中'], ['Tainan', '臺南'], ['Kaohsiung', '高雄'], ['Keelung', '基隆'], ['Hsinchu', '新竹']];
const REFRESH = 20000;

function starAction(setAction, toast, item) {
  const draw = () => setAction(favs.has(item.id) ? icons.starFill : icons.star, () => {
    toast(favs.toggle(item) ? '已加入收藏' : '已取消收藏'); draw();
  }, '收藏', favs.has(item.id));
  draw();
}

/** 路線搜尋 */
export const busSearch = {
  title: '公車',
  root: true,
  render({ main, query }) {
    let city = prefs.get('city', 'Taipei');
    main.innerHTML = `
      <form class="form" id="f">
        <div class="chips" id="cities">${CITY_CHIPS.map(([v, n]) => `<button type="button" class="chip" data-c="${v}">${n}</button>`).join('')}</div>
        <div class="row"><input class="field" name="q" placeholder="輸入路線，例如 307、紅30" value="${esc(query.q || '')}" enterkeyhint="search" autocomplete="off"><button class="btn">搜尋</button></div>
      </form>
      <div id="res"></div>`;
    const res = main.querySelector('#res');
    const chips = main.querySelectorAll('#cities .chip');
    const paint = () => chips.forEach((c) => c.classList.toggle('on', c.dataset.c === city));
    chips.forEach((c) => c.addEventListener('click', () => { city = c.dataset.c; prefs.set('city', city); paint(); search(); }));
    paint();

    async function search() {
      const q = main.querySelector('[name=q]').value.trim();
      if (!q) return (res.innerHTML = empty('輸入路線號碼開始查詢'));
      res.innerHTML = loading();
      try {
        const rows = await api.busRoutes(city, q);
        res.innerHTML = rows.length
          ? `<div class="card list">${rows.map((r) => `
              <a href="#/bus/${r.city}/${encodeURIComponent(r.routeName)}">
                <div class="grow"><div class="title">${esc(r.routeName)}</div><div class="sub">${esc(r.departure)} ⇄ ${esc(r.destination)}</div></div>${chev}
              </a>`).join('')}</div>`
          : empty('找不到符合的路線');
      } catch (e) { res.innerHTML = errorBox(e); }
    }
    main.querySelector('#f').addEventListener('submit', (e) => { e.preventDefault(); search(); });
    search();
  },
};

/**
 * 螢幕閱讀器播報（M6-04）：第一次載入不念（內容本身會被讀到）；之後每 20 秒刷新，文字有變才更新 live region。
 * @param {HTMLElement} el aria-live 區塊（常駐，不隨列表重畫）
 */
export function announcer(el) {
  let first = true, last = '';
  return (text) => {
    if (!first && text && text !== last) el.textContent = text;
    first = false; last = text;
  };
}

/** 路線即時到站 */
export const busRoute = {
  title: '路線',
  render({ main, params: [city, route], query = {}, setTitle, setAction, toast, onCleanup }) {
    route = decodeURIComponent(route);
    setTitle(`${route} 公車`);
    starAction(setAction, toast, { id: `route:${city}:${route}`, type: 'route', title: `${route} 公車`, sub: '路線', href: location.hash.split('?')[0] });
    // ?stop=&dir=：問阿幫選公車後「開公車頁看動態」帶來的上車站（L-14）；也可以在時間軸點站名設定（到站提醒、下車提醒都從這裡開始）
    let myStop = query.stop || null;
    const host = createWebHost();
    let dir = Number(query.dir) === 1 ? 1 : 0, data = null, stale = null;
    main.innerHTML = `<div id="focus"></div><div id="scene"></div><div class="seg" id="dirs"></div><p class="note pick-hint" id="pick-hint">點站名設成上車站，就能設到站提醒和下車提醒。</p><div id="stops">${loading()}</div><div class="updated" id="upd"></div><p class="sr-only" aria-live="polite" aria-atomic="true" id="sr"></p>`;
    const say = announcer(main.querySelector('#sr'));
    let sceneState = {}; // 公車在街景裡上一次的位置（刷新時從那裡開過來）
    let alightAsked = false;

    async function load() {
      try {
        data = await api.busEta(city, route);
        stale = apiState.staleAt; // 連不上時拿到的是上次存下的資料：不當成即時
        paint({ fresh: true });
        if (query.alight && !alightAsked) { // 問阿幫「上車後提醒我下車」帶來：直接到選下車站
          alightAsked = true;
          const sel = main.querySelector('#alight-dest');
          sel?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
          sel?.focus({ preventScroll: true });
        }
        const d = data.directions[dir] || data.directions[0];
        const soon = stale ? [] : (d?.stops || []).filter((s) => s.status === 0 && s.etaSec != null && s.etaSec < 180).slice(0, 3).map((s) => s.stopName);
        say(soon.length ? `${route} 即將進站：${soon.join('、')}` : '');
        main.querySelector('#upd').textContent = stale ? staleNote(stale) : `更新於 ${fmtTime()}・每 20 秒自動更新`;
      } catch (e) { main.querySelector('#stops').innerHTML = errorBox(e); }
    }
    const setUrl = () => { const qs = new URLSearchParams({ ...(myStop && { stop: myStop }), dir: String(dir) }); history.replaceState(null, '', `${location.hash.split('?')[0]}?${qs}`); };
    function paint({ fresh = false } = {}) {
      // 每 20 秒重畫：記下焦點在哪個站名或方向按鈕，畫完放回去（鍵盤與讀屏不會掉到頁首）
      const act = document.activeElement;
      const keep = act?.dataset?.stop != null ? `.stop-pick[data-stop="${CSS.escape(act.dataset.stop)}"]` : act?.dataset?.i != null && act.closest?.('#dirs') ? `#dirs button[data-i="${act.dataset.i}"]` : null;
      const dirs = main.querySelector('#dirs');
      dirs.innerHTML = data.directions.map((d, i) => `<button data-i="${i}" class="${i === dir ? 'on' : ''}" aria-pressed="${i === dir}">${esc(d.label)}</button>`).join('');
      dirs.querySelectorAll('button').forEach((b) => (b.onclick = () => { dir = +b.dataset.i; sceneState = {}; setUrl(); paint(); }));
      const d = data.directions[dir] || data.directions[0];
      // 公車街景：有上車站才畫；公車依真實「還有幾站」停在路上（怎麼走到站牌交給導航）
      // 坐車中（行程中模式）：站牌換成下車站，公車往下車站開
      const me = myStop && d.stops.find((x) => x.stopName === myStop);
      const ride = riding(d);
      const at = ride ? d.stops.find((x) => x.seq === ride.destSeq) || d.stops.find((x) => x.stopName === ride.dest) : me;
      // 坐車中：下車站的「下一班」不一定是我這台（前面可能還有一台）；看得出是我這台才畫公車與站數，否則只寫剩多久
      const mine = !ride || (at && busToDest(d.stops, d.stops.findIndex((x) => (ride.boardSeq != null ? x.seq === ride.boardSeq : x.stopName === myStop)), d.stops.indexOf(at)).where === 'ahead');
      const rail = at && mine && railOf(d, { seq: at.seq, etaSec: at.etaSec, status: at.status });
      main.querySelector('#scene').replaceChildren(...(at ? [busScene({ routeName: route, stopName: at.stopName, away: rail ? rail.away : null, etaSec: at.status === 0 ? at.etaSec : null, etaText: ride ? rideLeftShort(ride) : at.statusText, state: sceneState, riding: !!ride })] : []));
      const stopsEl = main.querySelector('#stops');
      const before = fresh ? snapshot(stopsEl) : null; // 刷新：車從上一站滑到這一站
      stopsEl.innerHTML = `<div class="card list timeline">${d.stops.map((s) => `
        <div class="${s.plate ? 'here' : ''}${s.stopName === myStop ? ' me' : ''}">
          ${s.plate ? `<span class="ab-token sm go bus-pos" data-plate="${esc(s.plate)}" style="--c:#0f766e" role="img" aria-label="公車在這附近">${modeSvg('bus')}</span>` : ''}
          <div class="grow"><div class="title"><button type="button" class="stop-pick" data-stop="${esc(s.stopName)}" aria-label="${esc(s.stopName)}，設為上車站" aria-pressed="${s.stopName === myStop}">${esc(s.stopName)}</button>${s.stopName === myStop ? '<span class="me-tag">你在這上車</span>' : ''}${ride && (s.seq === ride.destSeq || (ride.destSeq == null && s.stopName === ride.dest)) ? '<span class="me-tag off">你在這下車</span>' : ''}</div>${s.plate ? `<div class="plate">${esc(s.plate)} 即將抵達</div>` : ''}</div>
          ${etaBadge(s)}
        </div>`).join('')}</div>`;
      if (before) slide(stopsEl, before);
      // 點站名＝設成上車站（網址一起改，重新整理或分享都一樣；不觸發換頁）
      stopsEl.querySelectorAll('.stop-pick').forEach((b) => (b.onclick = () => {
        const had = otherWatches().length; // 換上車站前已經有提醒：提醒照舊，在上車站卡片上看得到、可以取消
        myStop = b.dataset.stop;
        setUrl();
        sceneState = {};
        paint();
        const card = main.querySelector('#focus .bus-focus');
        card?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
        card?.focus({ preventScroll: true }); // 焦點移到上車站卡片（按的站名按鈕已重畫）
        toast(had ? `上車站：${myStop}。原本的提醒還在，可在上方取消` : `上車站：${myStop}。可以設提醒了`);
      }));
      const hint = main.querySelector('#pick-hint');
      hint.textContent = me ? '點其他站名可以改上車站。' : '點站名設成上車站，就能設到站提醒和下車提醒。';
      paintFocus(d);
      if (keep) main.querySelector(keep)?.focus({ preventScroll: true });
    }
    /** 坐車中：這條路線、這個方向、從目前上車站設的下車提醒（行程中模式） */
    function riding(d) {
      const a = alightWatch();
      return a && a.routeName === route && a.direction === (d.direction ?? dir) && a.board === myStop ? a : null;
    }
    /** 這條路線、但不是目前上車站（或方向）的提醒：換上車站後還看得到、可以取消 */
    function otherWatches() {
      const out = [];
      const w = host.arrivalWatch();
      if (w && w.routeName === route && (w.stop !== myStop || (w.direction != null && w.direction !== dir))) out.push({ text: `另有提醒：「${w.stop}」到站前 ${w.minutes} 分`, cancel: () => host.unwatchArrival() });
      const a = alightWatch();
      if (a && a.routeName === route && (a.board !== myStop || a.direction !== dir)) out.push({ text: `另有下車提醒：在「${a.dest}」下車`, cancel: () => stopAlight() });
      return out;
    }
    /** 上車站：大字到站時間＋到站提醒（與問阿幫卡片共用同一個提醒） */
    function paintFocus(d) {
      const box = main.querySelector('#focus');
      const s = myStop && d.stops.find((x) => x.stopName === myStop);
      if (!s) { box.innerHTML = ''; return; }
      const w = host.arrivalWatch();
      const watching = w && w.routeName === route && w.stop === myStop && (w.direction == null || w.direction === (d.direction ?? dir));
      const live = !stale && s.status === 0 && s.etaSec != null; // 舊資料不給到站提醒（時間不準）
      const when = cardT(`busRoute.${host.arrivalNote?.() || 'whenOpenPage'}`);
      const others = otherWatches();
      const ride = riding(d);
      if (ride) { // 坐車中：大字是到下車站還要多久；不再顯示到站提醒按鈕（已經上車了）
        box.innerHTML = `<div class="card bus-focus riding" tabindex="-1" aria-labelledby="focus-at"><span class="ab-token lg go" style="--c:#0f766e" aria-hidden="true">${modeSvg('bus')}</span><div class="sub" id="focus-at">坐車中・從「${esc(myStop)}」上車</div><div class="big">${esc(rideLeftText(ride))}</div></div>`;
        box.querySelector('.bus-focus').append(alightBlock(d, s));
        return;
      }
      box.innerHTML = `<div class="card bus-focus" tabindex="-1" aria-labelledby="focus-at"><span class="ab-token lg${live ? ' go' : ''}" style="--c:#0f766e" aria-hidden="true">${modeSvg('bus')}</span><div class="sub" id="focus-at">到「${esc(myStop)}」</div><div class="big">${esc(s.statusText)}</div>
        ${watching && w.stuck ? `<div class="stuck"><p>${esc(cardT(`busRoute.stuck.${w.stuck}`, { route }))}</p><a class="btn" href="#/agent?q=${encodeURIComponent(w.trip?.to ? cardT('busRoute.stuckAskTo', { to: w.trip.to }) : cardT('busRoute.stuckAsk'))}">${esc(cardT('busRoute.stuckBtn'))}</a></div>` : ''}
        ${watching ? `<p class="ok" role="status">${w.skip ? `這班快到了、可能趕不上；下一班到站前 ${w.minutes} 分提醒你（${when}）` : `已設定：到站前 ${w.minutes} 分提醒你（${when}）`}<button class="btn ghost" id="unwatch" type="button">取消提醒</button></p>`
          : live ? `<div class="row">${[3, 5].map((n) => `<button class="btn" type="button" data-min="${n}">到站前 ${n} 分提醒我</button>`).join('')}</div>` : ''}</div>`;
      if (others.length) { // 這條路線還有別站（或別方向）的提醒：寫出來、可以取消
        const o = document.createElement('div');
        o.className = 'other-watch';
        for (const x of others) {
          const p2 = Object.assign(document.createElement('p'), { textContent: x.text });
          const c = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: '取消' });
          c.setAttribute('aria-label', `取消：${x.text}`);
          c.addEventListener('click', () => { x.cancel(); toast('已取消提醒'); paintFocus(d); });
          p2.append(c);
          o.append(p2);
        }
        box.querySelector('.bus-focus').append(o);
      }
      box.querySelector('.bus-focus').append(alightBlock(d, s));
      box.querySelectorAll('[data-min]').forEach((b) => (b.onclick = async () => {
        await host.watchArrival({ city, routeName: route, stop: myStop, direction: dir, minutes: Number(b.dataset.min) });
        toast(`好，${route} 到「${myStop}」前 ${b.dataset.min} 分提醒你`);
        paintFocus(data.directions[dir] || data.directions[0]);
      }));
      box.querySelector('#unwatch')?.addEventListener('click', () => { host.unwatchArrival(); toast(cardT('busRoute.alertCanceled')); paintFocus(d); });
    }
    let pickedDest = null;
    /** 下車提醒：上車後（或車快到時）選下車站，快到時提醒（App 關著也會響）；進行中顯示剩多久與取消 */
    function alightBlock(d, me) {
      const wrap = document.createElement('div');
      wrap.className = 'alight';
      const a = alightWatch();
      const dirOf = d.direction ?? dir;
      if (a && a.routeName === route && a.direction === dirOf && a.board === myStop) {
        // 剩多久在上方大字（行程中模式），這裡只說會提醒；不加 live role（設定時的 toast 已念過）
        wrap.innerHTML = `<p class="ok">下車提醒：快到「${esc(a.dest)}」前約 2 分提醒你</p>${a.nativeFailed ? '<p class="note">沒有通知權限：App 關著時不會提醒，請開著畫面。</p>' : ''}`;
        const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: '取消下車提醒' });
        cancel.addEventListener('click', () => { stopAlight(); toast('已取消下車提醒'); paintFocus(d); });
        wrap.append(cancel);
        return wrap;
      }
      const after = d.stops.filter((x) => x.seq > me.seq);
      if (!after.length || stale) return wrap;
      wrap.innerHTML = `<label class="alight-pick"><span>上車了嗎？要在哪一站下車？</span><select id="alight-dest">${after.map((x) => `<option value="${x.seq}"${x.seq === pickedDest ? ' selected' : ''}>${esc(x.stopName)}</option>`).join('')}</select></label>`;
      wrap.querySelector('select').addEventListener('change', (e) => { pickedDest = Number(e.target.value); }); // 每 20 秒重畫：選好的站保留
      const go = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: '快到時提醒我下車' });
      go.addEventListener('click', async () => {
        const destSeq = Number(wrap.querySelector('#alight-dest').value);
        const dest = d.stops.find((x) => x.seq === destSeq)?.stopName;
        const est = rideEstimate(d.stops, me.seq, destSeq);
        if (!est || !dest) { toast('估不出要坐多久，請重新整理後再試'); return; }
        const watching = await watchAlight({ city, routeName: route, direction: dirOf, board: myStop, boardSeq: me.seq, dest, destSeq, ...est }, (n, a2) => host.callTool(n, a2));
        if (watching) toast(`好，快到「${dest}」時提醒你下車`); // 太近：設定當下已經提醒過，不再說「好」
        paintFocus(data.directions[dir] || data.directions[0]);
      });
      wrap.append(go);
      return wrap;
    }
    const onWatch = () => data && paint(); // 提醒開始、更新、結束：上車站卡片、街景、時間軸一起換（坐車中 ⇄ 等車中）
    window.addEventListener('abang:alight-watch', onWatch);
    onCleanup(() => window.removeEventListener('abang:alight-watch', onWatch));
    window.addEventListener('abang:arrival-watch', onWatch);
    onCleanup(() => window.removeEventListener('abang:arrival-watch', onWatch));
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH);
    onCleanup(() => clearInterval(t));
  },
};

/** 站位即時到站 */
export const busStation = {
  title: '公車站',
  render({ main, params: [city, stationId], query, setTitle, setAction, toast, onCleanup }) {
    stationId = decodeURIComponent(stationId);
    const name = query.name || '公車站';
    setTitle(name);
    starAction(setAction, toast, { id: `station:${city}:${stationId}`, type: 'station', city, stationId, title: name, sub: '公車站', href: location.hash });
    main.innerHTML = `<div id="list">${loading()}</div><div class="updated" id="upd"></div><p class="sr-only" aria-live="polite" aria-atomic="true" id="sr"></p>`;
    const say = announcer(main.querySelector('#sr'));
    async function load() {
      try {
        const rows = await api.busStationEta(city, stationId);
        const stale = apiState.staleAt;
        say(stale ? '' : rows.slice(0, 3).map((r) => `${r.routeName} ${r.statusText}`).join('；'));
        main.querySelector('#list').innerHTML = rows.length
          ? `<div class="card list">${rows.map((r) => `
              <a href="#/bus/${city}/${encodeURIComponent(r.routeName)}">
                <div class="grow"><div class="title">${esc(r.routeName)}</div><div class="sub">${r.direction ? '返程' : '去程'}</div></div>${etaBadge(r)}
              </a>`).join('')}</div>`
          : empty('目前沒有到站資訊');
        main.querySelector('#upd').textContent = stale ? staleNote(stale) : `更新於 ${fmtTime()}・每 20 秒自動更新`;
      } catch (e) { main.querySelector('#list').innerHTML = errorBox(e); }
    }
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH);
    onCleanup(() => clearInterval(t));
  },
};

/** 收藏 */
export const favPage = {
  title: '收藏',
  root: true,
  render({ main }) {
    const l = favs.list();
    main.innerHTML = l.length
      ? `<div class="card list">${l.map((f) => `<a href="${esc(f.href)}"><div class="grow"><div class="title">${esc(f.title)}</div><div class="sub">${esc(f.sub)}</div></div>${chev}</a>`).join('')}</div>`
      : empty('還沒有收藏。在公車路線或站牌頁點右上角星號即可加入。');
  },
};
