// 天氣好又動得少時建議去走走（ADR-0018，2026-11-22 產品負責人定案）。
// 純函式、不連網、不依賴 Node：伺服器以 /core/health-nudge.js 提供給前端（public/js/health.js），App 打包時一起複製。
// **健康資料只在手機上**：步數、運動分鐘、「動得少」的推論都在這裡（手機上）算，不送伺服器、不寫 log、不進 agent 的 userState 或 prompt。
// 天氣、空品、地標是本來就會查的資料（天氣與空品來自既有 API；地標是內建地標庫 core/data/landmarks.json 的 walk 欄位）。
// 判斷規則由程式決定（ADR-0010 精神），門檻都是下面的常數，改了要更新 test/health.test.js。
import { walkMinutes, navLinks } from './nav.js';

/** 「動得少」：步數依時段比例、近 7 天運動分鐘的進度 */
export const MOVE = Object.freeze({
  STEP_GOAL: 6000, // 一天的目標步數
  STEP_PACE: 0.6, // 到現在應有的步數（目標按時間比例）的 60% 以下才算少
  MIN_EXPECTED_STEPS: 600, // 應有步數還不到這麼多（一大早）不判斷步數
  WEEK_EXERCISE_MIN: 150, // 近 7 天的運動分鐘目標
  ACTIVE_FROM: 7 * 60, // 估「到現在應有多少步」用的清醒時段（台灣時間，分鐘）
  ACTIVE_TO: 22 * 60,
});

/** 「天氣好」：沒下雨、3 小時降雨機率 < 30%、體感 15～31°C、AQI ≤ 100、06:00～19:30 */
export const GOOD = Object.freeze({ POP_LT: 30, FEELS_MIN: 15, FEELS_MAX: 31, AQI_MAX: 100, FROM: 6 * 60, TO: 19 * 60 + 30 });

/** 散步地點：走路 10～25 分 */
export const WALK = Object.freeze({ MIN: 10, MAX: 25 });

/** 健康資料來源（外掛與示範） */
export const HEALTH_SOURCES = ['health-connect', 'healthkit', 'demo'];

const TW = 8 * 3600e3;
/** 台灣時間的日期 YYYY-MM-DD */
export const twDate = (now = Date.now()) => new Date(now + TW).toISOString().slice(0, 10);
/** 台灣時間的「一天中第幾分鐘」 */
export const twMinutes = (now = Date.now()) => Math.floor(((now + TW) % 864e5) / 6e4);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** 清醒時段已經過了多少（0～1） */
export function dayProgress(now = Date.now()) {
  const m = twMinutes(now);
  return Math.min(1, Math.max(0, (m - MOVE.ACTIVE_FROM) / (MOVE.ACTIVE_TO - MOVE.ACTIVE_FROM)));
}

const int = (v, max) => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) || n < 0 ? null : Math.min(max, Math.round(n));
};

/**
 * 外掛（或示範）回來的資料 → 正規化：只留每日的日期、步數、運動分鐘（其他欄位一律丟掉），最近 7 天、由舊到新。
 * @param {any} raw { days: [{ date, steps, exerciseMin }], source }
 * @returns {{ days: Array<{ date: string, steps: number|null, exerciseMin: number|null }>, source: string, demo: boolean }|null}
 */
export function normalizeHealth(raw, now = Date.now()) {
  if (!raw || !Array.isArray(raw.days)) return null;
  const today = twDate(now);
  const from = addDays(today, -6);
  const byDate = new Map();
  for (const d of raw.days) {
    const date = typeof d?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null;
    if (!date || date < from || date > today) continue;
    byDate.set(date, { date, steps: int(d.steps, 200000), exerciseMin: int(d.exerciseMin, 1440) });
  }
  // 這 7 天有任何一天有運動紀錄：其他天沒有紀錄就是沒運動（0），不是「不知道」
  if ([...byDate.values()].some((d) => d.exerciseMin != null)) for (const d of byDate.values()) d.exerciseMin ??= 0;
  const source = HEALTH_SOURCES.includes(raw.source) ? raw.source : 'unknown';
  return { days: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), source, demo: source === 'demo' };
}

/**
 * 動得多少（只在手機上算）。
 * low：步數低於「到現在應有步數」的 60%，或近 7 天運動分鐘低於進度（已達標就不算少）
 * met：今天步數達到目標，或近 7 天運動分鐘達到 150 分
 * @param {ReturnType<typeof normalizeHealth>} h
 */
export function movement(h, now = Date.now()) {
  const days = h?.days || [];
  const today = twDate(now);
  const t = days.find((d) => d.date === today);
  const steps = t?.steps ?? null;
  const prog = dayProgress(now);
  const expectedSteps = Math.round(MOVE.STEP_GOAL * prog);
  const stepsLow = steps != null && expectedSteps >= MOVE.MIN_EXPECTED_STEPS && steps < expectedSteps * MOVE.STEP_PACE;
  const exDays = days.filter((d) => d.exerciseMin != null);
  const exKnown = exDays.length > 0;
  const weekMin = exDays.reduce((s, d) => s + d.exerciseMin, 0);
  const pastDays = Math.min(6, exDays.filter((d) => d.date < today).length);
  const expectedWeekMin = Math.round((MOVE.WEEK_EXERCISE_MIN * Math.min(7, pastDays + prog)) / 7);
  const exerciseLow = exKnown && expectedWeekMin > 0 && weekMin < expectedWeekMin;
  const met = (steps != null && steps >= MOVE.STEP_GOAL) || (exKnown && weekMin >= MOVE.WEEK_EXERCISE_MIN);
  return { steps, weekMin: exKnown ? weekMin : null, expectedSteps, expectedWeekMin, stepsLow, exerciseLow, low: !met && (stepsLow || exerciseLow), met, known: steps != null || exKnown };
}

/**
 * 天氣好不好（給散步用）。資料不夠（沒查到降雨機率、溫度、AQI）就不算好：寧可不推。
 * @param {{ weather?: { raining?: boolean, rainMm1h?: number|null, pop3h?: number|null, tempC?: number|null, feelsC?: number|null }|null, air?: { aqi?: number|string|null }|null }} d
 * @returns {{ ok: boolean, reasons: string[], feelsC: number|null, aqi: number|null, pop3h: number|null }}
 *   reasons：rain 下雨｜pop 降雨機率高｜hot 太熱｜cold 太冷｜air 空品不好｜dark 不在白天到傍晚｜no-weather｜no-air
 */
export function weatherGood({ weather = null, air = null } = {}, now = Date.now()) {
  const reasons = [];
  const m = twMinutes(now);
  if (m < GOOD.FROM || m > GOOD.TO) reasons.push('dark');
  const pop = Number.isFinite(weather?.pop3h) ? weather.pop3h : null;
  const feels = Number.isFinite(weather?.feelsC) ? weather.feelsC : Number.isFinite(weather?.tempC) ? weather.tempC : null; // 沒有體感溫度時用氣溫
  if (!weather || pop == null || feels == null) reasons.push('no-weather');
  if (weather?.raining || weather?.rainMm1h > 0) reasons.push('rain');
  else if (pop != null && pop >= GOOD.POP_LT) reasons.push('pop');
  if (feels != null && feels > GOOD.FEELS_MAX) reasons.push('hot');
  if (feels != null && feels < GOOD.FEELS_MIN) reasons.push('cold');
  const aqi = air && air.aqi !== '' && air.aqi != null && Number.isFinite(Number(air.aqi)) ? Number(air.aqi) : null;
  if (aqi == null) reasons.push('no-air');
  else if (aqi > GOOD.AQI_MAX) reasons.push('air');
  return { ok: !reasons.length, reasons, feelsC: feels, aqi, pop3h: pop };
}

/** 兩點直線距離（公尺） */
export function distanceM(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}

/** 內建地標庫裡適合散步的地方（有 walk 欄位：park 公園、riverside 河濱、trail 步道） */
export const walkSpots = (landmarks) => (landmarks?.items || landmarks || []).filter((x) => x && x.walk && Number.isFinite(x.lat) && Number.isFinite(x.lon));

/**
 * 最近、走路 10～25 分的散步地點（沒有回 null）。
 * @param {Array<{ name: string, lat: number, lon: number, walk: string, en?: string }>} spots
 * @param {{ lat: number, lon: number }|null} pos
 */
export function pickWalkSpot(spots, pos) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return null;
  let best = null;
  for (const s of spots || []) {
    const d = distanceM(pos.lat, pos.lon, s.lat, s.lon);
    const min = walkMinutes(d);
    if (min == null || min < WALK.MIN || min > WALK.MAX) continue;
    if (!best || d < best.d) best = { d, spot: s, min };
  }
  return best && { name: best.spot.name, en: best.spot.en || best.spot.name, kind: best.spot.walk, lat: best.spot.lat, lon: best.spot.lon, walkMin: best.min, nav: navLinks(best.spot.lat, best.spot.lon, 'walking') };
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const REASON = {
  rain: () => ['現在在下雨', "it's raining"],
  pop: (w) => [`接下來 3 小時降雨機率 ${w.pop3h}%`, `there's a ${w.pop3h}% chance of rain in the next 3 hours`],
  hot: (w) => [`體感 ${Math.round(w.feelsC)}°C 太熱`, `it feels like ${Math.round(w.feelsC)}°C, too hot`],
  cold: (w) => [`體感 ${Math.round(w.feelsC)}°C 偏冷`, `it feels like ${Math.round(w.feelsC)}°C, quite cold`],
  air: (w) => [`AQI ${w.aqi} 空氣不太好`, `the air isn't great (AQI ${w.aqi})`],
  dark: () => ['天色晚了', "it's getting late"],
  'no-weather': () => ['這次沒查到天氣', "I couldn't get the weather this time"],
  'no-air': () => ['這次沒查到空品', "I couldn't get air quality this time"],
};

/**
 * 要不要建議去走走：判斷與文案都在手機上組。
 * kind：go 建議去走走｜cheer 已達標給一句鼓勵（不推）｜wait 動得少但天氣不適合（只有使用者自己問時才說）｜ok 進度不錯（只有自己問時才說）｜none 不說
 * @param {{ health: ReturnType<typeof normalizeHealth>, weather?: object|null, air?: object|null, pos?: {lat:number,lon:number}|null, spots?: any[], asked?: boolean }} o
 *   asked：使用者自己問「要不要去運動」（天氣不好、進度不錯也回一句）
 * @returns {{ kind: 'go'|'cheer'|'wait'|'ok'|'none', text: string, en: string, spot: ReturnType<typeof pickWalkSpot>, demo: boolean, mv: ReturnType<typeof movement>, wx: ReturnType<typeof weatherGood> }}
 */
export function nudgeFor({ health, weather = null, air = null, pos = null, spots = [], asked = false } = {}, now = Date.now()) {
  const mv = movement(health, now);
  const wx = weatherGood({ weather, air }, now);
  const demo = !!health?.demo;
  const out = (kind, text = '', en = '', spot = null) => ({ kind, text, en, spot, demo, mv, wx });
  if (!health || !mv.known) return asked ? out('none', '這次讀不到你的步數，到「設定與隱私 → 健康與運動」看看權限。', "I couldn't read your steps this time. Check Settings → Health & exercise.") : out('none');
  const moveZh = mv.stepsLow || mv.weekMin == null ? `今天才走 ${fmt(mv.steps ?? 0)} 步` : `這 7 天才運動 ${mv.weekMin} 分鐘`;
  const moveEn = mv.stepsLow || mv.weekMin == null ? `you've only walked ${fmt(mv.steps ?? 0)} steps today` : `you've only exercised ${mv.weekMin} min this week`;
  if (mv.met) {
    const zh = mv.steps != null && mv.steps >= MOVE.STEP_GOAL ? `今天走了 ${fmt(mv.steps)} 步，達標了，很棒！` : `這 7 天運動了 ${mv.weekMin} 分鐘，達標了，很棒！`;
    const en = mv.steps != null && mv.steps >= MOVE.STEP_GOAL ? `${fmt(mv.steps)} steps today. Goal reached, nice!` : `${mv.weekMin} min of exercise this week. Goal reached, nice!`;
    return out('cheer', zh, en);
  }
  if (mv.low && wx.ok) {
    const spot = pickWalkSpot(spots, pos);
    const zh = `天氣好、AQI ${wx.aqi}，${moveZh}；${spot ? `走到${spot.name}約 ${spot.walkMin} 分` : '附近走走 20 分鐘也好'}。`;
    const en = `Nice weather and AQI ${wx.aqi}, and ${moveEn}. ${spot ? `${spot.en} is about a ${spot.walkMin}-min walk.` : 'A 20-minute walk nearby would help.'}`;
    return out('go', zh, en, spot);
  }
  if (!asked) return out('none');
  const say = { ...wx };
  const why = wx.reasons.filter((r) => REASON[r]).slice(0, 2).map((r) => REASON[r](say));
  if (mv.low) {
    return out('wait', `${moveZh}，不過${why.map((x) => x[0]).join('、')}，可以在室內走走，或晚點、明天白天再出門。`,
      `${moveEn[0].toUpperCase()}${moveEn.slice(1)}, but ${why.map((x) => x[1]).join(' and ')}. Try walking indoors, or go out later or tomorrow during the day.`);
  }
  const stepsZh = mv.steps != null ? `今天走了 ${fmt(mv.steps)} 步` : `這 7 天運動了 ${mv.weekMin} 分鐘`;
  const stepsEn = mv.steps != null ? `${fmt(mv.steps)} steps today` : `${mv.weekMin} min of exercise this week`;
  if (wx.ok) {
    const spot = pickWalkSpot(spots, pos);
    return out('ok', `${stepsZh}，進度不錯；天氣也好，想去就去吧${spot ? `（走到${spot.name}約 ${spot.walkMin} 分）` : ''}。`, `${stepsEn}, you're on track. The weather's nice too, so go for it${spot ? ` (${spot.en} is about a ${spot.walkMin}-min walk)` : ''}.`, spot);
  }
  return out('ok', `${stepsZh}，進度不錯；${why.map((x) => x[0]).join('、')}，今天休息一下也沒關係。`, `${stepsEn}, you're on track. ${why.map((x) => x[1]).join(' and ').replace(/^./, (c) => c.toUpperCase())}, so taking it easy today is fine.`);
}

// ───── 一天提一次（手機上記：只有日期與兩個旗標，不含步數）─────
/**
 * 今天的提醒紀錄：換日就重來。
 * @param {any} raw localStorage 讀出來的 { d, off, agent }
 * @returns {{ d: string, off?: true, agent?: true }}
 */
export function dayRecord(raw, now = Date.now()) {
  const d = twDate(now);
  return raw && raw.d === d ? { d, ...(raw.off && { off: true }), ...(raw.agent && { agent: true }) } : { d };
}
/** 首頁小卡：今天按過「今天不用」就不出現（到明天再說） */
export const homeAllowed = (rec) => !rec.off;
/** 問阿幫時順便提：一天一次；按過「今天不用」就不提；使用者自己問（asked）一定回答 */
export const agentAllowed = (rec, asked = false) => asked || (!rec.off && !rec.agent);

/** 使用者自己在問要不要去運動、散步（這句話本來就送到伺服器；判斷「要不要在手機上補一句」用） */
export const EXERCISE_Q = /(?:要不要|適合|可以|能不能|該不該|應該|想).{0,6}(?:運動|散步|走走|慢跑|跑步|健走)|(?<!捷)(?:運動|散步|走走|慢跑|跑步|健走)(?:一下)?(?:嗎|好嗎|好不好|如何)|走了幾步|步數夠|\b(?:should i (?:go )?(?:exercise|work ?out|jog|run|walk)|go (?:for )?a (?:walk|run|jog)|my steps)\b/i;
