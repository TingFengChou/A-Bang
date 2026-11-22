// 行程規劃 plan_trip（docs/MCP_TOOLS.md §7、ADR-0010）：組合各服務產生候選方案 → 自動狀態 → decide() 排序。
// 只用 svc 的既有服務（live 與 mock 介面相同），不直接呼叫外部 API；任何一個來源失敗只略過該方案，不中斷規劃。
// 估算值（市區轉乘、叫車時間與車資、客運票價缺資料時）一律標 estimated，並在 notes 說明依據。
import { distanceM, toHHMM, toMin, normName, nowTW } from '../util.js';
import { walkMinutes, navLinks } from '../nav.js';
import { decide, keyQuestion, STATES } from '../decide.js';
import { departOf, delayRiskOf } from './intercity.js';
import { LANDMARKS, normPlace } from './places.js';
import { METRO_LINE_NAME, nearMetroArea } from './metro.js';
import { currentFallback, fellBack } from '../metrics.js';
import { consideredOf, missingModes, singleNote, nightOf, AIR_MAX_M, BAD_AIR_AQI, RAIN_SOON_POP } from './trip-considered.js';

export { AIR_MAX_M, BAD_AIR_AQI, RAIN_SOON_POP };

// ── 候選方案的距離門檻（直線） ──
export const LIMITS = {
  walkMaxM: 6000,        // 步行：6 公里內列出（> 3 公里通常排後）
  bikeMinM: 500, bikeMaxM: 12000, bikeRadiusM: 500, bikeReturnRadiusM: 800,
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
  maxIdleWaitMin: 10,       // 班次制（軌道、客運）：要等更久時視為晚一點出門，等車只算 10 分（時間＝從 leaveAt 出門起算）
};

// YouBike 2.0（台北市）：前 30 分 5 元（市府補助）、之後每 30 分 10 元
export const bikeFare = (min) => (min <= 30 ? 5 : 5 + Math.ceil((min - 30) / 30) * 10);

const roadKm = (m) => (m / 1000) * EST.roadFactor;
const pt = (p) => ({ name: p.name, lat: p.lat, lon: p.lon });
/** detail 可以是 [中文, 英文]：英文提問的卡片用 detailEn（S12f；地名維持中文） */
const leg = (mode, from, to, minutes, detail, navMode = 'walking') => ({ mode, from: pt(from), to: pt(to), minutes, ...(Array.isArray(detail) ? { detail: detail[0], detailEn: detail[1] } : { detail }), nav: navLinks(to.lat, to.lon, navMode) });

// ── 車站座標：由內建地標對照（高鐵「高鐵○○站」或「○○車站」；台鐵「○○車站」） ──
const STATION_ITEMS = LANDMARKS.items.filter((x) => x.kind === 'station' && !/捷運/.test(x.name));
const keysOf = (x) => [x.name, ...x.aliases].map(normPlace);
/** 鐵路車站名稱 → 地標座標；找不到回 null */
const stationCache = new Map();
export function stationPoint(system, name) {
  const ck = `${system}|${name}`;
  if (!stationCache.has(ck)) stationCache.set(ck, findStationPoint(system, name));
  return stationCache.get(ck);
}
function findStationPoint(system, name) {
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
    return { minutes: m, walkMin: m, cost: 0, estimated: false, leg: leg('walk', fromP, toP, m, [`步行約 ${m} 分`, `Walk about ${m} min`]) };
  }
  const m = Math.round((roadKm(d) / EST.cityKmh) * 60) + EST.cityWaitMin;
  return { minutes: m, walkMin: 3, cost: EST.cityFare, estimated: true, leg: leg('transit', fromP, toP, m, [`市區公車／捷運約 ${m} 分（估算）`, `City bus/MRT about ${m} min (est.)`], 'transit') };
}

// ───────── 各種方案 ─────────
function walkOption(from, to, straight) {
  if (straight > LIMITS.walkMaxM) return null;
  const m = walkMinutes(straight);
  return {
    id: 'walk', role: 'walk', name: '步行', minutes: m, waitMin: 0, walkMin: m, cost: 0,
    exposure: 1, effort: Math.min(1, straight / 3000), delayRisk: 0,
    legs: [leg('walk', from, to, m, [`步行約 ${m} 分`, `Walk about ${m} min`])], notes: straight > 3000 ? ['超過 3 公里，走路比較累'] : [],
  };
}

/** 少於這個數字算「很緊」：走過去或騎到時可能被借光／停滿（資料是現在的，騎過去要十幾分鐘） */
export const BIKE_SAFE = { bikes: 3, slots: 3 };
/**
 * 挑站：優先選數量夠（≥ safe）的最近站；夠的站比最近的站多走不到 300 公尺就選它，否則選最近的（標為很緊）。
 * @returns {{ pick: object, tight: boolean, backup: object|null } | null}
 */
export function pickBikeStation(list, key, safe) {
  const ok = list.filter((s) => s.inService !== false && s[key] > 0).sort((x, y) => x.distance - y.distance);
  if (!ok.length) return null;
  const safeOne = ok.find((s) => s[key] >= safe);
  const pick = safeOne && safeOne.distance - ok[0].distance <= 300 ? safeOne : ok[0];
  const tight = pick[key] < safe;
  const backup = tight ? ok.find((s) => s !== pick && s[key] >= safe) || ok.find((s) => s !== pick) || null : null;
  return { pick, tight, backup };
}

async function bikeOption(svc, from, to, straight) {
  if (straight < LIMITS.bikeMinM || straight > LIMITS.bikeMaxM) return null;
  // 終點多找一點（800 公尺）：最近的站停滿時，告訴使用者備用還車站
  const [a, b] = await Promise.all([svc.bike.nearby({ ...from, radius: LIMITS.bikeRadiusM }), svc.bike.nearby({ ...to, radius: LIMITS.bikeReturnRadiusM })]);
  const r1 = pickBikeStation(a, 'rent', BIKE_SAFE.bikes);
  const r2 = pickBikeStation(b, 'returnSlots', BIKE_SAFE.slots);
  if (!r1) return { skip: { role: 'bike', why: `出發地 ${LIMITS.bikeRadiusM} 公尺內的 YouBike 站都沒車可借`, whyEn: `No bikes at YouBike stations within ${LIMITS.bikeRadiusM} m of the start` } };
  if (!r2) return { skip: { role: 'bike', why: `目的地 ${LIMITS.bikeReturnRadiusM} 公尺內的 YouBike 站都沒有空位可還`, whyEn: `No free docks at YouBike stations within ${LIMITS.bikeReturnRadiusM} m of the destination` } };
  const rent = r1.pick, ret = r2.pick;
  if (rent.uid === ret.uid) return { none: { kind: 'near', why: '借車和還車是同一站，走路就到', whyEn: 'Same station at both ends; just walk' } };
  const w1 = walkMinutes(rent.distance), w2 = walkMinutes(ret.distance);
  const ride = Math.max(1, Math.round((roadKm(distanceM(rent.lat, rent.lon, ret.lat, ret.lon)) / EST.bikeKmh) * 60));
  return {
    id: 'bike', role: 'bike', name: 'YouBike', minutes: w1 + ride + w2, waitMin: 0, walkMin: w1 + w2, cost: bikeFare(ride),
    exposure: 1, effort: 0.8, delayRisk: 0,
    legs: [
      leg('walk', from, rent, w1, [`走到 ${rent.name}（${rent.rent} 台可借）`, `Walk to ${rent.name} (${rent.rent} ${rent.rent === 1 ? 'bike' : 'bikes'} available)`]),
      leg('bike', rent, ret, ride, [`騎約 ${ride} 分到 ${ret.name}（${ret.returnSlots} 個空位）`, `Ride about ${ride} min to ${ret.name} (${ret.returnSlots} ${ret.returnSlots === 1 ? 'dock' : 'docks'} free)`], 'bicycling'),
      leg('walk', ret, to, w2, [`步行約 ${w2} 分`, `Walk about ${w2} min`]),
    ],
    // 起點有車、終點有空位（兩端都要知道）：給卡片、討論串與總結用
    bike: {
      rent: { name: rent.name, count: rent.rent, tight: r1.tight, ...(r1.backup && { backup: { name: r1.backup.name, count: r1.backup.rent } }) },
      ret: { name: ret.name, count: ret.returnSlots, tight: r2.tight, ...(r2.backup && { backup: { name: r2.backup.name, count: r2.backup.returnSlots, walkMin: walkMinutes(r2.backup.distance) } }) },
    },
    notes: [
      ...(r1.tight ? [r1.backup ? `「${rent.name}」只剩 ${rent.rent} 台，借不到就改去「${r1.backup.name}」（${r1.backup.rent} 台）` : `「${rent.name}」只剩 ${rent.rent} 台，走過去可能被借光`] : []),
      ...(r2.tight ? [r2.backup ? `「${ret.name}」只剩 ${ret.returnSlots} 個空位，停滿就改還「${r2.backup.name}」（${r2.backup.returnSlots} 位，到目的地走 ${walkMinutes(r2.backup.distance)} 分）` : `「${ret.name}」只剩 ${ret.returnSlots} 個空位，騎到時可能停滿`] : []),
      '借車、還車數量是現在的資料，騎到時可能變動',
      `車資依 YouBike 2.0 台北市費率（前 30 分 5 元）`,
    ],
  };
}

/**
 * 深夜（台灣時間）：示範資料 00:00～05:00 公車不列入、23:00 後提醒末班（S10）；真實資料改看到站狀態。
 * TDX 額度用完、公車這次改用示範資料（withTdxFallback）時，示範資料沒有收班狀態，也依時間估並照實說。
 */
export const NIGHT = { closedFrom: 0, closedTo: 5 * 60, lateFrom: 23 * 60 };
/** 公車深夜收班（依時間估）；est＝真實模式但這次公車是示範資料（TDX 額度用完） */
const busNightClosed = (est) => ({
  role: 'bus', closed: true,
  why: est ? '深夜多數公車已收班（TDX 額度用完，這次依時間估；以站牌即時資訊為準）' : '深夜多數公車已收班（以站牌即時資訊為準）',
  whyEn: est ? 'Most buses have stopped for the night (estimated from the time: TDX quota used up; check the stop for live info)' : 'Most buses have stopped for the night (check the stop for live info)',
  ...(est && { estimated: true, fallback: 'tdx-limit' }),
});

/**
 * 捷運營運時間（台灣時間的當日分鐘；S10 深夜）。⚠️ 大約值，以各系統公告為準：首班約 06:00；末班依站與方向不同（多在 24:00 前後從端點發車）。
 * 捷運沒有「末班已過」的即時狀態可看，真實資料與示範資料都用這張表：收班時段不列入（說明首班時間）、收班前 METRO_LATE_MIN 分鐘列入但提醒末班。
 */
export const METRO_HOURS = {
  TRTC: { open: 6 * 60, close: 24 * 60 },      // 台北捷運：約 06:00～24:00
  TYMC: { open: 6 * 60, close: 23 * 60 + 59 }, // 桃園機場捷運：約 06:00～23:59
  TMRT: { open: 6 * 60, close: 24 * 60 },      // 台中捷運：約 06:00～24:00
  KRTC: { open: 6 * 60, close: 24 * 60 },      // 高雄捷運：約 06:00～24:00
};
export const METRO_LATE_MIN = 30;
/** 起訖 10 公里內都沒有捷運站＝這一帶沒有捷運：不說「捷運沒列入」 */
export const METRO_NA_M = 10000;
const hhmmOf = (min) => (min >= 24 * 60 ? '24:00' : toHHMM(min));
/**
 * 某系統在某時刻（當日分鐘，可超過 24 小時）：closed 已收班（first＝首班約幾點；首班前 1 小時內 notYet＝還沒發車）、late 末班快到了（last＝末班約幾點）、都不是回 {}
 * @returns {{ closed?: true, notYet?: true, first?: string, late?: true, last?: string }}
 */
export function metroHours(system, minute) {
  const h = METRO_HOURS[system] || METRO_HOURS.TRTC;
  const m = ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
  if (m >= h.close || m < h.open) return { closed: true, first: hhmmOf(h.open), ...(m < h.open && m >= h.open - 60 && { notYet: true }) };
  if (m >= h.close - METRO_LATE_MIN) return { late: true, last: hhmmOf(h.close) };
  return {};
}
/** 捷運路線名（代碼字首；各系統） */
/**
 * 各系統的估算參數（S7，依距離；⚠️ 真實以 TDX S2STravelTime／ODFare 為準）：每公里分鐘、進出站分鐘、等車分鐘、票價
 * 北捷：5 公里內 20 元、每 3 公里加 5 元（上限 65）；機捷：直達車快但班距長、票價高（台北車站到機場約 160 元）
 */
const METRO_EST = {
  TRTC: { perKm: 2, base: 2, wait: 4, fare: (km) => Math.min(65, 20 + 5 * Math.ceil(Math.max(0, km - 5) / 3)) },
  TYMC: { perKm: 1.1, base: 3, wait: 12, fare: (km) => Math.min(160, 30 + Math.round(km * 3.7)) },
  TMRT: { perKm: 1.8, base: 2, wait: 6, fare: (km) => Math.min(50, 20 + 5 * Math.ceil(Math.max(0, km - 2) / 3)) },
  KRTC: { perKm: 1.8, base: 2, wait: 6, fare: (km) => Math.min(60, 20 + 5 * Math.ceil(Math.max(0, km - 5) / 3)) },
};
const stLabel = (n) => (/站$/.test(String(n)) ? String(n) : `${n}站`); // 「台北車站」「北屯總站」不再接「站」

/**
 * 捷運（S7）：起訖點各自 1.2 公里內有捷運站（同一系統）；同一條線直達，不同線找轉乘站（同時在兩條線、繞最少的站）。
 * 時間與票價依距離估算並標示 estimated；走到站加起來太遠（≥ 直線 60%）不列。
 */
async function metroOption(svc, from, to, straight, depart) {
  if (straight < 1500 || straight > 60000) return null; // 太近、太遠（missingModes 說明）
  if (!svc.metro) return { none: { kind: 'none', why: '查不到捷運資料', whyEn: 'No MRT data' } };
  // 只看起點或目的地附近有路網的系統（台北的行程不必查高雄捷運的車站，冷快取時省 TDX 額度）
  const systems = Object.keys(METRO_LINE_NAME).filter((sys) => nearMetroArea(sys, from) || nearMetroArea(sys, to));
  if (!systems.length) return { none: { kind: 'na', why: '這一帶沒有捷運', whyEn: 'No MRT in this area' } };
  const lists = await Promise.allSettled(systems.map((sys) => svc.metro.stations({ system: sys })));
  if (lists.every((r) => r.status === 'rejected')) throw new Error('metro stations unavailable'); // 進 unavailable
  let best = null, same = false, nearest = Infinity;
  lists.forEach((r, i) => {
    const list = (r.status === 'fulfilled' ? r.value : []).filter((x) => Number.isFinite(x.lat));
    for (const x of list) nearest = Math.min(nearest, distanceM(from.lat, from.lon, x.lat, x.lon), distanceM(to.lat, to.lon, x.lat, x.lon));
    const near = (p) => list.map((x) => ({ ...x, m: distanceM(p.lat, p.lon, x.lat, x.lon) })).filter((x) => x.m <= 1200).sort((a, b) => a.m - b.m)[0];
    const o = near(from), d = near(to);
    if (o && d && o.name === d.name) same = true;
    if (!o || !d || o.name === d.name) return;
    if (!best || o.m + d.m < best.o.m + best.d.m) best = { sys: systems[i], list, o, d };
  });
  // 沒列入也要說原因（深夜 00:10 問 101 沒有捷運，使用者以為是 bug）
  // 沒有捷運的地方（起訖 10 公里內都沒有捷運站）：kind 'na'，不列入 missing（不要每趟都說「捷運沒列入」）
  if (!best) return { none: same ? { kind: 'near', why: '起點和目的地最近的捷運站是同一站', whyEn: 'Same MRT station at both ends' } : nearest > METRO_NA_M ? { kind: 'na', why: '這一帶沒有捷運', whyEn: 'No MRT in this area' } : { kind: 'none', why: '起點或目的地附近沒有捷運站', whyEn: 'No MRT station near the start or destination' } };
  const { sys, list, o, d } = best;
  if (o.m + d.m >= straight * 0.6 || o.m + d.m > 1500) { // 走到站太遠（比坐捷運還遠、或兩段直線加起來超過 1.5 公里，約走 25 分）
    const w = walkMinutes(o.m) + walkMinutes(d.m);
    return { none: { kind: 'none', why: `走到捷運站太遠（兩端加起來約走 ${w} 分）`, whyEn: `Too far to walk to the MRT stations (about ${w} min in total)` } };
  }
  // 營運時間（⚠️ 大約值，以各系統公告為準）：看走到站的時刻（23:59 出發走到站已過 24:00；05:50 出發 06:02 到站可搭）
  // 收班不列入並說首班時間（首班前 1 小時內說「還沒發車」）；接近末班列入但提醒
  const hours = depart ? metroHours(sys, depart.minute + walkMinutes(o.m)) : {};
  if (hours.closed) {
    return { skip: hours.notYet
      ? { role: 'metro', closed: true, notYet: true, first: hours.first, why: `捷運還沒發車（約 ${hours.first} 首班）`, whyEn: `The MRT hasn't started yet (first train around ${hours.first})` }
      : { role: 'metro', closed: true, first: hours.first, why: `捷運已收班（約 ${hours.first} 首班）`, whyEn: `The MRT has stopped for the night (first train around ${hours.first})` } };
  }
  const est = METRO_EST[sys];
  const lineName = (l) => METRO_LINE_NAME[sys]?.[l] || '捷運';
  const shared = (o.lines || []).find((l) => (d.lines || []).includes(l));
  let km = distanceM(o.lat, o.lon, d.lat, d.lon) / 1000;
  let via = null, pair = null;
  if (!shared) {
    // 轉乘站：同時有起站某條線與迄站某條線的站，繞最少的那個
    for (const t of list) {
      const a = (t.lines || []).find((l) => (o.lines || []).includes(l)), b = (t.lines || []).find((l) => (d.lines || []).includes(l));
      if (!a || !b || a === b) continue;
      const k = (distanceM(o.lat, o.lon, t.lat, t.lon) + distanceM(t.lat, t.lon, d.lat, d.lon)) / 1000;
      if (!via || k < via.k) via = { name: t.name, k, a, b };
    }
    if (via) { km = via.k; pair = [via.a, via.b]; } else pair = [o.lines?.[0], d.lines?.[0]];
  }
  const transfer = !shared;
  const w1 = walkMinutes(o.m), w2 = walkMinutes(d.m);
  const ride = Math.round(km * est.perKm + est.base + (transfer ? 5 : 0));
  const wait = est.wait + (transfer ? 3 : 0);
  const lines = shared ? lineName(shared) : `${lineName(pair[0])}轉${lineName(pair[1])}`;
  return {
    id: 'metro', role: 'metro', name: transfer ? `捷運（${lines}）` : `捷運 ${lines}`, minutes: w1 + wait + ride + w2, waitMin: wait, walkMin: w1 + w2,
    cost: est.fare(km), exposure: 0.1, effort: transfer ? 0.3 : 0.2, delayRisk: 0,
    legs: [
      leg('walk', from, o, w1, [`走到捷運${stLabel(o.name)}`, `Walk to MRT ${o.name}`]),
      leg('metro', o, d, ride, [`${lines}：${o.name} → ${d.name}${via ? `（在${stLabel(via.name)}轉乘）` : transfer ? '（轉乘一次）' : ''}`, `MRT ${o.name} → ${d.name}${via ? ` (change at ${via.name})` : transfer ? ' (one transfer)' : ''}`], 'transit'),
      leg('walk', d, to, w2, [`步行約 ${w2} 分`, `Walk about ${w2} min`]),
    ],
    notes: ['捷運時間與票價依距離估算（未含實際路網）', ...(transfer ? [`需轉乘一次${via ? `（在${stLabel(via.name)}）` : ''}，估算多 5 分`] : []), ...(hours.late ? [`末班快到了（約 ${hours.last} 前後，各站不同），早點出門；錯過可以叫車`] : [])],
    ...(hours.late && { lastTrain: true }),
    estimated: true,
    metro: { system: sys, from: o.name, to: d.name, lines, transfer, ...(via && { via: via.name }) },
  };
}

/**
 * 上車站的到站狀態（TDX StopStatus）代表這條路線現在不會來：不列入，原因照實說（2026-11-22 三峽→台北 101：推了今日未營運的路線）。
 * 1 尚未發車不算（等一下會來，只是時間不明，見 busOption 的 etaUnknown）。
 */
export const BUS_OFF = {
  2: { why: '這站交管不停靠（站牌即時資訊）', whyEn: 'not stopping here due to traffic control (live stop info)' },
  3: { why: '末班已過（站牌即時資訊）', whyEn: 'the last bus has left (live stop info)' },
  4: { why: '今天沒有營運（站牌即時資訊）', whyEn: 'not running today (live stop info)' },
};
/** 不列入的那條路線（卡片、決策圖「沒列入」：公車 X 沒列入：今天沒有營運） */
export const busOffEntry = (routeName, status) => ({ role: 'bus', kind: 'route', route: routeName, status, why: BUS_OFF[status].why, whyEn: BUS_OFF[status].whyEn });

async function busOption(svc, from, to, straight, risk, depart) {
  if (straight > LIMITS.busMaxM) return null;
  // 深夜（S10）：示範資料只能看時間；真實資料看上車站的到站狀態（BUS_OFF：2 交管不停靠、3 末班已過、4 今日未營運），全部不會來才不列入
  const m = depart ? depart.minute % (24 * 60) : null;
  const live = svc.mode === 'live';
  const night = m != null && m >= NIGHT.closedFrom && m < NIGHT.closedTo;
  if (!live && night) return { skip: busNightClosed(false) };
  const raw = await svc.bus.directTrips({ from, to });
  // svc.busOff：agent 選了公車後盯上車站，發現這條路線其實不會來（run.js execTools）→ 重排時照盯到的狀態排除
  const off = new Map((svc.busOff || []).filter((x) => BUS_OFF[x.status]).map((x) => [x.routeName, x.status]));
  const all = raw.map((t) => (off.has(t.routeName) ? { ...t, board: { ...t.board, status: off.get(t.routeName), etaSec: null } } : t));
  const est = live && fellBack('directTrips'); // TDX 額度用完：這次的公車是示範資料（沒有收班狀態），只能依時間估
  if (est && night) return { skip: busNightClosed(true) };
  const late = (!live || est) && m != null && m >= NIGHT.lateFrom;
  const list = all.filter((t) => !BUS_OFF[t.board?.status]);
  const dropped = all.filter((t) => BUS_OFF[t.board?.status]).map((t) => busOffEntry(t.routeName, t.board.status));
  // 站牌狀態：3 末班已過＝收班；4 今日未營運、2 交管不停靠不是深夜收班（不觸發深夜第一句）
  if (all.length && !list.length) {
    const has = (s) => all.some((t) => t.board?.status === s);
    const names = all.map((t) => t.routeName).join('、'); // 哪幾條（directTrips 最多 3 條）
    return { skip: has(3)
      ? { role: 'bus', closed: true, why: '附近直達的公車末班已過（站牌即時資訊），可以叫車或騎 YouBike', whyEn: 'The last direct bus has left (live stop info); try a taxi or YouBike' }
      : has(4) ? { role: 'bus', why: `附近直達的公車（${names}）今天沒有營運（站牌即時資訊）`, whyEn: `Direct buses nearby (${names}) are not running today (live stop info)` }
        : { role: 'bus', why: `附近直達的公車（${names}）這站交管不停靠（站牌即時資訊）`, whyEn: `Direct buses nearby (${names}) are not stopping here due to traffic control (live stop info)` } };
  }
  // TDX 額度用完：有些路線的到站資料查不到（directTrips 內部 routeEta 429），照實說，不說成「查不到直達公車」
  if (!list.length && raw.limited) return { none: { kind: 'none', why: 'TDX 額度用完，公車資料這次查不到（稍後再問一次）', whyEn: 'TDX quota used up; bus data unavailable this time (try again shortly)', fallback: 'tdx-limit' } };
  const opts = list.map((t) => {
    const w1 = walkMinutes(t.walkFromM), w2 = walkMinutes(t.walkToM);
    // 走到站牌前車子就來了 → 等下一班（不知道下一班時間，以 10 分估）
    const etaMin = t.board.etaSec != null ? Math.ceil(t.board.etaSec / 60) : null;
    // 到站時間不明（站牌沒有任何預估，或尚未發車）：不知道車什麼時候來，決策時不排在時間確定的大眾運輸前面（core/decide.js etaUnknown）
    const unknown = etaMin == null;
    const wait = unknown ? 10 : etaMin >= w1 ? etaMin - w1 : 10;
    const ride = Math.round(t.stops * EST.busMinPerStop);
    const waitNote = unknown
      ? (t.board.status === 1 ? `${t.board.name}：尚未發車，到站時間不明（等車以 10 分估）` : `${t.board.name}：到站時間不明（站牌沒有預估，等車以 10 分估）`)
      : etaMin < w1 ? '這班走到前就會開走，下一班到站時間不明，以 10 分估' : `${t.board.name} 約 ${etaMin} 分後到站`;
    return {
      id: `bus-${t.routeName}`, role: 'bus', name: `公車 ${t.routeName}`, minutes: w1 + wait + ride + w2, waitMin: wait, walkMin: w1 + w2,
      cost: EST.busFare, exposure: 0.2, effort: 0.2, delayRisk: risk,
      legs: [
        leg('walk', from, t.board, w1, [`走到 ${t.board.name}`, `Walk to ${t.board.name}`]),
        leg('bus', t.board, t.alight, ride, [`${t.routeName}（${t.label}）坐 ${t.stops} 站`, `Bus ${t.routeName}, ${t.stops} ${t.stops === 1 ? 'stop' : 'stops'}`], 'transit'),
        leg('walk', t.alight, to, w2, [`步行約 ${w2} 分`, `Walk about ${w2} min`]),
      ],
      notes: [waitNote, '票價以一段票 15 元估', ...(late ? ['末班快到了，早點出門；錯過可以叫車或騎 YouBike'] : [])],
      ...(late && { lastBus: true }),
      ...((unknown || etaMin < w1) && { estimated: true }),
      ...(unknown && { etaUnknown: true }),
      // 決策選公車時，agent 接著盯這條路線在上車站的即時到站（bus_route_eta 的 stop／direction）
      follow: { city: t.city, routeName: t.routeName, stop: t.board.name, ...(t.direction != null && { direction: t.direction }), walkMin: w1 },
    };
  });
  // 好幾條直達路線：到站時間確定的優先，再比總時間（「三峽-臺北市信義區」今日未營運時改列 939）
  const best = opts.sort((a, b) => (a.etaUnknown ? 1 : 0) - (b.etaUnknown ? 1 : 0) || a.minutes - b.minutes)[0];
  if (!best) return { none: { kind: 'none', why: '起點附近查不到直達目的地的公車', whyEn: 'No direct bus from near the start to the destination' } };
  return dropped.length ? { ...best, busOff: dropped } : best;
}

async function railOption(svc, system, from, to, straight, depart) {
  if (straight < LIMITS.railMinM) return null;
  const stations = (await (system === 'THSR' ? svc.rail.thsrStations() : svc.rail.traStations()))
    .map((s) => stationPoint(system, s.name)).filter(Boolean);
  const o = nearestStation(stations, from), d = nearestStation(stations, to);
  if (!o || !d) return { none: { kind: 'none', why: `起點或目的地 ${LIMITS.railAccessMaxM / 1000} 公里內沒有車站`, whyEn: `No station within ${LIMITS.railAccessMaxM / 1000} km of the start or destination` } };
  if (normName(o.name) === normName(d.name)) return { none: { kind: 'near', why: '起點和目的地最近的車站是同一站', whyEn: 'Same station at both ends' } };
  const a1 = access(from, o, o.d), a2 = access(d, to, d.d);
  const tt = await (system === 'THSR' ? svc.rail.thsrTimetable : svc.rail.traTimetable)({ from: o.name, to: d.name, date: depart.date });
  const ready = depart.minute + a1.minutes;
  const train = (tt.trains || []).filter((t) => toMin(t.depart) >= ready).sort((x, y) => toMin(x.depart) - toMin(y.depart))[0];
  if (!train) return { none: { kind: 'noService', why: '查不到趕得上的班次', whyEn: 'No train you can still catch today' } };
  const fares = await (system === 'THSR' ? svc.rail.thsrFare : svc.rail.traFare)({ from: o.name, to: d.name }).then((f) => f.fares).catch(() => []);
  const fare = fares.find((f) => f.adultOneWay && (!train.type || !f.trainType || f.trainType === train.type)) || fares.find((f) => f.adultOneWay);
  // 班次制：等太久就晚點出門，等車最多算 maxIdleWaitMin；抵達以實際班次計算
  const wait = Math.min(toMin(train.depart) - ready, EST.maxIdleWaitMin);
  const label = system === 'THSR' ? '高鐵' : `台鐵${train.type || ''}`;
  return {
    id: system.toLowerCase(), role: system.toLowerCase(), name: label,
    minutes: a1.minutes + wait + train.minutes + a2.minutes, waitMin: wait, walkMin: a1.walkMin + a2.walkMin,
    arriveMin: toMin(train.depart) + train.minutes + a2.minutes,
    cost: (fare?.price ?? 0) + a1.cost + a2.cost, exposure: 0.1, effort: 0.3, delayRisk: 0,
    legs: [a1.leg, leg(system.toLowerCase(), o, d, train.minutes, [`${label} ${train.trainNo} 次 ${train.depart} 開、${train.arrive} 到`, `${system === 'THSR' ? 'THSR' : 'Train'} ${train.trainNo}, departs ${train.depart}, arrives ${train.arrive}`], 'transit'), a2.leg],
    notes: [fare ? `${fare.trainType || fare.cabin || ''}成人單程 ${fare.price} 元` : '票價暫時查不到'],
    train: { trainNo: train.trainNo, depart: train.depart, arrive: train.arrive, from: o.name, to: d.name, date: depart.date },
    leaveAt: toHHMM(toMin(train.depart) - a1.minutes - wait), // 出門時間＝發車 − 到站 − 等車（卡片「提醒我出門」）
    ...((a1.estimated || a2.estimated || !fare) && { estimated: true }),
  };
}

async function intercityOption(svc, from, to, straight, depart) {
  if (straight < LIMITS.intercityMinM) return null;
  // 帶完整日期（台灣時間），出發日不是今天時客運班表才會用對的星期
  const r = await svc.intercity.trips({ from, to, departAt: `${depart.date}T${toHHMM(depart.minute)}` });
  const waitOf = (t) => toMin(t.depart) + (t.nextDay ? 24 * 60 : 0) - depart.minute - walkMinutes(t.walkFromM);
  const t = r.trains.find((x) => waitOf(x) >= 0); // 走到站牌還趕得上的第一班
  if (!t) return { none: { kind: 'noService', why: '查不到趕得上的直達班次', whyEn: 'No direct coach you can still catch today' } };
  const w1 = walkMinutes(t.walkFromM), w2 = walkMinutes(t.walkToM);
  const realWait = waitOf(t);
  const wait = Math.min(realWait, EST.maxIdleWaitMin);
  const ride = t.minutes + (t.delayMin || 0);
  const estFare = Math.round((roadKm(straight) * EST.intercityTwdPerKm) / 5) * 5;
  return {
    id: 'intercity', role: 'intercity', name: /^國道客運/.test(t.trainNo) ? t.trainNo : `國道客運 ${t.trainNo}`,
    minutes: w1 + wait + ride + w2, waitMin: wait, walkMin: w1 + w2, cost: t.fare ?? estFare,
    arriveMin: depart.minute + realWait + w1 + ride + w2,
    leaveAt: toHHMM(depart.minute + realWait - wait), // 出門時間＝發車 − 走到站牌 − 等車
    exposure: 0.2, effort: 0.3, delayRisk: r.delayRisk,
    // 客運站牌座標服務層沒有回傳：站牌點不附座標與導航
    legs: [
      leg('walk', from, { name: t.board, lat: null, lon: null }, w1, [`走到 ${t.board}（約 ${t.walkFromM} 公尺）`, `Walk to ${t.board} (about ${t.walkFromM} m)`]),
      leg('intercity', { name: t.board, lat: null, lon: null }, { name: t.alight, lat: null, lon: null }, ride, [`${t.trainNo} ${t.depart} 開${t.delayMin ? `，路上多 ${t.delayMin} 分` : ''}`, `${t.trainNo} departs ${t.depart}${t.delayMin ? `, about ${t.delayMin} min extra on the road` : ''}`], 'transit'),
      leg('walk', { name: t.alight, lat: null, lon: null }, to, w2, [`步行約 ${w2} 分`, `Walk about ${w2} min`]),
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
    legs: [{ ...leg('ridehail', from, to, drive, [`車程約 ${drive} 分（估算）`, `About ${drive} min by car (est.)`], 'driving'), url: link.url }],
    notes: [`車資 ${e.low}～${e.high} 元（${e.basis}）`, '叫車前需你確認（ridehail_link）'],
  };
}


/** 指定抵達時間時，最佳方案只早到這幾分鐘以內＝時間很緊 */
export const TIGHT_MIN = 10;
/** 計程車一輛最多坐幾人（超過要叫多輛） */
export const TAXI_SEATS = 4;
/** 多人叫車：車資換成每人分攤（cost、costRange 都是每人；share 留總額與車數） */
export function shareRide(o, party) {
  const cars = Math.ceil(party / TAXI_SEATS);
  const per = (n) => Math.round((n * cars) / party / 5) * 5;
  return {
    ...o, cost: per(o.cost), ...(o.costRange && { costRange: o.costRange.map(per) }),
    share: { party, cars, total: o.cost * cars },
    notes: [...(o.notes || []), `${party} 人${cars > 1 ? `、${cars} 輛車` : ''}分攤，每人約 ${per(o.cost)} 元`],
  };
}
/**
 * 規劃 A → B。
 * @param {object} svc createServices() 的結果
 * @param {{ from: { name, lat, lon }, to: { name, lat, lon }, departAt?: string, prefs?: { states?: string[], arriveBy?: string, party?: number, habit?: Record<string, number> }, now?: number }} p
 *   prefs.habit：手機記的常選比例（只在手機算好送來；沒指定方式、沒說狀況時小幅加分，ADR-0010）
 */
export async function planTrip(svc, { from, to, departAt, prefs = {}, now = Date.now() }) {
  const depart = departOf(departAt, now);
  const straight = distanceM(from.lat, from.lon, to.lat, to.lon);

  // 自動狀態：起點天氣、空品、沿途路況（失敗不加狀態、不中斷）
  const [weather, traffic, aqi] = await Promise.all([
    svc.weather.now({ lat: from.lat, lon: from.lon }).catch(() => null),
    svc.traffic.status({ from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon } }).catch(() => null),
    svc.life?.aqiNearby({ lat: from.lat, lon: from.lon }).catch(() => null),
  ]);
  const air = aqi?.nearest && aqi.nearest.distanceM <= AIR_MAX_M ? aqi.nearest : null; // 最近測站太遠（> 25 公里）不採用
  const party = Number.isInteger(prefs.party) && prefs.party >= 2 ? prefs.party : null;
  // 可能下雨：現在沒下、3 小時降雨機率 60～69%（≥ 70% 依 weather.js RAIN_POP 已算「下雨」狀態）
  const rainSoon = !weather?.raining && weather?.pop3h >= RAIN_SOON_POP;
  // 帶傘提醒：雨量站沒量到雨、但降雨機率 ≥ 60%（含已算「下雨」的 ≥ 70%）
  const umbrella = weather?.pop3h >= RAIN_SOON_POP && !(weather?.rainMm1h > 0);
  const autoStates = [
    ...(weather?.raining ? [{ key: 'rain', source: 'auto', from: 'weather_now', detail: weather.summary }] : []),
    ...(rainSoon ? [{ key: 'rainSoon', source: 'auto', from: 'weather_now', detail: `3 小時內降雨機率 ${weather.pop3h}%` }] : []),

    ...(air?.aqi > BAD_AIR_AQI ? [{ key: 'badAir', source: 'auto', from: 'aqi_nearby', detail: `${air.site}測站 AQI ${air.aqi}（${air.status}）` }] : []),
    ...(traffic?.level === 'jam' ? [{ key: 'traffic', source: 'auto', from: 'traffic_status', detail: `沿途國道塞車，多 ${traffic.delayMin} 分` }] : []),
  ];
  const risk = delayRiskOf(traffic?.covered ? traffic.level : null);

  const tasks = {
    walk: async () => walkOption(from, to, straight),
    bike: () => bikeOption(svc, from, to, straight),
    bus: () => busOption(svc, from, to, straight, risk, depart),
    metro: () => metroOption(svc, from, to, straight, depart),
    thsr: () => railOption(svc, 'THSR', from, to, straight, depart),
    tra: () => railOption(svc, 'TRA', from, to, straight, depart),
    intercity: () => intercityOption(svc, from, to, straight, depart),
    ridehail: () => ridehailOption(svc, from, to, straight, traffic),
  };
  const FAILED = Symbol('failed');
  const entries = Object.entries(tasks);
  const results = await Promise.all(entries.map(([, f]) => f().catch(() => FAILED)));
  const unavailable = entries.filter((_, i) => results[i] === FAILED).map(([k]) => k); // 依方案順序，結果穩定
  const byRole = Object.fromEntries(entries.map(([k], i) => [k, results[i] === FAILED ? 'failed' : results[i]]));
  // arriveMin：從出發日 00:00 起算的分鐘數（可超過 24 小時），跨午夜也能正確比較抵達時間
  // arriveMin：班次制方案以實際班次計算（已帶入），其餘＝出發＋總時間
  const skipped = results.filter((o) => o && o !== FAILED && o.skip).map((o) => o.skip); // 查了但不可行（例：目的地沒空位可還）
  const busOff = results.flatMap((o) => (o && o !== FAILED && o.busOff) || []); // 今天不會來的直達路線（BUS_OFF）：另一條照常列入時，卡片與決策圖說這條為什麼不在
  const options = results.filter((o) => o && o !== FAILED && !o.skip && !o.none).map(({ busOff: _off, ...o }) => { const am = o.arriveMin ?? depart.minute + o.minutes; return { ...o, arriveAt: toHHMM(am), arriveMin: am }; });
  if (party) for (const [i, o] of options.entries()) if (o.role === 'ridehail') options[i] = shareRide(o, party); // 多人：叫車用每人分攤比較（其他方式本來就是每人）
  // arriveBy 早於出發時間 → 視為隔天（例：23:00 出發、01:00 前到）
  const arriveByMin = prefs.arriveBy ? toMin(prefs.arriveBy) + (toMin(prefs.arriveBy) < depart.minute ? 24 * 60 : 0) : undefined;

  // 狀態（CARDS.md trip）：自動判斷在前，使用者說的（source: 'user'）在後，同一個 key 只留一筆
  const states = [...autoStates];
  for (const k of prefs.states || []) if (STATES[k] && !states.some((s) => s.key === k)) states.push({ key: k, source: 'user' });
  if (party) states.push({ key: 'group', source: 'user', detail: `${party} 人` }); // 人數是使用者說的（決策圖不能關：車資已是每人）
  const habit = prefs.habit && Object.keys(prefs.habit).length ? prefs.habit : null;
  // 習慣：使用者自己說了狀況（你說的）時以狀況為準；決策圖重算用同一條規則（狀態 source 不是 auto）
  const ctx = { states: states.map((s) => s.key), arriveBy: prefs.arriveBy, arriveByMin, mode: prefs.mode, avoid: prefs.avoid, habit, said: states.some((s) => s.source !== 'auto') };
  const r = decide(options, ctx);
  const ask = keyQuestion(options, ctx); // 答案取決於使用者（趕不趕、帶不帶行李…）時，畫面上問一句（決策圖；不交給模型）
  // 提醒（卡片與總結照列；數字都來自上面的資料）：kind＝tight 時間很緊、rain 帶傘（醒目、總結也說）、cost 多人分攤（卡片上）
  const bestOpt = options.find((o) => o.id === r.best?.id);
  const slack = arriveByMin != null && bestOpt ? arriveByMin - bestOpt.arriveMin : null;
  const tight = slack != null && slack >= 0 && slack < TIGHT_MIN;
  const ride = options.find((o) => o.role === 'ridehail');
  // 卡片上看得到叫車（建議或備案）、使用者也沒指定別的方式，才說分攤（「不要叫車」已被排除，不在 ranked）
  const rideShown = ride && r.ranked.slice(0, 3).some((o) => o.id === ride.id) && (!prefs.mode || prefs.mode === 'ridehail');
  const tips = [
    ...(tight ? [{ kind: 'tight', text: `時間很緊：預計 ${bestOpt.arriveAt} 抵達，比 ${prefs.arriveBy} 早到 ${slack} 分鐘，建議現在就出發` }] : []),
    ...(umbrella ? [{ kind: 'rain', text: `3 小時內降雨機率 ${weather.pop3h}%，記得帶傘` }] : []),
    ...(party && ride?.share && rideShown ? [{ kind: 'cost', text: `${party} 人叫車${ride.share.cars > 1 ? `要 ${ride.share.cars} 輛車，` : ''}共約 ${ride.share.total} 元，每人分攤約 ${ride.cost} 元` }] : []),
  ];
  // 判斷用到的資料（天氣、空品、路況）各自的值與影響：討論串、決策圖資料欄、模型文字共用（trip-considered.js）
  const considered = consideredOf({
    weather, aqi, traffic, today: depart.date === nowTW(now).date,
    demo: { weather: svc.weatherMode !== 'live' || Boolean(weather?.demo), air: svc.aqiMode !== 'live', traffic: svc.mode !== 'live' || Boolean(traffic?.demo) },
  }).map((c) => (c.source === 'traffic' && svc.mode === 'live' && traffic?.demo // TDX 額度用完改用示範資料（withTdxFallback）：這一行照實說
    ? { ...c, fallback: 'tdx-limit', text: `${c.text}（TDX 額度用完，這次先用示範資料）`, textEn: `${c.textEn} (TDX quota used up; demo data this time)` } : c));
  // 沒列入的方式與原因（任何時候都說：深夜 00:10 問 101 沒有公車和捷運，使用者以為是 bug）；太近、太遠是顯而易見的，不列
  const missingList = missingModes({ straight, roles: byRole, skipped, limits: LIMITS });
  const missing = [...missingList.filter((x) => !['near', 'far', 'na'].includes(x.kind)), ...busOff]; // busOff：{ role: 'bus', kind: 'route', route, status, why }
  // 深夜：公車、捷運收班或末班快到了，回答第一句就說（「現在 00:10，公車和捷運都收班了（捷運約 06:00 首班），先比走路、YouBike、叫車」）
  const tw = nowTW(now);
  const isNow = depart.date === tw.date && Math.abs(depart.minute - toMin(tw.hhmm)) <= 2;
  const night = nightOf({ skipped, options, departMin: depart.minute, isNow, single: options.length === 1 });
  // 只有一種方式：說明其他方式為什麼不在（太遠、附近沒有站、沒有趕得上的班次…）；深夜收班已由 night 說，不重複
  const single = singleNote({ options, missingList: night ? missingList.filter((x) => !(x.closed && night.closed.includes(x.role))) : missingList, straight, departMin: depart.minute, demo: svc.mode !== 'live', fallback: currentFallback(), toName: to.name, fromName: from.name }); // fallback：TDX 額度用完時公車、高鐵等可能是示範資料（withTdxFallback 逐個方法改用）
  return {
    from: pt(from), to: pt(to), straightKm: +(straight / 1000).toFixed(1),
    date: depart.date, departAt: toHHMM(depart.minute),
    best: r.best?.id ?? null, states,
    ...(prefs.arriveBy && { arriveBy: prefs.arriveBy, arriveByMin }), // 前端重算（決策圖）用同一份 decide.js
    ...((r.mode || r.modeUnavailable) && { mode: r.mode || r.modeUnavailable }), // 使用者指定的交通方式（前端重算也照這個）
    ...(r.modeUnavailable && { modeUnavailable: r.modeUnavailable }),
    ...(prefs.avoid?.length && { avoid: prefs.avoid }), // 使用者說不要的方式（前端重算也排除）
    ...(habit && { habit, habitOn: !!r.habitOn }),
    ...(ask && { ask }), // 關鍵問題（core/decide.js keyQuestion）
    weather: weather && { summary: weather.summary, raining: weather.raining, pop3h: weather.pop3h },
    traffic: traffic && { level: traffic.level, delayMin: traffic.delayMin, covered: traffic.covered },
    air: air ? { site: air.site, aqi: air.aqi, status: air.status } : null,
    considered,
    ...(single && { single }),
    options,
    ranking: {
      ranked: r.ranked.map((o) => ({ id: o.id, name: o.name, score: o.score, breakdown: o.breakdown, ...(o.notWorth && { notWorth: o.notWorth }), ...(o.tooLong && { tooLong: o.tooLong }), ...(o.unsure && { unsure: o.unsure }) })), // notWorth／tooLong／unsure：ADR-0010 2026-11-22
      excluded: r.excluded.map((o) => ({ id: o.id, name: o.name, why: o.why })),
      weights: r.weights, reason: r.reason,
    },
    ...(unavailable.length && { unavailable }),
    ...(skipped.length && { skipped }),
    ...(missing.length && { missing }), // 沒列入的方式（含 skipped）：{ role, kind, why, whyEn, closed? }；kind 'route'＝那一條公車路線（route、status）（卡片「沒列入」、決策圖）
    ...(night && { night }), // 深夜的一句（回答、討論串、卡片第一行）
    ...(party && { party }),
    ...(tight && { tight: { slackMin: slack } }),
    ...(tips.length && { tips }),
  };
}
