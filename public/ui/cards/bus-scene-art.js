// 公車街景的「生活感」圖層（2026-11-21 Austin：「只有即將進站似乎很少」→ 街景更有變化）：
// Blender 街景（scripts/blender/bus-scene.py）是一張固定的圖；這裡用同一台正交相機的投影，在上面疊 SVG 小物：
// 中間經過的小站牌、路燈、店面與遮雨棚、近側人行道（機車、郵筒、花台…）、等車的人、偶爾經過的機車與計程車、夜晚的燈。
// 小物依站名（＋第幾班）用固定亂數選，同一站每次看都一樣、換站就不同；不放任何使用者資料到 SVG 字串裡。
// 這個檔只有純函式與 SVG 字串，不碰 DOM（node:test 可直接測）。

/** 與 bus-scene.py 相同的相機：位置、看向、正交寬度 21（畫布 960×420） */
const CAM = [7, -15, 10.8];
const PX = 960 / 21;
const ROT_Z = Math.atan2(16, -5) - Math.PI / 2;
const TILT = Math.atan2(Math.hypot(5, 16), 10);
const R = [Math.cos(ROT_Z), Math.sin(ROT_Z), 0];
const U = [-Math.sin(ROT_Z) * Math.cos(TILT), Math.cos(ROT_Z) * Math.cos(TILT), Math.sin(TILT)];
const VIEW = (() => { const v = [-5, 16, -10]; const n = Math.hypot(...v); return v.map((x) => x / n); })();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const r1 = (n) => Math.round(n * 10) / 10;

/** 世界座標（公尺級的示意單位；x 往站牌、y 往人行道、z 往上）→ 畫布像素 [x, y] */
export function project(x, y, z = 0) {
  const d = [x - CAM[0], y - CAM[1], z - CAM[2]];
  return [480 + PX * dot(d, R), 210 - PX * dot(d, U)];
}
/** 離相機多遠（越大越遠；先畫遠的） */
export const depthOf = (x, y, z = 0) => dot([x - CAM[0], y - CAM[1], z - CAM[2]], VIEW);
/** 高 1 單位在畫面上幾像素（人、機車用） */
export const Z_PX = PX * U[2];
/** 路的方向在畫面上的角度（度） */
export const ROAD_DEG = (Math.atan2(PX * -U[0], PX * R[0]) * 180) / Math.PI;

export const STOP_X = 7;      // 你這站的站牌（Blender）
export const PER_STOP = 4.2;  // 一站在畫面上的距離（世界單位；示意）

/**
 * 台灣時間的時段：白天 6:00～16:59、傍晚 17:00～18:29、夜晚 18:30～5:59（天氣卡 sceneOf 也用台灣時間）
 * @param {Date|number} [at]
 * @returns {'day'|'dusk'|'night'}
 */
export function dayPhase(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return 'day';
  const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Taipei' }).format(d).split(':').map(Number);
  const min = h * 60 + m;
  if (min >= 6 * 60 && min < 17 * 60) return 'day';
  if (min >= 17 * 60 && min < 18 * 60 + 30) return 'dusk';
  return 'night';
}

/** 固定亂數（同一個字串永遠同一串數字）：FNV-1a 雜湊＋mulberry32 */
export function seeded(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
/**
 * 洗牌（Fisher-Yates，用同一個固定亂數）：回傳新陣列。
 * 不用 sort(() => rnd() - 0.5)：各家引擎排序實作不同（Android V8、iOS JavaScriptCore），同一個種子會排出不同結果。
 */
export function shuffled(rnd, arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 中間經過的小站牌（最多 max 個）：第 k 個＝你這站前 k 站。公車還沒開到的（k ≤ away）清楚、旁邊標「還有 k 站」；開過的變淡。
 * away＝null（未發車、末班已過）：小站牌都畫、都不標。
 * @returns {{ k: number, x: number, ahead: boolean }[]}
 */
export function stopMarks(away, max = 2) {
  const out = [];
  for (let k = 1; k <= max; k++) out.push({ k, x: STOP_X - PER_STOP * k, ahead: away != null && k <= away });
  return out;
}

/** 等車的人：1～3 個，依站名與第幾班固定（刷新不亂跳）；位置在候車亭前 */
export function waitingPeople(seed) {
  const rnd = seeded(`people|${seed}`);
  const n = 1 + Math.floor(rnd() * 3);
  const slots = shuffled(rnd, [7.5, 8.25, 9.0, 9.75]).slice(0, n);
  const people = slots.map((x) => ({
    x: x + (rnd() - 0.5) * 0.25,
    y: 2.05 + rnd() * 0.45,
    h: rnd() < 0.15 ? 1.15 : 1.45 + rnd() * 0.3, // 偶爾是小朋友
    shirt: pick(rnd, ['#ef8354', '#3b82f6', '#f2c14e', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#ffffff']),
    pants: pick(rnd, ['#334155', '#475569', '#1e3a5f', '#57534e', '#0f172a']),
    skin: pick(rnd, ['#f3cfb1', '#e7b48f', '#c98e66']),
    hair: pick(rnd, ['#2b2b2b', '#4a3728', '#1f2937', '#6b4f3a']),
    extra: pick(rnd, ['phone', 'bag', 'backpack', 'none', 'phone']),
  }));
  return people.sort((a, b) => depthOf(b.x, b.y) - depthOf(a.x, a.y)); // 遠的先畫
}

// ── SVG 小工具（數字與固定顏色，沒有外來字串）──
const poly = (pts, fill, extra = '') => `<path d="M${pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z" fill="${fill}"${extra}/>`;
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const P = (x, y, z) => project(x, y, z);

/** 長方體（看得到上面、朝相機的前面、右側面） */
function box(x0, x1, y0, y1, z0, z1, color, { top = 0.12, side = -0.16, cls = '' } = {}) {
  const a = cls ? ` class="${cls}"` : '';
  return poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], color, a)
    + poly([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], shade(color, side), a)
    + poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], shade(color, top), a);
}
const line = ([x1, y1], [x2, y2], stroke, w, extra = '') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
/** 低多邊形圓錐樹（亮面＋暗面） */
function cone(x, y, z0, r, h, color) {
  const apex = P(x, y, z0 + h), l = P(x - r, y, z0), rt = P(x + r, y, z0), f = P(x, y - r, z0);
  return line(P(x, y, 0), P(x, y, z0 + 0.3), '#8a6a4f', 7) + poly([apex, l, f], color) + poly([apex, f, rt], shade(color, -0.2));
}
/** 一團矮樹叢（幾個圓） */
function bush(x, y, z0, s, color) {
  const [cx, cy] = P(x, y, z0);
  const k = s * Z_PX;
  return `<g>${[[-0.55, 0.05, 0.42], [0.5, 0.08, 0.38], [0, -0.22, 0.5]].map(([dx, dy, rr]) => `<circle cx="${r1(cx + dx * k)}" cy="${r1(cy - k * 0.35 + dy * k)}" r="${r1(rr * k)}" fill="${shade(color, dy < 0 ? 0.08 : -0.05)}"/>`).join('')}</g>`;
}

/** 小站牌（中間經過的站）：桿子＋品牌色牌面（朝來車方向，跟 Blender 的站牌同方向） */
export function smallSign(x, k) {
  const y = 1.75;
  return `<g class="ab-sign" data-k="${k}">${line(P(x, y, 0.24), P(x, y, 2.6), '#5d6966', 4)}${box(x - 0.06, x + 0.06, y - 0.48, y + 0.48, 1.85, 2.6, '#0f766e', { side: 0.08 })}${box(x - 0.07, x + 0.07, y - 0.3, y + 0.3, 2.3, 2.42, '#ffffff', { side: -0.05 })}</g>`;
}
/** 小站牌旁的「還有 k 站」標籤放哪（畫布百分比；桿子中段右邊，不跟上方說明重疊） */
export function markAt(x) {
  const [sx, sy] = P(x + 0.3, 1.75, 1.35);
  return [(sx / 960) * 100, (sy / 420) * 100];
}

const LAMPS = [-4.6, 5.0];
/** 路燈（人行道靠路邊，燈頭伸向路） */
function lamp(x) {
  const base = P(x, 1.55, 0.24), top = P(x, 1.55, 3.7), head = P(x, 0.95, 3.62);
  return line(base, top, '#5d6966', 4) + line(top, head, '#5d6966', 3) + `<ellipse cx="${r1(head[0])}" cy="${r1(head[1] + 2)}" rx="7" ry="3" fill="#e5ece9" stroke="#5d6966" stroke-width="1.5"/>`;
}

/** 店面（Blender 中間那棟房子的正面）：玻璃門面＋遮雨棚，顏色依站名 */
function shopfront(rnd) {
  const y = 5.99, x0 = -1.3, x1 = 3.3;
  const awn = pick(rnd, ['#e76f51', '#2a9d8f', '#e9c46a', '#5c7cfa', '#d6336c', '#f08c00']);
  const bays = 3 + Math.floor(rnd() * 2);
  const w = (x1 - x0) / bays;
  let s = '';
  for (let i = 0; i < bays; i++) {
    const a = x0 + i * w + 0.12, b = x0 + (i + 1) * w - 0.12;
    s += poly([P(a, y, 0.1), P(b, y, 0.1), P(b, y, 0.95), P(a, y, 0.95)], '#e3f1f2', ' class="ab-win"');
    s += line(P((a + b) / 2, y, 0.1), P((a + b) / 2, y, 0.95), '#9fb8b6', 1.2);
  }
  // 遮雨棚：從牆面斜斜伸出來，條紋
  const n = 8, dw = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * dw, b = a + dw;
    s += poly([P(a, y, 1.3), P(b, y, 1.3), P(b, y - 0.7, 1.02), P(a, y - 0.7, 1.02)], i % 2 ? '#ffffff' : awn);
  }
  s += poly([P(x0, y - 0.7, 1.02), P(x1, y - 0.7, 1.02), P(x1, y - 0.7, 0.92), P(x0, y - 0.7, 0.92)], shade(awn, -0.25));
  // 招牌（沒有字）
  s += poly([P(x0 + 0.4, y, 1.36), P(x1 - 0.4, y, 1.36), P(x1 - 0.4, y, 1.56), P(x0 + 0.4, y, 1.56)], shade(awn, 0.55));
  return s;
}

/** 遠側（路的另一邊）：店面、路燈、你這站後面的小東西、中間經過的小站牌 */
export function farLayer(seed, marks) {
  const rnd = seeded(`far|${seed}`);
  let s = shopfront(rnd);
  const extra = pick(rnd, ['bush', 'vend', 'bench', 'bush']);
  if (extra === 'bush') s += bush(5.3, 4.6, 0.1, 1.1, '#5fae7b');
  if (extra === 'vend') s += box(4.9, 5.5, 4.5, 5.0, 0.1, 1.5, '#d94848') + poly([P(5.0, 4.49, 0.8), P(5.4, 4.49, 0.8), P(5.4, 4.49, 1.35), P(5.0, 4.49, 1.35)], '#fef3c7', ' class="ab-win"');
  if (extra === 'bench') s += box(4.6, 5.8, 4.4, 4.75, 0.35, 0.5, '#b45309') + line(P(4.75, 4.45, 0.1), P(4.75, 4.45, 0.35), '#5d6966', 2) + line(P(5.65, 4.45, 0.1), P(5.65, 4.45, 0.35), '#5d6966', 2);
  s += LAMPS.map(lamp).join('');
  s += marks.map((m) => smallSign(m.x, m.k)).join('');
  return s;
}

/** 晚上（與傍晚）的燈：路燈光暈、地上的光、店面亮燈。放在暗色罩上面（不被調暗） */
export function lightsLayer(seed, phase) {
  if (phase === 'day') return '';
  const a = phase === 'night' ? 1 : 0.55;
  const id = `ab-glow-${phase}`; // 同一頁可能有好幾個街景：id 依時段，內容相同
  let s = `<defs><radialGradient id="${id}"><stop offset="0" stop-color="#fffbe8" stop-opacity="${a}"/><stop offset=".3" stop-color="#ffe38a" stop-opacity="${0.6 * a}"/><stop offset="1" stop-color="#ffe38a" stop-opacity="0"/></radialGradient></defs>`;
  for (const x of LAMPS) {
    const head = P(x, 0.95, 3.62), pool = P(x, 0.7, 0.05);
    s += `<ellipse cx="${r1(pool[0])}" cy="${r1(pool[1])}" rx="70" ry="19" fill="url(#${id})" opacity=".75"/>`;
    s += `<circle cx="${r1(head[0])}" cy="${r1(head[1] + 3)}" r="42" fill="url(#${id})"/>`;
  }
  // 店面亮燈（有幾格沒開，依站名固定）
  const rnd = seeded(`lit|${seed}`);
  const y = 5.98, x0 = -1.3, x1 = 3.3, bays = 4, w = (x1 - x0) / bays;
  for (let i = 0; i < bays; i++) {
    if (rnd() < 0.25) continue;
    const l = x0 + i * w + 0.12, r = x0 + (i + 1) * w - 0.12;
    s += poly([P(l, y, 0.1), P(r, y, 0.1), P(r, y, 0.95), P(l, y, 0.95)], '#ffe8a0', ` opacity="${0.85 * a}"`);
  }
  return s;
}

/** 公車身上的東西（跟公車圖一起移動；公車 x=0 的位置）：開門、晚上車窗與車燈 */
export function busOverlay(phase) {
  const y = -2.06;
  // 開門：車門變成亮亮的車廂（門框深色）
  const door = poly([P(1.7, y, 0.62), P(2.6, y, 0.62), P(2.6, y, 2.28), P(1.7, y, 2.28)], '#fdf3d0', ' class="ab-door" stroke="#1d3b4f" stroke-width="2.5"');
  if (phase === 'day') return door;
  const a = phase === 'night' ? 1 : 0.6;
  let s = '';
  if (phase === 'night') { // 車窗亮燈（傍晚天還亮，不開）
    for (let i = 0; i < 4; i++) {
      const cx = -2.2 + i * 1.15;
      s += poly([P(cx - 0.42, y, 1.6), P(cx + 0.42, y, 1.6), P(cx + 0.42, y, 2.44), P(cx - 0.42, y, 2.44)], '#ffe49a', ' opacity=".85"');
    }
  }
  // 車頭燈照在路上
  const l1 = P(3.05, -1.65, 0.95), l2 = P(3.05, -0.15, 0.95);
  const id = `ab-beam-${phase}`;
  s += `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#fff3bf" stop-opacity="${0.85 * a}"/><stop offset="1" stop-color="#fff3bf" stop-opacity="0"/></linearGradient></defs>`;
  s += poly([l1, l2, P(7.2, 0.5, 0.02), P(7.2, -2.6, 0.02)], `url(#${id})`);
  s += `<circle cx="${r1(l1[0])}" cy="${r1(l1[1])}" r="5" fill="#fffbe6"/><circle cx="${r1(l2[0])}" cy="${r1(l2[1])}" r="5" fill="#fffbe6"/>`;
  return door + s;
}

// ── 近側（靠相機這邊）：人行道與小物 ──
function scooterParked(x, y, color) {
  // 側面：兩個輪子、踏板、前擋、座墊（沿著路的方向）
  const w1 = P(x - 0.55, y, 0.2), w2 = P(x + 0.55, y, 0.2);
  return `<g>${box(x - 0.6, x + 0.45, y - 0.18, y + 0.18, 0.28, 0.42, shade(color, -0.1))}${box(x + 0.35, x + 0.6, y - 0.2, y + 0.2, 0.28, 0.95, color)}${box(x - 0.6, x - 0.05, y - 0.2, y + 0.2, 0.42, 0.72, color)}${box(x - 0.55, x - 0.1, y - 0.18, y + 0.18, 0.72, 0.8, '#2b2b2b')}`
    + `<circle cx="${r1(w1[0])}" cy="${r1(w1[1])}" r="7" fill="#1f2a2c"/><circle cx="${r1(w2[0])}" cy="${r1(w2[1])}" r="7" fill="#1f2a2c"/>${line(P(x + 0.55, y, 0.95), P(x + 0.4, y, 1.1), '#3f4a4c', 3)}</g>`;
}
function mailboxes(x, y) {
  // 郵筒：綠色（國內）、紅色（限時、航空）
  const one = (cx, c) => box(cx - 0.22, cx + 0.22, y - 0.22, y + 0.22, 0.2, 1.05, c, { top: 0.2 })
    + poly([P(cx - 0.12, y - 0.225, 0.85), P(cx + 0.12, y - 0.225, 0.85), P(cx + 0.12, y - 0.225, 0.9), P(cx - 0.12, y - 0.225, 0.9)], '#1f2937');
  return one(x - 0.3, '#2f9e44') + one(x + 0.3, '#e03131');
}
const planter = (x, y) => box(x - 0.8, x + 0.8, y - 0.3, y + 0.3, 0.2, 0.55, '#c9cfcc') + bush(x - 0.3, y, 0.55, 0.9, '#4f9d69') + bush(x + 0.45, y, 0.55, 0.75, '#5fae7b');
const benchNear = (x, y) => box(x - 0.7, x + 0.7, y - 0.15, y + 0.2, 0.55, 0.68, '#b45309') + box(x - 0.7, x + 0.7, y + 0.15, y + 0.25, 0.68, 1.05, '#c2410c') + line(P(x - 0.55, y - 0.1, 0.2), P(x - 0.55, y - 0.1, 0.55), '#5d6966', 3) + line(P(x + 0.55, y - 0.1, 0.2), P(x + 0.55, y - 0.1, 0.55), '#5d6966', 3);
const hydrant = (x, y) => box(x - 0.13, x + 0.13, y - 0.13, y + 0.13, 0.2, 0.75, '#e03131', { top: 0.25 }) + box(x - 0.2, x + 0.2, y - 0.07, y + 0.07, 0.48, 0.58, '#c92a2a');

/** 近側人行道與小物（依站名固定）；畫在公車上面（離相機比較近） */
export function nearLayer(seed) {
  const rnd = seeded(`near|${seed}`);
  const y0 = -3.25, y1 = -5.1, z = 0.18;
  let s = poly([P(-12, y0, z), P(18, y0, z), P(18, y1, z), P(-12, y1, z)], '#e9eeec')
    + poly([P(-12, y0, 0), P(18, y0, 0), P(18, y0, z), P(-12, y0, z)], '#c9d2cf');
  // 人行道磚縫
  for (let x = -11; x < 18; x += 1.6) s += line(P(x, y0, z), P(x - 0.05, y1, z), '#dde4e1', 1.2);
  const items = [];
  // 每種最多一次（機車一排 2～3 台）；有的格子空著
  const kinds = shuffled(rnd, ['scooters', 'mail', 'planter', 'bench', 'hydrant', 'planter']);
  const slots = [-5.6, -1.6, 2.4, 6.6, 10.6];
  for (const x of slots) {
    if (rnd() < 0.25 || !kinds.length) continue;
    const kind = kinds.pop();
    const yy = -4.45;
    if (kind === 'scooters') {
      const n = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) items.push([depthOf(x + i * 1.25, yy), scooterParked(x - 0.6 + i * 1.25, yy - (i % 2) * 0.15, pick(rnd, ['#e9ecef', '#4dabf7', '#ff8787', '#ffd43b', '#868e96', '#63e6be']))]);
    } else items.push([depthOf(x, yy), { mail: mailboxes, planter, bench: benchNear, hydrant }[kind](x, yy)]);
  }
  // 左下角的草地：一兩棵小樹或樹叢
  for (const x of [-6.6, -4.0]) {
    const k = rnd();
    if (k < 0.45) items.push([depthOf(x, -6.6), cone(x, -6.6, 0.5, 0.75, 1.7, pick(rnd, ['#5fae7b', '#4f9d69', '#74b98a']))]);
    else if (k < 0.8) items.push([depthOf(x, -6.4), bush(x, -6.4, 0, 1.2, '#5fae7b')]);
  }
  items.sort((a, b) => b[0] - a[0]);
  return s + items.map((i) => i[1]).join('');
}

// ── 會動的小東西（每個是一個小圖，外面的 div 只做平移，手機上走合成層）──

/** 等車的人（腳在 0,0；往上是負）；回傳 [svg 內容, viewBox（x, y, 寬, 高）] */
export function personSvg(p) {
  const H = p.h * Z_PX * 1.3; // 比實際比例大一點，手機上看得清楚
  const k = H / 62;
  const g = (n) => r1(n * k);
  let s = '';
  if (p.extra === 'backpack') s += `<rect x="${g(-10)}" y="${g(-46)}" width="${g(8)}" height="${g(16)}" rx="${g(3)}" fill="#475569"/>`;
  s += `<rect x="${g(-6)}" y="${g(-26)}" width="${g(5.4)}" height="${g(26)}" rx="${g(2.5)}" fill="${p.pants}"/><rect x="${g(0.8)}" y="${g(-26)}" width="${g(5.4)}" height="${g(26)}" rx="${g(2.5)}" fill="${p.pants}"/>`;
  s += `<rect x="${g(-8)}" y="${g(-48)}" width="${g(16)}" height="${g(25)}" rx="${g(6)}" fill="${p.shirt}" stroke="${shade(p.shirt === '#ffffff' ? '#cbd5e1' : p.shirt, -0.25)}" stroke-width="${g(1.2)}"/>`;
  s += `<circle cx="0" cy="${g(-55)}" r="${g(7.2)}" fill="${p.skin}"/><path d="M${g(-7.2)} ${g(-55)}a${g(7.2)} ${g(7.2)} 0 0 1 ${g(14.4)} 0q${g(-7)} ${g(-3.5)} ${g(-14.4)} 0z" fill="${p.hair}"/>`;
  if (p.extra === 'phone') s += `<rect class="ab-phone" x="${g(-3)}" y="${g(-42)}" width="${g(6)}" height="${g(8)}" rx="${g(1.2)}" fill="#1f2937" stroke="#93c5fd" stroke-width="${g(0.8)}"/>`;
  if (p.extra === 'bag') s += `<rect x="${g(6)}" y="${g(-32)}" width="${g(8)}" height="${g(9)}" rx="${g(2)}" fill="#b45309"/>`;
  return [s, [g(-16), g(-64), g(32), g(68)]];
}

/** 經過的機車（騎士戴安全帽），朝 +x；回傳 [svg 內容, viewBox]；(40, 69) 是著地的中間點 */
export function scooterRiderSvg(rnd) {
  const body = pick(rnd, ['#4dabf7', '#ff8787', '#e9ecef', '#ffd43b', '#63e6be']);
  const helmet = pick(rnd, ['#f03e3e', '#ffffff', '#fab005', '#1c7ed6', '#2b8a3e']);
  const shirt = pick(rnd, ['#495057', '#1864ab', '#e64980', '#f08c00', '#2f9e44']);
  const s = `<g transform="rotate(${r1(ROAD_DEG)} 40 60)">`
    + '<circle cx="16" cy="60" r="9" fill="#1f2a2c"/><circle cx="64" cy="60" r="9" fill="#1f2a2c"/><circle cx="16" cy="60" r="4" fill="#ced4da"/><circle cx="64" cy="60" r="4" fill="#ced4da"/>'
    + `<path d="M8 52 Q10 40 30 40 L52 42 L58 52 Z" fill="${body}"/><path d="M58 52 L56 26 L66 24 L72 50 Z" fill="${body}"/><rect x="58" y="20" width="14" height="5" rx="2" fill="#343a40"/>`
    + `<path d="M22 40 L44 40 L46 22 L30 18 Z" fill="${shirt}"/><path d="M40 26 L60 23" stroke="${shirt}" stroke-width="6" stroke-linecap="round"/>`
    + '<path d="M30 40 L44 40 L48 52 L42 54 Z" fill="#343a40"/>'
    + `<circle cx="38" cy="11" r="10" fill="${helmet}"/><path d="M40 8 h9 a2 2 0 0 1 0 6 h-7 z" fill="#1f2937" opacity=".75"/>`
    + '<circle cx="71" cy="40" r="3" fill="#fff3bf"/></g>';
  return [s, [0, 0, 82, 72]];
}

/** 經過的計程車（黃色，朝 -x 開，在路的另一邊）；直接畫在畫布座標，回傳 [svg 內容, viewBox（外框）] */
export function taxiSvg(x0) {
  const y0 = 0.38, y1 = 1.32;
  let s = box(x0, x0 + 2.7, y0, y1, 0.22, 0.78, '#fcc419', { top: 0.15 }); // 車身
  s += box(x0 + 0.55, x0 + 2.0, y0 + 0.08, y1 - 0.08, 0.78, 1.25, '#fcc419', { top: 0.2 }); // 車廂
  s += poly([P(x0 + 0.65, y0 + 0.07, 0.84), P(x0 + 1.9, y0 + 0.07, 0.84), P(x0 + 1.9, y0 + 0.07, 1.18), P(x0 + 0.65, y0 + 0.07, 1.18)], '#334155');
  s += box(x0 + 1.1, x0 + 1.45, y0 + 0.4, y1 - 0.4, 1.25, 1.4, '#ffffff');
  s += poly([P(x0 + 2.71, y0 + 0.1, 0.45), P(x0 + 2.71, y0 + 0.3, 0.45), P(x0 + 2.71, y0 + 0.3, 0.6), P(x0 + 2.71, y0 + 0.1, 0.6)], '#e03131');
  for (const wx of [x0 + 0.55, x0 + 2.15]) { const [cx, cy] = P(wx, y0, 0.22); s += `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="9" ry="8" fill="#1f2a2c"/>`; }
  const a = P(x0, y0, 0), b = P(x0 + 2.7, y1, 1.4);
  const minX = Math.min(a[0], b[0], P(x0, y1, 1.4)[0]) - 12, maxX = Math.max(a[0], b[0], P(x0 + 2.7, y0, 0)[0]) + 12;
  const minY = Math.min(P(x0, y1, 1.4)[1], b[1]) - 6, maxY = Math.max(a[1], P(x0 + 2.7, y0, 0)[1]) + 10;
  return [s, [r1(minX), r1(minY), r1(maxX - minX), r1(maxY - minY)]];
}
