// 行程中出狀況，主動給 B 方案（P1-5 v2，2026-11-28 Claude 與 Antigravity 第六輪）：純函式，伺服器與手機共用（前端以 /core/b-plan.js）。
// 公車一直不來、末班已過時，用手機上那一次 plan_trip 的方案（不打 API），排除出狀況的那條、出發改成「現在」，
// 用同一份 decide.js 重算，泡泡直接說「可以改坐捷運，約晚 5 分到」。按鈕一律用最新的資料重查（指定那種方式），不沿用舊班次。
// - 資料太舊（STALE_MIN）：不硬算，照舊問「要我用最新的資料找其他方式嗎？」
// - 時間不太會變的（捷運、步行、台鐵、高鐵、客運）說幾點到、比原本晚幾分；會變的（公車、YouBike、叫車）只說「可以改」
// - 鐵路、客運的那班已經開走（leaveAt 過了）：不列
import { decide, STATES } from './decide.js';

/** 那一次規劃超過這麼多分鐘：不用舊資料算 B 方案 */
export const STALE_MIN = 25;
/** 比原本晚（或早）幾分以內說「時間差不多」 */
export const SAME_MIN = 3;
/** 時間不太會變、可以直接說幾點到的方式 */
const STABLE = new Set(['metro', 'walk', 'tra', 'thsr', 'intercity']);
const SCHEDULED = new Set(['tra', 'thsr', 'intercity']);
const DO_ZH = { walk: '走路', bike: '騎 YouBike', bus: '坐公車', metro: '坐捷運', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運', ridehail: '叫車', drive: '開車' };
const DO_EN = { walk: 'walk', bike: 'ride a YouBike', bus: 'take another bus', metro: 'take the MRT', thsr: 'take the High Speed Rail', tra: 'take the train', intercity: 'take a coach', ridehail: 'get a taxi', drive: 'drive' };
/** 方案名稱去掉交通方式的字頭（「捷運（板南線轉淡水信義線）」→「板南線轉淡水信義線」、「台鐵自強」→「自強」、「叫車（Uber）」→ 空）：句子不寫成「坐捷運（捷運…）」 */
const PREFIX = { metro: '捷運', bus: '公車', tra: '台鐵', thsr: '高鐵', intercity: '國道客運', bike: 'YouBike', ridehail: '叫車', walk: '步行', drive: '開車' };
const detailOf = (o) => { const d = String(o.name || '').replace(new RegExp(`^${PREFIX[o.role] || '\\b'}\\s*`), '').replace(/^（(.*)）$/, '$1').trim(); return /Uber|^$/.test(d) ? '' : d; };
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const twMin = (now) => { const d = new Date(now + 8 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const clock = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;

/**
 * @param {{ data: object, at: number }} trip 手機上那一次 plan_trip 的資料與拿到的時間
 * @param {{ routeName: string, now?: number, lang?: 'en'|null, ended?: boolean }} p 出狀況的公車路線；ended＝末班已過、今日未營運（到站提醒已自動取消）
 * @returns {null | { stale?: true, role?: string, name?: string, arrive?: string, lateMin?: number, text: string, label: string, ask: string }}
 *   text：泡泡那句；label／ask：主要按鈕（用最新資料重查、指定那種方式）；null＝沒有資料可以算
 */
export function bPlan(trip, { routeName, now = Date.now(), lang = null, ended = false }) {
  const en = lang === 'en';
  const data = trip?.data;
  if (!data?.options?.length || !data.to?.name) return null;
  const to = data.to.name;
  const head = ended
    ? (en ? `Bus ${routeName} isn't running any more today, so I cancelled the reminder.` : `${routeName} 今天不會再來了（末班已過或沒有營運），到站提醒已取消。`)
    : (en ? `Bus ${routeName} isn't coming.` : `${routeName} 一直沒來。`);
  const requery = { stale: true, text: en ? `${head} Want me to find another way with fresh data?` : `${head}要我用最新的資料幫你找其他方式嗎？`, label: en ? 'Another way' : '改其他方式', ask: en ? `No bus, find another way to ${to}` : `不要坐公車，改別的方式去${to}` };
  if (!(now - Number(trip.at) <= STALE_MIN * 60e3)) return requery; // 資料太舊（或不知道多舊）：不硬算
  const nowMin = twMin(now);
  const stuck = (o) => o.role === 'bus' && String(o.name || '').includes(routeName);
  const gone = (o) => SCHEDULED.has(o.role) && o.leaveAt && hm(o.leaveAt) != null && hm(o.leaveAt) < nowMin; // 那班已經開走
  const cands = data.options.filter((o) => !stuck(o) && !gone(o));
  if (!cands.length) return requery;
  const states = (data.states || []).map((s) => s.key).filter((k) => STATES[k]);
  const best = decide(cands, { states }).best;
  if (!best) return requery;
  const orig = data.options.find((o) => o.id === data.best) || data.options.find(stuck);
  const origArr = orig?.arriveMin ?? hm(orig?.arriveAt);
  const label = en ? `${DO_EN[best.role] || 'Switch'}`.replace(/^./, (c) => c.toUpperCase()) : `改${DO_ZH[best.role] || '走'}`;
  const ask = en ? `${label} to ${to}` : `改${DO_ZH[best.role] || '別的方式'}去${to}`;
  if (!STABLE.has(best.role)) {
    // 會變的（公車、YouBike、叫車）：不說幾點到，按了用最新的資料查
    const d = detailOf(best);
    const say = en ? `${head} You could ${DO_EN[best.role]} instead; tap and I'll check with fresh data.` : `${head}可以改${DO_ZH[best.role]}${d ? `（${d}）` : ''}，按了我用最新的資料幫你查。`;
    return { role: best.role, name: best.name, text: say, label, ask };
  }
  const arr = SCHEDULED.has(best.role) ? (best.arriveMin ?? hm(best.arriveAt)) : nowMin + Number(best.minutes || 0);
  const late = origArr != null && arr != null ? Math.round(arr - origArr) : null;
  const whenZh = late == null ? '' : Math.abs(late) <= SAME_MIN ? '時間差不多；' : late > 0 ? `比原本晚 ${late} 分；` : '比原本早一點；';
  const whenEn = late == null ? '' : Math.abs(late) <= SAME_MIN ? ', about the same time' : late > 0 ? `, about ${late} min later than planned` : ', a bit earlier than planned';
  const d = detailOf(best);
  const text = en
    ? `${head} You could ${DO_EN[best.role]} instead, arriving about ${clock(arr)}${whenEn} (based on the earlier search).`
    : `${head}可以改${DO_ZH[best.role]}${d ? `（${d}）` : ''}，大約 ${clock(arr)} 到（${whenZh}依剛才查的資料）。`;
  return { role: best.role, name: best.name, arrive: clock(arr), lateMin: late, text, label, ask };
}
