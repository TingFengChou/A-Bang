import { api } from '../api.js';
import { icons } from '../icons.js';
import { esc, loading, errorBox, empty, etaBadge, fmtTime, favs, prefs, chev } from '../ui.js';
import { createWebHost } from '../../ui/cards/host-web.js';
import { modeSvg } from '../../ui/cards/mode-icons.js';
import { snapshot, slide } from '../../ui/cards/slide.js';
import { routeMap3d } from '../../ui/cards/route3d.js';

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
    // ?stop=&dir=：問阿幫選公車後「開公車頁看動態」帶來的上車站（L-14）；這裡也能設到站提醒
    const myStop = query.stop || null;
    const host = createWebHost();
    let dir = Number(query.dir) === 1 ? 1 : 0, data = null;
    main.innerHTML = `<div id="focus"></div><div class="seg" id="dirs"></div><div id="map3d"></div><div id="stops">${loading()}</div><div class="updated" id="upd"></div><p class="sr-only" aria-live="polite" aria-atomic="true" id="sr"></p>`;
    const say = announcer(main.querySelector('#sr'));
    let mapSeen = false;

    async function load() {
      try {
        data = await api.busEta(city, route);
        paint({ fresh: true });
        const d = data.directions[dir] || data.directions[0];
        const soon = (d?.stops || []).filter((s) => s.status === 0 && s.etaSec != null && s.etaSec < 180).slice(0, 3).map((s) => s.stopName);
        say(soon.length ? `${route} 即將進站：${soon.join('、')}` : '');
        main.querySelector('#upd').textContent = `更新於 ${fmtTime()}・每 20 秒自動更新`;
      } catch (e) { main.querySelector('#stops').innerHTML = errorBox(e); }
    }
    function paint({ fresh = false } = {}) {
      const dirs = main.querySelector('#dirs');
      dirs.innerHTML = data.directions.map((d, i) => `<button data-i="${i}" class="${i === dir ? 'on' : ''}">${esc(d.label)}</button>`).join('');
      dirs.querySelectorAll('button').forEach((b) => (b.onclick = () => { dir = +b.dataset.i; mapSeen = false; paint(); }));
      const d = data.directions[dir] || data.directions[0];
      // 立體路線圖：路線形狀只有去程，回程用站點連線；刷新時不再播進場
      const me = myStop && d.stops.find((x) => x.stopName === myStop);
      const map = routeMap3d({ stops: d.stops, shape: (d.direction ?? dir) === 0 ? data.shape : null, meSeq: me?.seq ?? null, seen: mapSeen,
        label: `${route} 路線圖：${d.stops.length} 站，${d.stops.filter((x) => x.plate).length} 台車在路上` });
      main.querySelector('#map3d').replaceChildren(...(map ? [map] : []));
      if (map) mapSeen = true;
      const stopsEl = main.querySelector('#stops');
      const before = fresh ? snapshot(stopsEl) : null; // 刷新：車從上一站滑到這一站
      stopsEl.innerHTML = `<div class="card list timeline">${d.stops.map((s) => `
        <div class="${s.plate ? 'here' : ''}${s.stopName === myStop ? ' me' : ''}">
          ${s.plate ? `<span class="ab-token sm go bus-pos" data-plate="${esc(s.plate)}" style="--c:#0f766e" role="img" aria-label="公車在這附近">${modeSvg('bus')}</span>` : ''}
          <div class="grow"><div class="title">${esc(s.stopName)}${s.stopName === myStop ? '<span class="me-tag">你在這上車</span>' : ''}</div>${s.plate ? `<div class="plate">${esc(s.plate)} 即將抵達</div>` : ''}</div>
          ${etaBadge(s)}
        </div>`).join('')}</div>`;
      if (before) slide(stopsEl, before);
      paintFocus(d);
    }
    /** 上車站：大字到站時間＋到站提醒（與問阿幫卡片共用同一個提醒） */
    function paintFocus(d) {
      const box = main.querySelector('#focus');
      const s = myStop && d.stops.find((x) => x.stopName === myStop);
      if (!s) { box.innerHTML = ''; return; }
      const w = host.arrivalWatch();
      const watching = w && w.routeName === route && w.stop === myStop;
      const live = s.status === 0 && s.etaSec != null;
      box.innerHTML = `<div class="card bus-focus"><span class="ab-token lg${live ? ' go' : ''}" style="--c:#0f766e" aria-hidden="true">${modeSvg('bus')}</span><div class="sub">到「${esc(myStop)}」</div><div class="big">${esc(s.statusText)}</div>
        ${watching ? `<p class="ok" role="status">${w.skip ? `這班快到了、可能趕不上；下一班到站前 ${w.minutes} 分提醒你（App 開著時）` : `已設定：到站前 ${w.minutes} 分提醒你（App 開著時）`}<button class="btn ghost" id="unwatch" type="button">取消提醒</button></p>`
          : live ? `<div class="row">${[3, 5].map((n) => `<button class="btn" type="button" data-min="${n}">到站前 ${n} 分提醒我</button>`).join('')}</div>` : ''}</div>`;
      box.querySelectorAll('[data-min]').forEach((b) => (b.onclick = async () => {
        await host.watchArrival({ city, routeName: route, stop: myStop, direction: dir, minutes: Number(b.dataset.min) });
        toast(`好，${route} 到「${myStop}」前 ${b.dataset.min} 分提醒你`);
        paintFocus(data.directions[dir] || data.directions[0]);
      }));
      box.querySelector('#unwatch')?.addEventListener('click', () => { host.unwatchArrival(); paintFocus(d); });
    }
    const onWatch = () => data && paintFocus(data.directions[dir] || data.directions[0]);
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
        say(rows.slice(0, 3).map((r) => `${r.routeName} ${r.statusText}`).join('；'));
        main.querySelector('#list').innerHTML = rows.length
          ? `<div class="card list">${rows.map((r) => `
              <a href="#/bus/${city}/${encodeURIComponent(r.routeName)}">
                <div class="grow"><div class="title">${esc(r.routeName)}</div><div class="sub">${r.direction ? '返程' : '去程'}</div></div>${etaBadge(r)}
              </a>`).join('')}</div>`
          : empty('目前沒有到站資訊');
        main.querySelector('#upd').textContent = `更新於 ${fmtTime()}・每 20 秒自動更新`;
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
