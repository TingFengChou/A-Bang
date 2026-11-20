// 公車街景（取代看不懂的傾斜路線圖；2026-11-20 Austin：「引導到公車站那不應該是 3D 傾斜圖，沒人看得懂」）：
// Blender 算好的低多邊形街景（scripts/blender/bus-scene.py → public/img/scene/），公車依真實「還有幾站」停在路上，
// 站牌上方寫站名、公車上方寫「601・還有 2 站・約 7 分」。文字是網頁文字（清楚、可縮放、念得出來）。
// 怎麼走到站牌交給「導航」按鈕（官方地圖 App）。reduced motion／精簡模式：公車不滑動。

/** 與 public/img/scene/scene.json 相同（test 會比對）：畫布大小、世界 x 每 +1 的畫面位移、站牌牌面、公車 x=0 時的車頂上方 */
export const SCENE = { w: 960, h: 420, unit: [43.7, 7.0], sign: [708.4, 102.5], busStopAt: 3.2, busLabel: [366.8, 128.6] };
const PER_STOP = 4.2;   // 一站在畫面上的距離（世界單位；示意，不是真實比例）
const MAX_SHOWN = 2.2;  // 超過約兩站就停在畫面左邊，文字寫實際站數

/** 公車在街景裡的世界 x：停靠＝busStopAt，每遠一站往左 PER_STOP；太遠停在左邊 */
export const busX = (away) => SCENE.busStopAt - Math.min(Math.max(away ?? 0, 0), MAX_SHOWN) * PER_STOP;

/** 世界 x → 公車圖要平移的百分比（相對畫布） */
export const busShift = (x) => [(SCENE.unit[0] * x) / SCENE.w * 100, (SCENE.unit[1] * x) / SCENE.h * 100];

const still = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  || document.documentElement.classList.contains('lite-motion');

/**
 * 街景的說明（左上角固定；分鐘最重要，單獨加粗）。只有 1 分鐘內才說「就在你這站」：
 * away＝0 只代表前面沒有更早到的站（上一站沒資料時車可能還要 10 分）。PR #29 審查修正。
 * @returns {{ head: string, eta: string, near: boolean }}
 */
export function sceneSay({ routeName, away, etaSec, etaText }) {
  if (away == null) return { head: routeName, eta: etaText, near: false };
  if (away === 0) return etaSec != null && etaSec <= 60 ? { head: `${routeName}・就在你這站`, eta: etaText, near: true } : { head: routeName, eta: etaText, near: false };
  return { head: `${routeName}・還有 ${away} 站`, eta: etaText, near: false };
}

/**
 * @param {{ routeName: string, stopName: string, away: number|null, etaSec?: number|null, etaText: string, state?: { sceneX?: number } }} o
 *   away：公車還有幾站（railOf）；null＝推估不出來（未發車等）→ 不畫公車，只寫狀態
 * @returns {HTMLElement}
 */
export function busScene({ routeName, stopName, away, etaSec = null, etaText, state = {} }) {
  const box = document.createElement('div');
  box.className = 'ab-scene3d';
  const say = sceneSay({ routeName, away, etaSec, etaText });
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${say.head}・${say.eta}；你在「${stopName}」等車`);
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
  if (away != null) {
    const x = away === 0 && !say.near ? busX(0.6) : busX(away); // 還沒到但前面沒有更早的站：停在站牌前一點
    const bus = el('div', 'ab-scene-bus');
    bus.append(img('/img/scene/bus.webp', 'ab-scene-img'));
    const from = state.sceneX ?? busX(MAX_SHOWN) - 3; // 第一次從畫面左邊開進來
    state.sceneX = x;
    const place = (wx) => { const [dx, dy] = busShift(wx); bus.style.transform = `translate(${dx}%, ${dy}%)`; };
    place(still() ? x : from);
    if (!still() && from !== x) requestAnimationFrame(() => requestAnimationFrame(() => place(x)));
    box.append(bus);
  }
  return box;
}
