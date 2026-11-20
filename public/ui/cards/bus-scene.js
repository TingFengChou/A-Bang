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
 * @param {{ routeName: string, stopName: string, away: number|null, etaText: string, state?: { sceneX?: number } }} o
 *   away：公車還有幾站（railOf）；null＝推估不出來（未發車等）→ 不畫公車，只寫狀態
 * @returns {HTMLElement}
 */
export function busScene({ routeName, stopName, away, etaText, state = {} }) {
  const box = document.createElement('div');
  box.className = 'ab-scene3d';
  const say = away == null ? `${routeName}・${etaText}` : away === 0 ? `${routeName}・就在你這站・${etaText}` : `${routeName}・還有 ${away} 站・${etaText}`;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${say}；你在「${stopName}」等車`);
  const pct = (p, i) => `${(p[i] / (i ? SCENE.h : SCENE.w)) * 100}%`;
  const img = (src, cls) => { const i = document.createElement('img'); i.src = src; i.alt = ''; i.className = cls; i.decoding = 'async'; i.draggable = false; return i; };
  const label = (text, at, cls) => { const l = document.createElement('span'); l.className = `ab-scene-label ${cls}`; l.textContent = text; l.style.left = pct(at, 0); l.style.top = pct(at, 1); return l; };
  box.append(img('/img/scene/street.png', 'ab-scene-bg'), label(stopName, SCENE.sign, 'stop'));
  if (away != null) {
    const x = busX(away);
    const bus = document.createElement('div');
    bus.className = 'ab-scene-bus';
    bus.append(img('/img/scene/bus.png', 'ab-scene-img'));
    // 車頂的字：跟著公車移動；靠近左緣時改成靠左對齊，不被切掉
    const tag = label(say, SCENE.busLabel, 'bus');
    const from = state.sceneX ?? busX(MAX_SHOWN) - 3; // 第一次從畫面左邊開進來
    state.sceneX = x;
    const place = (wx) => {
      const [dx, dy] = busShift(wx);
      bus.style.transform = `translate(${dx}%, ${dy}%)`;
      const cx = (SCENE.busLabel[0] / SCENE.w) * 100 + dx;
      tag.style.left = cx < 30 ? `${Math.max(2, cx - 12)}%` : `${cx}%`;
      tag.style.top = `${(SCENE.busLabel[1] / SCENE.h) * 100 + dy}%`;
      tag.classList.toggle('start', cx < 30);
    };
    place(still() ? x : from);
    if (!still() && from !== x) requestAnimationFrame(() => requestAnimationFrame(() => place(x)));
    box.append(bus, tag);
  } else {
    box.append(label(say, [SCENE.w * 0.28, SCENE.h * 0.3], 'bus'));
  }
  return box;
}
