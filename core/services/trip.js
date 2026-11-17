// 行程規劃 plan_trip（docs/MCP_TOOLS.md §7、ADR-0010）：組合各服務產生候選方案 → 自動狀態 → decide() 排序。
// 只用 svc 的既有服務（live 與 mock 介面相同），不直接呼叫外部 API；任何一個來源失敗只略過該方案，不中斷規劃。
// 估算值（市區轉乘、叫車時間與車資、客運票價缺資料時）一律標 estimated，並在 notes 說明依據。
import { distanceM, toHHMM, normName } from '../util.js';
import { walkMinutes, navLinks } from '../nav.js';
import { decide, STATES } from '../decide.js';
import { departOf, delayRiskOf } from './intercity.js';
import { LANDMARKS, normPlace } from './places.js';

// ── 候選方案的距離門檻（直線） ──
export const LIMITS = {
  walkMaxM: 6000,        // 步行：6 公里內列出（> 3 公里通常排後）
  bikeMinM: 500, bikeMaxM: 12000, bikeRadiusM: 500,
  busMaxM: 25000,
  railMinM: 30000,       // 軌道：直線 > 30 公里
  railAccessMaxM: 25000, // 起訖點到車站最遠 25 公里
  intercityMinM: 15000,
};
// ── 估算用常數（estimated 方案的依據） ──
export const EST = {
  roadFactor: 1.3,          // 道路距離 ≈ 直線 × 1.3
  bikeKmh: 12,              // YouBike 騎乘
  busMinPerStop: 1.5,       // 公車每站 1.5 分（MCP_TOOLS §7 規則 3）
  busFare: 15,              // 公車單段票（台北市一段票）
  cityKmh: 20, cityWaitMin: 5, cityFare: 15, // 到車站的市區轉乘（公車／捷運）
  carCityKmh: 22, carHighwayKmh: 55, ridehailWaitMin: 6,
  intercityTwdPerKm: 1.3,   // 客運票價缺資料時：道路公里 × 1.3 元
  stationWalkM: 1200,       // 到車站 1.2 公里內用走的
};

// YouBike 2.0（台北市）：前 30 分 5 元（市府補助）、之後每 30 分 10 元
export const bikeFare = (min) => (min <= 30 ? 5 : 5 + Math.ceil((min - 30) / 30) * 10);

const roadKm = (m) => (m / 1000) * EST.roadFactor;
const pt = (p) => ({ name: p.name, lat: p.lat, lon: p.lon });
const leg = (mode, from, to, minutes, detail, navMode = 'walking') => ({ mode, from: pt(from), to: pt(to), minutes, detail, nav: navLinks(to.lat, to.lon, navMode) });

// ── 車站座標：由內建地標對照（高鐵「高鐵○○站」或「○○車站」；台鐵「○○車站」） ──
const STATION_ITEMS = LANDMARKS.items.filter((x) => x.kind === 'station' && !/捷運/.test(x.name));
const keysOf = (x) => [x.name, ...x.aliases].map(normPlace);
/** 鐵路車站名稱 → 地標座標；找不到回 null */
export function stationPoint(system, name) {
  const n = normPlace(name);
  const want = system === 'THSR' ? [`高鐵${n}站`, `${n}車站`] : [`${n}車站`];
  for (const w of want) {
    const hit = STATION_ITEMS.find((x) => keysOf(x).includes(w) && (system === 'THSR' || !/^高鐵/.test(x.name)));
    if (hit) return { name, lat: hit.lat, lon: hit.lon };
  }
  return null;
}

/** 離某點最近（且在上限內）的車站 */
function nearestStation(stations, p) {
  let best = null;
  for (const s of stations) {
    const d = distanceM(p.lat, p.lon, s.lat, s.lon);
    if (d <= LIMITS.railAccessMaxM && (!best || d < best.d)) best = { ...s, d };
  }
  return best;
}

/** 到車站／離開車站：1.2 公里內走路，否則市區轉乘（估算） */
function access(fromP, toP, d) {
  if (d <= EST.stationWalkM) {
    const m = walkMinutes(d);
    return { minutes: m, walkMin: m, cost: 0, estimated: false, leg: leg('walk', fromP, toP, m, `步行約 ${m} 分`) };
  }
  const m = Math.round((roadKm(d) / EST.cityKmh) * 60) + EST.cityWaitMin;
  return { minutes: m, walkMin: 3, cost: EST.cityFare, estimated: true, leg: leg('transit', fromP, toP, m, `市區公車／捷運約 ${m} 分（估算）`, 'transit') };
}

// ───────── 各種方案 ─────────
function walkOption(from, to, straight) {
  if (straight > LIMITS.walkMaxM) return null;
  const m = walkMinutes(straight);
  return {
    id: 'walk', role: 'walk', name: '步行', minutes: m, waitMin: 0, walkMin: m, cost: 0,
    exposure: 1, effort: Math.min(1, straight / 3000), delayRisk: 0,
    legs: [leg('walk', from, to, m, `步行約 ${m} 分`)], notes: straight > 3000 ? ['超過 3 公里，走路比較累'] : [],
  };
}

async function bikeOption(svc, from, to, straight) {
  if (straight < LIMITS.bikeMinM || straight > LIMITS.bikeMaxM) return null;
  const [a, b] = await Promise.all([svc.bike.nearby({ ...from, radius: LIMITS.bikeRadiusM }), svc.bike.nearby({ ...to, radius: LIMITS.bikeRadiusM })]);
  const rent = a.filter((s) => s.inService !== false && s.rent > 0).sort((x, y) => x.distance - y.distance)[0];
  const ret = b.filter((s) => s.inService !== false && s.returnSlots > 0).sort((x, y) => x.distance - y.distance)[0];
  if (!rent || !ret || rent.uid === ret.uid) return null;
  const w1 = walkMinutes(rent.distance), w2 = walkMinutes(ret.distance);
  const ride = Math.max(1, Math.round((roadKm(distanceM(rent.lat, rent.lon, ret.lat, ret.lon)) / EST.bikeKmh) * 60));
  return {
    id: 'bike', role: 'bike', name: 'YouBike', minutes: w1 + ride + w2, waitMin: 0, walkMin: w1 + w2, cost: bikeFare(ride),
    exposure: 1, effort: 0.8, delayRisk: 0,
    legs: [
      leg('walk', from, rent, w1, `走到 ${rent.name}（${rent.rent} 台可借）`),
      leg('bike', rent, ret, ride, `騎約 ${ride} 分到 ${ret.name}（${ret.returnSlots} 個空位）`, 'bicycling'),
      leg('walk', ret, to, w2, `步行約 ${w2} 分`),
    ],
    notes: [`車資依 YouBike 2.0 台北市費率（前 30 分 5 元）`],
  };
}

async function busOption(svc, from, to, straight, risk) {
  if (straight > LIMITS.busMaxM) return null;
  const list = await svc.bus.directTrips({ from, to });
  const opts = list.map((t) => {
    const w1 = walkMinutes(t.walkFromM), w2 = walkMinutes(t.walkToM);
    // 走到站牌前車子就來了 → 等下一班（不知道下一班時間，以 10 分估）
    const etaMin = t.board.etaSec != null ? Math.ceil(t.board.etaSec / 60) : null;
    const wait = etaMin == null ? 10 : etaMin >= w1 ? etaMin - w1 : 10;
    const ride = Math.round(t.stops * EST.busMinPerStop);
    return {
      id: `bus-${t.routeName}`, role: 'bus', name: `公車 ${t.routeName}`, minutes: w1 + wait + ride + w2, waitMin: wait, walkMin: w1 + w2,
      cost: EST.busFare, exposure: 0.2, effort: 0.2, delayRisk: risk,
      legs: [
        leg('walk', from, t.board, w1, `走到 ${t.board.name}`),
        leg('bus', t.board, t.alight, ride, `${t.routeName}（${t.label}）坐 ${t.stops} 站`, 'transit'),
        leg('walk', t.alight, to, w2, `步行約 ${w2} 分`),
      ],
      notes: [etaMin == null || etaMin < w1 ? '下一班到站時間不明，以 10 分估' : `${t.board.name} 約 ${etaMin} 分後到站`, '票價以一段票 15 元估'],
      ...((etaMin == null || etaMin < w1) && { estimated: true }),
    };
  });
  return opts.sort((a, b) => a.minutes - b.minutes)[0] || null;
}

async function railOption(svc, system, from, to, straight, depart) {
  if (straight < LIMITS.railMinM) return null;
  const stations = (await (system === 'THSR' ? svc.rail.thsrStations() : svc.rail.traStations()))
    .map((s) => stationPoint(system, s.name)).filter(Boolean);
  const o = nearestStation(stations, from), d = nearestStation(stations, to);
  if (!o || !d || normName(o.name) === normName(d.name)) return null;
  const a1 = access(from, o, o.d), a2 = access(d, to, d.d);
  const tt = await (system === 'THSR' ? svc.rail.thsrTimetable : svc.rail.traTimetable)({ from: o.name, to: d.name, date: depart.date });
  const ready = depart.minute + a1.minutes;
  const toM = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const train = (tt.trains || []).filter((t) => toM(t.depart) >= ready).sort((x, y) => toM(x.depart) - toM(y.depart))[0];
  if (!train) return null;
  const fares = await (system === 'THSR' ? svc.rail.thsrFare : svc.rail.traFare)({ from: o.name, to: d.name }).then((f) => f.fares).catch(() => []);
  const fare = fares.find((f) => f.adultOneWay && (!train.type || !f.trainType || f.trainType === train.type)) || fares.find((f) => f.adultOneWay);
  const wait = toM(train.depart) - ready;
  const label = system === 'THSR' ? '高鐵' : `台鐵${train.type || ''}`;
  return {
    id: system.toLowerCase(), role: system.toLowerCase(), name: label,
    minutes: a1.minutes + wait + train.minutes + a2.minutes, waitMin: wait, walkMin: a1.walkMin + a2.walkMin,
    cost: (fare?.price ?? 0) + a1.cost + a2.cost, exposure: 0.1, effort: 0.3, delayRisk: 0,
    legs: [a1.leg, leg(system.toLowerCase(), o, d, train.minutes, `${label} ${train.trainNo} 次 ${train.depart} 開、${train.arrive} 到`, 'transit'), a2.leg],
    notes: [fare ? `${fare.trainType || fare.cabin || ''}成人單程 ${fare.price} 元` : '票價暫時查不到'],
    train: { trainNo: train.trainNo, depart: train.depart, arrive: train.arrive, from: o.name, to: d.name, date: depart.date },
    ...((a1.estimated || a2.estimated || !fare) && { estimated: true }),
  };
}

async function intercityOption(svc, from, to, straight, depart) {
  if (straight < LIMITS.intercityMinM) return null;
  const r = await svc.intercity.trips({ from, to, departAt: toHHMM(depart.minute) });
  const toM = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const waitOf = (t) => toM(t.depart) + (t.nextDay ? 24 * 60 : 0) - depart.minute - walkMinutes(t.walkFromM);
  const t = r.trains.find((x) => waitOf(x) >= 0); // 走到站牌還趕得上的第一班
  if (!t) return null;
  const w1 = walkMinutes(t.walkFromM), w2 = walkMinutes(t.walkToM);
  const wait = waitOf(t);
  const ride = t.minutes + (t.delayMin || 0);
  const estFare = Math.round((roadKm(straight) * EST.intercityTwdPerKm) / 5) * 5;
  return {
    id: 'intercity', role: 'intercity', name: /^國道客運/.test(t.trainNo) ? t.trainNo : `國道客運 ${t.trainNo}`,
    minutes: w1 + wait + ride + w2, waitMin: wait, walkMin: w1 + w2, cost: t.fare ?? estFare,
    exposure: 0.2, effort: 0.3, delayRisk: r.delayRisk,
    // 客運站牌座標服務層沒有回傳：站牌點不附座標與導航
    legs: [
      leg('walk', from, { name: t.board, lat: null, lon: null }, w1, `走到 ${t.board}（約 ${t.walkFromM} 公尺）`),
      leg('intercity', { name: t.board, lat: null, lon: null }, { name: t.alight, lat: null, lon: null }, ride, `${t.trainNo} ${t.depart} 開${t.delayMin ? `，路上多 ${t.delayMin} 分` : ''}`, 'transit'),
      leg('walk', { name: t.alight, lat: null, lon: null }, to, w2, `步行約 ${w2} 分`),
    ],
    notes: [t.fare != null ? `票價 ${t.fare} 元` : `票價暫無資料，以道路公里 × ${EST.intercityTwdPerKm} 元估`, ...(t.estimated ? ['抵達時間依距離估算'] : [])],
    ...((t.fare == null || t.estimated) && { estimated: true }),
  };
}

async function ridehailOption(svc, from, to, straight, traffic) {
  const km = roadKm(straight);
  const drive = Math.round((km / (km < 15 ? EST.carCityKmh : EST.carHighwayKmh)) * 60) + (traffic?.delayMin || 0);
  const link = await svc.ridehail.link({ from, to });
  const e = link.estimate;
  return {
    id: 'ridehail', role: 'ridehail', name: `叫車（${link.providerName}）`,
    minutes: EST.ridehailWaitMin + drive, waitMin: EST.ridehailWaitMin, walkMin: 0,
    cost: Math.round((e.low + e.high) / 2 / 5) * 5, costRange: [e.low, e.high],
    exposure: 0, effort: 0, delayRisk: delayRiskOf(traffic?.level ?? null), estimated: true,
    legs: [{ ...leg('ridehail', from, to, drive, `車程約 ${drive} 分（估算）`, 'driving'), url: link.url }],
    notes: [`車資 ${e.low}～${e.high} 元（${e.basis}）`, '叫車前需你確認（ridehail_link）'],
  };
}

/**
 * 規劃 A → B。
 * @param {object} svc createServices() 的結果
 * @param {{ from: { name, lat, lon }, to: { name, lat, lon }, departAt?: string, prefs?: { states?: string[], arriveBy?: string }, now?: number }} p
 */
export async function planTrip(svc, { from, to, departAt, prefs = {}, now = Date.now() }) {
  const depart = departOf(departAt, now);
  const straight = distanceM(from.lat, from.lon, to.lat, to.lon);

  // 自動狀態：起點天氣、沿途路況（失敗不加狀態、不中斷）
  const [weather, traffic] = await Promise.all([
    svc.weather.now({ lat: from.lat, lon: from.lon }).catch(() => null),
    svc.traffic.status({ from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon } }).catch(() => null),
  ]);
  const autoStates = [
    ...(weather?.raining ? [{ key: 'rain', source: 'auto', from: 'weather_now', detail: weather.summary }] : []),
    ...(traffic?.level === 'jam' ? [{ key: 'traffic', source: 'auto', from: 'traffic_status', detail: `沿途國道塞車，多 ${traffic.delayMin} 分` }] : []),
  ];
  const risk = delayRiskOf(traffic?.covered ? traffic.level : null);

  const tasks = {
    walk: async () => walkOption(from, to, straight),
    bike: () => bikeOption(svc, from, to, straight),
    bus: () => busOption(svc, from, to, straight, risk),
    thsr: () => railOption(svc, 'THSR', from, to, straight, depart),
    tra: () => railOption(svc, 'TRA', from, to, straight, depart),
    intercity: () => intercityOption(svc, from, to, straight, depart),
    ridehail: () => ridehailOption(svc, from, to, straight, traffic),
  };
  const unavailable = [];
  const results = await Promise.all(Object.entries(tasks).map(([k, f]) => f().catch(() => { unavailable.push(k); return null; })));
  const options = results.filter(Boolean).map((o) => ({ ...o, arriveAt: toHHMM(depart.minute + o.minutes) }));

  // 狀態（CARDS.md trip）：自動判斷在前，使用者說的（source: 'user'）在後，同一個 key 只留一筆
  const states = [...autoStates];
  for (const k of prefs.states || []) if (STATES[k] && !states.some((s) => s.key === k)) states.push({ key: k, source: 'user' });
  const r = decide(options, { states: states.map((s) => s.key), arriveBy: prefs.arriveBy });
  return {
    from: pt(from), to: pt(to), straightKm: +(straight / 1000).toFixed(1),
    date: depart.date, departAt: toHHMM(depart.minute),
    best: r.best?.id ?? null, states,
    weather: weather && { summary: weather.summary, raining: weather.raining, pop3h: weather.pop3h },
    traffic: traffic && { level: traffic.level, delayMin: traffic.delayMin, covered: traffic.covered },
    options,
    ranking: {
      ranked: r.ranked.map((o) => ({ id: o.id, name: o.name, score: o.score, breakdown: o.breakdown })),
      excluded: r.excluded.map((o) => ({ id: o.id, name: o.name, why: o.why })),
      weights: r.weights, reason: r.reason,
    },
    ...(unavailable.length && { unavailable }),
  };
}
