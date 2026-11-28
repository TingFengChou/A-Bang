// 首頁「現在的建議」（ADR-0023，規格 docs/HOME_REDESIGN.md §3、§4、§6、§7、§9）。
// 純函式、不連網、不讀時鐘（now 一定從 snapshot 帶進來）：伺服器以 /core/home-suggest.js 提供給前端，App 打包時一起複製。
// 輸入只有 ContextSnapshot；輸出是「決策＋這次用到的訊號＋理由」（Antigravity 第十九輪 C：
// 自動位置與手動切換分開、規則互斥有優先序、引擎直接說它看了什麼，畫面與「為何顯示此建議」都用同一份）。
// 規則由程式決定（ADR-0010 精神）；門檻都是下面的常數，改了要更新 test/home-suggest.test.js。
// 資料誠實（§9）：捷運一律「依時刻表」；拿不到延誤分鐘就不寫延誤；班距拿不到就不說「班次間隔較長」；查不到不說成沒有。
import { twClock } from './suggest.js';
import { distanceM } from './health-nudge.js';

/** 跟固定地點距離超過這麼多公尺，就算「不在那裡」，出發地自動改用目前位置（§6） */
export const NEAR_M = 800;
/** 下一班 > 班距 × 這個倍數，才說「班次間隔較長」（第十九輪第 8 點；班距拿不到就不說） */
export const LONG_GAP = 1.5;
/** 固定通勤方式沒有自己設時段時的預設（§3；分鐘，台灣時間） */
export const WINDOWS = Object.freeze({ out: [6 * 60, 10 * 60], back: [16 * 60 + 30, 21 * 60] });
/** 末班車、週末晚上回家、明日提醒的時間（分鐘） */
export const LATE_FROM = 22 * 60 + 30;
export const EVENING_FROM = 18 * 60;
export const TOMORROW_FROM = 20 * 60;
/** 明天降雨機率到這裡才提醒帶傘 */
export const RAIN_TOMORROW = 50;
/** 空品 AQI 超過這裡算安全情境（紅色以上） */
export const AQI_ALERT = 150;

const WEEK = '日一二三四五六';
const ask = (q) => `#/agent?q=${encodeURIComponent(q)}`;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
/** 'HH:MM' 或分鐘數 → 分鐘數 */
export const toMin = (v) => {
  if (typeof v === 'number') return v;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const inWin = (m, [a, b]) => m >= a && m < b;

/**
 * 補上預設值的 ContextSnapshot（§4）。所有欄位都可以缺；缺的就是「不知道」，不是「沒有」。
 * @param {any} s
 */
export function snapshot(s = {}) {
  const loc = s.location || {};
  return {
    now: Number.isFinite(Number(s.now)) ? Number(s.now) : NaN,
    day: s.day && typeof s.day === 'object' ? s.day : null,
    location: { auto: validPos(loc.auto) ? loc.auto : null, override: loc.override === 'fixed' || loc.override === 'here' ? loc.override : null },
    places: s.places && typeof s.places === 'object' ? s.places : {},
    commute: validCommute(s.commute) ? s.commute : null,
    env: s.env && typeof s.env === 'object' ? s.env : {},
    transit: s.transit && typeof s.transit === 'object' ? s.transit : {},
    user: { onboarded: s.user?.onboarded !== false, trip: s.user?.trip || null, walk: s.user?.walk || null, last: s.user?.last || null, antifraud: !!s.user?.antifraud },
    source: { offline: !!s.source?.offline, demo: !!s.source?.demo, quotaOut: !!s.source?.quotaOut },
  };
}
const validPos = (p) => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
const validCommute = (c) => !!c && typeof c.from === 'string' && typeof c.to === 'string' && Array.isArray(c.legs) && c.legs.length > 0;

/**
 * 今天是哪一種日子（辦公日曆；查不到照星期推，known: false）。跟 public/js/today.js dayKind 同一套說法。
 * @returns {{ work: boolean, weekend: boolean, label: string, known: boolean }}
 */
export function dayKind(day, dow) {
  const weekend = dow === 0 || dow === 6;
  const work = typeof day?.workday === 'boolean' ? day.workday : !weekend;
  const known = !!day?.known;
  let label;
  if (work) label = weekend && known ? '補班日' : '上班日';
  else if (!weekend && known) label = day?.note ? `放假・${day.note}` : '放假';
  else label = '週末';
  return { work, weekend, label, known };
}

/** 時段（天空與眉標用；台灣時間） */
export function skyOf(min) {
  if (min < 5 * 60) return 'night';
  if (min < 7 * 60) return 'dawn';
  if (min < 16 * 60) return 'day';
  if (min < 18 * 60 + 30) return 'dusk';
  return 'night';
}
const partLabel = (min) => (min < 5 * 60 ? '深夜' : min < 11 * 60 ? '早上' : min < 16 * 60 ? '白天' : min < 18 * 60 ? '傍晚' : min < 22 * 60 + 30 ? '晚上' : '深夜');

/**
 * 出發地（§6）：手動切換永遠優先；沒切換時，已知位置離固定地點超過 NEAR_M 就自動改用目前位置。
 * @param {ReturnType<typeof snapshot>} s
 * @param {string|null} fixedKey 固定地點的名字（'家'、'公司'…）；沒有固定地點時給 null
 * @returns {{ mode: 'fixed'|'here', label: string, sub: string, auto: boolean, needAsk: boolean, distM: number|null }}
 */
export function resolveOrigin(s, fixedKey) {
  const fixed = fixedKey ? s.places[fixedKey] : null;
  const here = s.location.auto;
  const distM = fixed && validPos(fixed) && here ? distanceM(here.lat, here.lon, fixed.lat, fixed.lon) : null;
  const hereSub = here ? (here.area ? `${here.area}${here.near ? here.near : ''}附近` : '依目前位置') : '按下後才取得';
  const fixedOut = () => ({ mode: 'fixed', label: placeName(fixedKey), sub: `出發地・${fixed?.area || placeName(fixedKey)}`, auto: false, needAsk: false, distM });
  const hereOut = (auto) => ({ mode: 'here', label: '目前位置', sub: hereSub, auto, needAsk: !here, distM });
  if (s.location.override === 'here' || !fixed) return hereOut(false);
  if (s.location.override === 'fixed') return fixedOut();
  if (distM != null && distM > NEAR_M) return hereOut(true);
  return fixedOut();
}
/** 存在手機的地點鍵 → 畫面上的正式說法 */
export const placeName = (k) => (k === '家' ? '住家' : k || '');

/**
 * 一段路的班次狀態（§9）。
 * transit.bus：[{ route, stop?, mins: number|null, next?: number|null, headway?: number|null }]（公車即時）
 * transit.metro：[{ line, name, station?, mins: number|null }]（時刻表推估）
 * @returns {{ kind: 'live'|'timetable'|'unknown', mins: number|null, next: number|null, long: boolean, text: string }}
 */
export function legStatus(leg, transit = {}, quotaOut = false) {
  if (leg.mode === 'metro') {
    const m = (transit.metro || []).find((x) => x && (x.line === leg.line || x.name === leg.name));
    if (!m || !Number.isFinite(m.mins)) return { kind: 'unknown', mins: null, next: null, long: false, text: quotaOut ? '這次查不到班次' : '依時刻表' };
    return { kind: 'timetable', mins: m.mins, next: null, long: false, text: '依時刻表' };
  }
  if (leg.mode === 'bus') {
    const b = (transit.bus || []).find((x) => x && String(x.route) === String(leg.route));
    if (!b || !Number.isFinite(b.mins)) return { kind: 'unknown', mins: null, next: null, long: false, text: '這次查不到班次' };
    const next = Number.isFinite(b.next) ? b.next : null;
    const long = Number.isFinite(b.headway) && b.headway > 0 && b.mins > b.headway * LONG_GAP;
    return { kind: 'live', mins: b.mins, next, long, text: next != null ? `下一班 ${next} 分` : `${b.mins} 分` };
  }
  return { kind: 'unknown', mins: null, next: null, long: false, text: '' };
}
const legLabel = (leg) => (leg.mode === 'bus' ? String(leg.route) : leg.mode === 'metro' ? leg.name || leg.line : leg.name || '');

/** 固定通勤方式的一趟（out 去、back 回）：回程沒另外設就用去程反過來（第十九輪 B） */
export function commuteTrip(c, dir) {
  if (dir === 'out') return { from: c.from, to: c.to, legs: c.legs, win: (c.out || []).map(toMin).every(Number.isFinite) && c.out?.length === 2 ? c.out.map(toMin) : WINDOWS.out };
  const legs = Array.isArray(c.backLegs) && c.backLegs.length ? c.backLegs : [...c.legs].reverse();
  return { from: c.to, to: c.from, legs, win: (c.back || []).map(toMin).every(Number.isFinite) && c.back?.length === 2 ? c.back.map(toMin) : WINDOWS.back };
}

// ── 規則（互斥，由上往下第一個成立的就是答案；§3） ──────────────────────────────
const RULES = [
  ['safety', (c) => safetyOf(c.s)],
  ['trip', (c) => (c.s.user.trip ? { title: '行程進行中', cta: { label: '回到行程', href: c.s.user.trip.href || '#/agent' }, reasons: ['有進行中的行程'] } : null)],
  ['new', (c) => (!c.s.user.onboarded || !c.s.places['家'] ? newbie(c) : null)],
  ['commute', (c) => commuteRule(c, 'out')],
  ['home', (c) => commuteRule(c, 'back')],
  ['late', (c) => lateRule(c)],
  ['out', (c) => outRule(c)],
  ['walk', (c) => (c.s.user.walk?.kind === 'go' ? walkRule(c) : null)],
  ['tomorrow', (c) => tomorrowRule(c)],
  ['general', (c) => generalRule(c)],
];

function safetyOf(s) {
  const q = s.env.quake;
  if (q && q.alert) return { title: '地震訊息', status: 'warn', cta: { label: '查看詳細與求助電話', href: '#/s/quake' }, reasons: [`地震：${q.area || ''}${q.mag ? ` 規模 ${q.mag}` : ''}`.trim()] };
  const n = Number(s.env.aqi?.nearest?.aqi);
  if (Number.isFinite(n) && n > AQI_ALERT) return { title: '空氣品質不良', status: 'warn', cta: { label: '查看空品與防護建議', href: '#/s/aqi' }, reasons: [`空品 AQI ${n}`] };
  if (s.env.typhoon?.off) return { title: '停班停課', status: 'warn', cta: { label: '查看停班停課', href: ask('今天停班停課嗎？') }, reasons: ['停班停課公告'] };
  return null;
}
function newbie(c) {
  return { title: '開始使用', cta: { label: '三步完成設定', href: '#/settings' }, steps: ['設定住家', '設定公司或學校', '選擇固定通勤方式（可略過）'], reasons: [c.s.user.onboarded ? '還沒設定住家' : '第一次使用'] };
}
function commuteRule(c, dir) {
  const { s, kind, min } = c;
  if (!s.commute || !kind.work) return null;
  const trip = commuteTrip(s.commute, dir);
  if (!inWin(min, trip.win)) return null;
  const origin = resolveOrigin(s, trip.from);
  // 去程：人已經在終點附近（例如早到公司）就不再建議通勤
  if (dir === 'out' && s.location.auto && s.places[trip.to] && validPos(s.places[trip.to]) && !s.location.override
    && distanceM(s.location.auto.lat, s.location.auto.lon, s.places[trip.to].lat, s.places[trip.to].lon) <= NEAR_M) return null;
  const st = trip.legs.map((l) => legStatus(l, s.transit, s.source.quotaOut));
  const first = st[0];
  const longLeg = trip.legs.findIndex((l, i) => l.mode === 'bus' && st[i].long);
  const status = longLeg >= 0 ? 'warn' : st.some((x) => x.kind === 'unknown') ? 'unknown' : 'ok';
  const statusText = longLeg >= 0 ? `${legLabel(trip.legs[longLeg])} 班次間隔較長` : status === 'unknown' ? '這次查不到部分班次' : '班次正常';
  const title = dir === 'out' ? '今日通勤' : '今日返家';
  const route = [origin.mode === 'here' ? '目前位置' : placeName(trip.from), ...trip.legs.map(legLabel), placeName(trip.to)];
  const readout = { big: first.mins, unit: '分', line: `${legLabel(trip.legs[0])}${trip.legs[0].stop || trip.legs[0].station ? ` 到${trip.legs[0].stop || trip.legs[0].station}站` : ''}`, note: first.text };
  const cta = dir === 'out'
    ? { label: '開始出門倒數', action: 'leave', steps: ['設定出門提醒', '鎖定畫面顯示到站倒數', '可分享預計抵達時間給家人'] }
    : { label: '開始返家導引', action: 'guide', steps: ['顯示每一段的班次與轉乘', '快到站時提醒下車', '可分享預計到家時間給家人'] };
  if (longLeg >= 0) cta.alt = { label: `仍搭 ${legLabel(trip.legs[longLeg])}`, action: dir === 'out' ? 'leave' : 'guide' };
  if (origin.mode === 'here') cta.label = dir === 'out' ? '開始通勤導引' : '開始返家導引';
  return {
    title, mode: '固定方式', status, statusText, origin, route, readout, cta,
    eyebrowNote: origin.auto ? '已依目前位置調整' : '',
    reasons: [kind.label, hhmm(min), '已設定固定通勤方式', origin.mode === 'here' ? (origin.auto ? `不在${placeName(trip.from)}附近，改從目前位置` : '您選擇從目前位置出發') : `從${placeName(trip.from)}出發`],
    legs: trip.legs.map((l, i) => ({ ...l, status: st[i] })),
  };
}
function lateRule(c) {
  const { s, min } = c;
  if (!(min >= LATE_FROM || min < 4 * 60)) return null;
  const home = s.places['家'];
  if (home && validPos(home) && s.location.auto && distanceM(s.location.auto.lat, s.location.auto.lon, home.lat, home.lon) <= NEAR_M) return null;
  const fixedKey = s.location.override === 'fixed' && s.places['公司'] ? '公司' : null;
  const origin = resolveOrigin(s, fixedKey);
  return { title: '末班車與返家路線', status: 'ok', origin, route: [origin.label, '住家'], cta: { label: '查詢末班車與返家路線', href: ask('回家的末班車是幾點？'), steps: [origin.needAsk ? '取得目前位置，僅用於本次查詢' : fixedKey ? '不需定位，以公司為起點' : '以目前位置為起點', '顯示末班車、返家路線與最晚出發時間', '可設定出門提醒、加入行事曆、分享給家人'] }, reasons: [partLabel(min), '不在住家附近或位置未知'] };
}
function outRule(c) {
  const { s, kind, min } = c;
  if (kind.work || min < EVENING_FROM || !s.places['家']) return null;
  const home = s.places['家'];
  if (validPos(home) && s.location.auto && distanceM(s.location.auto.lat, s.location.auto.lon, home.lat, home.lon) <= NEAR_M) return null;
  const origin = resolveOrigin(s, null);
  return { title: '返家路線', status: 'ok', origin, route: [origin.label, '住家'], cta: { label: '查詢返家路線與班次', href: ask('回家怎麼走？'), steps: [origin.needAsk ? '取得目前位置，僅用於本次查詢' : '以目前位置為起點', '顯示搭乘路線、班次與預估到家時間', '可設定出門提醒、加入行事曆、分享給家人'] }, reasons: [kind.label, partLabel(min), '不在住家附近或位置未知'] };
}
function walkRule(c) {
  const w = c.s.user.walk;
  return { title: '散步建議', status: 'ok', cta: { label: w.spot ? `前往${w.spot.name}` : '查看散步地點', href: w.spot?.href || ask('附近有適合散步的地方嗎？'), steps: ['顯示步行路線與時間', '天氣變化時提醒', '散步提醒可在設定關閉'] }, text: w.text || '', reasons: ['天氣良好', '今天活動量較少（只在手機上判斷）'] };
}
function tomorrowRule(c) {
  const { s, min } = c;
  if (min < TOMORROW_FROM) return null;
  const pop = Number(s.env.tomorrow?.pop);
  const g = s.env.garbage;
  if (Number.isFinite(pop) && pop >= RAIN_TOMORROW) return { title: '明日天氣', status: 'ok', cta: { label: '設定明早帶傘提醒', action: 'remind', href: ask('明天幾點開始下雨？') }, reasons: [`明天降雨機率 ${pop}%`] };
  if (g && g.soon) return { title: '垃圾車', status: 'ok', cta: { label: '設定垃圾車提醒', action: 'remind', href: '#/s/garbage' }, reasons: [`垃圾車 ${g.time || ''}`.trim()] };
  return null;
}
function generalRule(c) {
  const first = homeAsks(c.s, null)[0];
  return { title: '有事問阿幫', status: 'ok', cta: { label: first?.q || '想查什麼？', href: first?.href || '#/agent' }, reasons: [c.kind.label, partLabel(c.min)] };
}

/**
 * 首頁「現在的建議」。
 * @param {any} raw ContextSnapshot（§4）
 * @returns {{ kind: string, title: string, status: 'ok'|'warn'|'unknown', statusText?: string, origin?: object, route?: string[], readout?: object,
 *   cta: object, eyebrow: string, sky: string, date: string, day: ReturnType<typeof dayKind>, alt: Array<{ kind: string, title: string }>,
 *   signals: Array<{ key: string, label: string, value: string, tone?: string }>, reasons: string[], source: object }}
 */
export function homeSuggest(raw) {
  const s = snapshot(raw);
  if (!Number.isFinite(s.now)) throw new TypeError('homeSuggest 需要 now（不讀時鐘）');
  const { hour, min: mm, dow } = twClock(s.now);
  const min = hour * 60 + mm;
  const kind = dayKind(s.day, dow);
  const ctx = { s, kind, min };
  const hits = [];
  for (const [k, fn] of RULES) {
    const r = fn(ctx);
    if (r) hits.push({ kind: k, ...r });
  }
  const pick = (raw.prefer && hits.find((h) => h.kind === raw.prefer)) || hits[0]; // 「其他建議」點了：換成那一個（仍是成立的規則）
  const d = new Date(s.now + 8 * 3600e3);
  const eyebrowBase = pick.kind === 'commute' || pick.kind === 'home' ? `${kind.label === '補班日' ? '補班日' : '上班日'}${partLabel(min)}` : `${kind.weekend && !kind.work ? `週${WEEK[dow]}` : kind.label}${partLabel(min)}`;
  return {
    ...pick,
    status: pick.status || 'ok',
    eyebrow: pick.eyebrowNote || eyebrowBase,
    sky: skyOf(min),
    date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
    weekday: `週${WEEK[dow]}`,
    day: kind,
    alt: hits.filter((h) => h !== pick && h.kind !== 'general').slice(0, 5).map((h) => ({ kind: h.kind, title: h.title })),
    signals: signalsOf(s, pick, `週${WEEK[dow]} ${hhmm(min)}`),
    source: s.source,
  };
}

/** 核心只連這次真的用到的訊號（ADR-0023 §1） */
function signalsOf(s, pick, nowText) {
  const out = [{ key: 'now', label: '現在', value: nowText }];
  const o = pick.origin;
  if (o?.mode === 'here' && s.location.auto?.area) out.push({ key: 'here', label: '目前位置', value: s.location.auto.area });
  const keys = pick.kind === 'commute' || pick.kind === 'home' ? [pick.route?.[0] === '目前位置' ? null : commuteTrip(s.commute, pick.kind === 'commute' ? 'out' : 'back').from, commuteTrip(s.commute, pick.kind === 'commute' ? 'out' : 'back').to] : pick.kind === 'late' || pick.kind === 'out' ? ['家'] : [];
  for (const k of keys.filter(Boolean)) {
    const p = s.places[k];
    if (p) out.push({ key: k === '家' ? 'home' : 'office', label: placeName(k), value: p.area || '已設定' });
  }
  if (pick.legs) {
    const warn = pick.legs.find((l) => l.status.long);
    const leg = warn || pick.legs[0];
    out.push({ key: 'line', label: legLabel(leg), value: leg.status.kind === 'timetable' ? '依時刻表' : leg.status.kind === 'live' ? (warn ? `下一班 ${leg.status.next ?? leg.status.mins} 分` : '即時班次') : '這次查不到', tone: warn ? 'warn' : undefined });
  }
  if (pick.kind === 'walk') out.push({ key: 'move', label: '活動量', value: '今天較少' });
  if (pick.kind === 'safety') out.push({ key: 'alert', label: '警示', value: pick.reasons[0], tone: 'warn' });
  return out.slice(0, 4);
}

/**
 * 「您可能想問」（§7）：接續上次 → 這次建議的追問 → 現在的資料 → 時段預設題；去重、最多 5 個。
 * @param {any} raw ContextSnapshot
 * @param {{ kind: string }|null} decision homeSuggest 的結果（可以不給）
 * @returns {Array<{ q: string, icon: string, href: string, resume?: true }>}
 */
export function homeAsks(raw, decision = null) {
  const s = snapshot(raw);
  const out = [];
  const add = (q, icon, extra = {}) => { if (q && !out.some((x) => x.q === q)) out.push({ q, icon, href: ask(q), ...extra }); };
  const last = s.user.last;
  if (last?.q && Number.isFinite(Number(last.at)) && Number.isFinite(s.now) && s.now - Number(last.at) < 24 * 3600e3) out.push({ q: `接續上次：${String(last.q).slice(0, 14)}`, icon: 'clock', href: ask(String(last.q)), resume: true });
  const k = decision?.kind;
  const line = decision?.legs?.find((l) => l.mode === 'metro');
  const bus = decision?.legs?.find((l) => l.mode === 'bus');
  if (k === 'commute' || k === 'home') {
    if (bus) add(`${bus.route} 下一班還要多久？`, 'bus');
    if (line) add(`${line.name || line.line}今天正常嗎？`, 'metro');
  } else if (k === 'late') add('捷運幾點收班？', 'metro');
  else if (k === 'walk') add('附近有適合散步的地方嗎？', 'walk');
  const pop = Number(s.env.weather?.pop3h);
  if (Number.isFinite(pop) && pop >= 50) add('今天需要帶傘嗎？', 'umbrella');
  const n = Number(s.env.aqi?.nearest?.aqi);
  if (Number.isFinite(n) && n > 100) add('今天空氣品質如何？', 'air');
  if (s.env.garbage?.soon) add('垃圾車幾點到？', 'garbage');
  const min = Number.isFinite(s.now) ? (() => { const t = twClock(s.now); return t.hour * 60 + t.min; })() : 12 * 60;
  if (min < 11 * 60) { add('今天需要帶傘嗎？', 'umbrella'); add('附近 YouBike 還有車嗎？', 'bike'); }
  else if (min < 18 * 60) { add('附近有看診的診所嗎？', 'clinic'); add('今天空氣品質如何？', 'air'); }
  else { add('晚上會下雨嗎？', 'umbrella'); add('附近有營業中的藥局嗎？', 'pharmacy'); }
  if (s.user.antifraud) add('這則簡訊是詐騙嗎？', 'shield');
  add('附近有哪些公車站？', 'bus');
  return out.slice(0, 5);
}
