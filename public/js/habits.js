// 個人化：記住常選的交通方式（2026-11-21，ADR-0010 習慣）。只存在這支手機（localStorage 一個鍵）。
// 只記「選了哪種交通方式」與時間，不記地點、路線、站名或其他任何東西。
// 「選了」＝在行程卡按建議方案的導航／叫車／訂票、說或按「改成 X」（決策圖點方案也是）、設公車到站提醒或下車提醒。
// 用法：常選比例隨問阿幫的請求送出（userState.habit），由 core/decide.js 小幅加分；設定頁可以關閉、清除。
export const HABITS_KEY = 'abang.habits';
export const HABIT_MODES = ['walk', 'bike', 'bus', 'metro', 'tra', 'thsr', 'intercity', 'ridehail'];
export const HABIT_MAX_PICKS = 50; // 最近 50 次
export const HABIT_HALF_LIFE_DAYS = 60; // 60 天前的一次只算半次
export const HABIT_KEEP_DAYS = 180; // 180 天前的不再算（只剩 1/8）
export const HABIT_MIN_PICKS = 5; // 選過 5 次以上才生效
export const HABIT_SAME_MS = 30 * 60e3; // 30 分鐘內同一種方式只算一次（同一趟按導航又按叫車不重複算）
const DAY = 864e5;
const NAME = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', tra: '台鐵', thsr: '高鐵', intercity: '客運', ridehail: '叫車' };
export const habitName = (m) => NAME[m] || m;

/** 讀出（壞掉或沒有：預設開、沒有紀錄） */
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(HABITS_KEY) || 'null');
    if (!v || typeof v !== 'object') return { on: true, seen: false, picks: [] };
    const picks = Array.isArray(v.picks) ? v.picks.filter((p) => HABIT_MODES.includes(p?.m) && Number.isFinite(p?.t)).map((p) => ({ m: p.m, t: p.t })) : [];
    return { on: v.on !== false, seen: v.seen === true, picks };
  } catch { return { on: true, seen: false, picks: [] }; }
}
function save(s) {
  try { localStorage.setItem(HABITS_KEY, JSON.stringify({ v: 1, on: s.on, ...(s.seen && { seen: true }), picks: s.picks.slice(-HABIT_MAX_PICKS) })); return true; } catch { return false; } // 無痕模式：不記
}

/** 設定頁的開關（預設開） */
export const habitsOn = () => load().on;
export function setHabitsOn(on) { const s = load(); s.on = !!on; save(s); }

/**
 * 記一次「選了」：只存交通方式與時間。關閉時不記；30 分鐘內同一種方式只算一次。
 * @returns {boolean} 有沒有記
 */
export function noteChoice(role, now = Date.now()) {
  if (!HABIT_MODES.includes(role)) return false;
  const s = load();
  if (!s.on) return false;
  if (s.picks.some((p) => p.m === role && now - p.t >= 0 && now - p.t < HABIT_SAME_MS)) return false;
  s.picks.push({ m: role, t: now });
  return save(s);
}

/** 問阿幫的決策：使用者指定了方式（「改成捷運」、決策圖點方案、「坐捷運去」）且建議就是這種方式 → 算選了 */
export function noteDecision(d, now = Date.now()) {
  const role = d?.mode && d.options?.find((o) => o.id === d.best)?.role;
  return role === d?.mode ? noteChoice(role, now) : false;
}

/** 還算數的紀錄（180 天內） */
const live = (s, now) => s.picks.filter((p) => p.t <= now && now - p.t < HABIT_KEEP_DAYS * DAY);

/**
 * 常選比例（隨請求送出的 userState.habit）：時間衰減（60 天半衰期）後的比例，取到小數 2 位（無條件捨去，總和 ≤ 1）。
 * 關閉或選不到 5 次回 null。
 * @returns {Record<string, number> | null} 例 { metro: 0.6, bus: 0.3 }
 */
export function habitShare(now = Date.now()) {
  const s = load();
  const picks = live(s, now);
  if (!s.on || picks.length < HABIT_MIN_PICKS) return null;
  const w = {};
  for (const p of picks) w[p.m] = (w[p.m] || 0) + 0.5 ** ((now - p.t) / (HABIT_HALF_LIFE_DAYS * DAY));
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [m, v] of Object.entries(w).sort((a, b) => b[1] - a[1])) { const x = Math.floor((v / sum) * 100) / 100; if (x > 0) out[m] = x; }
  return Object.keys(out).length ? out : null;
}

/** 設定頁與決策圖「為什麼」用：總次數、各方式次數、最近 30 天各方式次數 */
export function habitSummary(now = Date.now()) {
  const s = load();
  const picks = live(s, now);
  const count = (list) => list.reduce((o, p) => ({ ...o, [p.m]: (o[p.m] || 0) + 1 }), {});
  return { on: s.on, total: picks.length, counts: count(picks), recent: count(picks.filter((p) => now - p.t < 30 * DAY)), active: s.on && picks.length >= HABIT_MIN_PICKS };
}

/** 「為什麼」一句話：最近 30 天選捷運 12 次（30 天內沒有就說最近 N 次裡選了幾次） */
export function habitWhy(role, now = Date.now()) {
  const { total, counts, recent } = habitSummary(now);
  const n30 = recent[role] || 0;
  return n30 ? `最近 30 天選${habitName(role)} ${n30} 次` : `最近 ${total} 次裡選${habitName(role)} ${counts[role] || 0} 次`;
}

/** 第一次在決策圖生效時說明一次 */
export const habitSeen = () => load().seen;
export function markHabitSeen() { const s = load(); s.seen = true; save(s); }

/** 清除紀錄（開關照舊：關掉的人清除後仍是關的） */
export function clearHabits() {
  const s = load();
  try { if (s.on) localStorage.removeItem(HABITS_KEY); else save({ on: false, seen: false, picks: [] }); } catch { /* 無痕模式 */ }
}

// 卡片（行程卡的導航、叫車、訂票）、到站提醒、下車提醒送出 abang:choice 事件（不必 import 這個檔；MCP Apps 的卡片沒人聽就沒事）
globalThis.addEventListener?.('abang:choice', (e) => noteChoice(e?.detail?.role));
