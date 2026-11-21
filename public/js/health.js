// 健康與運動（ADR-0018，2026-11-22 產品負責人定案）：讀手機的步數與運動時間，天氣好又動得少時建議去走走。
// **健康資料只留在手機**：這個檔不呼叫阿幫的 API（只讀同站的內建地標庫 /core/landmarks.json），
// 步數、運動分鐘、「動得少」的推論都在手機上算（/core/health-nudge.js），不送伺服器、不寫 log、不進 agent 的 userState 或 prompt，
// 也不存進 localStorage（只記開關與「今天提過沒有」的日期旗標）。
// 預設關閉，使用者在「設定與隱私」或「我的」自己打開；第一次打開時才跳系統權限。
// 兩種來源（介面相同：status、requestPermission、summary）：
//   手機 App：專案內外掛 AbangHealth（Android Health Connect、iPhone HealthKit；只讀、不寫）
//   網頁版與示範：示範健康資料（畫面上標「示範」），整個流程在沒有手機時也能跑、E2E 可測
import { normalizeHealth, nudgeFor, dayRecord, walkSpots, homeAllowed, agentAllowed, dayProgress, twDate, distanceM } from '../../core/health-nudge.js';

const PLUGIN = 'AbangHealth';
export const HEALTH_KEY = 'abang.health';
export const HEALTH_DAY_KEY = 'abang.healthDay';
const TTL = 5 * 60_000; // 步數在記憶體裡 5 分鐘（不寫進手機儲存）

/** 使用者有沒有打開（預設關閉） */
export function healthEnabled() {
  try { return globalThis.localStorage?.getItem(HEALTH_KEY) === 'on'; } catch { return false; }
}
export function setHealthEnabled(on) {
  try { if (on) globalThis.localStorage.setItem(HEALTH_KEY, 'on'); else globalThis.localStorage.removeItem(HEALTH_KEY); } catch { return false; }
  cache = null;
  globalThis.dispatchEvent?.(new CustomEvent('abang:health-setting', { detail: { on: !!on } }));
  return true;
}

// ───── 來源 ─────
const cap = () => {
  const c = globalThis.Capacitor;
  try { return c?.isNativePlatform?.() && c.isPluginAvailable?.(PLUGIN) && typeof c.nativePromise === 'function' ? c : null; } catch { return null; }
};
const nativeApp = () => { try { return !!globalThis.Capacitor?.isNativePlatform?.(); } catch { return false; } };

/** 示範健康資料（網頁版、示範模式）：今天的步數跟著時間長，但一直低於目標的一半；近 7 天有幾天運動 */
export function demoSummary(now = Date.now()) {
  const today = twDate(now);
  const day = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
  const past = [[6, 5200, 20], [5, 7400, 0], [4, 3100, 35], [3, 6800, 0], [2, 4500, 15], [1, 2900, 0]];
  return {
    source: 'demo',
    days: [...past.map(([n, steps, exerciseMin]) => ({ date: day(n), steps, exerciseMin })), { date: today, steps: Math.round(3000 * dayProgress(now)), exerciseMin: 0 }],
  };
}

const demoBackend = {
  where: 'demo',
  status: async () => ({ available: true, permission: 'granted', source: 'demo' }),
  requestPermission: async () => ({ available: true, permission: 'granted', source: 'demo' }),
  summary: async () => demoSummary(),
};
const nativeBackend = (c) => ({
  where: 'app',
  status: () => c.nativePromise(PLUGIN, 'status', {}),
  requestPermission: () => c.nativePromise(PLUGIN, 'requestPermission', {}),
  summary: () => c.nativePromise(PLUGIN, 'summary', { days: 7 }),
  openSettings: (target) => c.nativePromise(PLUGIN, 'openSettings', { target }),
});
/** 手機 App 裡卻沒有外掛（舊版 App）：不用示範資料冒充 */
const missingBackend = { where: 'app', status: async () => ({ available: false, reason: 'no-plugin' }), requestPermission: async () => ({ available: false, reason: 'no-plugin' }), summary: async () => null };
const backend = () => { const c = cap(); return c ? nativeBackend(c) : nativeApp() ? missingBackend : demoBackend; };

/** 不能用的原因（畫面文字）；denied／no-data 是有外掛但讀不到 */
export const HEALTH_WHY = {
  'not-installed': '這支手機還沒有 Health Connect（健康資料連線）。到 Play 商店安裝後再打開。',
  'update-needed': 'Health Connect 需要更新。到 Play 商店更新後再打開。',
  os: '需要 Android 9 以上才能讀步數（Health Connect 的最低版本）。',
  'no-healthkit': '這台裝置沒有「健康」App（例如 iPad），讀不到步數。',
  'no-entitlement': '這個版本的 Abang 沒有開通 Apple 健康（開發版用免費開發者帳號簽章，不能使用 HealthKit），所以讀不到步數。',
  'no-plugin': '這個版本的 App 還沒有健康資料功能，請更新 App。',
  failed: '暫時讀不到健康資料，等一下再試。',
};
export const HEALTH_DENIED = {
  android: '你沒有允許阿幫讀取步數和運動時間。要打開的話，按下面的「到 Health Connect 允許」，在 Abang 打開「步數」「運動」。',
  ios: '讀不到步數：可能沒有允許。到「健康」App → 右上角頭像 → 隱私權 → App → Abang，打開「步數」與「體能訓練時間」。',
};

/**
 * 外掛（或示範）回報 → 畫面用的狀態。
 * state：ready 可以讀｜need-permission 還沒問過（打開開關時才問）｜denied 被拒｜unavailable 這支手機不能用
 * @returns {{ where: 'app'|'demo', source: string, state: 'ready'|'need-permission'|'denied'|'unavailable', reason?: string, platform: 'android'|'ios'|'web', canOpen: boolean, canInstall: boolean }}
 */
export function healthState(r, where = 'app', platform = 'android') {
  const base = { where, source: r?.source || (where === 'demo' ? 'demo' : platform === 'ios' ? 'healthkit' : 'health-connect'), platform };
  if (!r || r.available === false) {
    const reason = Object.hasOwn(HEALTH_WHY, r?.reason) ? r.reason : 'failed';
    return { ...base, state: 'unavailable', reason, canOpen: false, canInstall: platform === 'android' && (reason === 'not-installed' || reason === 'update-needed') };
  }
  if (r.permission === 'granted' || r.permission === 'partial' || r.permission === 'asked') return { ...base, state: 'ready', canOpen: platform === 'android', canInstall: false };
  if (r.permission === 'denied') return { ...base, state: 'denied', reason: 'denied', canOpen: platform === 'android', canInstall: false };
  return { ...base, state: 'need-permission', canOpen: false, canInstall: false };
}
const platformOf = () => { try { const p = globalThis.Capacitor?.getPlatform?.(); return p === 'ios' || p === 'android' ? p : 'web'; } catch { return 'web'; } };

/** 現在能不能讀（不跳權限框） */
export async function healthStatus() {
  const b = backend();
  try { return healthState(await b.status(), b.where, b.where === 'demo' ? 'web' : platformOf()); } catch { return healthState({ available: false, reason: 'failed' }, b.where, platformOf()); }
}
/** 第一次打開開關時才呼叫：跳系統權限（Health Connect 或「健康」App 的畫面），允許要使用者自己按 */
export async function requestHealthPermission() {
  const b = backend();
  cache = null;
  try { return healthState(await b.requestPermission(), b.where, b.where === 'demo' ? 'web' : platformOf()); } catch { return healthState({ available: false, reason: 'failed' }, b.where, platformOf()); }
}
/** 開 Health Connect（manage：允許權限；install：Play 商店安裝或更新）。iPhone 不能直接開「健康」App 的權限頁，只說路徑 */
export async function openHealthSettings(target = 'manage') {
  const b = backend();
  if (!b.openSettings) return false;
  try { await b.openSettings(target); return true; } catch { return false; }
}

/** @type {{ at: number, v: ReturnType<typeof normalizeHealth> }|null} */
let cache = null;
/** 每日步數、運動分鐘（正規化；只在記憶體）。沒打開、讀不到都回 null */
export async function healthSummary(now = Date.now()) {
  if (!healthEnabled()) return null;
  if (cache && now - cache.at < TTL) return cache.v;
  let v;
  try { v = normalizeHealth(await backend().summary(), now); } catch { v = null; }
  cache = v ? { at: now, v } : null;
  return v;
}
/** 測試用 */
export const _resetHealth = () => { cache = null; spotsP = null; };

// ───── 散步地點：內建地標庫（同站靜態檔；跟健康狀態無關，打開功能時載一次） ─────
let spotsP = null;
export function loadWalkSpots() {
  spotsP ||= fetch('/core/landmarks.json').then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((j) => walkSpots(j)).catch(() => { spotsP = null; return []; }); // 失敗不記住，下次再載
  return spotsP;
}

// ───── 一天提一次（只記日期與兩個旗標） ─────
const readDay = (now) => { try { return dayRecord(JSON.parse(globalThis.localStorage?.getItem(HEALTH_DAY_KEY) || 'null'), now); } catch { return dayRecord(null, now); } };
const writeDay = (rec) => { try { globalThis.localStorage.setItem(HEALTH_DAY_KEY, JSON.stringify(rec)); } catch { /* 無痕 */ } };
/** 按「今天不用」：首頁小卡收起、問阿幫也不提，到明天再說 */
export function dismissToday(now = Date.now()) { writeDay({ ...readDay(now), off: true }); globalThis.dispatchEvent?.(new CustomEvent('abang:health-day')); }
/** 問阿幫時提過了（今天不再主動提） */
export function markMentioned(now = Date.now()) { writeDay({ ...readDay(now), agent: true }); }

/**
 * 首頁「現在」的小卡：打開了、今天沒按過「今天不用」、天氣好又動得少（go）或已達標（cheer）。
 * @param {{ weather?: object|null, air?: object|null, pos?: {lat:number,lon:number}|null }} d 首頁已經查好的天氣、空品（位置只在有定位時給）
 */
export async function homeNudge(d, now = Date.now()) {
  if (!healthEnabled() || !homeAllowed(readDay(now))) return null;
  if (!d?.pos) return null; // 沒有定位：首頁的天氣是台北車站附近的備用資料，不拿來建議散步
  const [health, spots] = await Promise.all([healthSummary(now), loadWalkSpots()]);
  if (!health) return null;
  const n = nudgeFor({ health, ...d, spots }, now);
  return n.kind === 'go' || n.kind === 'cheer' ? n : null;
}

export { EXERCISE_Q } from '../../core/health-nudge.js';

/** 這一輪查到的天氣、空品（問天氣、出門、空品時）；明天的天氣不算。pos 是工具查的位置（沒有座標就不找公園） */
export function turnWeather(results = []) {
  let weather = null, air = null, pos = null, relevant = false;
  const at = (a) => (Number.isFinite(a?.lat) && Number.isFinite(a?.lon) ? { lat: a.lat, lon: a.lon } : null);
  for (const r of results) {
    if (!r?.data) continue;
    if (r.tool === 'outing_advice') { relevant = true; weather = r.data.weather || weather; air = r.data.air || air; pos = at(r.args) || pos; }
    else if (r.tool === 'weather_now') { relevant = true; weather = r.data; pos = pos || at(r.args); }
    else if (r.tool === 'aqi_nearby') { relevant = true; air = r.data.nearest || air; pos = pos || at(r.args); }
  }
  return { relevant, weather, air, pos };
}

/**
 * 散步建議只用「你在的地方」的天氣：查天氣的位置離手機的位置 3 公里內才算（問「高雄天氣」「去淡水那邊天氣好嗎」都不拿來建議）。
 * 手機的位置只在手機上比對，不送出；不知道你在哪就不算。
 */
export const NEAR_ME_M = 3000;
export function nearMe(p, me) {
  return !!p && !!me && Number.isFinite(p.lat) && Number.isFinite(me.lat) && distanceM(p.lat, p.lon, me.lat, me.lon) <= NEAR_ME_M;
}

/**
 * 問阿幫之後在手機上補一句（不進對話紀錄、不送伺服器）。asked：使用者自己問要不要去運動。
 * 一天主動提一次；自己問一定回答。
 */
export async function agentNudge(d, { asked = false } = {}, now = Date.now()) {
  if (!healthEnabled() || !agentAllowed(readDay(now), asked)) return null;
  const [health, spots] = await Promise.all([healthSummary(now), loadWalkSpots()]);
  const n = nudgeFor({ health, ...d, spots, asked }, now);
  if (n.kind === 'none' && !asked) return null;
  if (!asked && n.kind !== 'go' && n.kind !== 'cheer') return null;
  if (n.kind === 'go' || n.kind === 'cheer') markMentioned(now); // 建議過了：今天不再主動提（自己問的也算）
  return n;
}
