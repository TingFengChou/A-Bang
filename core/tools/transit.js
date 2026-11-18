// 工具包：transit（交通）— 風險分級 L1
import { z } from 'zod';
import { defineTool, T, clip } from './define.js';
import { withNav } from '../nav.js';
import { resolveCity } from '../cities.js';
import { nowTW, toMin } from '../util.js';

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
  description: '查詢一條公車路線所有站牌的預估到站時間（去程與返程）。etaSec 為秒數；statusText 為易讀文字；有座標的站牌附 lat/lon 與導航連結 nav；shape 為去程路線形狀 [[lat, lon]]（資料有提供時）。',
  pack: PACK, tier: 'L1', card: 'bus-route',
  input: { city: T.city, routeName: z.string().min(1).describe('完整路線名稱，例如 307') },
  speak: (d) => {
    const near = d.directions.flatMap((x) => x.stops.filter((s) => s.etaSec != null && s.etaSec < 180).map((s) => s.stopName));
    return `${d.routeName} 目前有 ${near.length} 個站即將有車${near.length ? `（例如${near.slice(0, 2).join('、')}）` : ''}。`;
  },
  async run(svc, a) {
    const raw = await svc.bus.routeEta(a);
    const data = { ...raw, directions: raw.directions.map((d) => ({ ...d, stops: withNav(d.stops) })) };
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
  speak: (d) => (d.stations.length ? `附近有 ${d.stations.length} 個站牌，最近的是${d.stations[0].name}（${fmtM(d.stations[0].distance)}）。` : '附近沒有公車站。'),
  async run(svc, a) {
    const stations = withNav(await svc.bus.nearbyStations(a));
    const data = { lat: a.lat, lon: a.lon, radius: a.radius ?? 400, stations }; // 卡片 nearby 契約（CARDS.md §4）
    const text = stations.length
      ? clip([`附近 ${stations.length} 個公車站：`, ...stations.map((s) => `- ${s.name}（${fmtM(s.distance)}，city=${s.city}，stationId=${s.stationId}）：${s.routes.join('、')}`)])
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
  speak: (d) => { const f = d.arrivals.find((r) => r.etaSec != null); return f ? `最快的是 ${f.routeName}，${f.statusText}。` : '這個站目前沒有車要來。'; },
  async run(svc, a) {
    const arrivals = await svc.bus.stationEta(a);
    const data = { city: a.city, stationId: a.stationId, arrivals }; // 卡片 bus-station 契約
    const text = arrivals.length
      ? clip([`此站 ${arrivals.length} 條路線到站：`, ...arrivals.map((r) => `- ${r.routeName}（${r.direction ? '返程' : '去程'}）：${r.statusText}`)])
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
  speak: (d) => { const s = d.stations.find((x) => x.inService && x.rent > 0); return s ? `最近有車的是${s.name}（${fmtM(s.distance)}），還有 ${s.rent} 台。` : '附近的站暫時都沒有車。'; },
  async run(svc, a) {
    const stations = withNav(await svc.bike.nearby(a));
    const data = { lat: a.lat, lon: a.lon, radius: a.radius ?? 500, stations }; // 卡片 youbike 契約
    const text = stations.length
      ? clip([`附近 ${stations.length} 個 YouBike 站：`, ...stations.map((s) => `- ${s.name}（${fmtM(s.distance)}）：可借 ${s.rent ?? '?'}（電輔 ${s.electric ?? 0}）、可還 ${s.returnSlots ?? '?'}${s.inService ? '' : '，暫停營運'}`)])
      : '附近沒有 YouBike 站。';
    return { data, text };
  },
});

/** 查今天的班次時，只留還沒開出的（「下一班」）；其他日期回 null（全部都算） */
export function upcomingTrains(data, now = Date.now()) {
  const t = nowTW(now);
  if (data.date !== t.date) return null;
  const cur = toMin(t.hhmm);
  return data.trains.filter((x) => toMin(x.depart) >= cur);
}

/** 工具發言：今天 → 下一班；其他日期 → 最早一班 */
export function railSpeak(d, now = Date.now()) {
  if (!d.trains.length) return '那天沒有直達班次。';
  const type = (x) => (d.system === 'TRA' && x.type ? `（${x.type}）` : '');
  const up = upcomingTrains(d, now);
  if (!up) return `${d.date} 共 ${d.trains.length} 班，最早 ${d.trains[0].depart} 出發${type(d.trains[0])}、${d.trains[0].arrive} 到${d.to}。`;
  if (!up.length) return `今天的班次都開走了（末班 ${d.trains.at(-1).depart}），可以改查明天。`;
  return `今天還有 ${up.length} 班，下一班 ${up[0].depart} 出發${type(up[0])}、${up[0].arrive} 到${d.to}。`;
}

/** 給模型的文字：今天只列還沒開出的班次，並寫明現在時間與下一班，避免把第一班當成下一班 */
export function railText(data, label, now = Date.now()) {
  const row = (t) => `- ${t.trainNo} 次${t.type ? `（${t.type}）` : ''}：${t.depart} → ${t.arrive}，${t.minutes} 分`;
  if (!data.trains.length) return `${label} ${data.from} → ${data.to}（${data.date}）沒有直達班次。`;
  const up = upcomingTrains(data, now);
  if (!up) return clip([`${label} ${data.from} → ${data.to}（${data.date}），共 ${data.trains.length} 班：`, ...data.trains.map(row)]);
  const head = `${label} ${data.from} → ${data.to}（今天 ${data.date}，現在 ${nowTW(now).hhmm}）`;
  if (!up.length) return `${head}：今天的 ${data.trains.length} 班都已開出（末班 ${data.trains.at(-1).depart}），請改查明天。`;
  return clip([`${head}：今天還有 ${up.length} 班（全天 ${data.trains.length} 班），下一班 ${up[0].depart} 出發。尚未開出的班次：`, ...up.map(row)]);
}

export const thsrTimetable = defineTool({
  name: 'thsr_timetable',
  title: '高鐵時刻表',
  description: '查詢指定日期兩個高鐵站之間的班次（出發、抵達、行車分鐘數）。站名可用中文，例如「台北」「左營」。',
  pack: PACK, tier: 'L1', card: 'timetable',
  input: { from: z.string().min(1).describe('起站'), to: z.string().min(1).describe('迄站'), date: T.date },
  speak: (d) => railSpeak(d),
  async run(svc, a) {
    const data = { system: 'THSR', ...(await svc.rail.thsrTimetable(a)) }; // 卡片 timetable 依 system 決定標題與訂票
    return { data, text: railText(data, '高鐵') };
  },
});

export const traTimetable = defineTool({
  name: 'tra_timetable',
  title: '台鐵時刻表',
  description: '查詢指定日期兩個台鐵車站之間的班次（車種、出發、抵達、行車分鐘數）。站名可用中文，例如「臺北」「花蓮」。',
  pack: PACK, tier: 'L1', card: 'timetable',
  input: { from: z.string().min(1).describe('起站'), to: z.string().min(1).describe('迄站'), date: T.date },
  speak: (d) => railSpeak(d),
  async run(svc, a) {
    const data = { system: 'TRA', ...(await svc.rail.traTimetable(a)) };
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

const cityName = (c) => resolveCity(c)?.name || c;
const KIND = { station: '車站', airport: '機場', landmark: '景點', market: '夜市商圈', school: '學校', hospital: '醫院', government: '機關' };

export const findPlace = defineTool({
  name: 'find_place',
  title: '找地點座標',
  description: '把地名、車站、景點、俗稱（例：台北101、北車、逢甲夜市、小港機場）轉成座標，最多 5 筆，最符合的在前；每筆附 city 與導航連結 nav。查到座標後可接 bus_nearby_stations、youbike_nearby 或 plan_trip。目前只查內建地標與車站，找不到時請換個說法或加上縣市。',
  pack: PACK, tier: 'L1',
  source: '阿幫內建地標資料（座標為近似值）', static: true,
  input: {
    query: z.string().trim().min(1).max(50).describe('地點名稱或俗稱，例如 台北101、高雄車站、逢甲夜市'),
    city: T.city.optional().describe('限定縣市（可省略），例如 Taichung 或「台中市」'),
  },
  speak: (d, a) => (d.length
    ? `「${a.query}」最符合的是${d[0].name}（${cityName(d[0].city)}）${d.length > 1 ? `，另有 ${d.length - 1} 個相近地點` : ''}。`
    : `找不到「${a.query}」，可以換個說法或加上縣市。`),
  async run(svc, a) {
    const data = withNav(await svc.places.find(a));
    const text = data.length
      ? clip([`「${a.query}」找到 ${data.length} 個地點：`, ...data.map((p) => `- ${p.name}（${cityName(p.city)}，${KIND[p.kind] || p.kind}）：lat=${p.lat}, lon=${p.lon}`)])
      : `找不到「${a.query}」。目前只查內建地標與車站，請換個說法（例如完整名稱）或加上縣市。`;
    return { data, text };
  },
});

const SYS = { THSR: '高鐵', TRA: '台鐵' };
const fmtPrice = (n) => `${n.toLocaleString('en-US')} 元`;
const fareLabel = (f) => [f.trainType, f.cabin, f.fareClass, f.ticketType].filter(Boolean).join('／');

export const railFare = defineTool({
  name: 'rail_fare',
  title: '高鐵／台鐵票價',
  description: '查詢高鐵或台鐵兩站之間的票價。fares 每筆有票種、身分、車廂（高鐵）或車種（台鐵）與 price（新台幣元）；adultOneWay=true 為成人單程票，排在最前面。',
  pack: PACK, tier: 'L1',
  input: {
    system: z.enum(['THSR', 'TRA']).describe('THSR=高鐵, TRA=台鐵'),
    from: z.string().trim().min(1).describe('起站，中文站名或代碼，例如 台北'),
    to: z.string().trim().min(1).describe('訖站，中文站名或代碼，例如 左營'),
  },
  speak: (d) => {
    const a = d.fares.filter((f) => f.adultOneWay);
    if (!a.length) return `${d.from}到${d.to}的${SYS[d.system]}票價暫時查不到。`;
    const min = a[0], max = a.at(-1);
    return min.price === max.price
      ? `${d.from}到${d.to}${SYS[d.system]}成人單程 ${fmtPrice(min.price)}。`
      : `${d.from}到${d.to}${SYS[d.system]}成人單程 ${fmtPrice(min.price)}起（最高 ${fmtPrice(max.price)}）。`;
  },
  async run(svc, a) {
    const data = a.system === 'THSR' ? await svc.rail.thsrFare(a) : await svc.rail.traFare(a);
    const text = data.fares.length
      ? clip([`${SYS[data.system]} ${data.from} → ${data.to} 票價：`, ...data.fares.map((f) => `- ${fareLabel(f)}：${fmtPrice(f.price)}`)])
      : `${SYS[data.system]} ${data.from} → ${data.to} 目前查不到票價資料。`;
    return { data, text };
  },
});

export default [busSearchRoutes, busRouteEta, busNearbyStations, busStationEta, youbikeNearby, thsrTimetable, traTimetable, railStations, railFare, findPlace];
