// 工具包：transit（交通）／行程規劃 — 風險分級 L1（ADR-0010：排序由 core/decide.js 計分，模型只轉述）
import { z } from 'zod';
import { defineTool, T, clip } from './define.js';
import { resolvePoint } from '../services/places.js';
import { planTrip } from '../services/trip.js';
import { HHMM_RE, ISO_RE } from '../services/intercity.js';
import { STATES } from '../decide.js';

const hhmm = z.string().trim().regex(HHMM_RE, '時間格式需為 HH:mm（00:00～23:59）');

export const planTripTool = defineTool({
  name: 'plan_trip',
  title: '從 A 到 B 怎麼去',
  description: '比較從起點到終點的交通方式（步行、YouBike、公車直達、高鐵、台鐵、國道客運、叫車），依使用者狀態排序並給一句理由。'
    + '自動查起點天氣與沿途國道路況：下雨、塞車會自動加入狀態（states 中 source=auto）。prefs.states 放使用者說的狀態：'
    + Object.entries(STATES).map(([k, v]) => `${k}=${v.label}`).join('、')
    + '；prefs.arriveBy 指定最晚抵達時間（會遲到的方案排除）。排序與理由由程式計分（ranking），請照 ranking.reason 轉述，不要自行改排名。estimated=true 的時間或車資是估算。',
  pack: 'transit', tier: 'L1', card: 'trip',
  input: {
    from: T.point('起點'), to: T.point('終點'),
    departAt: z.string().trim().refine((s) => HHMM_RE.test(s) || ISO_RE.test(s), 'departAt 格式需為 HH:mm 或 ISO 時間，例如 18:30').optional().describe('出發時間：HH:mm（今天）或 ISO 日期時間，預設現在（台灣時間）'),
    prefs: z.object({
      states: z.array(z.enum(Object.keys(STATES))).max(6).optional().describe('使用者狀態'),
      arriveBy: hhmm.optional().describe('最晚抵達時間 HH:mm'),
    }).optional(),
  },
  speak: (d) => {
    const best = d.options.find((o) => o.id === d.best);
    if (!best) return d.ranking.excluded.length ? '所有方式都趕不上指定時間。' : '這段路找不到可行的交通方式。';
    const why = d.states.length ? `，因為${d.states.map((s) => STATES[s.key].say).join('、')}` : '';
    return `比了 ${d.options.length} 種方式${why}，建議${best.name}。`;
  },
  async run(svc, a) {
    const [from, to] = await Promise.all([resolvePoint(svc.places, a.from), resolvePoint(svc.places, a.to)]);
    const data = await planTrip(svc, { from, to, departAt: a.departAt, prefs: a.prefs || {} });
    const byId = new Map(data.options.map((o) => [o.id, o]));
    const lines = [
      `${from.name} → ${to.name}（直線 ${data.straightKm} 公里，${data.departAt} 出發）`,
      ...(data.states.length ? [`狀態：${data.states.map((s) => `${STATES[s.key].label}（${s.source === 'auto' ? `自動：${s.detail}` : '你說的'}）`).join('、')}`] : []),
      ...data.ranking.ranked.map((r, i) => {
        const o = byId.get(r.id);
        return `${i + 1}. ${o.name}：${o.minutes} 分（等 ${o.waitMin}、走 ${o.walkMin}），${o.costRange ? `${o.costRange[0]}～${o.costRange[1]}` : o.cost} 元，${o.arriveAt} 到${o.estimated ? '（含估算）' : ''}，分數 ${r.score}`;
      }),
      ...data.ranking.excluded.map((e) => `✗ ${e.name}：${e.why}`),
      `建議：${data.ranking.reason}`,
    ];
    return { data, text: clip(lines) };
  },
});

export default [planTripTool];
