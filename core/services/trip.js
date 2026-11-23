// 行程規劃 plan_trip（docs/MCP_TOOLS.md §7、ADR-0010）：組合各服務產生候選方案 → 自動狀態 → decide() 排序。
// 只用 svc 的既有服務（live 與 mock 介面相同），不直接呼叫外部 API；任何一個來源失敗只略過該方案，不中斷規劃。
// 估算值（市區轉乘、叫車時間與車資、客運票價缺資料時）一律標 estimated，並在 notes 說明依據。
import { distanceM, toHHMM, toMin, normName, nowTW } from '../util.js';
import { walkMinutes, navLinks } from '../nav.js';
import { decide, keyQuestion, STATES } from '../decide.js';
import { departOf, delayRiskOf } from './intercity.js';
import { LANDMARKS, normPlace } from './places.js';
import { METRO_LINE_NAME, METRO_SYSTEMS, nearMetroArea } from './metro.js';
import { metroNetRoute } from './metro-net.js';
import { linkedSystems, stationKey } from '../metro-route.js';
import { currentFallback, fellBack } from '../metrics.js';
import { railDepMin } from '../rail-journeys.js';
import { traTrips } from './rail-trips.js';
import { consideredOf, missingModes, singleNote, nightOf, limitedOf, AIR_MAX_M, BAD_AIR_AQI, RAIN_SOON_POP } from './trip-considered.js';

export { AIR_MAX_M, BAD_AIR_AQI, RAIN_SOON_POP };

// ── 候選方案的距離門檻（直線） ──
export const LIMITS = {
  walkMaxM: 6000,        // 步行：6 公里內列出（> 3 公里通常排後）
  bikeMinM: 500, bikeMaxM: 12000, bikeRadiusM: 500, bikeReturnRadiusM: 800,
  busMaxM: 25000,
  railMinM: 30000,       // 高鐵：直線 > 30 公里
  traMinM: 0,            // 台鐵：不限距離（2026-11-22 產品負責人：時間久、麻煩的自然分數低，沒列出來會以為沒查）
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
  // 車速：道路 15 公里內市區 22 km/h；更遠的前 50 公里 55 km/h（進出市區、上下交流道），超過 50 公里的部分國道 95 km/h
  // （原本整段 55 km/h：台北→高雄叫車估成 418 分；改後台北→台中約 2 小時、台北→高雄約 4.5 小時，2026-11-23 交通健檢）
  carCityKmh: 22, carHighwayKmh: 55, carFreewayKmh: 95, carFreewayFromKm: 50, ridehailWaitMin: 6,
  // 自行開車（2026-11-22 產品負責人「交通方式還有應該是自行開車」）：油錢＝道路公里 × 每公里油耗 × 油價（約 2.6 元／公里，⚠️ 依車型不同）；
  // 停車：找車位約 5 分、停好走到目的地約 3 分；停車費約每小時 40 元（台北市路外停車場常見，⚠️ 以現場公告為準），最少 1 小時
  driveFuelTwdPerKm: 2.6, driveParkFindMin: 5, driveParkWalkMin: 3, driveParkTwdPerHour: 40,
  // 客運票價缺資料時（保守估算，ADR-0010 2026-11-22）：起跳 70 元＋道路公里 × 1.2 元（⚠️ 以業者公告為準）。
  // 原本道路公里 × 1.3 元把台北車站→機場的 1819（實際約 140 元）估成 50 元，便宜的假象讓它贏了機場捷運；
  // 起跳價對齊實際的短程國道客運（台北→機場約 140、台北→台中約 260～300、台北→高雄約 450～590）
  intercityBaseTwd: 70, intercityTwdPerKm: 1.2,
  stationWalkM: 1200,       // 到車站 1.2 公里內用走的
  maxIdleWaitMin: 10,       // 班次制（軌道、客運）：要等更久時視為晚一點出門，等車只算 10 分（時間＝從 leaveAt 出門起算）
};

// YouBike 2.0（台北市）：前 30 分 5 元（市府補助）、之後每 30 分 10 元
export const bikeFare = (min) => (min <= 30 ? 5 : 5 + Math.ceil((min - 30) / 30) * 10);

const roadKm = (m) => (m / 1000) * EST.roadFactor;
/** 開車（叫車、自己開車）的車程分鐘（不含塞車延誤）：km＝道路公里 */
export function carMinutes(km) {
  if (km < 15) return Math.round((km / EST.carCityKmh) * 60);
  const near = Math.min(km, EST.carFreewayFromKm), far = Math.max(0, km - EST.carFreewayFromKm);
  return Math.round((near / EST.carHighwayKmh + far / EST.carFreewayKmh) * 60);
}
/** 客運票價缺資料時的保守估算（起跳＋每公里；5 元為單位） */
export const intercityFareEst = (straightM) => Math.round((EST.intercityBaseTwd + roadKm(straightM) * EST.intercityTwdPerKm) / 5) * 5;

/**
 * TDX 額度用完（429）時 withTdxFallback 改用示範資料（core/index.js）：真實模式下，來自示範資料的方案**不參加排名、不推薦**
 * （2026-11-22 真實健檢：額度用完後推了「國道客運示範 A」「台鐵自強 只要等 1 分」、假的公車綠1 還問要不要到站提醒）。
 * 改成不列入（skipped），原因照實說；卡片「沒列入」、決策圖、模型都看得到。
 */
const LIMIT_WHAT = {
  bus: ['公車到站', 'bus arrivals'], intercity: ['客運班次', 'coach times'], thsr: ['高鐵班次', 'High Speed Rail times'], tra: ['台鐵班次', 'train times'],
  metro: ['捷運車站', 'MRT stations'], bike: [' YouBike 車輛與空位', 'YouBike availability'], // 前面空一格：「查不到 YouBike…」
};
export const limitSkip = (role) => ({
  role, fallback: 'tdx-limit',
  why: `TDX 額度用完，這次查不到${LIMIT_WHAT[role][0]}（稍後再問一次）`,
  whyEn: `TDX quota used up; couldn't get ${LIMIT_WHAT[role][1]} this time (try again shortly)`,
});
/** 這次 plan_trip 某個服務方法（bus.directTrips…）在真實模式下改用了示範資料 */
const demoOf = (svc, ...keys) => svc.mode === 'live' && keys.some((k) => fellBack(k));
const pt = (p) => ({ name: p.name, lat: p.lat, lon: p.lon });
/** detail 可以是 [中文, 英文]：英文提問的卡片用 detailEn（S12f；地名維持中文） */
const leg = (mode, from, to, minutes, detail, navMode = 'walking') => ({ mode, from: pt(from), to: pt(to), minutes, ...(Array.isArray(detail) ? { detail: detail[0], detailEn: detail[1] } : { detail }), nav: navLinks(to.lat, to.lon, navMode) });

// ── 車站座標：由內建地標對照（高鐵「高鐵○○站」或「○○車站」；台鐵「○○車站」） ──
const STATION_ITEMS = LANDMARKS.items.filter((x) => x.kind === 'station' && !/捷運/.test(x.name));
const keysOf = (x) => [x.name, ...x.aliases].map(normPlace);
/**
 * 鐵路票價查不到時的保守估算（兩站直線距離 × 每公里；⚠️ 大約值，以台鐵、高鐵公告為準）：
 * 高鐵標準車廂約每公里 5 元（台北→左營直線約 290 公里、實際 1490 元）；台鐵以自強號計約每公里 2.8 元（台北→高雄約 840 元），寧可估高、不要比實際便宜。
 */
export const RAIL_FARE_EST = { THSR: { perKm: 5, min: 40 }, TRA: { perKm: 2.8, min: 15 } };
export const railFareEst = (system, m) => { const r = RAIL_FARE_EST[system] || RAIL_FARE_EST.TRA; return Math.max(r.min, Math.round((m / 1000) * r.perKm / 5) * 5); };
/**
 * 鐵路車站 → 座標：車站清單（TDX StationPosition、示範資料）有座標就用；沒有才用內建地標對照（stationPoint）。
 * 原本只用地標對照，地標沒收的站（鶯歌、樹林、新烏日、新左營…）整個不能用：台中車站到高鐵台中站沒有台鐵、三峽繞到桃園（2026-11-23 交通健檢）。
 */
export function railPoint(system, s) {
  const lat = Number(s?.lat), lon = Number(s?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat && lon) return { name: s.name, lat, lon };
  return stationPoint(system, s?.name);
}
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
  if (demoOf(svc, 'bike.nearby')) return { skip: limitSkip('bike') }; // 示範的借車站、空位不推
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
      '車資以 YouBike 2.0 臺北市費率估算（前 30 分 5 元；各縣市費率不同）', // 不說成「依台北市費率」：在台中、高雄騎也這樣說（2026-11-23 交通健檢）
    ],
  };
}

/**
 * 深夜（台灣時間）：示範資料 00:00～05:00 公車不列入、23:00 後提醒末班（S10）；真實資料改看到站狀態。
 * TDX 額度用完、公車這次改用示範資料（withTdxFallback）時，示範資料沒有收班狀態，也依時間估並照實說。
 */
export const NIGHT = { closedFrom: 0, closedTo: 5 * 60, lateFrom: 23 * 60 };
/** 公車深夜收班（依時間估）；est＝真實模式但這次公車是示範資料（TDX 額度用完）；later＝出發時間不是現在（站牌即時資訊用不到，依出發時間估） */
const busNightClosed = (est, later = false) => ({
  role: 'bus', closed: true,
  why: est ? '深夜多數公車已收班（TDX 額度用完，這次依時間估；以站牌即時資訊為準）' : later ? '深夜多數公車已收班（依出發時間估；以站牌即時資訊為準）' : '深夜多數公車已收班（以站牌即時資訊為準）',
  whyEn: est ? 'Most buses have stopped for the night (estimated from the time: TDX quota used up; check the stop for live info)' : later ? 'Most buses have stopped for the night (estimated from the departure time; check the stop for live info)' : 'Most buses have stopped for the night (check the stop for live info)',
  ...(est && { estimated: true, fallback: 'tdx-limit' }),
  ...(later && !est && { estimated: true }),
});
/**
 * 出發時間離現在超過這麼多分鐘：站牌的即時到站與狀態（末班已過、尚未發車、交管不停靠）是「現在」的，不套到那時候
 * （2026-11-23 交通健檢：23:30 問明天 08:00 的公車，說「末班已過」不列入）。改依時間估、到站時間不明（etaUnknown）。
 */
export const BUS_LIVE_AHEAD_MIN = 15;

/**
 * 捷運營運時間（台灣時間的當日分鐘；S10 深夜）。⚠️ 大約值，以各系統公告為準：首班約 06:00；末班依站與方向不同（多在 24:00 前後從端點發車）。
 * 捷運沒有「末班已過」的即時狀態可看，真實資料與示範資料都用這張表：收班時段不列入（說明首班時間）、收班前 METRO_LATE_MIN 分鐘列入但提醒末班。
 */
export const METRO_HOURS = {
  TRTC: { open: 6 * 60, close: 24 * 60 },      // 台北捷運：約 06:00～24:00
  TYMC: { open: 6 * 60, close: 23 * 60 + 59 }, // 桃園機場捷運：約 06:00～23:59
  TMRT: { open: 6 * 60, close: 24 * 60 },      // 台中捷運：約 06:00～24:00
  KRTC: { open: 6 * 60, close: 24 * 60 },      // 高雄捷運：約 06:00～24:00
  NTMC: { open: 6 * 60, close: 24 * 60 },      // 新北捷運（三鶯線、環狀線）：約 06:00～24:00
  NTDLRT: { open: 6 * 60, close: 24 * 60 },    // 淡海輕軌
  NTALRT: { open: 6 * 60, close: 24 * 60 },    // 安坑輕軌
  KLRT: { open: 7 * 60, close: 22 * 60 },      // 高雄輕軌：約 07:00～22:00
};
export const METRO_LATE_MIN = 30;
/** 路線彼此不相通的營運單位：每條線分開算（三鶯線 LB 與環狀線 Y 只能在頂埔、大坪林等站轉台北捷運） */
const METRO_SPLIT_LINES = new Set(['NTMC']);
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
  NTMC: { perKm: 2, base: 2, wait: 6, fare: (km) => Math.min(65, 20 + 5 * Math.ceil(Math.max(0, km - 5) / 3)) },
  NTDLRT: { perKm: 2.5, base: 1, wait: 10, fare: (km) => Math.min(35, 20 + 5 * Math.ceil(Math.max(0, km - 5) / 3)) },
  NTALRT: { perKm: 2.5, base: 1, wait: 10, fare: (km) => Math.min(35, 20 + 5 * Math.ceil(Math.max(0, km - 5) / 3)) },
  KLRT: { perKm: 2.5, base: 1, wait: 12, fare: () => 30 },
};
const stLabel = (n) => (/站$/.test(String(n)) ? String(n) : `${n}站`); // 「台北車站」「北屯總站」不再接「站」
/** 走到捷運站的上限（直線公尺）：超過就算「附近沒有捷運站」 */
export const METRO_WALK_M = 1200;
/**
 * 接駁到捷運站（2026-11-22 產品負責人：捷運為何總是沒列入——三峽最近的頂埔站 5.8 公里，以前一律不列）：
 * 走不到的站 8 公里內用「公車／YouBike 接駁」估算（市區速度、等車、一段票），組成「接駁＋捷運」方案；標 estimated。
 */
export const METRO_ACCESS_M = 8000;
/** 到捷運站／離開捷運站：1.2 公里內走路，否則公車或 YouBike 接駁（估算） */
function metroAccess(fromP, toP, d, toStation) {
  if (d <= METRO_WALK_M) {
    const m = walkMinutes(d);
    return { minutes: m, walkMin: m, cost: 0, est: false, leg: leg('walk', fromP, toP, m, toStation ? [`走到捷運${stLabel(toP.name)}`, `Walk to MRT ${toP.name}`] : [`步行約 ${m} 分`, `Walk about ${m} min`]) };
  }
  const m = Math.round((roadKm(d) / EST.cityKmh) * 60) + EST.cityWaitMin;
  const name = toStation ? toP.name : fromP.name;
  return { minutes: m, walkMin: 4, cost: EST.cityFare, est: true,
    leg: leg('transit', fromP, toP, m, toStation ? [`坐公車或騎 YouBike 到捷運${stLabel(name)}，約 ${m} 分（估算）`, `Bus or YouBike to MRT ${name}, about ${m} min (est.)`] : [`出站後坐公車或騎 YouBike，約 ${m} 分（估算）`, `Bus or YouBike from MRT ${name}, about ${m} min (est.)`], 'transit') };
}
/** 接駁要花的分鐘（挑站用） */
const accessMin = (m) => (m <= METRO_WALK_M ? walkMinutes(m) : Math.round((roadKm(m) / EST.cityKmh) * 60) + EST.cityWaitMin);
/**
 * 機場捷運直達車（⚠️ 大約值，以桃園捷運公告為準）：台北車站 ↔ 機場第一航廈約 35 分、第二航廈約 38 分，單程 160 元，約 15 分一班（等車以半個班距估）。
 * 這一段用公告的固定參數，不用距離估算（原本估成 58 分 136 元，輸給票價也是估的客運；2026-11-22 真實健檢 z01）。
 */
export const AIRPORT_EXPRESS = { hub: '台北車站', stops: { 機場第一航廈: 35, 機場第二航廈: 38 }, fare: 160, waitMin: 8 };
/** 起訖兩站是機場捷運直達車的「台北車站 ↔ 機場航廈」：回 { ride, fare, wait }；不是回 null */
export function airportExpress(sys, a, b) {
  if (sys !== 'TYMC') return null;
  const n = (x) => normName(x);
  const hub = n(AIRPORT_EXPRESS.hub);
  const term = Object.entries(AIRPORT_EXPRESS.stops).find(([k]) => [n(a), n(b)].includes(n(k)));
  if (!term || ![n(a), n(b)].includes(hub)) return null;
  return { ride: term[1], fare: AIRPORT_EXPRESS.fare, wait: AIRPORT_EXPRESS.waitMin };
}
const km1 = (m) => (m / 1000).toFixed(1);
const SYSTEM_EN = { TRTC: 'Taipei Metro', TYMC: 'Taoyuan Airport MRT', TMRT: 'Taichung MRT', KRTC: 'Kaohsiung MRT', NTMC: 'New Taipei Metro', NTDLRT: 'Danhai LRT', NTALRT: 'Ankeng LRT', KLRT: 'Kaohsiung LRT' };
/**
 * 捷運沒列入的原因照實說（2026-11-22 真實健檢：三峽、桃園出發說「起點或目的地附近沒有捷運站」，使用者以為捷運壞了）：
 * 哪一端 1.2 公里內沒有捷運站、最近的是哪一站多遠；兩端都有站但不同系統（高鐵桃園站的機場捷運 → 台北捷運）說跨系統還沒列入比較。
 * ⚠️「公車／台鐵接捷運」的組合還沒做（docs/PLAN.md 待辦）。
 */
function metroNone(nearFrom, nearTo, closeFrom, closeTo) {
  const far = (c) => (c ? `（最近的是${stLabel(c.name)}，約 ${km1(c.m)} 公里）` : '');
  const farEn = (c) => (c ? ` (nearest: ${c.name}, about ${km1(c.m)} km)` : '');
  if (!nearFrom && !nearTo) return { kind: 'none', why: `起點和目的地 ${km1(METRO_WALK_M)} 公里內都沒有捷運站`, whyEn: `No MRT station within ${km1(METRO_WALK_M)} km of the start or the destination` };
  if (!nearFrom) return { kind: 'none', why: `起點 ${km1(METRO_WALK_M)} 公里內沒有捷運站${far(closeFrom)}`, whyEn: `No MRT station within ${km1(METRO_WALK_M)} km of the start${farEn(closeFrom)}` };
  if (!nearTo) return { kind: 'none', why: `目的地 ${km1(METRO_WALK_M)} 公里內沒有捷運站${far(closeTo)}`, whyEn: `No MRT station within ${km1(METRO_WALK_M)} km of the destination${farEn(closeTo)}` };
  const a = METRO_SYSTEMS[nearFrom.sys], b = METRO_SYSTEMS[nearTo.sys];
  return { kind: 'none', why: `起點附近是${a}、目的地附近是${b}，跨系統轉乘還沒列入比較`, whyEn: `The start is on the ${SYSTEM_EN[nearFrom.sys]} and the destination on the ${SYSTEM_EN[nearTo.sys]}; cross-system transfers aren't compared yet` };
}

/**
 * 同一個路網裡 o → d 怎麼坐（同系統方案與跨系統的每一段共用）：同一條線直達；不同線找轉乘站（同時有起站某條線與迄站某條線、繞最少的那個）。
 * @returns {{ shared: string|undefined, via: { name: string, k: number, a: string, b: string }|null, km: number, names: string[], lines: string, transfer: boolean }}
 */
function lineRoute(sys, list, o, d, fallback = '捷運') {
  const lineName = (l) => METRO_LINE_NAME[sys]?.[l] || fallback;
  const shared = (o.lines || []).find((l) => (d.lines || []).includes(l));
  let km = distanceM(o.lat, o.lon, d.lat, d.lon) / 1000;
  let via = null, pair = null;
  if (!shared) {
    for (const t of list) {
      const a = (t.lines || []).find((l) => (o.lines || []).includes(l)), b = (t.lines || []).find((l) => (d.lines || []).includes(l));
      if (!a || !b || a === b) continue;
      const k = (distanceM(o.lat, o.lon, t.lat, t.lon) + distanceM(t.lat, t.lon, d.lat, d.lon)) / 1000;
      if (!via || k < via.k) via = { name: t.name, k, a, b };
    }
    if (via) { km = via.k; pair = [via.a, via.b]; } else pair = [o.lines?.[0], d.lines?.[0]];
  }
  const names = shared ? [lineName(shared)] : pair.map(lineName);
  return { shared, via, km, transfer: !shared, names, lines: names.join('轉') };
}

/**
 * 捷運（S7）：起訖點各自 1.2 公里內有捷運站（同一系統）；同一條線直達，不同線找轉乘站（同時在兩條線、繞最少的站）。
 * 時間與票價依距離估算並標示 estimated；走到站加起來太遠（≥ 直線 60%）不列。
 */
/** 跨系統轉乘的捷運方案（估算；轉乘多算 5 分）；收班時不列（回 null 交給同系統或「沒列入」） */
function crossMetroOption(from, to, straight, c, depart) {
  const { A, B, t, tb } = c;
  if (A.o.m + B.d.m >= straight * 0.6) return null;
  const a1 = metroAccess(from, A.o, A.o.m, true), a2 = metroAccess(B.d, to, B.d.m, false);
  if (depart && (metroHours(A.sys, depart.minute + a1.minutes).closed || metroHours(B.sys, depart.minute + a1.minutes + 20).closed)) return null;
  const eA = METRO_EST[A.sys] || METRO_EST.TRTC, eB = METRO_EST[B.sys] || METRO_EST.TRTC;
  // 每一段各自找線與轉乘站（2026-11-23 交通健檢：三峽→台北 101 說「在頂埔站轉淡水信義線：頂埔 → 台北101」，頂埔是板南線，還要在台北車站再轉一次）
  const rA = lineRoute(A.sys, A.list, A.o, t, METRO_SYSTEMS[A.sys]), rB = lineRoute(B.sys, B.list, tb, B.d, METRO_SYSTEMS[B.sys]);
  // 機場捷運直達車（台北車站 ↔ 機場航廈）：用公告的時間、票價、等車（跟同系統方案一致，不用距離估算）
  const xA = airportExpress(A.sys, A.o.name, t.name), xB = airportExpress(B.sys, tb.name, B.d.name);
  const rideA = xA ? xA.ride : Math.round(rA.km * eA.perKm + eA.base + (rA.transfer ? 5 : 0));
  const rideB = (xB ? xB.ride : Math.round(rB.km * eB.perKm + eB.base + (rB.transfer ? 5 : 0))) + 5;
  const wait = (xA ? xA.wait : eA.wait + (rA.transfer ? 3 : 0)) + (xB ? xB.wait : eB.wait + (rB.transfer ? 3 : 0));
  const fed = a1.est || a2.est;
  const nA = rA.lines, nB = rB.lines;
  const [vA, vAEn] = rA.via ? [`（在${stLabel(rA.via.name)}轉${rA.names[1]}）`, ` (change at ${rA.via.name})`] : ['', ''];
  // 第二段也要轉乘：「在頂埔站轉板南線，到台北車站再轉淡水信義線：頂埔 → 台北101／世貿」
  const [cB, cBEn] = rB.via ? [`在${stLabel(t.name)}轉${rB.names[0]}，到${stLabel(rB.via.name)}再轉${rB.names[1]}`, `Change at ${t.name}, then at ${rB.via.name}`] : [`在${stLabel(t.name)}轉${nB}`, `Change at ${t.name}`];
  const transfers = 1 + (rA.transfer ? 1 : 0) + (rB.transfer ? 1 : 0);
  const stops = [...(rA.via ? [rA.via.name] : []), t.name, ...(rB.via ? [rB.via.name] : [])];
  return {
    id: 'metro', role: 'metro', name: `捷運（${nA}轉${nB}）${a1.est ? `（先到${stLabel(A.o.name)}）` : ''}`,
    minutes: a1.minutes + wait + rideA + rideB + a2.minutes, waitMin: wait, walkMin: a1.walkMin + a2.walkMin,
    cost: (xA ? xA.fare : eA.fare(rA.km)) + (xB ? xB.fare : eB.fare(rB.km)) + a1.cost + a2.cost, exposure: fed ? 0.2 : 0.1, effort: 0.35 + (fed ? 0.1 : 0) + (transfers > 1 ? 0.05 : 0), delayRisk: fed ? 0.1 : 0,
    transfers: transfers + (a1.est ? 1 : 0) + (a2.est ? 1 : 0),
    legs: [
      a1.leg,
      leg('metro', A.o, t, rideA, [`${nA}：${A.o.name} → ${t.name}${vA}`, `${A.o.name} → ${t.name}${vAEn}`], 'transit'),
      leg('metro', tb, B.d, rideB, [`${cB}：${tb.name} → ${B.d.name}`, `${cBEn}: ${tb.name} → ${B.d.name}`], 'transit'),
      a2.leg,
    ],
    notes: [
      ...(xA || xB ? [`機場捷運直達車約 ${(xA || xB).ride} 分、${(xA || xB).fare} 元，約 15 分一班（依公告，以實際班次為準）`] : []),
      '捷運時間與票價依距離估算（未含實際路網）',
      `跨系統轉乘（在${stLabel(t.name)}），估算多 5 分`,
      ...(transfers > 1 ? [`共轉乘 ${transfers} 次（${stops.map(stLabel).join('、')}），每次轉乘估算多 5 分`] : []),
      ...(fed ? ['接駁到捷運站的時間與票價是估算（公車或 YouBike，以實際為準）'] : []),
    ],
    estimated: true, est: { minutes: true },
    metro: { system: A.sys, systems: [A.sys, B.sys], from: A.o.name, to: B.d.name, lines: `${nA}轉${nB}`, transfer: true, via: t.name, ...(transfers > 1 && { vias: stops }), crossSystem: true, ...(fed && { feeder: { from: a1.est, to: a2.est } }) },
  };
}

/**
 * 真實路網的捷運方案（S7b，2026-11-23）：上下車站照舊挑（接駁最省的站），中間怎麼坐改用各線車站順序算（core/metro-route.js）——
 * 坐哪幾條線、往哪、幾站、在哪轉；時間依站數估（每站約 2 分、轉乘 5 分）＋進出站與等車；票價用 ODFare（同系統一張票、跨系統分段相加）。
 * 拿不到路網（額度、示範資料不完整）就回 null，呼叫端照舊依距離估算。
 * @param {object} c { oSt, dSt, a1, a2, depart, pointOf } oSt／dSt＝上下車站（含 sys、lat、lon、m）、a1／a2＝接駁（metroAccess）、pointOf＝站名 → 座標
 */
async function networkMetroOption(svc, from, to, straight, c) {
  const { oSt, dSt, a1, a2, depart, pointOf } = c;
  // 到站比坐捷運還遠、或兩端都走路但加起來超過 1.5 公里：交給原本的判斷說原因
  if (oSt.m + dSt.m >= straight * 0.6 || (oSt.m <= METRO_WALK_M && dSt.m <= METRO_WALK_M && oSt.m + dSt.m > 1500)) return null;
  let net;
  try { net = await metroNetRoute(svc.metro, { from: oSt.name, to: dSt.name, systems: linkedSystems(oSt.sys, dSt.sys), onlyStored: true }); } catch { return null; } // 只用已存的路網與票價：不在這一次多花 TDX 額度
  if (!net) return null;
  const systems = [...new Set(net.legs.map((l) => l.system))];
  // 營運時間：每個系統都看（走到站的時刻起；後面的系統多算前面坐的時間）
  if (depart) {
    let t = depart.minute + a1.minutes;
    for (const l of net.legs) { if (metroHours(l.system, t).closed) return null; t += l.minutes + 5; }
  }
  const est = METRO_EST[oSt.sys] || METRO_EST.TRTC;
  const fed = a1.est || a2.est;
  const ride = Math.round(net.minutes + est.base);
  const wait = est.wait + 3 * net.transfers;
  const kmOf = (l) => { const p = pointOf(l.from, l.system), q = pointOf(l.to, l.system); return p && q ? distanceM(p.lat, p.lon, q.lat, q.lon) / 1000 : l.stops; };
  const fare = net.fare ?? net.legs.reduce((sum, l) => sum + (METRO_EST[l.system] || METRO_EST.TRTC).fare(kmOf(l)), 0); // 查不到 ODFare：各段依距離估
  const names = net.legs.map((l) => l.line);
  const lines = names.join('轉');
  const vias = net.legs.slice(1).map((l) => l.from);
  const towardZh = (l) => (l.toward ? `往${l.toward}` : `下一站${l.next}`);
  const towardEn = (l) => (l.toward ? `toward ${l.towardEn || l.toward}` : `next stop ${l.nextEn || l.next}`);
  const metroLegs = net.legs.map((l, i) => leg('metro', pointOf(l.from, l.system) || (i === 0 ? oSt : dSt), pointOf(l.to, l.system) || dSt, Math.round(l.minutes + (i === 0 ? est.base : TRANSFER_PENALTY)),
    [`${i ? `在${stLabel(l.from)}轉` : ''}${l.line}（${towardZh(l)}）：${l.from} → ${l.to}，${l.stops} 站`, `${i ? `Change at ${l.fromEn || l.from}: ` : ''}${l.lineEn || l.line} ${towardEn(l)}: ${l.fromEn || l.from} → ${l.toEn || l.to}, ${l.stops} stops`], 'transit'));
  const hours = depart ? metroHours(oSt.sys, depart.minute + a1.minutes) : {};
  return {
    id: 'metro', role: 'metro', name: `${net.transfers ? `捷運（${lines}）` : `捷運 ${lines}`}${a1.est ? `（先到${stLabel(oSt.name)}）` : ''}`,
    minutes: a1.minutes + wait + ride + a2.minutes, waitMin: wait, walkMin: a1.walkMin + a2.walkMin,
    cost: fare + a1.cost + a2.cost, exposure: fed ? 0.2 : 0.1, effort: (net.transfers ? 0.3 : 0.2) + (net.transfers > 1 ? 0.05 : 0) + (fed ? 0.1 : 0), delayRisk: fed ? 0.1 : 0,
    transfers: net.transfers + (a1.est ? 1 : 0) + (a2.est ? 1 : 0),
    legs: [a1.leg, ...metroLegs, a2.leg],
    notes: [
      ...(fed ? ['接駁到捷運站的時間與票價是估算（公車或 YouBike，以實際為準）'] : []),
      `捷運路線依各線車站順序規劃；時間依站數估算（每站約 2 分${net.transfers ? '、每次轉乘約 5 分' : ''}）`,
      ...(net.fare == null ? ['捷運票價查不到，依距離估算'] : systems.length > 1 ? ['跨系統票價分段相加，實際可能有轉乘優惠'] : []),
      ...(net.transfers ? [`轉乘 ${net.transfers} 次（${vias.map(stLabel).join('、')}）`] : []),
      ...(hours.late ? [`末班快到了（約 ${hours.last} 前後，各站不同），早點出門；錯過可以叫車`] : []),
    ],
    ...(hours.late && { lastTrain: true }),
    estimated: true, ...(fed && { est: { minutes: true } }),
    metro: {
      system: oSt.sys, ...(systems.length > 1 && { systems, crossSystem: true }), from: oSt.name, to: dSt.name, lines, transfer: net.transfers > 0,
      ...(vias[0] && { via: vias[0] }), ...(vias.length > 1 && { vias }), network: true, ...(net.fare != null && { fare: net.fare }),
      ...(fed && { feeder: { from: a1.est, to: a2.est } }),
    },
  };
}
const TRANSFER_PENALTY = 5;
/** 挑上下車站時，估算的接駁（公車／YouBike 到捷運站）每段多算幾分（不確定性） */
const FEEDER_DOUBT_MIN = 10;

async function metroOption(svc, from, to, straight, depart) {
  if (straight < 1500 || straight > 60000) return null; // 太近、太遠（missingModes 說明）
  if (!svc.metro) return { none: { kind: 'none', why: '查不到捷運資料', whyEn: 'No MRT data' } };
  // 只看起點或目的地附近有路網的系統（台北的行程不必查高雄捷運的車站，冷快取時省 TDX 額度）
  const systems = Object.keys(METRO_LINE_NAME).filter((sys) => nearMetroArea(sys, from) || nearMetroArea(sys, to));
  if (!systems.length) return { none: { kind: 'na', why: '這一帶沒有捷運', whyEn: 'No MRT in this area' } };
  const lists = await Promise.allSettled(systems.map((sys) => svc.metro.stations({ system: sys })));
  if (lists.every((r) => r.status === 'rejected')) throw new Error('metro stations unavailable'); // 進 unavailable
  if (demoOf(svc, 'metro.stations')) return { skip: limitSkip('metro') }; // 示範的車站清單不完整，不拿來推薦或說「附近沒有捷運站」
  let best = null, same = false, nearest = Infinity, nearFrom = null, nearTo = null, closeFrom = null, closeTo = null;
  const per = []; // 各路網：起訖最近、接駁得到的站（跨系統轉乘用）
  // 同一個營運單位但路線不相通（新北捷運的三鶯線與環狀線）：每條線當一個路網，靠同名站轉乘
  const nets = lists.flatMap((r, i) => {
    const all = (r.status === 'fulfilled' ? r.value : []).filter((x) => Number.isFinite(x.lat));
    if (!METRO_SPLIT_LINES.has(systems[i])) return [{ sys: systems[i], net: systems[i], list: all }];
    const by = new Map();
    for (const x of all) { const l = x.lines?.[0] || ''; if (!by.has(l)) by.set(l, []); by.get(l).push(x); }
    return [...by].map(([l, list]) => ({ sys: systems[i], net: `${systems[i]}:${l}`, list }));
  });
  // 站名 → 座標（真實路網方案的每一段起訖用；轉乘站可能在另一個系統的清單裡）
  const pointOf = (name, sys) => { const k = stationKey(name); const hit = (x) => stationKey(x.name) === k; return (nets.find((n) => n.sys === sys)?.list.find(hit)) || nets.flatMap((n) => n.list).find(hit) || null; };
  nets.forEach(({ sys, net, list }) => {
    const dist = (p) => list.map((x) => ({ ...x, sys, m: distanceM(p.lat, p.lon, x.lat, x.lon) })).sort((a, b) => a.m - b.m)[0];
    const cf = dist(from), ct = dist(to);
    if (cf && (!closeFrom || cf.m < closeFrom.m)) closeFrom = cf;
    if (ct && (!closeTo || ct.m < closeTo.m)) closeTo = ct;
    nearest = Math.min(nearest, cf?.m ?? Infinity, ct?.m ?? Infinity);
    const wo = cf && cf.m <= METRO_WALK_M ? cf : null, wd = ct && ct.m <= METRO_WALK_M ? ct : null;
    if (wo && (!nearFrom || wo.m < nearFrom.m)) nearFrom = wo;
    if (wd && (!nearTo || wd.m < nearTo.m)) nearTo = wd;
    const o = cf && cf.m <= METRO_ACCESS_M ? cf : null, d = ct && ct.m <= METRO_ACCESS_M ? ct : null; // 走不到的站：公車／YouBike 接駁（metroAccess）
    per.push({ sys, net, list, o, d });
    if (o && d && o.name === d.name) same = true;
    if (!o || !d || o.name === d.name) return;
    const score = accessMin(o.m) + accessMin(d.m) + (distanceM(o.lat, o.lon, d.lat, d.lon) / 1000) * 2;
    if (!best || score < best.score) best = { sys, list, o, d, score };
  });
  // 跨系統轉乘（2026-11-22：三鶯線三峽 → 頂埔轉板南線；淡海輕軌 ↔ 紅樹林；安坑輕軌 ↔ 十四張）：兩個系統有同名的站就能轉
  let cross = null;
  for (const A of per) for (const B of per) {
    if (A.net === B.net || !A.o || !B.d) continue;
    for (const t of A.list) {
      const tb = B.list.find((x) => normName(x.name) === normName(t.name));
      // 轉乘站就是起站或訖站：等於只坐一個系統（同系統的 best 已經算過），不重複收兩段基本票價
      if (!tb || normName(t.name) === normName(A.o.name) || normName(tb.name) === normName(B.d.name)) continue;
      const kA = distanceM(A.o.lat, A.o.lon, t.lat, t.lon) / 1000, kB = distanceM(tb.lat, tb.lon, B.d.lat, B.d.lon) / 1000;
      const score = accessMin(A.o.m) + accessMin(B.d.m) + (kA + kB) * 2 + 8;
      if (!cross || score < cross.score) cross = { A, B, t, tb, kA, kB, score };
    }
  }
  // 真實路網（已存才有）：同系統與跨系統兩組上下車站都算，取比較快的（三峽老街：走到三鶯線三峽站，比坐公車到頂埔快）
  const real = async (oSt, dSt) => networkMetroOption(svc, from, to, straight, { oSt, dSt, a1: metroAccess(from, oSt, oSt.m, true), a2: metroAccess(dSt, to, dSt.m, false), depart, pointOf });
  const realCross = cross ? await real({ ...cross.A.o, sys: cross.A.sys }, { ...cross.B.d, sys: cross.B.sys }) : null;
  // 機場捷運直達車照公告參數（下面原本的算法），不用路網估
  const realBest = best && !airportExpress(best.sys, best.o.name, best.d.name) ? await real({ ...best.o, sys: best.sys }, { ...best.d, sys: best.sys }) : null;
  // 比快慢時，接駁（公車／YouBike）是估的、也不知道有沒有直達的公車：每段多算 FEEDER_DOUBT_MIN 分，差不多時選全程坐捷運
  const doubt = (o) => o.minutes + FEEDER_DOUBT_MIN * ((o.metro?.feeder?.from ? 1 : 0) + (o.metro?.feeder?.to ? 1 : 0));
  const fastest = [realCross, realBest].filter(Boolean).sort((x, y) => doubt(x) - doubt(y))[0];
  if (fastest) return fastest;
  if (cross && (!best || cross.score < best.score)) {
    const opt = crossMetroOption(from, to, straight, cross, depart);
    if (opt) return opt;
  }
  // 沒列入也要說原因（深夜 00:10 問 101 沒有捷運，使用者以為是 bug）；哪一端沒有、最近的站多遠，照實說（metroNone）
  // 沒有捷運的地方（起訖 10 公里內都沒有捷運站）：kind 'na'，不列入 missing（不要每趟都說「捷運沒列入」）
  if (!best) return { none: same && !cross ? { kind: 'near', why: '起點和目的地最近的捷運站是同一站', whyEn: 'Same MRT station at both ends' } : nearest > METRO_NA_M ? { kind: 'na', why: '這一帶沒有捷運', whyEn: 'No MRT in this area' } : metroNone(nearFrom, nearTo, closeFrom, closeTo) };
  const { sys, list, o, d } = best;
  const walkBoth = o.m <= METRO_WALK_M && d.m <= METRO_WALK_M;
  if (o.m + d.m >= straight * 0.6 || (walkBoth && o.m + d.m > 1500)) { // 到站比坐捷運還遠；或兩端都走路但加起來超過 1.5 公里（約走 25 分）
    const w = accessMin(o.m) + accessMin(d.m);
    return { none: { kind: 'none', why: `到捷運站太遠（兩端加起來約 ${w} 分）`, whyEn: `Too far to reach the MRT stations (about ${w} min in total)` } };
  }
  const a1 = metroAccess(from, o, o.m, true), a2 = metroAccess(d, to, d.m, false);
  // 營運時間（⚠️ 大約值，以各系統公告為準）：看走到站的時刻（23:59 出發走到站已過 24:00；05:50 出發 06:02 到站可搭）
  // 收班不列入並說首班時間（首班前 1 小時內說「還沒發車」）；接近末班列入但提醒
  const hours = depart ? metroHours(sys, depart.minute + a1.minutes) : {};
  if (hours.closed) {
    return { skip: hours.notYet
      ? { role: 'metro', closed: true, notYet: true, first: hours.first, why: `捷運還沒發車（約 ${hours.first} 首班）`, whyEn: `The MRT hasn't started yet (first train around ${hours.first})` }
      : { role: 'metro', closed: true, first: hours.first, why: `捷運已收班（約 ${hours.first} 首班）`, whyEn: `The MRT has stopped for the night (first train around ${hours.first})` } };
  }
  const est = METRO_EST[sys];
  const express = airportExpress(sys, o.name, d.name); // 機場捷運直達車：公告的固定參數（不是距離估算）
  const { via, km, transfer, lines } = lineRoute(sys, list, o, d);
  const w1 = a1.minutes, w2 = a2.minutes;
  const fed = a1.est || a2.est; // 有接駁（不是走路到站）
  const ride = express ? express.ride : Math.round(km * est.perKm + est.base + (transfer ? 5 : 0));
  const wait = express ? express.wait : est.wait + (transfer ? 3 : 0);
  return {
    id: 'metro', role: 'metro', name: `${transfer ? `捷運（${lines}）` : `捷運 ${lines}`}${a1.est ? `（先到${stLabel(o.name)}）` : ''}`, minutes: w1 + wait + ride + w2, waitMin: wait, walkMin: a1.walkMin + a2.walkMin,
    cost: (express ? express.fare : est.fare(km)) + a1.cost + a2.cost, exposure: fed ? 0.2 : 0.1, effort: (transfer ? 0.3 : 0.2) + (fed ? 0.1 : 0), delayRisk: fed ? 0.1 : 0,
    legs: [
      a1.leg,
      leg('metro', o, d, ride, [`${lines}：${o.name} → ${d.name}${via ? `（在${stLabel(via.name)}轉乘）` : transfer ? '（轉乘一次）' : ''}`, `MRT ${o.name} → ${d.name}${via ? ` (change at ${via.name})` : transfer ? ' (one transfer)' : ''}`], 'transit'),
      a2.leg,
    ],
    notes: [...(fed ? ['接駁到捷運站的時間與票價是估算（公車或 YouBike，以實際為準）'] : []), express ? `機場捷運直達車約 ${express.ride} 分、${express.fare} 元，約 15 分一班（依公告，以實際班次為準）` : '捷運時間與票價依距離估算（未含實際路網）', ...(transfer ? [`需轉乘一次${via ? `（在${stLabel(via.name)}）` : ''}，估算多 5 分`] : []), ...(hours.late ? [`末班快到了（約 ${hours.last} 前後，各站不同），早點出門；錯過可以叫車`] : [])],
    ...(hours.late && { lastTrain: true }),
    // 直達車用公告的時間與票價（只有等車以半個班距估）；其餘依距離與票價規則估算（跟公車「每站 1.5 分」同一種規則估算，不另外扣分，core/decide.js UNCERTAIN）
    ...((!express || fed) && { estimated: true }),
    ...(fed && { est: { minutes: true } }), // 接駁時間是估的：決策時保守看（core/decide.js UNCERTAIN）
    metro: { system: sys, from: o.name, to: d.name, lines, transfer, ...(via && { via: via.name }), ...(fed && { feeder: { from: a1.est, to: a2.est } }) },
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

async function busOption(svc, from, to, straight, risk, depart, { aheadMin = 0, sameDay = true } = {}) {
  if (straight > LIMITS.busMaxM) return null;
  // 深夜（S10）：示範資料只能看時間；真實資料看上車站的到站狀態（BUS_OFF：2 交管不停靠、3 末班已過、4 今日未營運），全部不會來才不列入
  const m = depart ? depart.minute % (24 * 60) : null;
  // 真實資料、晚一點才出發（BUS_LIVE_AHEAD_MIN）：站牌即時資訊是現在的，不拿來判斷那時候——跟示範資料一樣依時間估
  // （示範資料的到站時間本來就是固定的模擬值，照舊；固定 OD 測試 trip-od.test.js 依賴）
  const later = svc.mode === 'live' && aheadMin > BUS_LIVE_AHEAD_MIN;
  const live = svc.mode === 'live' && !later;
  const night = m != null && m >= NIGHT.closedFrom && m < NIGHT.closedTo;
  if (!live && night) return { skip: busNightClosed(false, later) };
  const raw0 = await svc.bus.directTrips({ from, to });
  // 晚一點出發：今天沒營運（4）只在同一天還算數；其餘狀態與到站時間都不套用（到站時間不明，依出發時才看站牌）
  const raw = later ? Object.assign(raw0.map((t) => ({ ...t, board: { ...t.board, etaSec: null, status: t.board?.status === 4 && sameDay ? 4 : null } })), { limited: raw0.limited }) : raw0;
  // svc.busOff：agent 選了公車後盯上車站，發現這條路線其實不會來（run.js execTools）→ 重排時照盯到的狀態排除（晚一點出發不盯，也不套用）
  const off = new Map((later ? [] : svc.busOff || []).filter((x) => BUS_OFF[x.status]).map((x) => [x.routeName, x.status]));
  const all = raw.map((t) => (off.has(t.routeName) ? { ...t, board: { ...t.board, status: off.get(t.routeName), etaSec: null } } : t));
  // TDX 額度用完：這次的公車是示範資料——不推假的路線與到站時間（不列入，原因照實說）；深夜照舊依時間說收班
  if (demoOf(svc, 'bus.directTrips')) return { skip: night ? busNightClosed(true) : limitSkip('bus') };
  const late = !live && m != null && m >= NIGHT.lateFrom;
  const list = all.filter((t) => !BUS_OFF[t.board?.status]);
  const dropped = all.filter((t) => BUS_OFF[t.board?.status]).map((t) => busOffEntry(t.routeName, t.board.status));
  // 站牌狀態：3 末班已過＝收班；4 今日未營運、2 交管不停靠不是深夜收班（不觸發深夜第一句）
  if (all.length && !list.length) {
    const has = (s) => all.some((t) => t.board?.status === s);
    const names = all.map((t) => t.routeName).join('、'), namesEn = all.map((t) => t.routeName).join(', '); // 哪幾條（directTrips 最多 3 條）
    return { skip: has(3)
      ? { role: 'bus', closed: true, why: '附近直達的公車末班已過（站牌即時資訊），可以叫車或騎 YouBike', whyEn: 'The last direct bus has left (live stop info); try a taxi or YouBike' }
      : has(4) ? { role: 'bus', why: `附近直達的公車（${names}）今天沒有營運（站牌即時資訊）`, whyEn: `Direct buses nearby (${namesEn}) are not running today (live stop info)` }
        : { role: 'bus', why: `附近直達的公車（${names}）這站交管不停靠（站牌即時資訊）`, whyEn: `Direct buses nearby (${namesEn}) are not stopping here due to traffic control (live stop info)` } };
  }
  // TDX 額度用完：有些路線的到站資料查不到（directTrips 內部 routeEta 429），照實說，不說成「查不到直達公車」
  if (!list.length && raw.limited) return { skip: limitSkip('bus') };
  const opts = list.map((t) => {
    const w1 = walkMinutes(t.walkFromM), w2 = walkMinutes(t.walkToM);
    // 走到站牌前車子就來了 → 等下一班（不知道下一班時間，以 10 分估）
    const etaMin = t.board.etaSec != null ? Math.ceil(t.board.etaSec / 60) : null;
    // 到站時間不明（站牌沒有任何預估，或尚未發車）：不知道車什麼時候來，決策時不排在時間確定的大眾運輸前面（core/decide.js etaUnknown）
    const unknown = etaMin == null;
    // 尚未發車但站牌有預估（依班表推的）：照預估算，說法跟公車卡片一致「尚未發車（預估約 N 分後到）」（2026-11-22 真實健檢 x07）
    const notYet = !unknown && t.board.status === 1;
    const missed = !unknown && etaMin < w1;
    const wait = unknown || missed ? 10 : etaMin - w1;
    const ride = Math.round(t.stops * EST.busMinPerStop);
    const waitNote = unknown
      ? later ? `${toHHMM(depart.minute)} 才出發：到站時間以那時的站牌資訊為準（等車以 10 分估）`
      : (t.board.status === 1 ? `${t.board.name}：尚未發車，到站時間不明（等車以 10 分估）` : `${t.board.name}：到站時間不明（站牌沒有預估，等車以 10 分估）`)
      : missed ? '這班走到前就會開走，下一班到站時間不明，以 10 分估'
        : notYet ? `${t.board.name}：尚未發車，預估約 ${etaMin} 分後到站（發車後以即時資料為準）` : `${t.board.name} 約 ${etaMin} 分後到站`;
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
      ...((unknown || missed || notYet) && { estimated: true }),
      ...((missed || notYet) && { est: { minutes: wait } }), // 等車是估的：決策時這幾分保守看（時間不明另由 etaUnknown 處理，不重複扣）
      ...(unknown && { etaUnknown: true }),
      // 決策選公車時，agent 接著盯這條路線在上車站的即時到站（bus_route_eta 的 stop／direction）；晚一點才出發不盯（現在的到站跟那時無關）
      ...(!later && { follow: { city: t.city, routeName: t.routeName, stop: t.board.name, ...(t.direction != null && { direction: t.direction }), walkMin: w1 } }),
    };
  });
  // 好幾條直達路線：到站時間確定的優先，再比總時間（「三峽-臺北市信義區」今日未營運時改列 939）
  const best = opts.sort((a, b) => (a.etaUnknown ? 1 : 0) - (b.etaUnknown ? 1 : 0) || a.minutes - b.minutes)[0];
  if (!best) return { none: { kind: 'none', why: '起點附近查不到直達目的地的公車', whyEn: 'No direct bus from near the start to the destination' } };
  return dropped.length ? { ...best, busOff: dropped } : best;
}

async function railOption(svc, system, from, to, straight, depart) {
  if (straight < (system === 'THSR' ? LIMITS.railMinM : LIMITS.traMinM)) return null;
  const role = system.toLowerCase(); // thsr、tra（也是 rail 服務方法的字首：rail.thsrTimetable）
  const stations = (await (system === 'THSR' ? svc.rail.thsrStations() : svc.rail.traStations()))
    .map((s) => railPoint(system, s)).filter(Boolean);
  if (demoOf(svc, `rail.${role}Stations`)) return { skip: limitSkip(role) }; // 示範的車站清單：不拿來挑站（也省下查時刻表的額度）
  const o = nearestStation(stations, from), d = nearestStation(stations, to);
  if (!o || !d) return { none: { kind: 'none', why: `起點或目的地 ${LIMITS.railAccessMaxM / 1000} 公里內沒有車站`, whyEn: `No station within ${LIMITS.railAccessMaxM / 1000} km of the start or destination` } };
  if (normName(o.name) === normName(d.name)) return { none: { kind: 'near', why: '起點和目的地最近的車站是同一站', whyEn: 'Same station at both ends' } };
  const a1 = access(from, o, o.d), a2 = access(d, to, d.d);
  // 台鐵市區短程（8 公里內）或車站不順路（到站的路加起來比這段路的六成還遠）：照樣列出讓分數決定，但不查時刻表（省 TDX 額度），時間與票價估算
  if (system === 'TRA' && straight < LIMITS.railMinM && (straight < TRA_EST.queryMinM || o.d + d.d >= straight * 0.6)) {
    if (!traEstRunning(depart.minute + a1.minutes)) return { none: { kind: 'noService', why: `這個時間台鐵沒有車（約 ${toHHMM(TRA_EST.open)}～${toHHMM(TRA_EST.close)} 有車）`, whyEn: `No trains at this hour (about ${toHHMM(TRA_EST.open)}–${toHHMM(TRA_EST.close)})` } };
    return traEstOption(o, d, a1, a2);
  }
  // 台鐵含要換車的走法（支線小站沒有直達車；core/services/rail-trips.js）
  const tt = system === 'THSR' ? await svc.rail.thsrTimetable({ from: o.name, to: d.name, date: depart.date }) : await traTrips(svc, { from: o.name, to: d.name, date: depart.date });
  if (demoOf(svc, `rail.${role}Timetable`)) return { skip: limitSkip(role) }; // 示範的班次不推
  const ready = depart.minute + a1.minutes;
  // 過午夜的末班車（班表上 00:09、00:18）是前一天發的車：算成 24:09，深夜出發才看得到（2026-11-23 交通健檢）
  const depMin = (t) => railDepMin(t.depart);
  // 趕得上的班次裡最早到的（同時到：換車少的、晚開的）；原本取最早開的，慢車先開時會選到比較晚到的那班
  const arrMin = (t) => depMin(t) + t.minutes;
  const train = (tt.trains || []).filter((t) => depMin(t) >= ready)
    .sort((x, y) => arrMin(x) - arrMin(y) || (x.transfers || 0) - (y.transfers || 0) || depMin(y) - depMin(x))[0];
  if (!train && tt.transfersUnavailable && !tt.trains?.length) return { none: { kind: 'none', why: '沒有直達車，換車的班次暫時查不到（稍後再問一次）', whyEn: "No direct train, and trips with a change of train can't be checked right now" } };
  if (!train) return { none: { kind: 'noService', why: '查不到趕得上的班次', whyEn: 'No train you can still catch today' } };
  const dep = depMin(train);
  const fares = await (system === 'THSR' ? svc.rail.thsrFare : svc.rail.traFare)({ from: o.name, to: d.name }).then((f) => (demoOf(svc, `rail.${role}Fare`) ? [] : f.fares)).catch(() => []); // 示範的票價不用：照「票價暫時查不到」
  const fareType = train.fareType || train.type; // 換車：取最高等那段的車種（rail-trips.js fareTypeOf）
  const fare = fares.find((f) => f.adultOneWay && (!fareType || !f.trainType || f.trainType === fareType)) || fares.find((f) => f.adultOneWay);
  // 票價查不到：不當 0 元（會變成最便宜而勝出），依兩站直線距離保守估（RAIL_FARE_EST）
  const estFare = fare ? null : railFareEst(system, distanceM(o.lat, o.lon, d.lat, d.lon));
  // 班次制：等太久就晚點出門，等車最多算 maxIdleWaitMin；抵達以實際班次計算
  const realWait = dep - ready;
  const wait = Math.min(realWait, EST.maxIdleWaitMin);
  const label = system === 'THSR' ? '高鐵' : train.via?.length ? `台鐵（${train.via.join('、')}換車）` : `台鐵${train.type || ''}`;
  const lw = longWaitOf(realWait, wait, train.depart);
  return {
    id: system.toLowerCase(), role: system.toLowerCase(), name: label,
    minutes: a1.minutes + wait + train.minutes + a2.minutes, waitMin: wait, walkMin: a1.walkMin + a2.walkMin,
    arriveMin: dep + train.minutes + a2.minutes,
    cost: (fare?.price ?? estFare) + a1.cost + a2.cost, exposure: 0.1, effort: 0.3, delayRisk: 0,
    legs: [a1.leg, ...(train.legs?.length ? transferLegsOf(train, stations, o, d) : [leg(system.toLowerCase(), o, d, train.minutes, [`${label} ${train.trainNo} 次 ${train.depart} 開、${train.arrive} 到`, `${system === 'THSR' ? 'THSR' : 'Train'} ${train.trainNo}, departs ${train.depart}, arrives ${train.arrive}`], 'transit')]), a2.leg],
    notes: [...(lw ? [lw.note] : []), ...(train.via?.length ? [`要在${train.via.join('、')}換車（依台鐵定期時刻表推算，以當天公告為準）`] : []), fare ? `${fare.trainType || fare.cabin || ''}成人單程 ${fare.price} 元` : `票價暫時查不到，約 ${estFare} 元（依距離估，以${system === 'THSR' ? '高鐵' : '台鐵'}公告為準）`],
    ...(train.via?.length && { rail: { transfers: train.transfers, via: train.via } }),
    ...(lw && { longWait: lw.longWait }),
    // 訂票：直達訂整段；換車時訂第一段（區間車那段不用訂位，卡片照樣可開訂票頁）
    train: train.legs?.length
      ? { trainNo: train.legs[0].trainNo, depart: train.legs[0].depart, arrive: train.legs[0].arrive, from: train.legs[0].from, to: train.legs[0].to, date: depart.date }
      : { trainNo: train.trainNo, depart: train.depart, arrive: train.arrive, from: o.name, to: d.name, date: depart.date },
    leaveAt: toHHMM(dep - a1.minutes - wait), // 出門時間＝發車 − 到站 − 等車（卡片「提醒我出門」）
    ...((a1.estimated || a2.estimated || !fare) && { estimated: true }),
    // 票價查不到（估的）：決策時保守看（core/decide.js UNCERTAIN）。到站、離站的市區轉乘時間是規則估算（每一種跨城方式都有），不另外扣
    ...(!fare && { est: { cost: true } }),
  };
}

/** 換車的每一段 → 行程的分段（換車站座標由車站清單取；查不到座標時用起訖站，卡片仍照段列出） */
function transferLegsOf(train, stations, o, d) {
  const at = (name) => stations.find((s) => normName(s.name) === normName(name)) || null;
  return train.legs.map((l, i) => {
    const a = i === 0 ? o : at(l.from) || o, b = i === train.legs.length - 1 ? d : at(l.to) || d;
    const ride = Math.max(1, railDepMin(l.arrive) - railDepMin(l.depart));
    return leg('tra', a, b, ride, [`台鐵${l.type || ''} ${l.trainNo} 次 ${l.from} ${l.depart} 開、${l.to} ${l.arrive} 到${i < train.legs.length - 1 ? `，在${l.to}換車` : ''}`, `Train ${l.trainNo}, ${l.from} ${l.depart} → ${l.to} ${l.arrive}${i < train.legs.length - 1 ? `, change at ${l.to}` : ''}`], 'transit');
  });
}

/**
 * 台鐵估算（短程、不查時刻表）：區間車平均 45 km/h、等車約 10 分；票價依距離估。
 * 約 05:00～隔天 00:30 有車（⚠️ 大約值，各站首末班不同；這段時間外不列估算的台鐵）。
 * 原本 05:30～23:30：23:45 說沒有車，其實 23:55、00:09、00:18 都還有車（2026-11-23 交通健檢）；close 是過午夜的分鐘數
 */
export const TRA_EST = { kmh: 45, waitMin: 10, queryMinM: 8000, open: 5 * 60, close: 30 };
/** 這個時刻（當日分鐘，可超過 24 小時）估算的台鐵有沒有車 */
export function traEstRunning(minute) {
  const at = ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
  return TRA_EST.close < TRA_EST.open ? !(at > TRA_EST.close && at < TRA_EST.open) : at >= TRA_EST.open && at <= TRA_EST.close;
}
export { RAIL_AFTER_MIDNIGHT, railDepMin } from '../rail-journeys.js'; // 鐵路班表過午夜的班次算成 24:xx（與換車走法共用）
/**
 * 等很久（超過 LONG_WAIT_MIN）才有班次（深夜要等首班）：班次制等車只算 maxIdleWaitMin（當作晚點出門），
 * 但現在就要走時不能假裝只等 10 分——標 longWait（真正要等幾分、幾點才開），決策用抵達時間比（core/decide.js effMinutes），卡片說「首班 05:24」。
 * 2026-11-23 交通健檢：01:00 台北→新竹推了 06:41 才到的台鐵，叫車 02:38 就到。
 */
export const LONG_WAIT_MIN = 60;
function longWaitOf(realWait, wait, departHHMM) {
  if (!(realWait > LONG_WAIT_MIN)) return null;
  const h = Math.floor(realWait / 60), m = realWait % 60;
  const span = h ? `${h} 小時${m ? ` ${m} 分` : ''}` : `${m} 分`;
  return {
    longWait: { min: realWait, extra: realWait - wait, first: departHHMM },
    // 清晨開的那班（深夜問）＝首班車
    note: `${toMin(departHHMM) < 9 * 60 ? '首班' : '下一班'} ${departHHMM} 才開，現在出發要等約 ${span}`,
  };
}
function traEstOption(o, d, a1, a2) {
  const m = distanceM(o.lat, o.lon, d.lat, d.lon);
  const ride = Math.max(3, Math.round((m * EST.roadFactor / 1000) / TRA_EST.kmh * 60));
  const fare = railFareEst('TRA', m);
  return {
    id: 'tra', role: 'tra', name: '台鐵（估算）',
    minutes: a1.minutes + TRA_EST.waitMin + ride + a2.minutes, waitMin: TRA_EST.waitMin, walkMin: a1.walkMin + a2.walkMin,
    cost: fare + a1.cost + a2.cost, exposure: 0.1, effort: 0.35, delayRisk: 0.05,
    legs: [a1.leg, leg('tra', o, d, ride, [`台鐵：${o.name} → ${d.name}（約 ${ride} 分，班次以台鐵為準）`, `TRA: ${o.name} → ${d.name} (about ${ride} min; check the timetable)`], 'transit'), a2.leg],
    notes: [`車站離起點或目的地有點遠，沒查時刻表：時間與票價約 ${fare} 元是估算（以台鐵公告為準）`],
    estimated: true, est: { minutes: true, cost: true },
  };
}

async function intercityOption(svc, from, to, straight, depart) {
  if (straight < LIMITS.intercityMinM) return null;
  // 帶完整日期（台灣時間），出發日不是今天時客運班表才會用對的星期
  const r = await svc.intercity.trips({ from, to, departAt: `${depart.date}T${toHHMM(depart.minute)}` });
  if (demoOf(svc, 'intercity.trips')) return { skip: limitSkip('intercity') }; // 「國道客運示範 A」不推
  const waitOf = (t) => toMin(t.depart) + (t.nextDay ? 24 * 60 : 0) - depart.minute - walkMinutes(t.walkFromM);
  const t = r.trains.find((x) => waitOf(x) >= 0); // 走到站牌還趕得上的第一班
  if (!t) return { none: { kind: 'noService', why: '查不到趕得上的直達班次', whyEn: 'No direct coach you can still catch today' } };
  const w1 = walkMinutes(t.walkFromM), w2 = walkMinutes(t.walkToM);
  const realWait = waitOf(t);
  const wait = Math.min(realWait, EST.maxIdleWaitMin);
  const lw = longWaitOf(realWait, wait, t.depart);
  const fakeRoad = demoOf(svc, 'traffic.status'); // 路況是示範資料（額度用完）：不加假的塞車延誤
  const delayMin = fakeRoad ? 0 : t.delayMin || 0;
  const ride = t.minutes + delayMin;
  const estFare = intercityFareEst(straight);
  return {
    id: 'intercity', role: 'intercity', name: /^國道客運/.test(t.trainNo) ? t.trainNo : `國道客運 ${t.trainNo}`,
    minutes: w1 + wait + ride + w2, waitMin: wait, walkMin: w1 + w2, cost: t.fare ?? estFare,
    arriveMin: depart.minute + realWait + w1 + ride + w2,
    leaveAt: toHHMM(depart.minute + realWait - wait), // 出門時間＝發車 − 走到站牌 − 等車
    exposure: 0.2, effort: 0.3, delayRisk: fakeRoad ? delayRiskOf(null) : r.delayRisk,
    // 客運站牌座標服務層沒有回傳：站牌點不附座標與導航
    legs: [
      leg('walk', from, { name: t.board, lat: null, lon: null }, w1, [`走到 ${t.board}（約 ${t.walkFromM} 公尺）`, `Walk to ${t.board} (about ${t.walkFromM} m)`]),
      leg('intercity', { name: t.board, lat: null, lon: null }, { name: t.alight, lat: null, lon: null }, ride, [`${t.trainNo} ${t.depart} 開${delayMin ? `，路上多 ${delayMin} 分` : ''}`, `${t.trainNo} departs ${t.depart}${delayMin ? `, about ${delayMin} min extra on the road` : ''}`], 'transit'),
      leg('walk', { name: t.alight, lat: null, lon: null }, to, w2, [`步行約 ${w2} 分`, `Walk about ${w2} min`]),
    ],
    ...(lw && { longWait: lw.longWait }),
    notes: [...(lw ? [lw.note] : []), t.fare != null ? `票價 ${t.fare} 元` : `票價暫無資料，約 ${estFare} 元（起跳 ${EST.intercityBaseTwd} 元＋道路公里 × ${EST.intercityTwdPerKm} 元估，以業者公告為準）`, ...(t.estimated ? ['抵達時間依距離估算'] : [])],
    ...((t.fare == null || t.estimated) && { estimated: true }),
    ...((t.fare == null || t.estimated) && { est: { ...(t.fare == null && { cost: true }), ...(t.estimated && { minutes: ride }) } }), // 決策時估算值保守看（core/decide.js UNCERTAIN）：票價整個、時間只算車程
  };
}

/** 自行開車（估算）：開車時間同叫車的車程（含國道塞車延誤）＋找車位、走到目的地；花費＝油錢＋停車費（停 1 小時估）。
 *  有目的地附近停車場資料時（svc.parking）：開到有空位的那一個，走過去的時間照距離算，卡片列出停車場與剩幾位 */
/** 停車場最多等多久（毫秒） */
export const PARKING_WAIT_MS = 2500;

async function driveOption(svc, from, to, straight, traffic) {
  const km = roadKm(straight);
  let timer;
  const pk = await Promise.race([svc.parking?.nearby({ lat: to.lat, lon: to.lon }).catch(() => null), new Promise((r) => { timer = setTimeout(() => r(null), PARKING_WAIT_MS); })]).finally(() => clearTimeout(timer)); // 停車場查不到不影響開車方案
  const lots = demoOf(svc, 'parking.nearby') && svc.mode === 'live' ? [] : (pk?.lots || []); // 額度用完的示範停車場不推
  const lot = lots.find((l) => l.available !== 0 && !l.full) || null;
  const drive = carMinutes(km) + (traffic?.delayMin || 0);
  const fuel = Math.max(5, Math.round((km * EST.driveFuelTwdPerKm) / 5) * 5);
  const park = EST.driveParkTwdPerHour;
  const walk = lot ? walkMinutes(lot.distanceM) : EST.driveParkWalkMin;
  const find = lot?.available != null ? 2 : EST.driveParkFindMin; // 知道有空位：直接開進去
  return {
    id: 'drive', role: 'drive', name: '自己開車',
    minutes: drive + find + walk, waitMin: 0, walkMin: walk,
    cost: fuel + park, exposure: 0.05, effort: 0.25, delayRisk: delayRiskOf(traffic?.level ?? null),
    legs: lot ? [
      leg('drive', from, lot, drive, [`開車到「${lot.name}」約 ${drive} 分（估算${traffic?.delayMin ? `，含塞車多 ${traffic.delayMin} 分` : ''}）`, `About ${drive} min driving to ${lot.name} (est.${traffic?.delayMin ? `, incl. ${traffic.delayMin} min of traffic` : ''})`], 'driving'),
      leg('walk', lot, to, find + walk, [`停車${lot.available != null ? `（剩 ${lot.available} 位）` : ''}，走過去約 ${walk} 分`, `Park${lot.available != null ? ` (${lot.available} spaces left)` : ''}, then walk about ${walk} min`]),
    ] : [
      leg('drive', from, to, drive, [`開車約 ${drive} 分（估算${traffic?.delayMin ? `，含塞車多 ${traffic.delayMin} 分` : ''}）`, `About ${drive} min driving (est.${traffic?.delayMin ? `, incl. ${traffic.delayMin} min of traffic` : ''})`], 'driving'),
      leg('walk', to, to, find + walk, [`找車位、停好走過去約 ${find + walk} 分（估算）`, `About ${find + walk} min to park and walk (est.)`]),
    ],
    notes: [
      `油錢約 ${fuel} 元（道路約 ${Math.round(km)} 公里）＋停車約 ${park} 元（停 1 小時估）`,
      ...(lot ? [`停車場：${lot.name}（離目的地約 ${lot.distanceM} 公尺${lot.available != null ? `，剩 ${lot.available} 位` : ''}${lot.fare ? `；${lot.fare}` : ''}）`] : pk?.noData ? ['這一帶查不到停車場資料'] : []),
      '開車時間、油錢、停車費都是估算（以實際路況與停車場公告為準）',
    ],
    ...(lots.length && { parking: lots.slice(0, 3).map((l) => ({ name: l.name, distanceM: l.distanceM, ...(l.available != null && { available: l.available }), ...(l.fare && { fare: l.fare }), lat: l.lat, lon: l.lon })) }),
    estimated: true, est: { minutes: true, cost: true },
  };
}

async function ridehailOption(svc, from, to, straight, traffic) {
  const km = roadKm(straight);
  const drive = carMinutes(km) + (traffic?.delayMin || 0);
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
/** decide() 的結果 → plan_trip 的 ranking（notWorth／tooLong／unsure：ADR-0010 2026-11-22） */
const rankingOf = (r) => ({
  ranked: r.ranked.map((o) => ({ id: o.id, name: o.name, score: o.score, breakdown: o.breakdown, ...(o.notWorth && { notWorth: o.notWorth }), ...(o.tooLong && { tooLong: o.tooLong }), ...(o.unsure && { unsure: o.unsure }) })),
  excluded: r.excluded.map((o) => ({ id: o.id, name: o.name, why: o.why })),
  weights: r.weights, reason: r.reason,
});
const tightTip = (best, arriveBy, slack) => ({ kind: 'tight', text: `時間很緊：預計 ${best.arriveAt} 抵達，比 ${arriveBy} 早到 ${slack} 分鐘，建議現在就出發` });
/** 決策的條件（planTrip 與 withoutBus 共用；前端決策圖重算用同一套） */
const ctxOf = (trip) => ({ states: (trip.states || []).map((s) => s.key), arriveBy: trip.arriveBy, arriveByMin: trip.arriveByMin, mode: trip.mode, avoid: trip.avoid, habit: trip.habit || null, said: (trip.states || []).some((s) => s.source !== 'auto') });

/** 盯到不會來的路線補進 missing（重排時公車整個查不到也照樣說是哪一條、為什麼）；已經有的不重複 */
export function withBusOff(trip, off) {
  const had = new Set((trip.missing || []).filter((m) => m.kind === 'route').map((m) => m.route));
  const add = off.filter((m) => !had.has(m.route));
  return add.length ? { ...trip, missing: [...(trip.missing || []), ...add] } : trip;
}

/**
 * 盯到站後發現推薦的公車今天不會來、又不能再重查（重排失敗、重排次數用完）：把這些公車排除，用同一套 decide() 重新排（不打 TDX）。
 * 不拿 ranking 第二名（第二名可能是被「太久」「不划算」壓到公車後面的步行或叫車）；卡片、決策圖、回答都用回傳的這一份。
 * @param {object} trip plan_trip 的 data
 * @param {Array<ReturnType<typeof busOffEntry>>} off 不會來的路線
 */
export function withoutBus(trip, off) {
  if (!trip.options.some((o) => off.some((m) => o.id === `bus-${m.route}`))) return withBusOff(trip, off); // 已經不在方案裡：只補原因
  const ids = new Set(off.map((m) => `bus-${m.route}`));
  const options = trip.options.filter((o) => !ids.has(o.id));
  const ctx = ctxOf(trip);
  const r = decide(options, ctx);
  const ask = keyQuestion(options, ctx);
  const best = options.find((o) => o.id === r.best?.id);
  const slack = trip.arriveByMin != null && best ? trip.arriveByMin - best.arriveMin : null;
  const tight = slack != null && slack >= 0 && slack < TIGHT_MIN;
  const tips = [...(tight ? [tightTip(best, trip.arriveBy, slack)] : []), ...(trip.tips || []).filter((t) => t.kind !== 'tight')];
  const { missing } = withBusOff(trip, off);
  const { ask: _a, tight: _t, tips: _tp, mode: _m, modeUnavailable: _mu, habitOn: _h, single: _s, ...rest } = trip; // single：方案數變了，原本的說明不適用
  return {
    ...rest, best: r.best?.id ?? null,
    ...((r.mode || r.modeUnavailable) && { mode: r.mode || r.modeUnavailable }),
    ...(r.modeUnavailable && { modeUnavailable: r.modeUnavailable }),
    ...(trip.habit && { habitOn: !!r.habitOn }),
    ...(ask && { ask }),
    options, ranking: rankingOf(r), missing,
    ...(tight && { tight: { slackMin: slack } }),
    ...(tips.length && { tips }),
  };
}

export async function planTrip(svc, { from, to, departAt, prefs = {}, now = Date.now() }) {
  const depart = departOf(departAt, now);
  const straight = distanceM(from.lat, from.lon, to.lat, to.lon);
  // 出發時間離現在幾分鐘（晚一點出發時，公車不套用站牌的即時狀態，BUS_LIVE_AHEAD_MIN）
  const tw = nowTW(now);
  const aheadMin = Math.round((Date.parse(`${depart.date}T00:00:00Z`) - Date.parse(`${tw.date}T00:00:00Z`)) / 6e4) + depart.minute - toMin(tw.hhmm);

  // 自動狀態：起點天氣、空品、沿途路況（失敗不加狀態、不中斷）
  const [weather, trafficRaw, aqi] = await Promise.all([
    svc.weather.now({ lat: from.lat, lon: from.lon }).catch(() => null),
    svc.traffic.status({ from: { lat: from.lat, lon: from.lon }, to: { lat: to.lat, lon: to.lon } }).catch(() => null),
    svc.life?.aqiNearby({ lat: from.lat, lon: from.lon }).catch(() => null),
  ]);
  const air = aqi?.nearest && aqi.nearest.distanceM <= AIR_MAX_M ? aqi.nearest : null; // 最近測站太遠（> 25 公里）不採用
  // 路況因 TDX 額度用完改用示範資料：不拿假的塞車加狀態、加延誤、算塞車風險（「資料」欄照實說查不到）
  const roadDemo = svc.mode === 'live' && Boolean(trafficRaw?.demo);
  const traffic = roadDemo ? null : trafficRaw;
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
    bus: () => busOption(svc, from, to, straight, risk, depart, { aheadMin, sameDay: depart.date === tw.date }),
    metro: () => metroOption(svc, from, to, straight, depart),
    thsr: () => railOption(svc, 'THSR', from, to, straight, depart),
    tra: () => railOption(svc, 'TRA', from, to, straight, depart),
    intercity: () => intercityOption(svc, from, to, straight, depart),
    ridehail: () => ridehailOption(svc, from, to, straight, traffic),
    // 自行開車：使用者說有車（我的 → 我有車）或指定開車才列（不是每個人都有車）
    ...((prefs.car === true || prefs.mode === 'drive') && { drive: () => driveOption(svc, from, to, straight, traffic) }),
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
    ...(tight ? [tightTip(bestOpt, prefs.arriveBy, slack)] : []),
    ...(umbrella ? [{ kind: 'rain', text: `3 小時內降雨機率 ${weather.pop3h}%，記得帶傘` }] : []),
    ...(party && ride?.share && rideShown ? [{ kind: 'cost', text: `${party} 人叫車${ride.share.cars > 1 ? `要 ${ride.share.cars} 輛車，` : ''}共約 ${ride.share.total} 元，每人分攤約 ${ride.cost} 元` }] : []),
  ];
  // 判斷用到的資料（天氣、空品、路況）各自的值與影響：討論串、決策圖資料欄、模型文字共用（trip-considered.js）
  const considered = consideredOf({
    weather, aqi, traffic: trafficRaw, today: depart.date === nowTW(now).date,
    demo: { weather: svc.weatherMode !== 'live' || Boolean(weather?.demo), air: svc.aqiMode !== 'live', traffic: svc.mode !== 'live' || Boolean(trafficRaw?.demo) },
  }).map((c) => (c.source === 'traffic' && roadDemo // TDX 額度用完改用示範資料（withTdxFallback）：示範的路況不列入判斷，這一行照實說
    ? { ...c, available: false, effect: 'none', tone: 'neutral', value: '查不到', valueEn: 'N/A', fallback: 'tdx-limit', text: 'TDX 額度用完，這次查不到國道路況', textEn: 'TDX quota used up; no freeway traffic this time', say: '這次不列入判斷', sayEn: 'not used this time' } : c));
  // 沒列入的方式與原因（任何時候都說：深夜 00:10 問 101 沒有公車和捷運，使用者以為是 bug）；太近、太遠是顯而易見的，不列
  const missingList = missingModes({ straight, roles: byRole, skipped, limits: LIMITS });
  const missing = [...missingList.filter((x) => !['near', 'far', 'na'].includes(x.kind)), ...busOff]; // busOff：{ role: 'bus', kind: 'route', route, status, why }
  // 深夜：公車、捷運收班或末班快到了，回答第一句就說（「現在 00:10，公車和捷運都收班了（捷運約 06:00 首班），先比走路、YouBike、叫車」）
  const isNow = depart.date === tw.date && Math.abs(depart.minute - toMin(tw.hhmm)) <= 2;
  const night = nightOf({ skipped, options, departMin: depart.minute, isNow, single: options.length === 1 });
  // 只有一種方式：說明其他方式為什麼不在（太遠、附近沒有站、沒有趕得上的班次…）；深夜收班已由 night 說，不重複
  const single = singleNote({ options, missingList: night ? missingList.filter((x) => !(x.closed && night.closed.includes(x.role))) : missingList, straight, departMin: depart.minute, demo: svc.mode !== 'live', fallback: currentFallback(), toName: to.name, fromName: from.name }); // fallback：TDX 額度用完時公車、高鐵等可能是示範資料（withTdxFallback 逐個方法改用）
  // TDX 額度用完、這次沒列入的方式（不推示範的假班次）：一句照實說；大眾運輸全部沒有時說先比走路、叫車，約 1 分鐘後再問
  const limited = limitedOf({ roles: skipped.filter((x) => x.fallback === 'tdx-limit' && !x.closed && x.role !== 'intercity').map((x) => x.role), options, toName: to.name, fromName: from.name }); // 客運沒資料就不提
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
    ranking: rankingOf(r),
    ...(unavailable.length && { unavailable }),
    ...(skipped.some((x) => x.role !== 'intercity') && { skipped: skipped.filter((x) => x.role !== 'intercity') }), // 客運沒資料就不列（卡片、決策圖）
    ...(missing.length && { missing }), // 沒列入的方式（含 skipped）：{ role, kind, why, whyEn, closed? }；kind 'route'＝那一條公車路線（route、status）（卡片「沒列入」、決策圖）
    ...(night && { night }), // 深夜的一句（回答、討論串、卡片第一行）
    ...(limited && { limited }), // TDX 額度用完沒列入的方式（{ roles, noTransit, text, textEn }）
    ...(party && { party }),
    ...(tight && { tight: { slackMin: slack } }),
    ...(tips.length && { tips }),
  };
}
