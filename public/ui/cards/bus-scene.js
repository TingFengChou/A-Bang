// 公車街景（取代看不懂的傾斜路線圖；2026-11-20 Austin：「引導到公車站那不應該是 3D 傾斜圖，沒人看得懂」）：
// Blender 算好的低多邊形街景（scripts/blender/bus-scene.py → public/img/scene/），公車依真實「還有幾站」停在路上，
// 站牌上方寫站名、公車上方寫「601・還有 2 站・約 7 分」。文字是網頁文字（清楚、可縮放、念得出來）。
// 怎麼走到站牌交給「導航」按鈕（官方地圖 App）。reduced motion／精簡模式：公車不滑動。
// 文字走卡片字典（scene.*）；lang＝'en'（英文公車頁，S12g）用英文，站名、路線名照原文。
// 2026-11-21 更有變化（Austin：「只有即將進站似乎很少」）：中間經過的小站牌與「還有 N 站」、台灣時間白天／傍晚／夜晚、
// 等車的人（到站開門上車）、這班開走下一班從左邊進來、近側人行道小物、偶爾經過的機車與計程車（bus-scene-art.js）。
// 同一個頁面跨更新沿用同一個街景（state.box），每 20 秒只改文字與公車位置，不重建整個畫面。
import { tFor } from './i18n/index.js';
import { dayPhase, stopMarks, markAt, waitingPeople, project, farLayer, nearLayer, lightsLayer, busOverlay, personSvg, scooterRiderSvg, taxiSvg, seeded, PER_STOP } from './bus-scene-art.js';

/** 與 public/img/scene/scene.json 相同（test 會比對）：畫布大小、世界 x 每 +1 的畫面位移、站牌牌面、公車 x=0 時的車頂上方 */
export const SCENE = { w: 960, h: 420, unit: [43.7, 7.0], sign: [708.4, 102.5], busStopAt: 3.2, busLabel: [366.8, 128.6] };
const DRIVE_SEC = 20;   // 兩次更新之間（公車頁每 20 秒）
const SLIDE_MS = 1100;  // 新資料時開到新位置的時間
const MAX_SHOWN = 2.2;  // 超過約兩站就停在畫面左邊，文字寫實際站數
const ENTER_X = -14;    // 從畫面左邊外面開進來
const EXIT_X = 20;      // 開走：開到畫面右邊外面
const LEAVE_MS = 2200;  // 這班開走的時間（下一班晚一點才從左邊進來）

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
export function sceneSay({ routeName, away, etaSec, etaText, riding = false, lang = null }) {
  const t = tFor(lang);
  if (away == null) return { head: routeName, eta: etaText, near: false };
  if (away === 0) return etaSec != null && etaSec <= 60 ? { head: `${routeName}${t('scene.sep')}${t(riding ? 'scene.alight' : 'scene.here')}`, eta: etaText, near: true } : { head: routeName, eta: etaText, near: false };
  return { head: `${routeName}${t('scene.sep')}${t('scene.away', { n: away })}`, eta: etaText, near: false };
}

/**
 * 這班是不是剛開走（已過你這站）：上次就在附近（還有 0～1 站），這次站數變多、推估不出來，或「就在你這站」後到站時間突然變長（換成下一班）。
 * 開走時公車往右開出畫面，下一班從左邊進來；遠的車站數忽多忽少（資料跳動）不算。
 * @param {{ away?: number|null, near?: boolean, eta?: number|null }} prev 上一次
 * @param {{ away: number|null, etaSec?: number|null }} now
 */
export function departed(prev, now) {
  if (prev?.away == null || prev.away > 1) return false;
  if (now.away == null || now.away > prev.away) return true;
  return !!prev.near && now.etaSec != null && prev.eta != null && now.etaSec > prev.eta + 120;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NS = 'http://www.w3.org/2000/svg';
/** 整張畫布大小的 SVG 圖層（內容是固定的數字與顏色字串） */
function layer(cls, inner) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', `0 0 ${SCENE.w} ${SCENE.h}`);
  s.setAttribute('preserveAspectRatio', 'none');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}
/** 小圖：畫布上 (ox, oy) 是小圖座標原點；外框 vb＝[x, y, 寬, 高]。外面的 div 用百分比定位，平移走合成層 */
function sprite(cls, ox, oy, vb, inner) {
  const d = el('div', cls);
  const [x, y, w, h] = vb;
  Object.assign(d.style, { left: `${((ox + x) / SCENE.w) * 100}%`, top: `${((oy + y) / SCENE.h) * 100}%`, width: `${(w / SCENE.w) * 100}%`, height: `${(h / SCENE.h) * 100}%` });
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', vb.join(' '));
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  d.append(s);
  d.dataset.w = String(w); d.dataset.h = String(h);
  return d;
}
/** 小圖平移畫布上 (dx, dy) 像素 → CSS translate 百分比（相對自己的大小） */
const moveBy = (d, dx, dy) => `translate(${(dx / Number(d.dataset.w)) * 100}%, ${(dy / Number(d.dataset.h)) * 100}%)`;
const img = (src, cls, onfail) => {
  const i = document.createElement('img');
  Object.assign(i, { src, alt: '', className: cls, decoding: 'async', draggable: false });
  i.onerror = () => { i.hidden = true; onfail?.(); }; // 圖片載不到：只留底色與文字，不顯示破圖
  return i;
};

/** 偶爾經過的車（低頻）：機車在近側車道超車、計程車在對向車道；reduced motion 不畫 */
function traffic(seed) {
  const rnd = seeded(`traffic|${seed}`);
  const out = [];
  const [rs, rvb] = scooterRiderSvg(rnd);
  const [sx, sy] = project(-11, -2.75, 0);
  const rider = sprite('ab-scene-rider', sx - 40, sy - 69, rvb, rs);
  const [ex, ey] = project(16, -2.75, 0);
  out.push([rider, ex - sx, ey - sy, 19000 + Math.round(rnd() * 6000), 2500 + Math.round(rnd() * 4000), 0.24]);
  const [ts, tvb] = taxiSvg(14);
  const taxi = sprite('ab-scene-taxi', 0, 0, tvb, ts);
  const [ax, ay] = project(14, 1, 0), [bx, by] = project(-13, 1, 0);
  out.push([taxi, bx - ax, by - ay, 27000 + Math.round(rnd() * 8000), 9000 + Math.round(rnd() * 6000), 0.26]);
  for (const [d, dx, dy, cycle, delay, frac] of out) {
    if (typeof d.animate !== 'function') continue;
    const end = moveBy(d, dx, dy);
    d.animate([{ transform: 'translate(0, 0)', offset: 0 }, { transform: end, offset: frac }, { transform: end, offset: 1 }], { duration: cycle, delay, iterations: Infinity });
  }
  return { rider, taxi };
}

/** 建街景（換站、換時段、換語言、換減少動態、上下車模式時才重建；其他更新沿用） */
function build(state, { stopName, phase, calm }) {
  const box = el('div', `ab-scene3d ${phase}`);
  box.setAttribute('role', 'img');
  const far = layer('ab-scene-far', farLayer(stopName, stopMarks(null)));
  const people = el('div', 'ab-scene-people');
  const tint = el('div', 'ab-scene-tint');
  const lights = layer('ab-scene-lights', lightsLayer(stopName, phase));
  const [hx, hy] = project(7, 1.75, 0.24);
  const halo = el('div', 'ab-scene-halo');
  Object.assign(halo.style, { left: `${(hx / SCENE.w) * 100}%`, top: `${(hy / SCENE.h) * 100}%` });
  const near = layer('ab-scene-near', nearLayer(stopName));
  const chips = el('div', 'ab-scene-marks');
  const stop = el('span', 'ab-scene-label stop');
  const caption = el('span', 'ab-scene-label bus');
  const top = el('div', 'ab-scene-top'); // 上方一列：說明（分鐘優先完整）＋站名（空間不夠時截斷）
  top.append(caption, stop);
  const busAnchor = el('div', 'ab-scene-anchor'); // 公車插在這之前（在近側機車與人行道後面）
  const cars = calm ? null : traffic(stopName);
  box.append(img('/img/scene/street.webp', 'ab-scene-bg'), far, people, ...(cars ? [cars.taxi] : []), tint, lights, halo, busAnchor, ...(cars ? [cars.rider] : []), near, chips, top);
  state.box = box;
  state.view = { far, people, halo, chips, stop, caption, busAnchor };
  state.bus = null;
  state.peopleGen = undefined;
}

/** 等車的人（1～3 個，依站名與第幾班固定）；換下一班時淡入 */
function paintPeople(state, stopName, { fadeIn = false } = {}) {
  const gen = state.gen || 0;
  const list = state.boarded ? [] : waitingPeople(`${stopName}|${gen}`).map((p) => {
    const [fx, fy] = project(p.x, p.y, 0.24);
    const [s, vb] = personSvg(p);
    const d = sprite('ab-scene-person', fx, fy, vb, s);
    d.dataset.x = String(p.x); d.dataset.y = String(p.y);
    if (fadeIn) d.classList.add('arrive');
    return d;
  });
  state.view.people.replaceChildren(...list);
  state.peopleGen = gen;
}

/** 公車到站：等車的人一個一個走向公車（被車身擋住）、淡出 */
function board(state) {
  const people = state.view.people;
  const ppl = [...people.children];
  ppl.forEach((d, i) => {
    const [fx, fy] = project(Number(d.dataset.x), Number(d.dataset.y), 0.24);
    const [tx, ty] = project(4.4 + i * 0.35, 0.45, 0.24);
    const delay = 0.9 + i * 0.45;
    d.classList.remove('arrive');
    d.classList.add('boarding'); // 停掉原地輕晃（動畫會蓋過 transform）
    d.style.transition = `transform 1.3s ease-in-out ${delay}s, opacity .4s ease-in ${delay + 1}s`;
    requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = moveBy(d, tx - fx, ty - fy); d.style.opacity = '0'; }));
  });
  setTimeout(() => { if (state.boarded && state.view?.people === people) people.replaceChildren(); }, 1000 * (2.4 + ppl.length * 0.45));
}

/** 公車（Blender 圖＋身上的門、車窗燈、車頭燈）；坐車中車頂標「你」 */
function makeBus(phase, riding, lang) {
  const bus = el('div', 'ab-scene-bus');
  const body = el('div', 'ab-scene-body');
  body.append(img('/img/scene/bus.webp', 'ab-scene-img', () => { body.hidden = true; }), layer('ab-scene-busfx', busOverlay(phase)));
  bus.append(body);
  if (riding) {
    const you = el('span', 'ab-scene-you', tFor(lang)('scene.you'));
    const [yx, yy] = project(-0.6, -2.06, 1.1); // 貼在車身側面（車窗下面），不會被上方說明蓋住
    Object.assign(you.style, { left: `${(yx / SCENE.w) * 100}%`, top: `${(yy / SCENE.h) * 100}%` });
    bus.append(you);
  }
  return bus;
}
const shiftCss = (x) => { const [dx, dy] = busShift(x); return `translate(${dx}%, ${dy}%)`; };

/**
 * @param {{ routeName: string, stopName: string, away: number|null, etaSec?: number|null, etaText: string, state?: object, riding?: boolean, dataAt?: number|null, lang?: 'en'|null, time?: Date|number }} o
 *   away：公車還有幾站（railOf）；null＝推估不出來（未發車、末班已過）→ 不畫公車，畫空的路與說明
 *   dataAt：這筆到站時間是什麼時候查到的（毫秒；提早重畫時只開剩下的時間）
 *   state：同一個頁面跨更新保留（box 街景本身、drive 上次慢慢開的起終點與時間、sceneX、away 上次站數、gen 第幾班、boarded 上車了沒）
 *   time：用哪個時間決定白天／傍晚／夜晚（預設現在，台灣時間）
 * @returns {HTMLElement} 同一個 state 回傳同一個元素（呼叫端已經放好就不用再放）
 */
export function busScene({ routeName, stopName, away, etaSec = null, etaText, state = {}, riding = false, dataAt = null, lang = null, time = Date.now() }) {
  const t = tFor(lang);
  const sep = t('scene.sep');
  const end = lang === 'en' ? '. ' : '；';
  const say = sceneSay({ routeName, away, etaSec, etaText, riding, lang });
  const phase = dayPhase(time);
  const calm = still();
  const key = [stopName, phase, lang || '', calm, riding].join('|');
  if (!state.box || state.key !== key) { build(state, { stopName, phase, calm }); state.key = key; }
  const { box } = state;
  const v = state.view;
  // riding：行程中模式，站牌是下車站；推估不出來（未發車、末班已過）多說一句路上沒有車
  box.setAttribute('aria-label', `${say.head}${sep}${say.eta}${end}${t(riding ? 'scene.riding' : 'scene.waiting', { stop: stopName })}${away == null ? `${end}${t('scene.empty')}` : ''}`);
  // 站名：右上角靠右（長站名截斷，完整名稱在 title）；說明：左上角固定（公車的位置表示距離）——兩個標籤不會重疊
  v.stop.textContent = stopName;
  v.stop.title = stopName;
  v.caption.className = `ab-scene-label bus${say.near ? ' near' : ''}`;
  v.caption.replaceChildren(el('span', '', `${say.head}${sep}`), el('b', '', say.eta));

  const now = Date.now();
  // 現在實際開到哪（上一次慢慢開的起點、終點、開始時間內插；不是終點，提早重畫才不會往前跳）
  const d = state.drive;
  // （換時段等重建街景後 state.bus 是新的，位置照 drive 接下去，不從左邊重新開進來）
  let cur = d ? d.x0 + (d.x1 - d.x0) * Math.min(1, Math.max(0, (now - d.t0) / d.ms)) : state.sceneX ?? null;
  clearTimeout(state.timer);
  // 這班開走了（已過你這站）：往右開出畫面、換一批等車的人；下一班（有的話）晚一點從左邊進來
  const gone = state.away != null && departed({ away: state.away, near: state.near, eta: state.eta }, { away, etaSec });
  let enterDelay = 0;
  if (gone) {
    const old = state.bus;
    state.bus = null;
    state.gen = (state.gen || 0) + 1;
    state.boarded = false;
    state.at = false;
    if (!old) { /* 街景剛重建：沒有可以開走的車 */ } else if (calm || cur == null) old.remove();
    else {
      old.classList.remove('open', 'at-stop', 'braking');
      old.classList.add('moving', 'leaving');
      old.style.transition = 'none';
      old.style.transform = shiftCss(cur);
      requestAnimationFrame(() => requestAnimationFrame(() => { old.style.transition = `transform ${LEAVE_MS}ms cubic-bezier(.45, 0, .85, .55)`; old.style.transform = shiftCss(EXIT_X); }));
      setTimeout(() => old.remove(), LEAVE_MS + 300);
      enterDelay = 900;
    }
    cur = null;
    state.drive = null; state.sceneX = undefined; state.away = undefined;
  }
  if (state.peopleGen !== (state.gen || 0)) paintPeople(state, stopName, { fadeIn: gone && !calm });

  // 中間經過的小站牌：還沒開到的標「還有 k 站」，開過的變淡；推估不出來時寫「目前路上沒有車」
  const marks = stopMarks(away);
  for (const m of marks) v.far.querySelector(`.ab-sign[data-k="${m.k}"]`)?.classList.toggle('passed', away != null && !m.ahead);
  v.chips.replaceChildren(...marks.filter((m) => m.ahead).map((m) => {
    const c = el('span', 'ab-scene-mark', t('scene.mark', { n: m.k }));
    const [l, tp] = markAt(m.x);
    Object.assign(c.style, { left: `${l}%`, top: `${tp}%` });
    return c;
  }), ...(away == null ? [el('span', 'ab-scene-empty', t('scene.empty'))] : []));
  // 你這站的站牌：公車越近越亮（還有 1 站以內：淡淡的光；就在你這站：一圈一圈）
  v.halo.className = `ab-scene-halo${say.near ? ' on' : away != null && away <= 1 ? ' soft' : ''}`;

  if (away == null) {
    state.bus?.remove();
    state.bus = null;
    state.drive = null; state.away = undefined; state.sceneX = undefined; state.at = false; state.near = false; state.eta = null; // 推估不出來：下次重新開進來
    return box;
  }
  const raw = away === 0 && !say.near ? busX(0.6) : busX(away); // 還沒到但前面沒有更早的站：停在站牌前一點
  // 同一台還在路上（站數沒變或變少）：不往回開，從現在開到的地方繼續；站數變多（換一台）才照資料重新定位
  const same = cur != null && state.away != null && away <= state.away && cur < SCENE.busStopAt;
  const x = same ? Math.max(raw, cur) : raw;
  state.away = away;
  state.near = say.near;
  state.eta = etaSec;
  if (!state.bus) {
    const b = makeBus(phase, riding, lang);
    b.addEventListener('transitionend', (e) => { if (e.target === b && b.style.transition.includes('linear')) b.classList.remove('moving'); }); // 開到了（沒有新資料）：不再震動；子層（開門）的 transition 冒泡上來不算
    v.busAnchor.before(b);
    state.bus = b;
  }
  const bus = state.bus;
  const from = cur ?? ENTER_X; // 第一次（或下一班）從畫面左邊外面開進來
  const place = (wx, how = '') => { bus.style.transition = how; bus.style.transform = shiftCss(wx); };
  const at = say.near || x >= SCENE.busStopAt; // 就在你這站：停著（開門、輕輕晃）
  // 之後慢慢往站牌開：只開這筆資料剩下的時間（資料 dataAt 之後已過的不重算，提早重畫不會多開）；不超過下一站的位置
  const elapsed = Math.max(0, (now - (dataAt ?? now)) / 1000);
  const win = Math.max(0, DRIVE_SEC - elapsed);
  const cap = away >= 1 ? busX(away - 1) : SCENE.busStopAt;
  const to = calm || at || !win ? x : Math.min(cap, Math.max(x, driveTo(x, etaSec == null ? null : etaSec - elapsed, win)));
  const lead = from !== x ? SLIDE_MS + enterDelay : 0; // 先開到現在的位置再慢慢開
  state.drive = { x0: x, x1: to, t0: now + lead, ms: win * 1000 || 1 };
  state.sceneX = x;
  bus.classList.toggle('moving', !calm && to > x); // 只有真的往站牌開才震動（開進來停在站牌的不算，否則停著還在震）
  bus.classList.toggle('at-stop', at);
  if (at && !state.at && !calm) bus.classList.add('braking'); // 剛到站才煞車點一下（停著時每次更新不重播）
  if (!at) bus.classList.remove('braking');
  bus.classList.toggle('open', at); // 到站開門
  if (at && !state.boarded) { state.boarded = true; if (calm) v.people.replaceChildren(); else board(state); } // 等車的人上車（減少動態：直接畫上車後，沒有人在等）
  state.at = at;
  place(calm ? x : from);
  if (!calm) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (from !== x) place(x, `transform ${SLIDE_MS}ms cubic-bezier(.25, .9, .35, 1) ${enterDelay}ms`);
      if (to > x) state.timer = setTimeout(() => { if (bus.isConnected) place(to, `transform ${win}s linear`); }, lead);
    }));
  }
  return box;
}

