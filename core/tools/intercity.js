// 工具包：transit（交通）／國道客運 — 風險分級 L1
import { z } from 'zod';
import { defineTool, T, clip } from './define.js';
import { resolvePoint } from '../services/places.js';
import { HHMM_RE } from '../services/intercity.js';

const PACK = 'transit';
const LEVEL = { smooth: '順暢', slow: '車多', jam: '塞車中' };

export const intercityBus = defineTool({
  name: 'intercity_bus',
  title: '國道客運班次',
  description: '查起訖附近（1.5 公里內有站牌）的直達國道客運接下來最多 5 班：出發、抵達、行車分鐘、票價（有資料時）、上下車站牌與步行距離；沿途塞車時附 arriveWithDelay（含延誤的預估抵達）與 delayRisk（0～1，供行程規劃排序）。estimated=true 表示抵達時間由距離估算；nextDay=true 表示隔日（跨過午夜）的班次。',
  pack: PACK, tier: 'L1', card: 'timetable',
  input: {
    from: T.point('起點'), to: T.point('終點'),
    departAt: z.string().trim().regex(HHMM_RE, 'departAt 格式需為 HH:mm（00:00～23:59）').optional().describe('最早出發時間 HH:mm（台灣時間），預設現在'),
  },
  speak: (d) => {
    const t = d.trains[0];
    if (!t) return `${d.from.name}到${d.to.name}附近沒有直達的國道客運班次。`;
    return `下一班${t.trainNo} ${t.nextDay ? '隔日 ' : ''}${t.depart} 出發，預計 ${t.arriveWithDelay || t.arrive} 到${t.delayMin ? `（路上${LEVEL[d.traffic.level] || '延誤'}，多 ${t.delayMin} 分）` : ''}。`;
  },
  async run(svc, a) {
    const [from, to] = await Promise.all([resolvePoint(svc.places, a.from), resolvePoint(svc.places, a.to)]);
    const raw = await svc.intercity.trips({ from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon }, departAt: a.departAt });
    const data = { ...raw, from: from.name, to: to.name, fromPoint: from, toPoint: to };
    const head = `國道客運 ${from.name} → ${to.name}（${data.departAt} 以後）`;
    if (!data.trains.length) return { data, text: `${head}：附近 1.5 公里內沒有直達班次，可改查台鐵、高鐵或用 plan_trip 比較。` };
    const lines = [
      `${head}${data.traffic.level ? `，國道${LEVEL[data.traffic.level]}` : ''}：`,
      ...data.trains.map((t) => `- ${t.trainNo}（${t.terminal}）${t.nextDay ? '隔日 ' : ''}${t.depart} → ${t.arriveWithDelay ? `${t.arriveWithDelay}（原 ${t.arrive}）` : t.arrive}${t.estimated ? '（估）' : ''}，${t.minutes} 分${t.fare != null ? `，${t.fare} 元` : ''}；${t.board} 上車、${t.alight} 下車`),
    ];
    return { data, text: clip(lines) };
  },
});

export default [intercityBus];
