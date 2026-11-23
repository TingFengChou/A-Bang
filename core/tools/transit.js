// 工具包：transit（交通）— 風險分級 L1
import { z } from 'zod';
import { defineTool, T, clip } from './define.js';
import { withNav } from '../nav.js';
import { resolveCity } from '../cities.js';
import { nowTW, toMin, normName, distanceM, UserError } from '../util.js';
import { resolvePoint, cityNear } from '../services/places.js';
import { traTrips } from '../services/rail-trips.js';

const PACK = 'transit';
const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`);

/**
 * 盯一個站（選公車後的上車站）：依站名（臺／台視為相同）找方向與站；給 direction 時先找那個方向。
 * @returns {{ direction: number, seq: number, stopName: string, etaSec: number|null, status: number, statusText: string } | null}
 */
export function focusStop(directions, stop, direction) {
  if (!stop) return null;
  const n = normName(stop);
  const order = [...directions.keys()].sort((a, b) => (directions[b].direction === direction) - (directions[a].direction === direction));
  for (const i of order) {
    const s = directions[i].stops.find((x) => normName(x.stopName) === n);
    if (s) return { direction: directions[i].direction ?? i, label: directions[i].label, seq: s.seq, stopName: s.stopName, etaSec: s.etaSec ?? null, status: s.status, statusText: s.statusText };
  }
  return null;
}
const NEAREST_MAX_M = 3000;
/**
 * 沒說站名、但知道使用者在哪（裝置定位或地名）：路線上離他最近的站。兩個方向都有同一站時，挑車比較快到的那個方向。
 * @returns {ReturnType<typeof focusStop> & { distanceM: number, nearest: true } | null}
 */
export function nearestStop(directions, pt) {
  let best = null;
  directions.forEach((d, i) => {
    for (const s of d.stops) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      const m = Math.round(distanceM(pt.lat, pt.lon, s.lat, s.lon));
      const eta = s.status === 0 && s.etaSec != null ? s.etaSec : Infinity;
      if (!best || m < best.m - 30 || (Math.abs(m - best.m) <= 30 && eta < best.eta)) best = { m, eta, d, i, s };
    }
  });
  if (!best || best.m > NEAREST_MAX_M) return null; // 太遠就不說「離你最近」（可能是別的縣市的同號路線）
  const { d, i, s, m } = best;
  // 另一個方向離你最近的站（兩個方向都說，不默默挑一個；PM Q-17）
  let other = null;
  directions.forEach((x, j) => {
    if (j === i) return;
    for (const t of x.stops) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
      const tm = Math.round(distanceM(pt.lat, pt.lon, t.lat, t.lon));
      if (tm <= NEAREST_MAX_M && (!other || tm < other.distanceM)) other = { direction: x.direction ?? j, label: x.label, stopName: t.stopName, etaSec: t.etaSec ?? null, status: t.status, statusText: t.statusText, distanceM: tm };
    }
  });
  return { direction: d.direction ?? i, label: d.label, seq: s.seq, stopName: s.stopName, etaSec: s.etaSec ?? null, status: s.status, statusText: s.statusText, distanceM: m, nearest: true, ...(other && { other }) };
}
/** 方向的名稱有沒有這個地名（「往板橋」）：比對方向標籤與終點站（臺／台相同） */
export const towardMatch = (d, toward) => { const n = normName(toward); return !!n && (normName(d.label || '').includes(n) || normName(d.stops?.at(-1)?.stopName || '').includes(n)); };
/** 另一個方向的一句：「往 民權二段：約 6 分後到「民權二段」」 */
const otherText = (o) => `${o.label}：${o.status === 0 && o.etaSec != null ? (o.etaSec < 180 ? `即將到「${o.stopName}」` : `約 ${Math.round(o.etaSec / 60)} 分後到「${o.stopName}」`) : `「${o.stopName}」${o.statusText}`}`;
/** 「601 約 6 分到「X」」；沒有預估時用狀態文字 */
export const focusText = (route, f) => (f.status === 0 && f.etaSec != null
  ? (f.etaSec < 60 ? `${route} 在「${f.stopName}」進站中` : f.etaSec < 180 ? `${route} 即將到「${f.stopName}」` : `${route} 約 ${Math.round(f.etaSec / 60)} 分後到「${f.stopName}」`)
  : `${route} 在「${f.stopName}」：${f.statusText}`);

/** 公車常跨縣市（雙北、桃園、基隆）：使用者所在縣市找不到這條路線時，依序看這些縣市（S4） */
export const NEIGHBOR_CITIES = {
  Taipei: ['NewTaipei', 'Keelung', 'Taoyuan'], NewTaipei: ['Taipei', 'Keelung', 'Taoyuan'],
  Taoyuan: ['NewTaipei', 'Taipei', 'Hsinchu', 'HsinchuCounty'], Keelung: ['NewTaipei', 'Taipei'],
};
/**
 * 相鄰縣市裡有這條路線的第一個：只用預熱快取的路線清單（svc.bus.routeCities，不多打 TDX）；清單沒有就回 null（照原本的錯誤說）。
 * @returns {Promise<string|null>}
 */
export async function neighborCity(svc, city, routeName) {
  const code = resolveCity(city)?.city || city;
  const known = await svc.bus.routeCities?.(routeName).catch(() => []) || [];
  return (NEIGHBOR_CITIES[code] || []).find((c) => known.includes(c)) || null;
}

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
  input: {
    city: T.city.optional().describe('縣市，可用 Taipei／台北市；有 near 時可省略（用位置推估）'),
    routeName: z.string().min(1).describe('完整路線名稱，例如 307'),
    stop: z.string().trim().max(40).optional().describe('要盯的站名（選填，例如上車站）：回傳 focus（該站方向、站序、到站時間），卡片聚焦這一站'),
    near: T.point('使用者現在的位置（選填）：沒說站名時聚焦路線上離他最近的站；有站名但沒給縣市時用來推縣市').optional(),
    direction: z.number().int().min(0).max(1).optional().describe('去程 0、返程 1（選填，配合 stop）'),
    toward: z.string().trim().min(1).max(20).optional().describe('往哪個方向（選填，例如「板橋」）：只看終點或方向名稱有這個地名的方向；對不到就兩個方向都列並說明'),
  },
  speak: (d) => {
    const tw = d.toward && !d.toward.found ? `${d.routeName} 沒有往「${d.toward.name}」的方向（${d.directions.map((x) => x.label).join('、')}）；` : ''; // 「307 往板橋」對不到方向：照實說，兩個方向都列
    const mv = d.cityMoved ? `（${d.cityMoved.from}沒有 ${d.routeName}，這是${d.cityMoved.to}的 ${d.routeName}）` : '';
    if (d.focus?.nearest) return `${tw}離你最近的是「${d.focus.stopName}」（約 ${fmtM(d.focus.distanceM)}）：${focusText(d.routeName, d.focus)}${d.focus.other ? `（${d.focus.label}）；${otherText(d.focus.other)}` : ''}。${mv || (d.cityGuessed ? `（依你的位置查${d.cityName}的 ${d.routeName}）` : '')}`;
    if (d.focus) return `${tw}${focusText(d.routeName, d.focus)}。${mv}`;
    const dirs = d.toward?.found ? d.directions.filter((x) => x.direction === d.toward.direction) : d.directions;
    const near = dirs.flatMap((x) => x.stops.filter((s) => s.etaSec != null && s.etaSec < 180).map((s) => s.stopName));
    return `${tw}${d.routeName}${d.toward?.found ? ` ${d.toward.label}` : ''} 目前有 ${near.length} 個站即將有車${near.length ? `（例如${near.slice(0, 2).join('、')}）` : ''}。${d.cityMoved ? `（${d.cityMoved.from}沒有 ${d.routeName}，這是${d.cityMoved.to}的 ${d.routeName}）` : ''}`;
  },
  async run(svc, a) {
    const here = a.near && (!a.stop || !a.city) ? await resolvePoint(svc.places, a.near) : null; // 有站名時位置只用來推縣市（拍站牌問的，M14-02）
    const city0 = a.city || (here && cityNear(here));
    if (!city0) throw new UserError('請告訴我是哪個縣市的公車（例如「台北 307」）');
    let city = city0, moved = null;
    const raw = await svc.bus.routeEta({ ...a, city }).catch(async (e) => {
      // 這個縣市沒有這條路線（板橋問 307、台北車站問藍15）：用預熱過的路線清單看相鄰縣市有沒有（不多打 TDX，S4）
      const alt = e instanceof UserError && /找不到路線/.test(e.message) ? await neighborCity(svc, city0, a.routeName) : null;
      if (!alt) throw e;
      city = alt; moved = { from: resolveCity(city0)?.name || city0, to: resolveCity(alt)?.name || alt };
      return svc.bus.routeEta({ ...a, city: alt });
    });
    const data = { ...raw, directions: raw.directions.map((d) => ({ ...d, stops: withNav(d.stops) })), ...(!a.city && { cityGuessed: true, cityName: resolveCity(city)?.name || city }), ...(moved && { cityMoved: moved }) };
    const dirIdx = a.toward ? data.directions.findIndex((d) => towardMatch(d, a.toward)) : -1;
    const way = dirIdx >= 0 ? data.directions[dirIdx] : null;
    if (a.toward) data.toward = { name: a.toward, found: !!way, ...(way && { direction: way.direction ?? dirIdx, label: way.label }) };
    const focus = focusStop(data.directions, a.stop, way ? (way.direction ?? dirIdx) : a.direction) || (here && !a.stop && nearestStop(way ? [way] : data.directions, here));
    if (focus) data.focus = focus;
    const lines = [`${data.routeName} 公車即時到站（更新：${data.updatedAt}）`];
    if (focus) lines.unshift(`${focusText(data.routeName, focus)}（${focus.label}）`);
    else if (a.stop) lines.unshift(`這條路線沒有「${a.stop}」這一站，以下是全線到站時間。`);
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
  // 沒說起站、用最近的車站時先說是哪一站（用預設地點時不說「離你」）
  return nearestSay(d) + railSpeakBody(d, now);
}
/** 「離你最近的高鐵站是南港（約 4.4 公里）。」；300 公尺內「你就在台北站附近。」；最近的站沒直達車時說改從哪站 */
export function nearestSay(d) {
  if (!d.nearest) return '';
  const label = d.system === 'THSR' ? '高鐵' : '台鐵';
  const skip = d.skipped ? `${d.skipped}站沒有直達車，改從` : '';
  if (d.nearest.distanceM <= 300 && !skip) return `${d.nearest.from ? `「${d.nearest.from}」` : '你'}就在${d.from}站附近。`;
  return skip ? `${skip}${d.from}站（約 ${fmtM(d.nearest.distanceM)}）。` : `${d.nearest.from ? `離「${d.nearest.from}」最近` : '離你最近'}的${label}站是${d.from}（約 ${fmtM(d.nearest.distanceM)}）。`;
}
function railSpeakBody(d, now) {
  if (!d.trains.length) return d.transfersUnavailable ? '那天沒有直達班次；換車的走法暫時查不到，稍後再問一次。' : d.system === 'TRA' ? '那天沒有直達班次，也找不到換車的走法。' : '那天沒有直達班次。';
  const type = (x) => (x.via?.length ? `（在${x.via.join('、')}換車）` : d.system === 'TRA' && x.type ? `（${x.type}）` : '');
  const up = upcomingTrains(d, now);
  if (!up) return `${d.date} 共 ${d.trains.length} 班，最早 ${d.trains[0].depart} 出發${type(d.trains[0])}、${d.trains[0].arrive} 到${d.to}。`;
  if (!up.length) return `今天的班次都開走了（末班 ${d.trains.at(-1).depart}），可以改查明天。`;
  return `今天還有 ${up.length} 班，下一班 ${up[0].depart} 出發${type(up[0])}、${up[0].arrive} 到${d.to}。`;
}

/** 給模型的文字：今天只列還沒開出的班次，並寫明現在時間與下一班，避免把第一班當成下一班 */
export function railText(data, label, now = Date.now()) {
  const pre = data.nearest ? `（使用者沒說起站，用最近的車站）${nearestSay(data)}\n` : '';
  return pre + railTextBody(data, label, now);
}
function railTextBody(data, label, now) {
  const leg = (l) => `${l.trainNo} 次${l.type ? `${l.type}` : ''} ${l.from} ${l.depart} → ${l.to} ${l.arrive}`;
  const row = (t) => (t.legs
    ? `- 換車 ${t.transfers} 次（${t.via.join('、')}）：${t.depart} → ${t.arrive}，${t.minutes} 分｜${t.legs.map(leg).join('，')}`
    : `- ${t.trainNo} 次${t.type ? `（${t.type}）` : ''}：${t.depart} → ${t.arrive}，${t.minutes} 分`);
  if (!data.trains.length) return `${label} ${data.from} → ${data.to}（${data.date}）沒有直達班次${data.transfersUnavailable ? '；換車的走法（台鐵定期時刻表）暫時查不到，請稍後再查，不要說成沒有車' : data.system === 'TRA' ? '，也找不到換車的走法' : ''}。`;
  const note = data.transferNote ? `\n（${data.transferNote}）` : '';
  const up = upcomingTrains(data, now);
  if (!up) return clip([`${label} ${data.from} → ${data.to}（${data.date}），共 ${data.trains.length} 班：`, ...data.trains.map(row)]) + note;
  const head = `${label} ${data.from} → ${data.to}（今天 ${data.date}，現在 ${nowTW(now).hhmm}）`;
  if (!up.length) return `${head}：今天的 ${data.trains.length} 班都已開出（末班 ${data.trains.at(-1).depart}），請改查明天。`;
  return clip([`${head}：今天還有 ${up.length} 班（全天 ${data.trains.length} 班），下一班 ${up[0].depart} 出發。尚未開出的班次：`, ...up.map(row)]) + note;
}

/** 高鐵／台鐵時刻表的輸入：起站可省略改給 near（使用者位置），用最近的車站 */
const RAIL_INPUT = {
  from: z.string().min(1).optional().describe('起站；使用者沒說時省略並給 near'),
  to: z.string().min(1).describe('迄站'),
  date: T.date,
  near: T.point('使用者現在的位置（沒說起站時用）：找 30 公里內最近的車站').optional(),
};
const RAIL_NEAR_MAX_M = 30_000;

/**
 * 沒說起站時：最近的高鐵／台鐵車站候選（30 公里內最近 3 站，排除迄站本身；車站沒有座標或太遠時請使用者說起站）。
 * @returns {Promise<Array<{ station: string, distanceM: number, from?: string }>|null>} 有起站時回 null
 */
async function railCandidates(svc, system, a) {
  if (a.from) return null;
  const label = system === 'THSR' ? '高鐵' : '台鐵';
  if (!a.near) throw new UserError(`請告訴我從哪一個${label}站出發，例如「${system === 'THSR' ? '台北到台中' : '臺北到花蓮'}」`);
  const pt = await resolvePoint(svc.places, a.near);
  const list = system === 'THSR' ? await svc.rail.thsrStations() : await svc.rail.traStations();
  const to = normName(a.to).replace(/站$/, '');
  const near = list.filter((s) => Number.isFinite(s.lat) && !normName(s.name).includes(to) && !to.includes(normName(s.name)))
    .map((s) => ({ station: s.name, distanceM: Math.round(distanceM(pt.lat, pt.lon, s.lat, s.lon)), ...(typeof a.near === 'string' && { from: a.near }) }))
    .filter((x) => x.distanceM <= RAIL_NEAR_MAX_M).sort((x, y) => x.distanceM - y.distanceM).slice(0, 3);
  if (!near.length) throw new UserError(`你附近 ${RAIL_NEAR_MAX_M / 1000} 公里內找不到${label}站；請告訴我從哪一站出發${system === 'THSR' ? '（花東、宜蘭沒有高鐵，要改查台鐵嗎？）' : ''}`);
  return near;
}

/** 時刻表：有起站直接查；沒有就從最近的站依序查，0 班（支線小站沒直達）換下一站 */
async function railTimetable(svc, system, a) {
  // 台鐵加上要換車的走法（支線小站、直達很少的路線；core/services/rail-trips.js）
  const get = (from) => (system === 'THSR' ? svc.rail.thsrTimetable({ ...a, from }) : traTrips(svc, { from, to: a.to, date: a.date }));
  const cands = await railCandidates(svc, system, a);
  if (!cands) return get(a.from);
  let first = null;
  for (const c of cands) {
    const r = await get(c.station).catch(() => null);
    if (!r) continue;
    first ||= { r, c };
    if (r.trains.length) return { ...r, nearest: c, ...(c !== cands[0] && { skipped: cands[0].station }) };
  }
  if (first) return { ...first.r, nearest: first.c };
  throw new UserError('附近的車站查不到班次；請告訴我從哪一站出發');
}

export const thsrTimetable = defineTool({
  name: 'thsr_timetable',
  title: '高鐵時刻表',
  description: '查詢指定日期兩個高鐵站之間的班次（出發、抵達、行車分鐘數）。站名可用中文，例如「台北」「左營」。',
  pack: PACK, tier: 'L1', card: 'timetable',
  input: RAIL_INPUT,
  speak: (d) => railSpeak(d),
  async run(svc, a) {
    const data = { system: 'THSR', ...(await railTimetable(svc, 'THSR', a)) }; // 卡片 timetable 依 system 決定標題與訂票
    return { data, text: railText(data, '高鐵') };
  },
});

export const traTimetable = defineTool({
  name: 'tra_timetable',
  title: '台鐵時刻表',
  description: '查詢指定日期兩個台鐵車站之間的班次（車種、出發、抵達、行車分鐘數）。站名可用中文，例如「臺北」「花蓮」。',
  pack: PACK, tier: 'L1', card: 'timetable',
  input: RAIL_INPUT,
  speak: (d) => railSpeak(d),
  async run(svc, a) {
    const data = { system: 'TRA', ...(await railTimetable(svc, 'TRA', a)) };
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
    const data = withNav(await svc.places.find(a)).map((p) => ({ ...p, cityName: cityName(p.city) })); // cityName：同名地點讓人分得出來（設定頁輸入地點）
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
