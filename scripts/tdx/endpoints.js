// M1 TDX 實測：要驗證的端點清單（scripts/verify-tdx.js 與 scripts/record-fixtures.js 共用）。
// 每個端點：id（也是 fixture 檔名 test/fixtures/tdx-<id>.json）、title、path、query（OData）、
// check(rows, data, ctx) → 補充說明（驗證用，例：座標完整度、欄位型別）、record：false＝只驗證不錄（回應太大或不需要）、
// pick(data, ctx)：錄 fixture 時怎麼取（預設每個陣列取前 5 筆）、plus：查詢字串的空白用 + 而不是 %20（驗證 OData 編碼）。
// 不含金鑰；查詢參數只有公開的路線、車站與台北市政府的地址。
import { parseWkt } from '../../core/geo.js';

/** 回應裡的資料列：陣列本身，或包在 { Xxx: [...] } 裡的第一個陣列 */
export function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') for (const v of Object.values(data)) if (Array.isArray(v)) return v;
  return [];
}

/** 錄 fixture 的預設取法：陣列取前 n 筆；包裝物件保留其他欄位（UpdateTime 等），裡面的陣列取前 n 筆 */
export function firstN(data, n = 5) {
  if (Array.isArray(data)) return data.slice(0, n);
  if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, n) : v]));
  return data;
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
const count = (list, f) => list.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('、');
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const okPos = (p) => Number.isFinite(p?.PositionLat) && Number.isFinite(p?.PositionLon) && p.PositionLat !== 0 && p.PositionLon !== 0;

/** 路線站序的座標完整度（StopPosition） */
function stopPositions(rows) {
  const stops = rows.flatMap((r) => r.Stops || []);
  const ok = stops.filter((s) => okPos(s.StopPosition)).length;
  const zero = stops.filter((s) => s.StopPosition && (s.StopPosition.PositionLat === 0 || s.StopPosition.PositionLon === 0)).length;
  return [`路線 ${rows.length} 條、站 ${stops.length} 個；StopPosition 有效 ${ok}（${pct(ok, stops.length)}），0,0 ${zero}，缺 ${stops.length - ok - zero}`];
}

/** WKT 形狀：類型、可解析比例、點數 */
function wktShapes(rows, field = 'Geometry') {
  const kinds = count(rows, (r) => /^\s*(SRID=\d+;)?\s*([A-Z]+)/i.exec(String(r[field] ?? ''))?.[2] || typeOf(r[field]));
  const parsed = rows.map((r) => parseWkt(r[field]));
  const ok = parsed.filter((p) => p.length).length;
  const pts = parsed.map((p) => p.reduce((n, l) => n + l.length, 0)).filter(Boolean);
  return [`${field} 類型：${fmt(kinds)}；core/geo.js 解析成功 ${ok}/${rows.length}${pts.length ? `，點數 ${Math.min(...pts)}～${Math.max(...pts)}` : ''}`,
    ...(rows[0] && field in rows[0] ? [`第一筆 ${field} 開頭：${String(rows[0][field]).slice(0, 60)}…`] : [])];
}

/** 站間行駛時間（秒）：TravelTimes 是「起站 → 各站」的累計 RunTime（2026-11-23 實測），直接找那一對；沒有回 null */
function rideSec(tts, from, to) {
  const t = tts.find((x) => x.FromStationID === from && x.ToStationID === to);
  return t ? Number(t.RunTime) + (Number(t.StopTime) || 0) : null;
}

const SPATIAL = { $spatialFilter: 'nearby(25.0478,121.517,300)', $top: 30 }; // 台北車站

/** @type {Array<{ id: string, title: string, path: string | ((ctx: object) => string), query?: object | ((ctx: object) => object), check?: Function, record?: boolean, pick?: Function, plus?: boolean, after?: string }>} */
export const ENDPOINTS = [
  // ───── 公車 ─────
  {
    id: 'bus-shape-taipei-307', title: '公車路線形狀 WKT（台北 307）',
    path: '/basic/v2/Bus/Shape/City/Taipei/307', query: { $filter: "RouteName/Zh_tw eq '307'" },
    check: (rows) => [`方向：${fmt(count(rows, (r) => r.Direction))}`, ...wktShapes(rows), ...('EncodedPolyline' in (rows[0] || {}) ? ['另有 EncodedPolyline'] : [])],
  },
  {
    id: 'bus-route-eta-taipei-307', title: '公車路線到站（台北 307，StopStatus／NextBusTime）',
    path: '/basic/v2/Bus/EstimatedTimeOfArrival/City/Taipei/307', query: { $filter: "RouteName/Zh_tw eq '307'" },
    check: (rows) => [`StopStatus：${fmt(count(rows, (r) => r.StopStatus))}`, `有 EstimateTime ${rows.filter((r) => Number.isFinite(r.EstimateTime)).length}、有 NextBusTime ${rows.filter((r) => r.NextBusTime).length}${rows.find((r) => r.NextBusTime) ? `（例 ${rows.find((r) => r.NextBusTime).NextBusTime}）` : ''}`],
  },
  {
    id: 'bus-display-stop-of-route-taipei', title: '公車路線站序 StopPosition 完整度（臺北市）',
    path: '/basic/v2/Bus/DisplayStopOfRoute/City/Taipei', query: { $select: 'RouteUID,RouteName,Direction,Stops' },
    check: stopPositions,
  },
  {
    id: 'bus-display-stop-of-route-taichung', title: '公車路線站序 StopPosition 完整度（臺中市）',
    path: '/basic/v2/Bus/DisplayStopOfRoute/City/Taichung', query: { $select: 'RouteUID,RouteName,Direction,Stops' },
    check: stopPositions, record: false,
  },
  // 2026-11-23 實測：DisplayStopOfRoute 只收 Taipei、Tainan、NewTaipei、Taoyuan、Taichung（其他縣市 400），其他縣市用 StopOfRoute（有子路線）
  {
    id: 'bus-stop-of-route-kaohsiung', title: '公車路線站序 StopOfRoute（高雄市；DisplayStopOfRoute 不收）',
    path: '/basic/v2/Bus/StopOfRoute/City/Kaohsiung', query: { $select: 'RouteUID,RouteName,SubRouteUID,SubRouteName,Direction,Stops' },
    check: (rows) => {
      const per = count(rows, (r) => `${r.RouteUID}|${r.Direction}`);
      return [...stopPositions(rows), `同一路線同方向有多個子路線的 ${Object.values(per).filter((n) => n > 1).length} 組（共 ${Object.keys(per).length} 組）`];
    },
    // 前 5 筆＋第一條「同方向有多個子路線」的路線全部（測試子路線合併）
    pick: (data) => {
      const rows = rowsOf(data);
      const per = count(rows, (r) => `${r.RouteUID}|${r.Direction}`);
      const multi = Object.keys(per).find((k) => per[k] > 1)?.split('|')[0];
      const extra = multi ? rows.filter((r) => r.RouteUID === multi) : [];
      return [...rows.slice(0, 5), ...extra.filter((r) => !rows.slice(0, 5).includes(r))];
    },
  },
  {
    id: 'bus-stop-of-route-hualiencounty', title: '公車路線站序 StopOfRoute（花蓮縣）',
    path: '/basic/v2/Bus/StopOfRoute/City/HualienCounty', query: { $select: 'RouteUID,RouteName,SubRouteUID,SubRouteName,Direction,Stops' },
    check: stopPositions, record: false,
  },
  {
    id: 'bus-station-nearby', title: '附近公車站位 NearBy（台北車站 300 公尺）',
    path: '/advanced/v2/Bus/Station/NearBy', query: SPATIAL,
    check: (rows) => [`StationPosition 有效 ${rows.filter((r) => okPos(r.StationPosition)).length}/${rows.length}；有 Stops ${rows.filter((r) => r.Stops?.length).length}`],
  },
  // OData 空白編碼：同一個查詢用 %20 與 + 各打一次，筆數一樣就表示兩種都可以
  {
    id: 'bus-route-taipei-307', title: 'OData 空白用 %20（台北路線 307）',
    path: '/basic/v2/Bus/Route/City/Taipei', query: { $filter: "RouteName/Zh_tw eq '307'", $select: 'RouteUID,RouteName,DepartureStopNameZh,DestinationStopNameZh' },
    check: (rows, _d, ctx) => { ctx.odataPct = rows.length; return []; },
  },
  {
    id: 'odata-plus', title: 'OData 空白用 +（同上查詢）', plus: true, record: false,
    path: '/basic/v2/Bus/Route/City/Taipei', query: { $filter: "RouteName/Zh_tw eq '307'", $select: 'RouteUID,RouteName,DepartureStopNameZh,DestinationStopNameZh' },
    check: (rows, _d, ctx) => [ctx.odataPct == null ? '（%20 那一次沒有結果可比）' : rows.length === ctx.odataPct ? `+ 與 %20 結果相同（${rows.length} 筆）→ %20 不是必要，但保留無妨` : `+ ${rows.length} 筆、%20 ${ctx.odataPct} 筆 → 不同，%20 必要`],
  },
  // ───── 國道路況 ─────
  {
    id: 'freeway-section-shape', title: '國道路段形狀 SectionShape',
    path: '/basic/v2/Road/Traffic/SectionShape/Freeway',
    check: (rows, data, ctx) => { ctx.shapes = rows; return [`包裝：${Object.keys(data || {}).join('、') || '陣列'}`, ...wktShapes(rows)]; },
    pick: (data, ctx) => { ctx.freewayIds = rowsOf(data).slice(0, 5).map((r) => r.SectionID); return firstN(data); },
  },
  {
    id: 'freeway-section', title: '國道路段 Section（名稱、速限、長度）',
    path: '/basic/v2/Road/Traffic/Section/Freeway',
    check: (rows, data, ctx) => {
      ctx.sections = rows;
      const shapeIds = new Set((ctx.shapes || []).map((s) => s.SectionID));
      return [`包裝：${Object.keys(data || {}).join('、') || '陣列'}`, `RoadName：${fmt(count(rows, (r) => r.RoadName))}`,
        `SectionName 型別 ${typeOf(rows[0]?.SectionName)}、SectionLength ${typeOf(rows[0]?.SectionLength)}、SpeedLimit ${typeOf(rows[0]?.SpeedLimit)}`,
        ...(ctx.shapes ? [`與形狀對得上的 SectionID ${rows.filter((r) => shapeIds.has(r.SectionID)).length}/${rows.length}`] : [])];
    },
    needs: 'freeway-section-shape', pick: (data, ctx) => (ctx.freewayIds ? { ...data, Sections: rowsOf(data).filter((r) => ctx.freewayIds.includes(r.SectionID)) } : null),
  },
  {
    id: 'freeway-live', title: '國道即時車速 Live',
    path: '/basic/v2/Road/Traffic/Live/Freeway',
    check: (rows, data, ctx) => {
      const ids = new Set((ctx.shapes || []).map((s) => s.SectionID));
      const sp = rows.map((r) => Number(r.TravelSpeed));
      return [`包裝：${Object.keys(data || {}).join('、') || '陣列'}`, `TravelSpeed：0 有 ${sp.filter((x) => x === 0).length}、負數 ${sp.filter((x) => x < 0).length}（例 ${[...new Set(sp.filter((x) => x < 0))].slice(0, 3).join('、') || '—'}）、正數 ${sp.filter((x) => x > 0).length}`,
        `CongestionLevel：${fmt(count(rows, (r) => r.CongestionLevel))}`, `DataCollectTime 例：${rows[0]?.DataCollectTime ?? '—'}`,
        ...(ctx.shapes ? [`與形狀對得上的 SectionID ${rows.filter((r) => ids.has(r.SectionID)).length}/${rows.length}`] : [])];
    },
    needs: 'freeway-section-shape', pick: (data, ctx) => (ctx.freewayIds ? { ...data, LiveTraffics: rowsOf(data).filter((r) => ctx.freewayIds.includes(r.SectionID)) } : null),
  },
  {
    id: 'freeway-news', title: '國道事件 Live/News',
    path: '/basic/v2/Road/Traffic/Live/News/Freeway',
    check: (rows, data) => [`包裝：${Object.keys(data || {}).join('、') || '陣列'}`, `第一筆標題：${rows[0]?.Title ?? '—'}`, `PublishTime 例：${rows[0]?.PublishTime ?? '—'}`],
  },
  {
    id: 'freeway-road-event', title: '國道道路事件 RoadEvent/LiveEvent（News 沒有路名時的替代）',
    path: '/basic/v1/Traffic/RoadEvent/LiveEvent/Freeway', query: { $top: 5 },
    check: (rows, data) => [`包裝：${Object.keys(data || {}).join('、') || '陣列'}`, `第一筆：${JSON.stringify(rows[0] ?? null).slice(0, 300)}`],
  },
  // ───── 國道客運 ─────
  {
    id: 'intercity-stop-of-route', title: '公路客運站序 StopOfRoute/InterCity',
    path: '/basic/v2/Bus/StopOfRoute/InterCity', query: { $select: 'RouteUID,RouteName,SubRouteUID,SubRouteName,Direction,Stops' },
    check: (rows, _d, ctx) => { ctx.intercityRoute = rows.find((r) => (r.Stops || []).length >= 3)?.RouteUID; return stopPositions(rows); },
    pick: (data) => firstN(data),
  },
  {
    id: 'intercity-schedule', title: '公路客運時刻表 Schedule/InterCity',
    path: '/basic/v2/Bus/Schedule/InterCity',
    query: (ctx) => (ctx.intercityRoute ? { $filter: `RouteUID eq '${ctx.intercityRoute}'` } : { $top: 5 }), // 單獨跑時取前 5 條路線（跟站序 fixture 對不上）
    check: (rows) => {
      const tts = rows.flatMap((r) => r.Timetables || []);
      const sd = tts.find((t) => t.ServiceDay)?.ServiceDay;
      return [`路線 ${rows.length}、Timetables ${tts.length}、有 Frequencys ${rows.filter((r) => r.Frequencys?.length).length}`,
        `ServiceDay：${sd ? Object.entries(sd).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : '沒有'}`,
        `StopTimes[0] 欄位：${Object.keys(tts.find((t) => t.StopTimes?.length)?.StopTimes[0] || {}).join(', ') || '—'}`];
    },
    // 每條路線的 Timetables 只留前 5 個（一條路線一天可能上百班）
    pick: (data) => rowsOf(data).slice(0, 5).map((r) => ({ ...r, ...(Array.isArray(r.Timetables) && { Timetables: r.Timetables.slice(0, 5) }) })),
  },
  {
    id: 'intercity-route-fare', title: '公路客運票價 RouteFare/InterCity（端點是否存在）',
    path: '/basic/v2/Bus/RouteFare/InterCity', query: { $top: 2 },
    check: (rows) => [`第一筆票價相關欄位：${Object.keys(rows[0] || {}).filter((k) => /fare|price|section|od/i.test(k)).join(', ') || '—'}`],
  },
  // ───── 捷運 ─────
  {
    id: 'metro-station-timetable-trtc-bl12', title: '北捷站別時刻表 ServiceDay（台北車站 BL12）',
    path: '/basic/v2/Rail/Metro/StationTimeTable/TRTC', query: { $filter: "StationID eq 'BL12'" },
    check: (rows) => {
      const sd = rows.map((r) => r.ServiceDay || {});
      const keys = [...new Set(sd.flatMap((s) => Object.keys(s)))];
      return [`共 ${rows.length} 份（線×方向×班表）`, `ServiceDay 欄位：${keys.join(', ')}`,
        `型別：${[...new Set(sd.flatMap((s) => Object.values(s).map(typeOf)))].join('、')}`,
        `NationalHolidays：${fmt(count(sd, (s) => s.NationalHolidays))}`,
        `每份班表：${rows.map((r) => `${r.LineID}/${r.Direction}→${r.DestinationStationID ?? r.DestinationStaionID}[${['Monday', 'Saturday', 'Sunday', 'NationalHolidays'].filter((d) => r.ServiceDay?.[d]).map((d) => d.slice(0, 3)).join('')}] ${r.Timetables?.length ?? 0} 班`).join('；')}`];
    },
    pick: (data) => rowsOf(data).slice(0, 5).map((r) => ({ ...r, ...(Array.isArray(r.Timetables) && { Timetables: r.Timetables.slice(0, 8) }) })),
  },
  {
    id: 'metro-s2s-travel-time-tymc', title: '機場捷運站間行駛時間 S2STravelTime（直達車參數）',
    path: '/basic/v2/Rail/Metro/S2STravelTime/TYMC', query: { $top: 3 },
    check: (rows) => [`TravelTimes 筆數：${rows.map((r) => r.TravelTimes?.length ?? 0).join('、')}`, `TravelTimes[0] 欄位：${Object.keys(rows[0]?.TravelTimes?.[0] || {}).join(', ') || '—'}`,
      `TrainType：${fmt(count(rows, (r) => r.TrainType ?? '—'))}`,
      ...rows.flatMap((r) => ['A12', 'A13'].map((to) => { const m = rideSec(r.TravelTimes || [], 'A1', to); return m == null ? null : `TrainType ${r.TrainType}：A1 → ${to} 約 ${Math.round(m / 60)} 分（${m} 秒）`; })).filter(Boolean)],
    pick: (data) => rowsOf(data).slice(0, 2).map((r) => ({ ...r, ...(Array.isArray(r.TravelTimes) && { TravelTimes: r.TravelTimes.slice(0, 5) }) })),
  },
  // ───── 高鐵、台鐵車站 ─────
  {
    id: 'thsr-station', title: '高鐵車站座標 StationPosition',
    path: '/basic/v2/Rail/THSR/Station',
    check: (rows) => [`StationPosition 有效 ${rows.filter((r) => okPos(r.StationPosition)).length}/${rows.length}`],
  },
  {
    id: 'tra-station', title: '台鐵車站座標與等級 StationClass（v3）',
    path: '/basic/v3/Rail/TRA/Station',
    check: (rows) => [`StationPosition 有效 ${rows.filter((r) => okPos(r.StationPosition)).length}/${rows.length}`,
      `StationClass：${fmt(count(rows, (r) => r.StationClass ?? '—'))}（型別 ${typeOf(rows[0]?.StationClass)}）`,
      `一等站例：${rows.filter((r) => String(r.StationClass) === '1').slice(0, 6).map((r) => r.StationName?.Zh_tw).join('、') || '—'}`],
  },
  // ───── 地理編碼 ─────
  {
    id: 'geocode-address', title: 'TDX 地理編碼：地址 → 座標',
    path: `/advanced/V3/Map/GeoCode/Coordinate/Address/${encodeURIComponent('臺北市信義區市府路1號')}`,
    check: (rows, data) => [`回應型別 ${typeOf(data)}；第一筆：${JSON.stringify(rows[0] ?? data).slice(0, 160)}`],
  },
  {
    id: 'geocode-markname', title: 'TDX 地理編碼：地標名稱 → 座標',
    path: `/advanced/V3/Map/GeoCode/Coordinate/Markname/${encodeURIComponent('台北101')}`,
    check: (rows, data) => [`回應型別 ${typeOf(data)}；第一筆：${JSON.stringify(rows[0] ?? data).slice(0, 160)}`],
  },
];

export const fixtureName = (id) => `tdx-${id}.json`;

/** 引數：--delay 秒（預設 13，每分鐘 5 次額度與其他程式共用）、--only id1,id2 */
export function parseArgs(argv) {
  const o = { delaySec: 13, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--delay') o.delaySec = Math.max(0, Number(argv[++i]) || 0);
    else if (argv[i] === '--only') o.only = new Set(String(argv[++i] || '').split(',').filter(Boolean));
  }
  return o;
}
