// 工具包：transit（交通）／行程規劃 — 風險分級 L1（ADR-0010：排序由 core/decide.js 計分，模型只轉述）
import { z } from 'zod';
import { defineTool, T, clip } from './define.js';
import { resolvePoint } from '../services/places.js';
import { planTrip } from '../services/trip.js';
import { HHMM_RE, ISO_RE } from '../services/intercity.js';
import { STATES } from '../decide.js';

const hhmm = z.string().trim().regex(HHMM_RE, '時間格式需為 HH:mm（00:00～23:59）');

const MODES = ['walk', 'bike', 'bus', 'metro', 'thsr', 'tra', 'intercity', 'ridehail'];
const MODE_LABEL = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車' };

/** 常選比例（個人化，ADR-0010 2026-11-21）：鍵限定交通方式、值 0～1、總和 ≤ 1（容許四捨五入 0.01）。網頁 agent 由程式從手機帶入，不交給模型 */
export const HabitSchema = z.partialRecord(z.enum(MODES), z.number().min(0).max(1))
  .refine((h) => Object.values(h).reduce((a, b) => a + b, 0) <= 1.01, '常選比例總和不能超過 1');

/** 建議方案的下一步（捷運帶上車站名：「問『台北車站下一班』看即時到站」） */
/** 只由程式判斷的狀態（多人同行看 party、可能下雨看預報）：不給呼叫端直接指定 */
const AUTO_ONLY = ['group', 'rainSoon', 'traffic'];
export const nextStepOf = (o) => (!o ? null : o.role === 'metro' && o.metro ? `${NEXT_STEP.metro}；要看下一班可以問「${/站$/.test(o.metro.from) ? o.metro.from : `${o.metro.from}站`}下一班」` : NEXT_STEP[o.role] || null);

/** 依建議方式的下一步（模型轉述照這句說；例：叫車不要提公車到站提醒，A2 轉述受程式約束） */
export const NEXT_STEP = {
  bus: '卡片上看公車多久到上車站，可以按「到站前 3 分提醒我」',
  metro: '走到捷運站搭車（時間與票價是估算）',
  ridehail: '按卡片的「叫車」用官方 App 叫車（會先請你確認，付款在叫車 App 完成）',
  walk: '按「導航」用地圖 App 走過去',
  bike: '照卡片走到借車站借車；還車站目前有空位（騎到時可能變，卡片有備用站）',
  thsr: '按「訂票」到高鐵官方訂票（會先請你確認）',
  tra: '按「訂票」到台鐵官方訂票（會先請你確認）',
  intercity: '看卡片上的班次時間，到上車站搭車',
};

/** plan_trip 給模型的文字（run() 與盯到站後重排 withoutBus 共用：資料改了文字跟著改） */
export function tripText(data) {
  const byId = new Map(data.options.map((o) => [o.id, o]));
  const lines = [
    `${data.from.name} → ${data.to.name}（直線 ${data.straightKm} 公里，${data.departAt} 出發）`,
    // 判斷用到的資料（程式產生）：模型照這幾行轉述，不要自己說「天氣很好」之類沒有資料的話
    `判斷用到的資料：${(data.considered || []).map((c) => `${c.role}「${c.text}」→ ${c.say}${c.demo ? '（示範資料）' : ''}`).join('；')}`,
    ...(data.night ? [`深夜（回答第一句先說）：${data.night.text}`] : []),
    ...(data.single ? [`只有一種方式：${data.single.text}`] : []),
    ...(data.limited ? [`TDX 額度用完（回答要照實說，不可提示範班次）：${data.limited.text}`] : []), // 示範資料的方案已排除（ADR-0010 2026-11-22）
    ...(data.missing?.length ? [`沒列入：${data.missing.map((m) => `${m.route ? `公車 ${m.route}` : MODE_LABEL[m.role] || m.role}（${m.why}）`).join('、')}`] : []), // route：那一條公車今天不會來（站牌即時資訊）
    ...(data.states.length ? [`狀態：${data.states.map((s) => `${STATES[s.key].label}（${s.source === 'auto' ? `自動：${s.detail}` : '你說的'}）`).join('、')}`] : []),
    ...(data.habitOn ? [`習慣（使用者同意過的常選方式，已小幅加分）：${Object.entries(data.habit).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${MODE_LABEL[k]} ${Math.round(v * 100)}%`).join('、')}`] : []),
    ...data.ranking.ranked.map((r, i) => {
      const o = byId.get(r.id);
      return `${i + 1}. ${o.name}：${o.minutes} 分（等 ${o.waitMin}、走 ${o.walkMin}），${o.costRange ? `${o.costRange[0]}～${o.costRange[1]}` : o.cost} 元，${o.arriveAt} 到${o.estimated ? '（含估算）' : ''}，分數 ${r.score}`;
    }),
    ...data.ranking.excluded.map((e) => `✗ ${e.name}：${e.why}`),
    `建議：${data.ranking.reason}`,
    ...(data.tips || []).map((t) => `提醒：${t.text}`),
    ...(nextStepOf(byId.get(data.best)) ? [`下一步：${nextStepOf(byId.get(data.best))}`] : []),
  ];
  return clip(lines);
}

export const planTripTool = defineTool({
  name: 'plan_trip',
  title: '從 A 到 B 怎麼去',
  description: '比較從起點到終點的交通方式（步行、YouBike、公車直達、高鐵、台鐵、國道客運、叫車），依使用者狀態排序並給一句理由。'
    + '自動查起點天氣與沿途國道路況：下雨、塞車會自動加入狀態（states 中 source=auto）。prefs.states 放使用者說的狀態：'
    + Object.entries(STATES).map(([k, v]) => `${k}=${v.label}`).join('、')
    + '；prefs.arriveBy 指定最晚抵達時間（會遲到的方案排除）；prefs.habit 是使用者同意過的常選比例（選填，例 {"metro":0.6}，沒說狀況時小幅加分）；輸出 ask 是畫面上會問使用者的一句（趕不趕、帶不帶行李…）。排序與理由由程式計分（ranking），請照 ranking.reason 轉述，不要自行改排名。estimated=true 的時間或車資是估算。',
  pack: 'transit', tier: 'L1', card: 'trip',
  fallbackSafe: true, // TDX 額度用完時示範資料的方案不列入（limited 照實說）：結果不標示範
  input: {
    from: T.point('起點'), to: T.point('終點'),
    departAt: z.string().trim().refine((s) => HHMM_RE.test(s) || ISO_RE.test(s), 'departAt 格式需為 HH:mm 或 ISO 時間，例如 18:30').optional().describe('出發時間：HH:mm（今天）或 ISO 日期時間，預設現在（台灣時間）'),
    prefs: z.object({
      states: z.array(z.enum(Object.keys(STATES).filter((k) => !AUTO_ONLY.includes(k)))).max(6).optional().describe('使用者狀態'),
      arriveBy: hhmm.optional().describe('最晚抵達時間 HH:mm'),
      mode: z.enum(MODES).optional().describe('使用者指定的交通方式（「改坐公車」→ bus、「叫車／計程車」→ ridehail）：建議改成這種方式裡分數最高的'),
      avoid: z.array(z.enum(MODES)).max(7).optional().describe('使用者說不要的交通方式（「不要叫車」→ ["ridehail"]）：直接排除'),
      party: z.number().int().min(1).max(20).optional().describe('同行人數（「我們 4 個人」→ 4）：2 人以上叫車改用每人分攤比較（4 人一輛）；1＝自己一個人'),
      habit: HabitSchema.optional().describe('使用者同意過的常選交通方式比例（裝置記的、使用者按過「好」，例 {"metro":0.6}）：沒指定方式、沒說狀況時最多加 8 分；不知道就不要帶'),
    }).optional(),
  },
  speak: (d) => {
    const best = d.options.find((o) => o.id === d.best);
    if (!best) return d.ranking.excluded.length ? d.ranking.reason : '這段路找不到可行的交通方式。';
    const why = d.states.length ? `，因為${d.states.map((s) => STATES[s.key].say).join('、')}` : '';
    // 深夜：第一句先說公車、捷運收班或末班快到了（night.text 已說「先比走路、YouBike、叫車」）
    if (d.night?.closed.length && !d.single) return `${d.night.text}；建議${best.name}${why}。`;
    const night = d.night ? `${d.night.text}。` : '';
    const lim = d.limited ? `${d.limited.short}。` : ''; // TDX 額度用完沒列入的方式（示範班次不推；ADR-0010 2026-11-22）
    if (d.single) return `${night}${lim}只找到${best.name}一種方式${why}。`; // 原因在 impact 與決策圖（single.text）
    return `${night}${lim}比了 ${d.options.length} 種方式${why}，建議${best.name}。`;
  },
  async run(svc, a) {
    const [from, to] = await Promise.all([resolvePoint(svc.places, a.from), resolvePoint(svc.places, a.to)]);
    // svc.now：網頁 agent 這一輪的「現在」（示範時鐘；run.js execTools 帶入）；MCP、REST 用真的時間
    const data = await planTrip(svc, { from, to, departAt: a.departAt, prefs: a.prefs || {}, ...(Number.isFinite(svc.now) && { now: svc.now }) });
    return { data, text: tripText(data) };
  },
});

export default [planTripTool];
