// 捷運服務（真實 TDX 版）：車站清單與到站看板（docs/MCP_TOOLS.md §5）
// 2026-11-22 實測：TDX 的北捷 LiveBoard 只有「列車進站中」的站（整個路網約 20 筆、EstimateTime 都是 0），沒有倒數分鐘；
// 所以看板整個系統一次取（20 秒共用，不依站另查），這一站沒有進站中的車時，改用站別時刻表（StationTimeTable）估下一班並照實標示。
import { UserError, normName, zh, enField, arr, odataStr as q, nowTW, toMin } from '../util.js';
import { metroLineColor } from '../metro-colors.js';
import { isNationalHoliday, twDate } from '../holidays.js';
import { cacheOf, rawOpts, nonEmpty, STATIC_TTL } from './tdx-cache.js';

/** 支援的捷運系統（TDX Operator 代碼） */
export const METRO_SYSTEMS = {
  TRTC: '台北捷運',
  TYMC: '桃園機場捷運',
  TMRT: '台中捷運',
  KRTC: '高雄捷運',
  NTMC: '新北捷運',     // 三鶯線、環狀線（2026-11-22 產品負責人：所有捷運系統都要包含，範圍全台灣）
  NTDLRT: '淡海輕軌',
  NTALRT: '安坑輕軌',
  KLRT: '高雄輕軌',
};

/** 各系統的路線名稱（代碼 → 中文；時刻表沒有路線名稱時用） */
export const METRO_LINE_NAME = {
  TRTC: { BL: '板南線', R: '淡水信義線', G: '松山新店線', O: '中和新蘆線', BR: '文湖線', Y: '環狀線', LG: '萬大線' },
  TYMC: { A: '機場線' }, TMRT: { G: '綠線' }, KRTC: { R: '紅線', O: '橘線' },
  NTMC: { LB: '三鶯線', Y: '環狀線' }, NTDLRT: { V: '淡海輕軌' }, NTALRT: { K: '安坑輕軌' }, KLRT: { C: '環狀輕軌' },
};
const LINE_NAME_EN = { BL: 'Bannan Line', R: 'Tamsui-Xinyi Line', G: 'Songshan-Xindian Line', O: 'Zhonghe-Xinlu Line', BR: 'Wenhu Line', Y: 'Circular Line', LG: 'Wanda Line', LB: 'Sanying Line', V: 'Danhai LRT', K: 'Ankeng LRT', C: 'Circular LRT' };
/** 線代碼和北捷不衝突的系統才用上面的英文線名（台中 G 是綠線、高雄 R/O 是紅橘線，不是北捷的 G/R/O） */
const LINE_EN_OK = new Set(['TRTC', 'NTMC', 'NTDLRT', 'NTALRT', 'KLRT']);

/** 各系統路網的大約範圍（緯度、經度；外擴約 10 公里）：行程規劃只查起訖附近有路網的系統 */
export const METRO_AREA = {
  TRTC: [24.85, 25.25, 121.30, 121.75],
  TYMC: [24.85, 25.20, 121.10, 121.60],
  TMRT: [24.00, 24.30, 120.50, 120.85],
  KRTC: [22.45, 22.90, 120.15, 120.50],
  NTMC: [24.85, 25.15, 121.30, 121.60],
  NTDLRT: [25.05, 25.30, 121.35, 121.55],
  NTALRT: [24.85, 25.10, 121.45, 121.65],
  KLRT: [22.50, 22.75, 120.20, 120.40],
};
export const nearMetroArea = (op, p) => { const a = METRO_AREA[op]; return Boolean(a && p && p.lat >= a[0] && p.lat <= a[1] && p.lon >= a[2] && p.lon <= a[3]); };

export const BOARD_TTL = 20;          // 看板：整個系統一份，20 秒
export const TIMETABLE_WINDOW_MIN = 60; // 時刻表估算只列 60 分鐘內的班次
/** 看板沒有這一站時的說明（卡片與工具文字） */
export const TIMETABLE_NOTE = '北捷即時到站在開放資料只有「進站中」，其他班次依時刻表估算';
export const TIMETABLE_NOTE_EN = 'Live MRT arrivals are only published when a train is at the platform; other times are estimated from the timetable';
/** 其他系統：這一站這時候沒有看板資料（或看板查不到）時的說明 */
export const TIMETABLE_NOTE_OTHER = '這一站目前沒有即時到站資料，依時刻表估算';
export const TIMETABLE_NOTE_OTHER_EN = 'No live arrivals for this station right now; times are estimated from the timetable';
/** 看板有拿到、但只有進站中（北捷、新北捷運）→ 說明看板的限制；看板查不到或其他系統 → 「目前沒有即時到站資料」 */
const timetableNote = (op, boardOk) => (!boardOk || !ARRIVING_ONLY.has(op) ? { note: TIMETABLE_NOTE_OTHER, noteEn: TIMETABLE_NOTE_OTHER_EN }
  : { note: op === 'TRTC' ? TIMETABLE_NOTE : TIMETABLE_NOTE.replace('北捷', '新北捷運'), noteEn: TIMETABLE_NOTE_EN });
/**
 * 2026-11-23 真實資料實測：
 *   看板只有「進站中」（EstimateTime 都是 0）：北捷、新北捷運（而且新北捷運看板只有環狀線，三鶯線全靠時刻表）；
 *   EstimateTime 單位是秒：淡海輕軌、安坑輕軌（例 483、720）；其他系統是分鐘；台中捷運看板回 400（只能用時刻表）。
 */
/**
 * 環狀線（高雄輕軌，2026-11-23 實測）：兩個方向的終點都是「籬仔內」，只有 TripHeadSign「順行方向」「逆行方向」分得出來 → 終點後面加方向，
 * 不然卡片是兩列「往 籬仔內」。英文用 forward／reverse loop（順行、逆行的字面意思）。
 */
const LOOP_DIR = { 順行: ['順行', 'forward loop'], 逆行: ['逆行', 'reverse loop'] };
export function loopDest(dest, destEn, headSign) {
  const k = /(順行|逆行)/.exec(zh(headSign) || '')?.[1];
  if (!k) return { destination: dest, ...(destEn && { destinationEn: destEn }) };
  return { destination: `${dest}（${LOOP_DIR[k][0]}）`, ...(destEn && { destinationEn: `${destEn} (${LOOP_DIR[k][1]})` }) };
}
/** 環狀線時刻表的 Direction → 看板的 TripHeadSign（2026-11-23 同一時間比對看板與時刻表：高雄輕軌 0＝順行、1＝逆行） */
const LOOP_TIMETABLE_DIR = { KLRT: { 0: '順行方向', 1: '逆行方向' } };
const ARRIVING_ONLY = new Set(['TRTC', 'NTMC']);
const BOARD_IN_SECONDS = new Set(['NTDLRT', 'NTALRT']);
/** 只有班距（TDX 的 LiveBoard、StationTimeTable 都不收 TMRT：「RailSystem: 'TMRT' is not accepted」）：不查看板與時刻表，只說幾分鐘一班 */
export const FREQUENCY_ONLY = new Set(['TMRT']);
export const FREQUENCY_NOTE = '台中捷運沒有提供到站時間的開放資料，只有班距';
export const FREQUENCY_NOTE_EN = 'Taichung MRT publishes no arrival times as open data, only how often trains run';

/**
 * 到站狀態代碼（卡片用中英字典顯示，不把資料的中文字串漏到英文卡片）：
 *   arriving＝看板 EstimateTime 0（北捷看板實測只有這一種：列車進站中）、approaching＝1 分內、minutes＝N 分、
 *   scheduled＝依時刻表估算、unknown＝看板沒有時間
 */
export const METRO_STATUS = ['arriving', 'approaching', 'minutes', 'scheduled', 'unknown'];
/** 看板分鐘數 → 狀態代碼 */
export function metroStatusCode(etaMin) {
  if (etaMin == null) return 'unknown';
  if (etaMin <= 0) return 'arriving';
  if (etaMin <= 1) return 'approaching';
  return 'minutes';
}
const STATUS_TEXT = {
  zh: { arriving: () => '進站中', approaching: () => '即將進站', minutes: (m) => `${m} 分`, scheduled: (m) => (m <= 1 ? '約 1 分內' : `約 ${m} 分`), unknown: () => '—' },
  en: { arriving: () => 'Arriving', approaching: () => 'Approaching', minutes: (m) => `${m} min`, scheduled: (m) => (m <= 1 ? 'within ~1 min' : `~${m} min`), unknown: () => '—' },
};
/** 狀態代碼 → 易讀文字（伺服器的工具文字與播報用；卡片用 public/ui/cards/i18n 的字典） */
export function metroStatusText(train, lang = 'zh') {
  const f = STATUS_TEXT[lang === 'en' ? 'en' : 'zh'][train?.status] || STATUS_TEXT.zh.unknown;
  return f(train?.etaMin);
}

/** 依到站分鐘排序，沒有時間的排最後 */
export const sortByEta = (a, b) => (a.etaMin ?? Infinity) - (b.etaMin ?? Infinity);

export function mustSystem(system) {
  const s = String(system || '').toUpperCase();
  if (!METRO_SYSTEMS[s]) throw new UserError(`不支援的捷運系統「${system}」，可用：${Object.entries(METRO_SYSTEMS).map(([k, v]) => `${k}（${v}）`).join('、')}`);
  return s;
}

/** 站名或代碼找車站；「台北車站」「臺北車站」「台北車站站」都對得到 */
export function findMetroStation(list, input, system) {
  const s = String(input || '').trim();
  const S = s.toUpperCase();
  const byId = list.find((x) => (x.ids || [x.id]).some((id) => String(id).toUpperCase() === S)); // 轉乘站的每條線代碼都對得到
  if (byId) return byId;
  const n = normName(s);
  const hit = list.find((x) => normName(x.name) === n) || list.find((x) => normName(x.name).includes(n) || (n.length >= 2 && n.includes(normName(x.name))));
  if (!hit) throw new UserError(`${METRO_SYSTEMS[system]}找不到「${input}」站，可先用 metro_stations 查站名`);
  return hit;
}

/** Metro Station → 車站清單（同一站多條線時以第一個代碼為準，ids 列出所有代碼；可存檔） */
/** StationOfLine → 各線車站順序（依 Sequence；線名用 METRO_LINE_NAME，英文線名只給代碼不衝突的系統） */
export function normStationOfLine(op, rows) {
  return arr(rows, 'StationOfLines').map((l) => {
    const lineId = l.LineID || l.LineNo || '';
    const stations = [...(l.Stations || [])].sort((a, b) => (a.Sequence ?? 0) - (b.Sequence ?? 0))
      .map((s) => ({ id: s.StationID, name: zh(s.StationName), ...enField('nameEn', s.StationName) })).filter((s) => s.id && s.name);
    return { lineId, line: METRO_LINE_NAME[op]?.[lineId] || lineId, ...(LINE_EN_OK.has(op) && LINE_NAME_EN[lineId] && { lineEn: LINE_NAME_EN[lineId] }), ...(metroLineColor(op, lineId) && { color: metroLineColor(op, lineId) }), stations };
  }).filter((l) => l.stations.length >= 2);
}

/** ODFare 的票價 → 成人單程票（TicketType 1 單程票、FareClass 1 成人；有好幾筆取最低）；沒有 null */
export function adultFare(rows) {
  const p = (rows || []).flatMap((r) => r.Fares || []).filter((f) => Number(f.TicketType) === 1 && Number(f.FareClass) === 1 && Number.isFinite(Number(f.Price))).map((f) => Number(f.Price));
  return p.length ? Math.min(...p) : null;
}

export function normMetroStations(op, rows) {
  const byName = new Map();
  for (const r of arr(rows, 'Stations')) {
    const name = zh(r.StationName);
    const p = r.StationPosition || {};
    if (!name) continue;
    const key = normName(name); // 「台北車站」「臺北車站」視為同一站
    const cur = byName.get(key);
    if (cur) { cur.ids.push(r.StationID); continue; }
    byName.set(key, {
      id: r.StationID, ids: [r.StationID], name, ...enField('nameEn', r.StationName),
      ...(Number.isFinite(p.PositionLat) && Number.isFinite(p.PositionLon) && { lat: p.PositionLat, lon: p.PositionLon }),
    });
  }
  // 經過的線（代碼字首：BL12 → BL；同名多線合併後有多條）
  return [...byName.values()].map((st) => ({ ...st, lines: stationLines(op, st.ids) }));
}

/**
 * StationTimeTable → [{ lineId, direction, destId, dest, destEn?, days: [日..六 是否行駛], holiday?, times: ['06:00', …] }]（可存檔）
 * holiday：ServiceDay.NationalHolidays（國定假日是否行駛這份班表）；資料沒有這個欄位就不帶（國定假日照星期幾）
 */
export function normStationTimetable(rows) {
  const D = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return arr(rows, 'StationTimeTables').map((r) => ({
    lineId: r.LineID || null, direction: r.Direction ?? null,
    destId: r.DestinationStationID || r.DestinationStaionID || null, dest: zh(r.DestinationStationName), ...enField('destEn', r.DestinationStationName),
    days: D.map((d) => Boolean(r.ServiceDay?.[d])),
    ...(typeof r.ServiceDay?.NationalHolidays === 'boolean' && { holiday: r.ServiceDay.NationalHolidays }),
    times: (r.Timetables || []).map((t) => t.DepartureTime || t.ArrivalTime).filter((t) => /^\d{1,2}:\d{2}$/.test(t || '')),
  }));
}

const AFTER_MIDNIGHT = 4 * 60; // 凌晨 4 點前的班次屬於前一天的營運日（00:49 末班）

/**
 * 依時刻表找今天（營運日）各線各方向的末班車（「捷運末班車幾點」，真實資料健檢）：每個「路線＋終點」取最晚的一班。
 * 凌晨 4 點前問的是前一天營運日的末班；國定假日的班表規則同 upcomingFromTimetable。
 * @returns {Array<{ lineId, destination, destinationEn?, time: string }>} time 'HH:mm'
 */
/**
 * 班距（TDX Frequency）：台中捷運沒有看板也沒有站別時刻表，只有「幾分鐘一班」。依台灣時間的星期幾（國定假日用標了 NationalHolidays 的那一份）找現在的班距。
 * @returns {{ min: number, max: number, peak: boolean, lineId: string|null } | null} 不在營運時間或沒資料時 null
 */
export function headwayNow(rows, now = Date.now()) {
  const list = arr(rows, 'Frequencies');
  if (!list.length) return null;
  const D = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const { hhmm, weekday } = nowTW(now);
  const holiday = isNationalHoliday(twDate(now)) && list.some((r) => r.ServiceDay?.NationalHolidays === true);
  const cur = toMin(hhmm);
  for (const r of list.filter((x) => (holiday ? x.ServiceDay?.NationalHolidays === true : Boolean(x.ServiceDay?.[D[weekday]])))) {
    for (const h of r.Headways || []) {
      const from = toMin(h.StartTime || ''), to = h.EndTime === '24:00' ? 24 * 60 : toMin(h.EndTime || '');
      const min = Number(h.MinHeadwayMins), max = Number(h.MaxHeadwayMins ?? h.MinHeadwayMins);
      if (Number.isFinite(from) && Number.isFinite(to) && cur >= from && cur < to && min > 0) return { min, max: max >= min ? max : min, peak: String(h.PeakFlag) === '1', lineId: r.LineID || null };
    }
  }
  return null;
}

export function lastFromTimetable(table, now = Date.now()) {
  const { hhmm, weekday } = nowTW(now);
  const early = toMin(hhmm) < AFTER_MIDNIGHT;
  const wd = early ? (weekday + 6) % 7 : weekday;
  const ymd = twDate(now, early ? -1 : 0);
  const lane = (r) => `${r.lineId}|${r.direction}|${r.destId || r.dest}`;
  const marked = new Set((table || []).filter((r) => r.holiday === true).map(lane));
  const runs = (row) => (marked.has(lane(row)) && isNationalHoliday(ymd) ? row.holiday === true : !!row.days?.[wd]);
  const best = new Map();
  for (const row of table || []) {
    if (!runs(row)) continue;
    for (const t of row.times) {
      let m = toMin(t);
      if (m < AFTER_MIDNIGHT) m += 24 * 60;
      const k = `${row.lineId}|${row.destId || row.dest}`;
      if (!best.has(k) || m > best.get(k).m) best.set(k, { m, lineId: row.lineId, destination: row.dest, ...(row.destEn && { destinationEn: row.destEn }), time: t.length === 4 ? `0${t}` : t });
    }
  }
  return [...best.values()].sort((a, b) => a.m - b.m).map(({ m: _m, ...x }) => x);
}

/**
 * 依時刻表估各線各方向下一班（每個「路線＋終點」取最近的一班，60 分鐘內）。
 * 國定假日（台灣時間，core/holidays.js 內建清單）：這條線這個方向、這個終點的資料有 ServiceDay.NationalHolidays 時用標了國定假日的班表；資料沒標就照星期幾。
 * @param {ReturnType<typeof normStationTimetable>} table
 * @returns {Array<{ lineId, destination, destinationEn?, etaMin }>}
 */
export function upcomingFromTimetable(table, now = Date.now(), windowMin = TIMETABLE_WINDOW_MIN) {
  const { hhmm, weekday } = nowTW(now);
  const cur = toMin(hhmm);
  // 今天的營運日；凌晨也看昨天的營運日（00:30 還有昨天的末班）
  const days = [{ wd: weekday, ref: cur, ymd: twDate(now) }, ...(cur < AFTER_MIDNIGHT ? [{ wd: (weekday + 6) % 7, ref: cur + 24 * 60, ymd: twDate(now, -1) }] : [])];
  const lane = (r) => `${r.lineId}|${r.direction}|${r.destId || r.dest}`; // 路線＋方向＋終點：區間車那一筆沒標國定假日時不被整筆排除
  const marked = new Set((table || []).filter((r) => r.holiday === true).map(lane)); // 這條線這個方向、這個終點有國定假日班表
  const runs = (row, { wd, ymd }) => (marked.has(lane(row)) && isNationalHoliday(ymd) ? row.holiday === true : !!row.days?.[wd]);
  const best = new Map();
  for (const row of table || []) {
    for (const day of days) {
      const { ref } = day;
      if (!runs(row, day)) continue;
      for (const t of row.times) {
        let m = toMin(t);
        if (m < AFTER_MIDNIGHT) m += 24 * 60;
        const eta = m - ref;
        if (eta < 0 || eta > windowMin) continue;
        const k = `${row.lineId}|${row.destId || row.dest}|${row.direction ?? ''}`; // 環狀線兩個方向終點相同（高雄輕軌）：方向也要分開
        if (!best.has(k) || eta < best.get(k).etaMin) best.set(k, { lineId: row.lineId, destination: row.dest, ...(row.destEn && { destinationEn: row.destEn }), ...(row.direction != null && { direction: row.direction }), etaMin: eta });
      }
    }
  }
  return [...best.values()];
}

/** 車站清單的下載（預熱與使用者請求共用同一個 key） */
export const metroLoaders = {
  stations: (tdx, op) => async (o) => nonEmpty(normMetroStations(op, await tdx.get(`/basic/v2/Rail/Metro/Station/${op}`, { $select: 'StationID,StationName,StationPosition' }, 60, rawOpts(o))), `${METRO_SYSTEMS[op]}車站`),
};
export const metroKey = { stations: (op) => `metro-stations-${op}`, timetable: (op, ids) => `metro-timetable-${op}-${ids.join('_')}`, frequency: (op) => `metro-frequency-${op}`, lines: (op) => `metro-lines-${op}`, fare: (op, a, b) => `metro-fare-${op}-${a}-${b}` };

/** 預熱步驟：四個系統的車站（plan_trip 每次都要看起訖附近有沒有捷運站） */
export function metroWarmSteps(tdx) {
  const { cached } = cacheOf(tdx);
  return Object.keys(METRO_SYSTEMS).map((op) => ({ key: metroKey.stations(op), ttl: STATIC_TTL, run: (o) => cached(metroKey.stations(op), STATIC_TTL, metroLoaders.stations(tdx, op), { ...o, force: true }) }));
}

export function createMetroServices(tdx, { now = () => tdx.now?.() ?? Date.now() } = {}) {
  const { cached, meta } = cacheOf(tdx);
  const lineName = (op, id) => METRO_LINE_NAME[op]?.[id] || id || '';
  // 看板回 400／404（這個系統沒有看板，例：台中捷運）：記住 10 分鐘，這段時間直接用時刻表，不再花額度查看板
  const noBoard = new Map();
  const NO_BOARD_MS = 10 * 60_000;

  const metro = {
    /** 車站清單（存檔；同一站多條線時以第一個代碼為準，lines 列出所有代碼） */
    async stations({ system }) {
      const op = mustSystem(system);
      return cached(metroKey.stations(op), STATIC_TTL, metroLoaders.stations(tdx, op));
    },

    /**
     * 各線車站順序（轉乘規劃，core/metro-route.js）：TDX StationOfLine（存檔）。
     * 拿不到時（台中捷運不收）、而且這個系統只有一條線：用車站清單依代碼排序（103a、104…119）。
     * @returns {Promise<Array<{ lineId, line, lineEn?, color?, stations: Array<{ id, name, nameEn? }> }>>}
     */
    async lines({ system }) {
      const op = mustSystem(system);
      const fromSol = await cached(metroKey.lines(op), STATIC_TTL, async (o) => nonEmpty(normStationOfLine(op, await tdx.get(`/basic/v2/Rail/Metro/StationOfLine/${op}`, {}, 60, rawOpts(o))), `${METRO_SYSTEMS[op]}路線`)).catch((e) => { if (e?.status === 429) throw e; return null; });
      if (fromSol) return fromSol;
      const ids = Object.keys(METRO_LINE_NAME[op] || {});
      if (ids.length !== 1) throw new UserError(`${METRO_SYSTEMS[op]}查不到各線的車站順序，暫時沒辦法規劃轉乘`);
      const st = await metro.stations({ system: op });
      const nat = (x) => { const m = /^([A-Z]*)(\d+)([a-zA-Z]*)$/.exec(x.id) || []; return [m[1] || '', Number(m[2] || 0), m[3] || '']; };
      const sorted = [...st].sort((a, b) => { const [pa, na, sa] = nat(a), [pb, nb, sb] = nat(b); return pa.localeCompare(pb) || na - nb || sa.localeCompare(sb); });
      return [{ lineId: ids[0], line: lineName(op, ids[0]), ...(metroLineColor(op, ids[0]) && { color: metroLineColor(op, ids[0]) }), stations: sorted.map((x) => ({ id: x.id, name: x.name, ...(x.nameEn && { nameEn: x.nameEn }) })) }];
    },

    /** 兩站之間的成人單程票價（TDX ODFare，存檔）；查不到 null */
    async odFare({ system, fromId, toId }) {
      const op = mustSystem(system);
      return cached(metroKey.fare(op, fromId, toId), STATIC_TTL, async (o) => {
        const rows = arr(await tdx.get(`/basic/v2/Rail/Metro/ODFare/${op}`, { $filter: `OriginStationID eq '${q(fromId)}' and DestinationStationID eq '${q(toId)}'` }, 60, rawOpts(o)), 'ODFares');
        return adultFare(rows);
      }).catch((e) => { if (e?.status === 429) throw e; return null; });
    },

    /**
     * 某站到站看板（各線各方向）。看板整個系統一次取（20 秒，所有車站、所有人共用）；
     * 這一站沒有看板資料時（北捷只有進站中的站），改用站別時刻表估下一班（scheduled: true、source: 'timetable'、note 說明）。
     */
    async liveBoard({ system, station, last = false }) {
      const op = mustSystem(system);
      const st = findMetroStation(await metro.stations({ system: op }), station, op);
      const ids = new Set(st.ids.map(String));
      if (FREQUENCY_ONLY.has(op)) {
        const rows = await cached(metroKey.frequency(op), STATIC_TTL, async (o) => nonEmpty(arr(await tdx.get(`/basic/v2/Rail/Metro/Frequency/${op}`, {}, 60, rawOpts(o)), 'Frequencies'), `${METRO_SYSTEMS[op]}班距`));
        const hw = headwayNow(rows, now());
        return {
          system: op, station: st.name, ...(st.nameEn && { stationEn: st.nameEn }), stationId: st.id,
          ...(st.lat != null && { lat: st.lat, lon: st.lon }),
          updatedAt: new Date(now()).toISOString(), trains: [], source: 'frequency', headway: hw && { ...hw, ...(metroLineColor(op, hw.lineId) && { lineColor: metroLineColor(op, hw.lineId) }) }, // null＝現在不在營運時間
          note: FREQUENCY_NOTE, noteEn: FREQUENCY_NOTE_EN,
          ...(last && { lastTrains: [] }),
        };
      }
      // 看板查不到（額度用完 429、這個系統沒有看板 404、上游暫時失敗）時，有時刻表就先用時刻表；兩個都沒有才算失敗（退回示範資料）
      let boardErr = null;
      const loadTable = () => cached(metroKey.timetable(op, st.ids), STATIC_TTL, async (o) => normStationTimetable(await tdx.get(
        `/basic/v2/Rail/Metro/StationTimeTable/${op}`, { $filter: st.ids.map((id) => `StationID eq '${q(id)}'`).join(' or ') }, 60, rawOpts(o)))).catch(() => null);
      const tablePromise = ARRIVING_ONLY.has(op) || last ? loadTable() : null; // 看板只有進站中的系統一定要時刻表：跟看板同時查；問末班車也要
      const skip = noBoard.get(op);
      const board = skip && skip.until > now() ? (boardErr = skip.err, null)
        : await meta(`/basic/v2/Rail/Metro/LiveBoard/${op}`, {}, BOARD_TTL, { staleSec: 60 }).catch((e) => {
          boardErr = e;
          if (e?.status === 400 || e?.status === 404) noBoard.set(op, { until: now() + NO_BOARD_MS, err: e });
          return null;
        });
      const list = board ? arr(board.data, 'LiveBoards').filter((r) => ids.has(String(r.StationID))) : [];
      const live = list.map((r) => {
        const ageMin = Math.max(0, Math.floor((now() - board.at) / 60000)); // 舊資料（最多 60 秒）扣掉經過的分鐘
        const est = Number.isFinite(r.EstimateTime) ? (BOARD_IN_SECONDS.has(op) ? Math.floor(r.EstimateTime / 60) : r.EstimateTime) : null;
        const etaMin = est != null ? Math.max(0, est - ageMin) : null;
        const lineId = r.LineID || r.LineNO || null;
        return {
          line: zh(r.LineName) || lineName(op, lineId), ...enField('lineEn', r.LineName),
          lineId,
          ...(metroLineColor(op, lineId) && { lineColor: metroLineColor(op, lineId) }), // 路線代表色（色條）
          ...loopDest(zh(r.DestinationStationName) || zh(r.TripHeadSign) || '', enField('destinationEn', r.DestinationStationName).destinationEn, r.TripHeadSign),
          etaMin, status: metroStatusCode(etaMin),
        };
      });
      // 看板沒涵蓋的線與方向用時刻表補：北捷、新北捷運看板只有進站中的站，一律補；其他系統只在這一站沒有看板資料時才查（省額度）
      let planned = [];
      const table = tablePromise ? await tablePromise : !live.length ? await loadTable() : null;
      // 看板被擋、時刻表也沒有（查不到或空的）：不能說成「目前沒有車」，照常走示範資料
      if (!board && !(Array.isArray(table) && table.length)) throw boardErr;
      if (Array.isArray(table)) {
        // 看板列沒有時間（新北捷運看板常這樣，只有「往某站」）不算涵蓋：這個方向用時刻表估
        const covered = new Set(live.filter((t) => t.etaMin != null).map((t) => `${t.lineId}|${normName(t.destination)}`));
        planned = upcomingFromTimetable(table, now())
          .map((t) => ({
            line: lineName(op, t.lineId), ...(LINE_EN_OK.has(op) && LINE_NAME_EN[t.lineId] && { lineEn: LINE_NAME_EN[t.lineId] }),
            lineId: t.lineId,
            ...(metroLineColor(op, t.lineId) && { lineColor: metroLineColor(op, t.lineId) }),
            ...loopDest(t.destination, t.destinationEn, LOOP_TIMETABLE_DIR[op]?.[t.direction]),
            etaMin: t.etaMin, status: 'scheduled', scheduled: true,
          }))
          .filter((t) => !covered.has(`${t.lineId}|${normName(t.destination)}`)); // 比對加了方向之後的終點（環狀線）
      }
      const plannedLanes = new Set(planned.map((t) => `${t.lineId}|${normName(t.destination)}`));
      const kept = live.filter((t) => t.etaMin != null || !plannedLanes.has(`${t.lineId}|${normName(t.destination)}`));
      const trains = [...kept, ...planned].sort(sortByEta);
      const updatedAt = list.map((r) => r.UpdateTime).filter(Boolean).sort().at(-1) || new Date(board?.at ?? now()).toISOString();
      // 看板被擋時就算這一小時沒有班次也是「時刻表」，不是即時
      const source = !board ? 'timetable' : planned.length ? (kept.length ? 'mixed' : 'timetable') : 'live';
      return {
        system: op, station: st.name, ...(st.nameEn && { stationEn: st.nameEn }), stationId: st.id,
        ...(st.lat != null && { lat: st.lat, lon: st.lon }),
        updatedAt, trains,
        ...(source !== 'live' && { source, ...timetableNote(op, Boolean(board)) }),
        ...(board?.stale && { stale: true }), // 看板用了 60 秒內的舊資料（額度快用完）
        ...(last && { lastTrains: Array.isArray(table) ? lastFromTimetable(table, now()).map((x) => ({ ...x, line: lineName(op, x.lineId) })) : [] }), // 末班車（時刻表；查不到是空陣列）
      };
    },
  };
  return { metro };
}

/**
 * 車站經過的線（代碼字首：BL12 → BL；同名多線合併後有多條）。⚠️ 待 M1 驗證：
 * 台中捷運代碼是數字（103a）→ 綠線 G；機場捷運 A；高雄岡山延伸 RK → 紅線 R。
 */
export function stationLines(op, ids = []) {
  const one = { TMRT: 'G', TYMC: 'A', NTDLRT: 'V', NTALRT: 'K', KLRT: 'C' }[op];
  if (one) return [one];
  return [...new Set(ids.map((i) => /^[A-Z]+/.exec(i)?.[0]).filter(Boolean).map((c) => (op === 'KRTC' && c === 'RK' ? 'R' : c)))];
}
