// 英文提問的工具回報（S12d，2026-11-21）：討論串裡「小幫手的一句話」英文版，與中文 speak 同一套判斷（ADR-0009：數字來自資料，不經模型）。
// 地名、站名等資料維持原文。沒有英文版的工具照中文。方案名稱（enName）也給英文總結用，說法與卡片字典 en.js 一致。
import { upcomingTrains } from './transit.js';
import { normName } from '../util.js';

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const mins = (sec) => Math.max(1, Math.round(sec / 60));
const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

/** 英文方案名稱（與 en.js trip.leg 一致；公車帶路線號碼） */
export const EN_ROLE = { walk: 'Walking', bike: 'YouBike', metro: 'MRT', thsr: 'High Speed Rail', tra: 'Train', intercity: 'Intercity bus', ridehail: 'Taxi', transit: 'City transit' };
export const enName = (o) => (o.role === 'bus' ? `Bus ${String(o.name || '').replace(/^公車\s*/, '')}`.trim() : EN_ROLE[o.role] || o.name);
const AQI_LEVEL = { good: 'good', moderate: 'moderate', sensitive: 'unhealthy for sensitive groups', unhealthy: 'unhealthy', very: 'very unhealthy', hazard: 'hazardous' };
const BUS_STATUS = ['', 'not departed yet', 'not stopping here (traffic control)', 'last bus has left', 'no service today'];
const DAY = (date) => { const [y, m, d] = String(date).split('-').map(Number); return y ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : date; };

/** 公車上車站的狀態：「307 arrives at 西門 in 5 min」 */
const busFocus = (route, f) => (f.status === 0 && f.etaSec != null
  ? (f.etaSec < 60 ? `${route} is arriving at ${f.stopName} now` : `${route} arrives at ${f.stopName} in ${mins(f.etaSec)} min`)
  : `${route} at ${f.stopName}: ${BUS_STATUS[f.status] || 'no live data'}`);

/** 最近的站：用預設地點（沒拿到位置）時說「離 X 最近」，不說「離你」（與中文 nearestSay 相同） */
function nearestEn(label, station, nearest) {
  if (!nearest) return '';
  const where = nearest.from ? `to ${nearest.from}` : 'to you';
  if (nearest.distanceM <= 300) return nearest.from ? `${nearest.from} is right by ${station} station. ` : `You're right by ${station} station. `;
  return `Nearest ${label} station ${where} is ${station} (${km(nearest.distanceM)}). `;
}

function railEn(d, label, now) {
  const skip = d.skipped ? `${d.skipped} has no direct train, so from ${d.from}: ` : '';
  const head = d.nearest && !d.skipped ? nearestEn(label, d.from, d.nearest) : skip;
  if (!d.trains.length) return `${head}No direct trains that day.`;
  const up = upcomingTrains(d, now);
  if (!up) return `${head}${plural(d.trains.length, 'train')} on ${DAY(d.date)}; first leaves ${d.trains[0].depart}, arrives ${d.to} ${d.trains[0].arrive}.`;
  if (!up.length) return `${head}All of today's trains have left (last at ${d.trains.at(-1).depart}); try tomorrow.`;
  return `${head}${up.length} more today; next leaves ${up[0].depart}, arrives ${d.to} ${up[0].arrive}.`;
}

/** 出門建議英文：core/agent/outing.js 產生建議時一起產生（item.en），這裡只取用（只有一份） */
export const outingEn = (x) => x?.en ?? null;

export const SPEAK_EN = {
  find_place: (d, a) => (d.length ? `Best match for "${a.query}": ${d[0].name}.` : `Couldn't find "${a.query}". Try another name.`),
  plan_trip: (d) => {
    const best = d.options.find((o) => o.id === d.best);
    if (!best) return 'No workable way found for this trip.';
    const night = d.night?.textEn ? `${d.night.textEn} ` : ''; // 深夜：第一句先說收班或末班快到了
    if (d.single) return `${night}Only one option found: ${enName(best)} (${best.minutes} min).`;
    return `${night}Compared ${plural(d.options.length, 'option')}; best is ${enName(best)} (${best.minutes} min).`;
  },
  weather_now: (d) => {
    const pop = d.pop3h != null ? `, ${d.pop3h}% chance of rain in the next 3 hours` : '';
    if (d.rainMm1h > 0) return `It's raining now${pop}.`;
    if (d.raining) return `Not raining yet${pop}; rain is likely.`;
    return `Not raining${d.tempC != null ? `, ${d.tempC}°C` : ''}${pop}.`;
  },
  weather_tomorrow: (d) => {
    const t = d.minT != null && d.maxT != null ? `, ${d.minT}–${d.maxT}°C` : '';
    const pop = d.pop != null ? `, ${d.pop}% chance of rain` : '';
    const p = d.dayPop ?? d.pop;
    const umbrella = p >= 50 ? ', bring an umbrella' : p >= 30 ? ', a folding umbrella would be wise' : '';
    return `Tomorrow (${DAY(d.date)})${t}${pop}${umbrella}.`;
  },
  aqi_nearby: (d) => `AQI ${d.nearest.aqi ?? '—'}${AQI_LEVEL[d.nearest.level] ? ` (${AQI_LEVEL[d.nearest.level]})` : ''} at ${d.nearest.site} station${d.nearest.pm25 != null ? `, PM2.5 ${d.nearest.pm25}` : ''}.`,
  outing_advice: (d) => { const first = outingEn(d.items[0]); return first ? `Before you go: ${first}${d.items.length > 1 ? ` (+${d.items.length - 1} more on the card)` : ''}.` : `Checked weather and air: ${plural(d.items.length, 'tip')} on the card.`; },
  pharmacy_search: (d) => (d.pharmacies.length ? `Found ${plural(d.pharmacies.length, 'National Health Insurance (NHI) pharmacy', 'National Health Insurance (NHI) pharmacies')}${d.area ? ` in ${d.area}` : ''}; ${d.pharmacies.filter((p) => p.openToday).length} open today.` : 'No matching NHI pharmacies.'),
  youbike_nearby: (d) => { const s = d.stations.find((x) => x.inService && x.rent > 0); return s ? `Nearest station with bikes: ${s.name} (${km(s.distance)}), ${plural(s.rent, 'bike')}.` : 'No bikes at nearby stations right now.'; },
  bus_nearby_stations: (d) => (d.stations.length ? `${plural(d.stations.length, 'bus stop')} nearby; nearest is ${d.stations[0].name} (${km(d.stations[0].distance)}).` : 'No bus stops nearby.'),
  bus_station_eta: (d) => { const f = d.arrivals.find((r) => r.etaSec != null); return f ? `Soonest is ${f.routeName}, in ${mins(f.etaSec)} min.` : 'No buses due at this stop right now.'; },
  bus_route_eta: (d) => {
    if (d.focus?.nearest) return `Nearest stop is ${d.focus.stopName} (${km(d.focus.distanceM)}): ${busFocus(d.routeName, d.focus)}${d.focus.other ? ` (${String(d.focus.label).replace(/^往\s*/, 'to ')}); ${String(d.focus.other.label).replace(/^往\s*/, 'to ')}: ${busFocus(d.routeName, d.focus.other)}` : ''}.`; // 兩個方向都說（PM Q-17）
    if (d.focus) return `${busFocus(d.routeName, d.focus)}.`;
    const near = d.directions.flatMap((x) => x.stops.filter((s) => s.etaSec != null && s.etaSec < 180)).length;
    return near ? `${d.routeName}: a bus is due within 3 min at ${plural(near, 'stop')}.` : `No ${d.routeName} buses due within 3 min.`;
  },
  metro_live_board: (d) => {
    const t = d.trains.find((x) => x.etaMin != null);
    const same = d.nearest?.from && normName(d.nearest.from).replace(/站$/, '') === normName(d.station).replace(/站$/, '');
    const where = d.nearest && !same ? nearestEn('MRT', d.station, d.nearest).replace(/\. $/, '') : `At ${d.station}`;
    if (!t) return `${where}: no live arrival data right now.`;
    const dest = t.destination;
    if (t.scheduled) return `${where}: next train to ${dest} in about ${Math.max(1, t.etaMin)} min (timetable).`;
    return `${where}: ${t.etaMin <= 1 ? `train to ${dest} arriving now` : `next train to ${dest} in ${t.etaMin} min`}.`;
  },
  thsr_timetable: (d) => railEn(d, 'High Speed Rail', Date.now()),
  tra_timetable: (d) => railEn(d, 'Train', Date.now()),
  rail_fare: (d) => { const a = d.fares.filter((f) => f.adultOneWay); return a.length ? `Adult one-way ${d.from} to ${d.to}: from NT$${a[0].price}.` : `No fare data for ${d.from} to ${d.to} right now.`; },
  ridehail_link: (d) => `${d.providerName} link ready${d.estimate ? `, about NT$${d.estimate.low}–${d.estimate.high} (estimate)` : ''}; confirm in the app.`,
  // 短劇（ADR-0019）：劇名是中文，照原文
  drama_picks: (d) => (d.items.length ? `Top on MyDrama (${({ hot: 'popular', new: 'new', completed: 'completed', taiwan: 'made in Taiwan' })[d.list] || 'popular'}): ${d.items.slice(0, 3).map((x) => `《${x.title}》`).join(', ')}.` : 'No short dramas to recommend right now.'),
  drama_search: (d) => (d.items.length ? `Found ${plural(d.total, 'short drama')} for "${d.query}": ${d.items.slice(0, 3).map((x) => `《${x.title}》`).join(', ')}.` : `No short dramas found for "${d.query}".`),
  drama_series: (d) => { const x = d.items[0]; return `About 《${x.title}》: ${x.episodes != null ? `${x.episodes} episodes` : 'episodes vary'}${x.freeEpisodes ? `, first ${x.freeEpisodes} free` : ''}, ${x.completed ? 'completed' : 'ongoing'}.`; },
  traffic_status: (d) => (!d.covered ? (d.straightKm < 15 ? 'Short trip; no need to check freeway traffic.' : 'No freeway traffic data for this route.') : !d.level ? 'No freeway speed data right now.' : d.level === 'smooth' ? 'Freeway traffic is smooth.' : `Freeway traffic is ${d.level === 'jam' ? 'jammed' : 'heavy'}, about ${d.delayMin} min extra.`),
};

/** 英文那一輪的工具回報；沒有英文版回 null（呼叫端用中文） */
export function speakEn(name, data, args) {
  const f = SPEAK_EN[name];
  return f ? f(data, args) : null;
}

/** 英文那一輪的「→ 影響」：只留要馬上注意的（YouBike 車位、公車趕不趕得上）；其他不附 */
export function impactEn(name, data) {
  if (!data) return null;
  if (name === 'bus_route_eta') {
    const f = data.focus;
    if (!f || f.status !== 0 || f.etaSec == null) return null;
    return f.etaSec < 180 ? { tone: 'bad', text: 'This bus is almost here; you may not make it' } : { tone: 'good', text: `About ${mins(f.etaSec)} min left, enough time to walk there` };
  }
  if (name === 'plan_trip') {
    if (data.single) return { tone: 'bad', text: 'Only one way works for this trip (see "How Abang decided")' };
    const skip = data.skipped?.find((s) => s.role === 'bike');
    if (skip) return { tone: 'bad', text: 'YouBike: not available at one end, left out' };
    const b = data.options?.find((o) => o.role === 'bike')?.bike;
    if (b?.ret.tight) return { tone: 'bad', text: `YouBike: only ${plural(b.ret.count, 'dock')} left at ${b.ret.name}${b.ret.backup ? `; if full, return at ${b.ret.backup.name}` : ''}` };
    if (b?.rent.tight) return { tone: 'bad', text: `YouBike: only ${plural(b.rent.count, 'bike')} left at ${b.rent.name}${b.rent.backup ? `; if none, try ${b.rent.backup.name}` : ''}` };
  }
  return null;
}
