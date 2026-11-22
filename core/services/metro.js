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
};

/** 各系統的路線名稱（代碼 → 中文；時刻表沒有路線名稱時用） */
export const METRO_LINE_NAME = {
  TRTC: { BL: '板南線', R: '淡水信義線', G: '松山新店線', O: '中和新蘆線', BR: '文湖線', Y: '環狀線', LG: '萬大線' },
  TYMC: { A: '機場線' }, TMRT: { G: '綠線' }, KRTC: { R: '紅線', O: '橘線' },
};
const LINE_NAME_EN = { BL: 'Bannan Line', R: 'Tamsui-Xinyi Line', G: 'Songshan-Xindian Line', O: 'Zhonghe-Xinlu Line', BR: 'Wenhu Line', Y: 'Circular Line', LG: 'Wanda Line' };

/** 各系統路網的大約範圍（緯度、經度；外擴約 10 公里）：行程規劃只查起訖附近有路網的系統 */
export const METRO_AREA = {
  TRTC: [24.85, 25.25, 121.30, 121.75],
  TYMC: [24.85, 25.20, 121.10, 121.60],
  TMRT: [24.00, 24.30, 120.50, 120.85],
  KRTC: [22.45, 22.90, 120.15, 120.50],
};
export const nearMetroArea = (op, p) => { const a = METRO_AREA[op]; return Boolean(a && p && p.lat >= a[0] && p.lat <= a[1] && p.lon >= a[2] && p.lon <= a[3]); };

export const BOARD_TTL = 20;          // 看板：整個系統一份，20 秒
export const TIMETABLE_WINDOW_MIN = 60; // 時刻表估算只列 60 分鐘內的班次
/** 看板沒有這一站時的說明（卡片與工具文字） */
export const TIMETABLE_NOTE = '北捷即時到站在開放資料只有「進站中」，其他班次依時刻表估算';
export const TIMETABLE_NOTE_EN = 'Live MRT arrivals are only published when a train is at the platform; other times are estimated from the timetable';

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
 * 依時刻表估各線各方向下一班（每個「路線＋終點」取最近的一班，60 分鐘內）。
 * 國定假日（台灣時間，core/holidays.js 內建清單）：這條線這個方向的資料有 ServiceDay.NationalHolidays 時用標了國定假日的班表；資料沒標就照星期幾。
 * @param {ReturnType<typeof normStationTimetable>} table
 * @returns {Array<{ lineId, destination, destinationEn?, etaMin }>}
 */
export function upcomingFromTimetable(table, now = Date.now(), windowMin = TIMETABLE_WINDOW_MIN) {
  const { hhmm, weekday } = nowTW(now);
  const cur = toMin(hhmm);
  // 今天的營運日；凌晨也看昨天的營運日（00:30 還有昨天的末班）
  const days = [{ wd: weekday, ref: cur, ymd: twDate(now) }, ...(cur < AFTER_MIDNIGHT ? [{ wd: (weekday + 6) % 7, ref: cur + 24 * 60, ymd: twDate(now, -1) }] : [])];
  const lane = (r) => `${r.lineId}|${r.direction}`;
  const marked = new Set((table || []).filter((r) => r.holiday === true).map(lane)); // 這條線這個方向有國定假日班表
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
        const k = `${row.lineId}|${row.destId || row.dest}`;
        if (!best.has(k) || eta < best.get(k).etaMin) best.set(k, { lineId: row.lineId, destination: row.dest, ...(row.destEn && { destinationEn: row.destEn }), etaMin: eta });
      }
    }
  }
  return [...best.values()];
}

/** 車站清單的下載（預熱與使用者請求共用同一個 key） */
export const metroLoaders = {
  stations: (tdx, op) => async (o) => nonEmpty(normMetroStations(op, await tdx.get(`/basic/v2/Rail/Metro/Station/${op}`, { $select: 'StationID,StationName,StationPosition' }, 60, rawOpts(o))), `${METRO_SYSTEMS[op]}車站`),
};
export const metroKey = { stations: (op) => `metro-stations-${op}`, timetable: (op, ids) => `metro-timetable-${op}-${ids.join('_')}` };

/** 預熱步驟：四個系統的車站（plan_trip 每次都要看起訖附近有沒有捷運站） */
export function metroWarmSteps(tdx) {
  const { cached } = cacheOf(tdx);
  return Object.keys(METRO_SYSTEMS).map((op) => ({ key: metroKey.stations(op), ttl: STATIC_TTL, run: (o) => cached(metroKey.stations(op), STATIC_TTL, metroLoaders.stations(tdx, op), { ...o, force: true }) }));
}

export function createMetroServices(tdx, { now = () => tdx.now?.() ?? Date.now() } = {}) {
  const { cached, meta } = cacheOf(tdx);
  const lineName = (op, id) => METRO_LINE_NAME[op]?.[id] || id || '';

  const metro = {
    /** 車站清單（存檔；同一站多條線時以第一個代碼為準，lines 列出所有代碼） */
    async stations({ system }) {
      const op = mustSystem(system);
      return cached(metroKey.stations(op), STATIC_TTL, metroLoaders.stations(tdx, op));
    },

    /**
     * 某站到站看板（各線各方向）。看板整個系統一次取（20 秒，所有車站、所有人共用）；
     * 這一站沒有看板資料時（北捷只有進站中的站），改用站別時刻表估下一班（scheduled: true、source: 'timetable'、note 說明）。
     */
    async liveBoard({ system, station }) {
      const op = mustSystem(system);
      const st = findMetroStation(await metro.stations({ system: op }), station, op);
      const ids = new Set(st.ids.map(String));
      // 看板額度用完（429）時，有時刻表就先用時刻表；兩個都沒有才算失敗
      let boardErr = null;
      const loadTable = () => cached(metroKey.timetable(op, st.ids), STATIC_TTL, async (o) => normStationTimetable(await tdx.get(
        `/basic/v2/Rail/Metro/StationTimeTable/${op}`, { $filter: st.ids.map((id) => `StationID eq '${q(id)}'`).join(' or ') }, 60, rawOpts(o)))).catch(() => null);
      const tablePromise = op === 'TRTC' ? loadTable() : null; // 北捷一定要時刻表：跟看板同時查
      const board = await meta(`/basic/v2/Rail/Metro/LiveBoard/${op}`, {}, BOARD_TTL, { staleSec: 60 }).catch((e) => { if (e?.status !== 429) throw e; boardErr = e; return null; });
      const list = board ? arr(board.data, 'LiveBoards').filter((r) => ids.has(String(r.StationID))) : [];
      const live = list.map((r) => {
        const ageMin = Math.max(0, Math.floor((now() - board.at) / 60000)); // 舊資料（最多 60 秒）扣掉經過的分鐘
        const etaMin = Number.isFinite(r.EstimateTime) ? Math.max(0, r.EstimateTime - ageMin) : null;
        const lineId = r.LineID || r.LineNO || null;
        return {
          line: zh(r.LineName) || lineName(op, lineId), ...enField('lineEn', r.LineName),
          lineId,
          ...(metroLineColor(op, lineId) && { lineColor: metroLineColor(op, lineId) }), // 路線代表色（色條）
          destination: zh(r.DestinationStationName) || zh(r.TripHeadSign) || '', ...enField('destinationEn', r.DestinationStationName),
          etaMin, status: metroStatusCode(etaMin),
        };
      });
      // 看板沒涵蓋的線與方向用時刻表補：北捷看板只有進站中的站，一律補；其他系統只在這一站沒有看板資料時才查（省額度）
      let planned = [];
      const table = tablePromise ? await tablePromise : !live.length ? await loadTable() : null;
      // 看板被擋、時刻表也沒有（查不到或空的）：不能說成「目前沒有車」，照常走示範資料
      if (!board && !(Array.isArray(table) && table.length)) throw boardErr;
      if (Array.isArray(table)) {
        const covered = new Set(live.map((t) => `${t.lineId}|${normName(t.destination)}`));
        planned = upcomingFromTimetable(table, now())
          .filter((t) => !covered.has(`${t.lineId}|${normName(t.destination)}`))
          .map((t) => ({
            line: lineName(op, t.lineId), ...(op === 'TRTC' && LINE_NAME_EN[t.lineId] && { lineEn: LINE_NAME_EN[t.lineId] }),
            lineId: t.lineId,
            ...(metroLineColor(op, t.lineId) && { lineColor: metroLineColor(op, t.lineId) }),
            destination: t.destination, ...(t.destinationEn && { destinationEn: t.destinationEn }),
            etaMin: t.etaMin, status: 'scheduled', scheduled: true,
          }));
      }
      const trains = [...live, ...planned].sort(sortByEta);
      const updatedAt = list.map((r) => r.UpdateTime).filter(Boolean).sort().at(-1) || new Date(board?.at ?? now()).toISOString();
      // 看板被擋時就算這一小時沒有班次也是「時刻表」，不是即時
      const source = !board ? 'timetable' : planned.length ? (live.length ? 'mixed' : 'timetable') : 'live';
      return {
        system: op, station: st.name, ...(st.nameEn && { stationEn: st.nameEn }), stationId: st.id,
        ...(st.lat != null && { lat: st.lat, lon: st.lon }),
        updatedAt, trains,
        ...(source !== 'live' && { source, note: TIMETABLE_NOTE, noteEn: TIMETABLE_NOTE_EN }),
        ...(board?.stale && { stale: true }), // 看板用了 60 秒內的舊資料（額度快用完）
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
  const one = { TMRT: 'G', TYMC: 'A' }[op];
  if (one) return [one];
  return [...new Set(ids.map((i) => /^[A-Z]+/.exec(i)?.[0]).filter(Boolean).map((c) => (op === 'KRTC' && c === 'RK' ? 'R' : c)))];
}
