// 工具包：transit（交通）／捷運 — 風險分級 L1
import { z } from 'zod';
import { defineTool, clip } from './define.js';
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
  description: '查詢捷運某一站各線各方向的下一班車還有幾分鐘到站（etaMin 為分鐘），依到站時間排序；附車站導航連結 nav。站名不確定時先用 metro_stations。',
  pack: PACK, tier: 'L1', card: 'metro',
  input: { system, station: z.string().trim().min(1).max(30).describe('站名或代碼，例如 台北車站、市政府、BL12') },
  speak: (d) => {
    const t = d.trains.find((x) => x.etaMin != null);
    if (!t) return `${d.station}目前沒有即時到站資料。`;
    return t.etaMin <= 1 ? `${d.station}往${t.destination}的車${t.status}。` : `${d.station}最快 ${t.etaMin} 分鐘後有往${t.destination}的車。`;
  },
  async run(svc, a) {
    const raw = await svc.metro.liveBoard(a);
    const data = { ...raw, nav: navLinks(raw.lat, raw.lon) };
    const text = data.trains.length
      ? clip([`${METRO_SYSTEMS[data.system]} ${data.station} 即時到站（更新：${data.updatedAt}）`, ...data.trains.map((t) => `- ${t.line} 往 ${t.destination}：${t.status}`)])
      : `${METRO_SYSTEMS[data.system]} ${data.station} 目前沒有即時到站資料（部分系統只在營運時段、或只提供部分車站看板）。`;
    return { data, text };
  },
});

export default [metroStations, metroLiveBoard];
