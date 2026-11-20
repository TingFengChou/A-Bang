// 英文提問的工具回報（S12d，2026-11-21）：討論串裡「小幫手的一句話」英文版。只放英文規則會用到的工具；
// 數字一律來自工具資料（ADR-0009，不經模型）；地名、站名等資料維持原文。沒有英文版的工具照中文。
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const mins = (sec) => Math.max(1, Math.round(sec / 60));
const MODE = { walk: 'walking', bike: 'YouBike', bus: 'bus', metro: 'MRT', thsr: 'High Speed Rail', tra: 'train', intercity: 'intercity bus', ridehail: 'taxi', transit: 'city transit' };

/** 公車上車站的狀態：「307 arrives in 5 min」 */
const busFocus = (route, f) => (f.status === 0 && f.etaSec != null
  ? (f.etaSec < 60 ? `${route} is arriving now` : `${route} arrives in ${mins(f.etaSec)} min`)
  : `${route}: ${['', 'not departed yet', 'not stopping here', 'last bus has left', 'no service today'][f.status] || 'no live data'}`);

export const SPEAK_EN = {
  find_place: (d, a) => (d.length ? `Best match for "${a.query}": ${d[0].name}.` : `Couldn't find "${a.query}". Try another name.`),
  plan_trip: (d) => {
    const best = d.options.find((o) => o.id === d.best);
    if (!best) return 'No workable way found for this trip.';
    return `Compared ${d.options.length} options, best is ${MODE[best.role] || best.name} (${best.minutes} min).`;
  },
  weather_now: (d) => {
    const pop = d.pop3h != null ? `, ${d.pop3h}% chance of rain in the next 3 hours` : '';
    if (d.rainMm1h > 0) return `It's raining now${pop}.`;
    if (d.raining) return `Not raining yet${pop}; rain is likely.`;
    return `Not raining${d.tempC != null ? `, ${d.tempC}°C` : ''}${pop}.`;
  },
  weather_tomorrow: (d) => `Tomorrow (${d.date}): ${d.minT ?? '—'}–${d.maxT ?? '—'}°C, ${d.pop ?? '—'}% chance of rain${(d.dayPop ?? d.pop) >= 50 ? ', bring an umbrella' : ''}.`,
  aqi_nearby: (d) => `AQI ${d.nearest.aqi ?? '—'} at the nearest station${d.nearest.pm25 != null ? `, PM2.5 ${d.nearest.pm25}` : ''}.`,
  outing_advice: (d) => `Checked weather and air: ${d.items.length} tip${d.items.length === 1 ? '' : 's'} on the card.`,
  youbike_nearby: (d) => { const s = d.stations.find((x) => x.inService && x.rent > 0); return s ? `Nearest station with bikes: ${s.name} (${km(s.distance)}), ${s.rent} bike${s.rent === 1 ? '' : 's'}.` : 'No bikes at nearby stations right now.'; },
  bus_nearby_stations: (d) => (d.stations.length ? `${d.stations.length} bus stops nearby; nearest is ${d.stations[0].name} (${km(d.stations[0].distance)}).` : 'No bus stops nearby.'),
  bus_route_eta: (d) => {
    if (d.focus?.nearest) return `Nearest stop is ${d.focus.stopName} (${km(d.focus.distanceM)}): ${busFocus(d.routeName, d.focus)}.`;
    if (d.focus) return `${busFocus(d.routeName, d.focus)}.`;
    const near = d.directions.flatMap((x) => x.stops.filter((s) => s.etaSec != null && s.etaSec < 180)).length;
    return `${d.routeName}: ${near} stop${near === 1 ? '' : 's'} with a bus arriving soon.`;
  },
  metro_live_board: (d) => {
    const t = d.trains.find((x) => x.etaMin != null);
    const where = d.nearest ? `Nearest MRT station is ${d.station}${d.nearest.from ? '' : ` (${km(d.nearest.distanceM)})`}` : d.station;
    if (!t) return `${where}: no live arrival data right now.`;
    return `${where}: ${t.etaMin <= 1 ? `train to ${t.destination} arriving now` : `next train to ${t.destination} in ${t.etaMin} min`}.`;
  },
  thsr_timetable: (d) => railEn(d, 'High Speed Rail'),
  tra_timetable: (d) => railEn(d, 'Train'),
  traffic_status: (d) => (!d.covered ? 'No freeway on this route.' : !d.level ? 'No freeway speed data right now.' : d.level === 'smooth' ? 'Freeway traffic is smooth.' : `Freeway traffic is slow, about ${d.delayMin} min extra.`),
};

function railEn(d, label) {
  const from = d.nearest ? `Nearest ${label} station is ${d.from}. ` : '';
  if (!d.trains.length) return `${from}No direct trains that day.`;
  const next = d.trains.find((x) => !x.gone) || d.trains[0];
  return `${from}${d.trains.length} trains; next leaves ${next.depart}, arrives ${d.to} ${next.arrive}.`;
}

/** 英文那一輪的工具回報；沒有英文版回 null（呼叫端用中文） */
export function speakEn(name, data, args) {
  try { return SPEAK_EN[name]?.(data, args) ?? null; } catch { return null; }
}
