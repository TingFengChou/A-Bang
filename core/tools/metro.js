// 工具包：transit（交通）／捷運 — 風險分級 L1
import { z } from 'zod';
import { defineTool, T, clip } from './define.js';
import { distanceM, UserError } from '../util.js';
import { resolvePoint } from '../services/places.js';
import { withNav, navLinks } from '../nav.js';
import { METRO_SYSTEMS } from '../services/metro.js';

const PACK = 'transit';
const system = z.enum(Object.keys(METRO_SYSTEMS)).describe(`捷運系統：${Object.entries(METRO_SYSTEMS).map(([k, v]) => `${k}=${v}`).join('、')}`);

export const metroStations = defineTool({
  name: 'metro_stations',
  title: '捷運車站清單',
  description: '列出某捷運系統的車站代碼、名稱與座標；每站附導航連結 nav。站名可直接給 metro_live_board 使用。',
  pack: PACK, tier: 'L1',
  input: { system },
  speak: (d, a) => `${METRO_SYSTEMS[a.system]}共有 ${d.length} 個車站。`,
  async run(svc, a) {
    const data = withNav(await svc.metro.stations(a));
    return { data, text: clip([`${METRO_SYSTEMS[a.system]}車站 ${data.length} 個：`, data.map((s) => `${s.name}(${s.id})`).join('、')]) };
  },
});

export const metroLiveBoard = defineTool({
  name: 'metro_live_board',
  title: '捷運即時到站',
  description: '查詢捷運某一站各線各方向的下一班車還有幾分鐘到站（etaMin 為分鐘），依到站時間排序；附車站導航連結 nav。使用者沒說站名時給 near（他現在的位置），自動用離他最近的捷運站（3 公里內）。',
  pack: PACK, tier: 'L1', card: 'metro',
  input: {
    system: system.optional().describe('捷運系統；有 near 時可省略（找各系統裡最近的站）'),
    station: z.string().trim().min(1).max(30).optional().describe('站名或代碼，例如 台北車站、市政府、BL12；沒說站名時省略並給 near'),
    near: T.point('使用者現在的位置（沒說站名時用）：自動找最近的捷運站').optional(),
  },
  speak: (d) => {
    const t = d.trains.find((x) => x.etaMin != null);
    const who = d.nearest?.from ? `離「${d.nearest.from}」最近的是` : '離你最近的是';
    if (d.nearest) return t ? `${who}${d.station}（約 ${fmtM(d.nearest.distanceM)}）：${t.etaMin <= 1 ? `往${t.destination}的車${t.status}` : `最快 ${t.etaMin} 分鐘後有往${t.destination}的車`}。` : `${who}${d.station}（約 ${fmtM(d.nearest.distanceM)}），目前沒有即時到站資料。`;
    if (!t) return `${d.station}目前沒有即時到站資料。`;
    return t.etaMin <= 1 ? `${d.station}往${t.destination}的車${t.status}。` : `${d.station}最快 ${t.etaMin} 分鐘後有往${t.destination}的車。`;
  },
  async run(svc, a) {
    const near = !a.station && a.near ? await nearestMetro(svc, await resolvePoint(svc.places, a.near), a.system) : null;
    if (!a.station && !near) throw new UserError(a.near ? '你附近 3 公里內沒有捷運站；請告訴我站名，例如「市政府站下一班」' : '請告訴我哪一站，例如「市政府站下一班」');
    if (!a.system && !near) throw new UserError('請說是哪個捷運系統（台北、桃園機場、台中、高雄…）');
    const raw = await svc.metro.liveBoard(near ? { system: near.system, station: near.station } : { system: a.system, station: a.station });
    const data = { ...raw, nav: navLinks(raw.lat, raw.lon), ...(near && { nearest: { distanceM: near.distanceM, ...(typeof a.near === 'string' && { from: a.near }) } }) };
    const text = data.trains.length
      ? clip([`${METRO_SYSTEMS[data.system]} ${data.station} 即時到站（更新：${data.updatedAt}）`, ...data.trains.map((t) => `- ${t.line} 往 ${t.destination}：${t.status}`)])
      : `${METRO_SYSTEMS[data.system]} ${data.station} 目前沒有即時到站資料（部分系統只在營運時段、或只提供部分車站看板）。`;
    return { data, text };
  },
});

const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`);
const NEAR_MAX_M = 3000;

/** 離某點最近的捷運站（指定系統只找該系統；否則各系統都找）；超過 3 公里回 null */
export async function nearestMetro(svc, pt, only) {
  if (!pt) return null;
  let best = null;
  for (const sys of only ? [only] : Object.keys(METRO_SYSTEMS)) {
    const list = await svc.metro.stations({ system: sys }).catch(() => []);
    for (const s of list) {
      if (!Number.isFinite(s.lat)) continue;
      const m = Math.round(distanceM(pt.lat, pt.lon, s.lat, s.lon));
      if (!best || m < best.distanceM) best = { system: sys, station: s.name, distanceM: m };
    }
  }
  return best && best.distanceM <= NEAR_MAX_M ? best : null;
}

export default [metroStations, metroLiveBoard];
