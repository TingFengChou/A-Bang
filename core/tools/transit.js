// 工具包：transit（交通）— 風險分級 L1
import { z } from 'zod';
import { defineTool, T, clip } from './define.js';
import { withNav } from '../nav.js';

const PACK = 'transit';
const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`);

export const busSearchRoutes = defineTool({
  name: 'bus_search_routes',
  title: '搜尋公車路線',
  description: '以關鍵字搜尋某縣市的市區公車路線，回傳路線名稱與起訖站。',
  pack: PACK, tier: 'L1',
  input: { city: T.city, keyword: z.string().min(1).describe('路線關鍵字，例如 307、紅30') },
  speak: (d, a) => (d.length ? `找到 ${d.length} 條和「${a.keyword}」有關的路線。` : `找不到「${a.keyword}」這條路線。`),
  async run(svc, a) {
    const data = await svc.bus.searchRoutes(a);
    const text = data.length
      ? clip([`找到 ${data.length} 條路線：`, ...data.map((r) => `- ${r.routeName}：${r.departure} ⇄ ${r.destination}`)])
      : `找不到符合「${a.keyword}」的路線。`;
    return { data, text };
  },
});

export const busRouteEta = defineTool({
  name: 'bus_route_eta',
  title: '公車路線即時到站',
  description: '查詢一條公車路線所有站牌的預估到站時間（去程與返程）。etaSec 為秒數；statusText 為易讀文字。',
  pack: PACK, tier: 'L1', card: 'bus-route',
  input: { city: T.city, routeName: z.string().min(1).describe('完整路線名稱，例如 307') },
  speak: (d) => {
    const near = d.directions.flatMap((x) => x.stops.filter((s) => s.etaSec != null && s.etaSec < 180).map((s) => s.stopName));
    return `${d.routeName} 目前有 ${near.length} 個站即將有車${near.length ? `（例如${near.slice(0, 2).join('、')}）` : ''}。`;
  },
  async run(svc, a) {
    const data = await svc.bus.routeEta(a);
    const lines = [`${data.routeName} 公車即時到站（更新：${data.updatedAt}）`];
    for (const d of data.directions) {
      const near = d.stops.filter((s) => s.etaSec != null && s.etaSec < 180).map((s) => s.stopName);
      lines.push(`【${d.label}】共 ${d.stops.length} 站${near.length ? `；即將到站：${near.slice(0, 5).join('、')}` : ''}`);
      lines.push(...d.stops.map((s) => `  ${s.seq}. ${s.stopName}：${s.statusText}`));
    }
    return { data, text: clip(lines) };
  },
});

export const busNearbyStations = defineTool({
  name: 'bus_nearby_stations',
  title: '附近公車站',
  description: '依座標找出附近的公車站位與經過的路線，依距離排序；每筆附導航連結 nav（Google／Apple 地圖）。可再用 bus_station_eta 查各路線到站時間。',
  pack: PACK, tier: 'L1', card: 'nearby',
  input: { lat: T.lat, lon: T.lon, radius: T.radius(400) },
  speak: (d) => (d.length ? `附近有 ${d.length} 個站牌，最近的是${d[0].name}（${fmtM(d[0].distance)}）。` : '附近沒有公車站。'),
  async run(svc, a) {
    const data = withNav(await svc.bus.nearbyStations(a));
    const text = data.length
      ? clip([`附近 ${data.length} 個公車站：`, ...data.map((s) => `- ${s.name}（${fmtM(s.distance)}，city=${s.city}，stationId=${s.stationId}）：${s.routes.join('、')}`)])
      : '附近沒有公車站，可加大搜尋半徑。';
    return { data, text };
  },
});

export const busStationEta = defineTool({
  name: 'bus_station_eta',
  title: '公車站即時到站',
  description: '查詢某個公車站位（stationId 來自 bus_nearby_stations）所有經過路線的預估到站時間。',
  pack: PACK, tier: 'L1', card: 'bus-station',
  input: { city: T.city, stationId: z.string().min(1) },
  speak: (d) => { const f = d.find((r) => r.etaSec != null); return f ? `最快的是 ${f.routeName}，${f.statusText}。` : '這個站目前沒有車要來。'; },
  async run(svc, a) {
    const data = await svc.bus.stationEta(a);
    const text = data.length
      ? clip([`此站 ${data.length} 條路線到站：`, ...data.map((r) => `- ${r.routeName}（${r.direction ? '返程' : '去程'}）：${r.statusText}`)])
      : '目前沒有到站資訊。';
    return { data, text };
  },
});

export const youbikeNearby = defineTool({
  name: 'youbike_nearby',
  title: '附近 YouBike',
  description: '依座標查詢附近公共自行車站的可借車輛（一般/電輔）與可還空位，依距離排序；每筆附導航連結 nav（Google／Apple 地圖）。',
  pack: PACK, tier: 'L1', card: 'youbike',
  input: { lat: T.lat, lon: T.lon, radius: T.radius(500) },
  speak: (d) => { const s = d.find((x) => x.inService && x.rent > 0); return s ? `最近有車的是${s.name}（${fmtM(s.distance)}），還有 ${s.rent} 台。` : '附近的站暫時都沒有車。'; },
  async run(svc, a) {
    const data = withNav(await svc.bike.nearby(a));
    const text = data.length
      ? clip([`附近 ${data.length} 個 YouBike 站：`, ...data.map((s) => `- ${s.name}（${fmtM(s.distance)}）：可借 ${s.rent ?? '?'}（電輔 ${s.electric ?? 0}）、可還 ${s.returnSlots ?? '?'}${s.inService ? '' : '，暫停營運'}`)])
      : '附近沒有 YouBike 站。';
    return { data, text };
  },
});

const railText = (data, label) => {
  const lines = [`${label} ${data.from} → ${data.to}（${data.date}），共 ${data.trains.length} 班：`];
  lines.push(...data.trains.map((t) => `- ${t.trainNo} 次${t.type ? `（${t.type}）` : ''}：${t.depart} → ${t.arrive}，${t.minutes} 分`));
  return clip(lines);
};

export const thsrTimetable = defineTool({
  name: 'thsr_timetable',
  title: '高鐵時刻表',
  description: '查詢指定日期兩個高鐵站之間的班次（出發、抵達、行車分鐘數）。站名可用中文，例如「台北」「左營」。',
  pack: PACK, tier: 'L1', card: 'timetable',
  input: { from: z.string().min(1).describe('起站'), to: z.string().min(1).describe('迄站'), date: T.date },
  speak: (d) => (d.trains.length ? `${d.date} 共 ${d.trains.length} 班，最早 ${d.trains[0].depart} 出發、${d.trains[0].arrive} 到${d.to}。` : '那天沒有直達班次。'),
  async run(svc, a) {
    const data = await svc.rail.thsrTimetable(a);
    return { data, text: railText(data, '高鐵') };
  },
});

export const traTimetable = defineTool({
  name: 'tra_timetable',
  title: '台鐵時刻表',
  description: '查詢指定日期兩個台鐵車站之間的班次（車種、出發、抵達、行車分鐘數）。站名可用中文，例如「臺北」「花蓮」。',
  pack: PACK, tier: 'L1', card: 'timetable',
  input: { from: z.string().min(1).describe('起站'), to: z.string().min(1).describe('迄站'), date: T.date },
  speak: (d) => (d.trains.length ? `${d.date} 共 ${d.trains.length} 班，最早 ${d.trains[0].depart} 的${d.trains[0].type || ''}，${d.trains[0].arrive} 到${d.to}。` : '那天沒有直達班次。'),
  async run(svc, a) {
    const data = await svc.rail.traTimetable(a);
    return { data, text: railText(data, '台鐵') };
  },
});

export const railStations = defineTool({
  name: 'rail_stations',
  title: '軌道車站清單',
  description: '列出高鐵或台鐵所有車站的代碼與名稱。',
  pack: PACK, tier: 'L1',
  input: { system: z.enum(['THSR', 'TRA']).describe('THSR=高鐵, TRA=台鐵') },
  speak: (d, a) => `${a.system === 'THSR' ? '高鐵' : '台鐵'}共有 ${d.length} 個車站。`,
  async run(svc, { system }) {
    const data = system === 'THSR' ? await svc.rail.thsrStations() : await svc.rail.traStations();
    return { data, text: clip([`${system === 'THSR' ? '高鐵' : '台鐵'}車站 ${data.length} 個：`, data.map((s) => `${s.name}(${s.id})`).join('、')]) };
  },
});

export default [busSearchRoutes, busRouteEta, busNearbyStations, busStationEta, youbikeNearby, thsrTimetable, traTimetable, railStations];
