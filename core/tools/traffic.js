// 工具包：transit（交通）／路況 — 風險分級 L1
import { defineTool, T, clip } from './define.js';
import { resolvePoint } from '../services/places.js';

const PACK = 'transit';

const LEVEL = { smooth: '順暢', slow: '車多', jam: '塞車中' };

export const trafficStatus = defineTool({
  name: 'traffic_status',
  title: '沿途國道路況',
  description: '查起訖兩點之間沿途國道的即時路況：level（smooth 順暢／slow 車多／jam 塞車中；起訖太近或查不到資料時為 null）、delayMin（比以速限行駛多花的分鐘）、各路段車速 segments 與相關事件 events。直線 15 公里以內不查國道。level=jam 時行程規劃應視為「塞車中」。',
  pack: PACK, tier: 'L1',
  input: { from: T.point('起點'), to: T.point('終點') },
  speak: (d) => {
    if (!d.covered) return d.straightKm < 15 ? '起訖很近，不需要看國道路況。' : '沿途查不到國道路況。';
    if (!d.level) return '沿途國道暫時沒有車速資料。';
    if (d.level === 'smooth') return '沿途國道順暢。';
    return `沿途國道${LEVEL[d.level]}，預估多花 ${d.delayMin} 分鐘${d.events.length ? `（${d.events[0].title}）` : ''}。`;
  },
  async run(svc, a) {
    const [from, to] = await Promise.all([resolvePoint(svc.places, a.from), resolvePoint(svc.places, a.to)]);
    const raw = await svc.traffic.status({ from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon } });
    const data = { from, to, ...raw };
    const head = `${from.name} → ${to.name}（直線 ${data.straightKm} 公里）`;
    if (!data.covered) return { data, text: `${head}：${data.note}。` };
    const lines = [
      `${head}：國道${data.level ? LEVEL[data.level] : '暫無車速資料'}${data.delayMin ? `，預估多花 ${data.delayMin} 分鐘` : ''}`,
      ...data.segments.map((s) => `- ${s.name}：${s.speedKmh != null ? `${s.speedKmh} km/h` : '無資料'}（${s.lengthKm} 公里）`),
      ...data.events.map((e) => `⚠ ${e.title}`),
    ];
    return { data, text: clip(lines) };
  },
});

export default [trafficStatus];
