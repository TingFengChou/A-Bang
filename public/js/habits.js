// 個人化：記住常選的交通方式（2026-11-21，ADR-0010 習慣、ADR-0016 阿幫問你）。只存在這支手機（localStorage 一個鍵）。
// 記錄：只記「選了哪種交通方式」與時間，不記地點、路線、站名或其他任何東西（記錄預設開：只記不用，不影響建議）。
//   「選了」＝在行程卡按建議方案的導航／叫車／訂票、說或按「改成 X」（決策圖點方案也是）、設公車到站提醒或下車提醒。
// 使用：不默默套用推測——某種方式選得夠多時，阿幫在那一輪問一次（「以後要我優先推捷運嗎？」），說「好」才加分；
//   常叫車另外問原因（有理由才推叫車）：趕時間／常帶東西／不想走路 → 存成「你說過」的預設狀況（不自動套用：會改變建議時問「這次也帶東西嗎？」）；
//   就是喜歡叫車 → 叫車加分；不一定 → 不加分、不再問。
// 關鍵問題（「你趕時間嗎？」）：同一段起訖同一題 24 小時內只問一次——只存那一題的雜湊與時間（不存地點），最多 50 筆。
export const HABITS_KEY = 'abang.habits';
export const HABIT_MODES = ['walk', 'bike', 'bus', 'metro', 'tra', 'thsr', 'intercity', 'ridehail'];
export const HABIT_MAX_PICKS = 50; // 最近 50 次
export const HABIT_HALF_LIFE_DAYS = 60; // 60 天前的一次只算半次
export const HABIT_KEEP_DAYS = 180; // 180 天前的不再算（只剩 1/8）
export const HABIT_MIN_PICKS = 5; // 同一種方式選過 5 次以上才問
export const HABIT_ASK_SHARE = 0.6; // 而且佔（時間衰減後）6 成以上
export const HABIT_DECLINE_DAYS = 90; // 說「不用」或撤銷後 90 天內不再問
export const HABIT_REASK_DAYS = 3; // 問了沒回答（直接問別的）：3 天後才再問
export const QUESTION_TTL_MS = 24 * 3600e3; // 同一題 24 小時內不再問
export const QUESTION_MAX = 50;
export const HABIT_SAME_MS = 30 * 60e3; // 30 分鐘內同一種方式只算一次（同一趟按導航又按叫車不重複算）
/** 叫車原因 → 「你說過」的預設狀況 */
export const RIDE_REASONS = { rush: 'rush', luggage: 'luggage', lessWalk: 'lessWalk' };
const DAY = 864e5;
const NAME = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', tra: '台鐵', thsr: '高鐵', intercity: '客運', ridehail: '叫車' };
export const habitName = (m) => NAME[m] || m;
/** 「你說過」的預設狀況怎麼稱呼（決策圖、設定頁） */
export const USUAL_LABEL = { rush: '常趕時間', luggage: '常帶東西', lessWalk: '不想走路' };

const empty = () => ({ on: true, picks: [], confirmed: {}, declined: {}, asked: {}, usual: [], ride: null, seenQ: {}, salt: null });
const times = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([m, t]) => HABIT_MODES.includes(m) && Number.isFinite(t)));
/** 讀出（壞掉或沒有：記錄開、沒有紀錄） */
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(HABITS_KEY) || 'null');
    if (!v || typeof v !== 'object') return empty();
    return {
      on: v.on !== false,
      picks: Array.isArray(v.picks) ? v.picks.filter((p) => HABIT_MODES.includes(p?.m) && Number.isFinite(p?.t)).map((p) => ({ m: p.m, t: p.t })) : [],
      confirmed: times(v.confirmed), declined: times(v.declined), asked: times(v.asked),
      usual: Array.isArray(v.usual) ? v.usual.filter((k) => RIDE_REASONS[k]).slice(0, 3) : [],
      ride: ['rush', 'luggage', 'lessWalk', 'love', 'depends'].includes(v.ride) ? v.ride : null,
      salt: typeof v.salt === 'string' && /^[0-9a-f]{16}$/.test(v.salt) ? v.salt : null,
      seenQ: Object.fromEntries(Object.entries(v.seenQ && typeof v.seenQ === 'object' ? v.seenQ : {}).filter(([k, t]) => /^[0-9a-f]{8}$/.test(k) && Number.isFinite(t))),
    };
  } catch { return empty(); }
}
function save(s) {
  try { localStorage.setItem(HABITS_KEY, JSON.stringify({ v: 2, ...s, picks: s.picks.slice(-HABIT_MAX_PICKS) })); return true; } catch { return false; } // 無痕模式：不記
}

/** 設定頁的開關（記錄；預設開）。關掉＝不記、不問、不加分（說過的預設狀況照舊，可另外撤銷） */
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
/** 時間衰減（60 天半衰期）後的比例，取到小數 2 位（無條件捨去，總和 ≤ 1） */
function shares(picks, now) {
  const w = {};
  for (const p of picks) w[p.m] = (w[p.m] || 0) + 0.5 ** ((now - p.t) / (HABIT_HALF_LIFE_DAYS * DAY));
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [m, v] of Object.entries(w).sort((a, b) => b[1] - a[1])) { const x = Math.floor((v / sum) * 100) / 100; if (x > 0) out[m] = x; }
  return out;
}

/**
 * 隨請求送出的比例（userState.habit）：只有使用者說「好」的方式（叫車要答「就是喜歡叫車」）。關閉或沒有回 null。
 * @returns {Record<string, number> | null} 例 { metro: 0.8 }
 */
export function habitShare(now = Date.now()) {
  const s = load();
  if (!s.on) return null;
  const all = shares(live(s, now), now);
  const out = Object.fromEntries(Object.entries(all).filter(([m]) => s.confirmed[m]));
  return Object.keys(out).length ? out : null;
}

/** 這次可以問的候選（userState.habitAsk）：選過 ≥ 5 次、佔 6 成以上、還沒回答過、沒在 90 天內說不用、3 天內沒問過 */
export function habitCandidate(now = Date.now()) {
  const s = load();
  if (!s.on) return null;
  const picks = live(s, now);
  const sh = shares(picks, now);
  for (const [m, x] of Object.entries(sh)) {
    const count = picks.filter((p) => p.m === m).length;
    if (count < HABIT_MIN_PICKS || x < HABIT_ASK_SHARE || s.confirmed[m]) continue;
    if (m === 'ridehail' && s.ride) continue; // 叫車原因答過（任何答案）就不再問
    if (s.declined[m] && now - s.declined[m] < HABIT_DECLINE_DAYS * DAY) continue;
    if (s.asked[m] && now - s.asked[m] < HABIT_REASK_DAYS * DAY) continue;
    return { mode: m, count: Math.min(count, HABIT_MAX_PICKS) };
  }
  return null;
}

/** 問阿幫請求的 userState（只有比例、預設狀況鍵、候選方式與次數；沒有地點） */
export function habitRequest(now = Date.now()) {
  const habit = habitShare(now), habitAsk = habitCandidate(now), usual = load().usual;
  const u = { ...(habit && { habit }), ...(usual.length && { usual }), ...(habitAsk && { habitAsk }) };
  return Object.keys(u).length ? u : null;
}

/** 問題的鍵（含起訖粗座標）＋這支手機的隨機鹽 → 8 碼雜湊（FNV-1a）：手機上只存這個，不存地點；
 *  有鹽，拿到 localStorage 的人也不能拿家、公司的座標去試出問過哪段路（清除時鹽一起清） */
export function questionHash(key, salt = '') {
  let h = 0x811c9dc5;
  for (const ch of `${salt}|${key}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const newSalt = () => {
  const b = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b); else for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
/** 這一題（同一段起訖、同一個狀態）24 小時內問過嗎 */
export function questionAskedRecently(key, now = Date.now()) {
  const s = load();
  if (!s.salt) return false;
  const t = s.seenQ[questionHash(key, s.salt)];
  return Number.isFinite(t) && now - t >= 0 && now - t < QUESTION_TTL_MS;
}
/** 記下問過這一題（出現就算；點了「不趕」也是問過）；過期的清掉、最多 50 筆 */
export function markQuestion(key, now = Date.now()) {
  const s = load();
  s.salt ||= newSalt();
  const keep = Object.entries(s.seenQ).filter(([, t]) => now - t < QUESTION_TTL_MS).sort((a, b) => b[1] - a[1]).slice(0, QUESTION_MAX - 1);
  s.seenQ = Object.fromEntries([[questionHash(key, s.salt), now], ...keep]);
  save(s);
}

/** 問題出現了（沒回答也算問過：3 天內不再問） */
export function markAsked(mode, now = Date.now()) { if (!HABIT_MODES.includes(mode)) return; const s = load(); s.asked[mode] = now; save(s); }

/**
 * 「阿幫問你」的 store 答案（core/agent/ask.js 產生的 value）：
 *   habit:yes:<mode>｜habit:no:<mode>｜ride:rush｜ride:luggage｜ride:lessWalk｜ride:love｜ride:depends
 * @returns {{ ok: boolean, habit?: Record<string, number>|null, say?: string }} 要套到這一輪決策圖的效果（說過的狀況不自動套用）
 */
export function applyStore(value, now = Date.now()) {
  const [kind, a, b] = String(value).split(':');
  const s = load();
  if (kind === 'habit' && HABIT_MODES.includes(b) && (a === 'yes' || a === 'no')) {
    if (a === 'yes') { s.confirmed[b] = now; delete s.declined[b]; } else { s.declined[b] = now; delete s.confirmed[b]; }
    save(s);
    return a === 'yes' ? { ok: true, habit: habitShare(now), say: `好，以後您沒說條件時，優先推${habitName(b)}。可以在設定撤銷。` } : { ok: true, say: '好，不會因為次數多就優先推。' };
  }
  if (kind === 'ride' && ['rush', 'luggage', 'lessWalk', 'love', 'depends'].includes(a)) {
    s.ride = a;
    if (RIDE_REASONS[a]) s.usual = [a];
    if (a === 'love') { s.confirmed.ridehail = now; delete s.declined.ridehail; }
    save(s);
    if (RIDE_REASONS[a]) return { ok: true, say: `記住了：您${USUAL_LABEL[a]}。之後沒說條件、而且會影響建議時，我會先問您一句。可以在設定撤銷。` };
    return a === 'love' ? { ok: true, habit: habitShare(now), say: '好，以後您沒說條件時，叫車會優先一點。可以在設定撤銷。' } : { ok: true, say: '好，叫車照每次的狀況算，不會再問。' };
  }
  return { ok: false };
}

/** 設定頁：撤銷同意（90 天內不再問） */
export function revokeHabit(mode, now = Date.now()) {
  const s = load();
  delete s.confirmed[mode];
  s.declined[mode] = now;
  if (mode === 'ridehail' && s.ride === 'love') s.ride = 'depends';
  save(s);
}
/** 設定頁：撤銷「你說過」的預設狀況（叫車原因不再問） */
export function revokeUsual(key) { const s = load(); s.usual = s.usual.filter((k) => k !== key); save(s); }
/** 說過的預設狀況（userState.usual） */
export const usualStates = () => load().usual;
/** 已同意優先推的方式 */
export const confirmedModes = () => Object.keys(load().confirmed);

/** 設定頁與決策圖「為什麼」用：總次數、各方式次數、最近 30 天各方式次數 */
export function habitSummary(now = Date.now()) {
  const s = load();
  const picks = live(s, now);
  const count = (list) => list.reduce((o, p) => ({ ...o, [p.m]: (o[p.m] || 0) + 1 }), {});
  return { on: s.on, total: picks.length, counts: count(picks), recent: count(picks.filter((p) => now - p.t < 30 * DAY)), confirmed: Object.keys(s.confirmed), usual: s.usual };
}

/** 「為什麼」一句話：最近 30 天選捷運 12 次（30 天內沒有就說最近 N 次裡選了幾次） */
export function habitWhy(role, now = Date.now()) {
  const { total, counts, recent } = habitSummary(now);
  const n30 = recent[role] || 0;
  return n30 ? `最近 30 天選${habitName(role)} ${n30} 次` : `最近 ${total} 次裡選${habitName(role)} ${counts[role] || 0} 次`;
}

/** 清除全部（紀錄、同意、說過的狀況）；記錄開關照舊：關掉的人清除後仍是關的 */
export function clearHabits() {
  const s = load();
  try { if (s.on) localStorage.removeItem(HABITS_KEY); else save({ ...empty(), on: false }); } catch { /* 無痕模式 */ }
}

// 卡片（行程卡的導航、叫車、訂票）、到站提醒、下車提醒送出 abang:choice 事件（不必 import 這個檔；MCP Apps 的卡片沒人聽就沒事）
globalThis.addEventListener?.('abang:choice', (e) => noteChoice(e?.detail?.role));
