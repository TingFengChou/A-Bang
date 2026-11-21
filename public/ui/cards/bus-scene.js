// 公車街景（取代看不懂的傾斜路線圖；2026-11-20 Austin：「引導到公車站那不應該是 3D 傾斜圖，沒人看得懂」）：
// Blender 算好的低多邊形街景（scripts/blender/bus-scene.py → public/img/scene/），公車依真實「還有幾站」停在路上，
// 站牌上方寫站名、公車上方寫「601・還有 2 站・約 7 分」。文字是網頁文字（清楚、可縮放、念得出來）。
// 怎麼走到站牌交給「導航」按鈕（官方地圖 App）。reduced motion／精簡模式：公車不滑動。

/** 與 public/img/scene/scene.json 相同（test 會比對）：畫布大小、世界 x 每 +1 的畫面位移、站牌牌面、公車 x=0 時的車頂上方 */
export const SCENE = { w: 960, h: 420, unit: [43.7, 7.0], sign: [708.4, 102.5], busStopAt: 3.2, busLabel: [366.8, 128.6] };
const PER_STOP = 4.2;
const DRIVE_SEC = 20;   // 兩次更新之間（公車頁每 20 秒）
const SLIDE_MS = 1100;  // 新資料時開到新位置的時間   // 一站在畫面上的距離（世界單位；示意，不是真實比例）
const MAX_SHOWN = 2.2;  // 超過約兩站就停在畫面左邊，文字寫實際站數

/** 公車在街景裡的世界 x：停靠＝busStopAt，每遠一站往左 PER_STOP；太遠停在左邊 */
export const busX = (away) => SCENE.busStopAt - Math.min(Math.max(away ?? 0, 0), MAX_SHOWN) * PER_STOP;

/**
 * 公車會動（2026-11-21 Austin：「公車會動吧，讓他動起來」）：兩次更新之間（20 秒）照到站時間往站牌慢慢開。
 * 從 x 開往站牌，etaSec 秒到；這段時間（windowSec）開到哪裡。最多開到站牌前一點（真的到站由下一次更新決定），太遠的不動（停在畫面左邊）。
 * @returns {number} 世界 x
 */
export function driveTo(x, etaSec, windowSec = 20) {
  if (!Number.isFinite(etaSec) || etaSec <= 0 || x >= SCENE.busStopAt) return x;
  if (x <= busX(MAX_SHOWN) + 1e-9) return x; // 還很遠（停在畫面左邊）：不動，免得每次更新又跳回去
  const stopAt = SCENE.busStopAt - 0.25;
  if (x >= stopAt) return x;
  return Math.min(stopAt, x + (SCENE.busStopAt - x) * Math.min(1, windowSec / etaSec));
}

/** 世界 x → 公車圖要平移的百分比（相對畫布） */
export const busShift = (x) => [(SCENE.unit[0] * x) / SCENE.w * 100, (SCENE.unit[1] * x) / SCENE.h * 100];

const still = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || document.documentElement.classList.contains('lite-motion');

/**
 * 街景的說明（左上角固定；分鐘最重要，單獨加粗）。只有 1 分鐘內才說「就在你這站」：
 * away＝0 只代表前面沒有更早到的站（上一站沒資料時車可能還要 10 分）。PR #29 審查修正。
 * @returns {{ head: string, eta: string, near: boolean }}
 */
export function sceneSay({ routeName, away, etaSec, etaText, riding = false }) {
  if (away == null) return { head: routeName, eta: etaText, near: false };
  if (away === 0) return etaSec != null && etaSec <= 60 ? { head: `${routeName}・${riding ? '快到了，準備下車' : '就在你這站'}`, eta: etaText, near: true } : { head: routeName, eta: etaText, near: false };
  return { head: `${routeName}・還有 ${away} 站`, eta: etaText, near: false };
}

/**
 * @param {{ routeName: string, stopName: string, away: number|null, etaSec?: number|null, etaText: string, state?: { sceneX?: number, away?: number|null, at?: boolean, drive?: { x0: number, x1: number, t0: number, ms: number }|null }, riding?: boolean, dataAt?: number|null }} o
 *   away：公車還有幾站（railOf）；null＝推估不出來（未發車等）→ 不畫公車，只寫狀態
 *   dataAt：這筆到站時間是什麼時候查到的（毫秒；提早重畫時只開剩下的時間）
 *   state：同一個頁面跨更新保留（drive 上次慢慢開的起終點與時間、sceneX、away 上次站數）
 * @returns {HTMLElement}
 */
export function busScene({ routeName, stopName, away, etaSec = null, etaText, state = {}, riding = false, dataAt = null }) {
  const box = document.createElement('div');
  box.className = 'ab-scene3d';
  const say = sceneSay({ routeName, away, etaSec, etaText, riding });
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${say.head}・${say.eta}；${riding ? `你在車上，在「${stopName}」下車` : `你在「${stopName}」等車`}`); // riding：行程中模式，站牌是下車站
  const img = (src, cls) => {
    const i = document.createElement('img');
    Object.assign(i, { src, alt: '', className: cls, decoding: 'async', draggable: false });
    i.onerror = () => { i.hidden = true; }; // 圖片載不到：只留底色與文字，不顯示破圖
    return i;
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
  // 站名：右上角靠右（長站名截斷，完整名稱在 title）；說明：左上角固定（公車的位置表示距離）——兩個標籤不會重疊
  const stop = el('span', 'ab-scene-label stop', stopName);
  stop.title = stopName;
  const caption = el('span', `ab-scene-label bus${say.near ? ' near' : ''}`);
  caption.append(el('span', '', `${say.head}・`), el('b', '', say.eta));
  const top = el('div', 'ab-scene-top'); // 上方一列：說明（分鐘優先完整）＋站名（空間不夠時截斷）
  top.append(caption, stop);
  box.append(img('/img/scene/street.webp', 'ab-scene-bg'), top);
  if (away == null) { state.drive = null; state.away = undefined; state.sceneX = undefined; state.at = false; } // 推估不出來：下次重新開進來
  else {
    const raw = away === 0 && !say.near ? busX(0.6) : busX(away); // 還沒到但前面沒有更早的站：停在站牌前一點
    // 現在實際開到哪（上一次慢慢開的起點、終點、開始時間內插；不是終點，提早重畫才不會往前跳）
    const now = Date.now();
    const d = state.drive;
    const cur = d ? d.x0 + (d.x1 - d.x0) * Math.min(1, Math.max(0, (now - d.t0) / d.ms)) : state.sceneX ?? null;
    // 同一台還在路上（站數沒變或變少）：不往回開，從現在開到的地方繼續；站數變多（換一台）才照資料重新定位
    const same = cur != null && state.away != null && away <= state.away && cur < SCENE.busStopAt;
    const x = same ? Math.max(raw, cur) : raw;
    state.away = away;
    const bus = el('div', 'ab-scene-bus');
    bus.append(img('/img/scene/bus.webp', 'ab-scene-img'));
    const from = cur ?? busX(MAX_SHOWN) - 3; // 第一次從畫面左邊開進來
    const place = (wx, how = '') => { bus.style.transition = how; const [dx, dy] = busShift(wx); bus.style.transform = `translate(${dx}%, ${dy}%)`; };
    const at = say.near || x >= SCENE.busStopAt; // 就在你這站：停著（開門、輕輕晃）
    // 之後慢慢往站牌開：只開這筆資料剩下的時間（資料 dataAt 之後已過的不重算，提早重畫不會多開）；不超過下一站的位置
    const elapsed = Math.max(0, (now - (dataAt ?? now)) / 1000);
    const win = Math.max(0, DRIVE_SEC - elapsed);
    const cap = away >= 1 ? busX(away - 1) : SCENE.busStopAt;
    const to = still() || at || !win ? x : Math.min(cap, Math.max(x, driveTo(x, etaSec == null ? null : etaSec - elapsed, win)));
    const lead = from !== x ? SLIDE_MS : 0; // 先開到現在的位置再慢慢開
    state.drive = { x0: x, x1: to, t0: now + lead, ms: win * 1000 || 1 };
    state.sceneX = x;
    bus.classList.toggle('moving', !still() && to > x);
    bus.classList.toggle('at-stop', at);
    if (at && !state.at && !still()) bus.classList.add('braking'); // 剛到站才煞車點一下（停著時每次更新不重播）
    state.at = at;
    bus.addEventListener('transitionend', () => { if (bus.style.transition.includes('linear')) bus.classList.remove('moving'); }); // 開到了（沒有新資料）：不再震動
    place(still() ? x : from);
    if (!still()) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (from !== x) place(x, `transform ${SLIDE_MS}ms cubic-bezier(.25, .9, .35, 1)`);
        if (to > x) setTimeout(() => { if (bus.isConnected) place(to, `transform ${win}s linear`); }, lead);
      }));
    }
    box.append(bus);
  }
  return box;
}
