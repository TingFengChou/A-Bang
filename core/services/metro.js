// 捷運服務（真實 TDX 版）：車站清單與即時到站看板（docs/MCP_TOOLS.md §5）
// ⚠️ 端點與欄位待 M1 驗證：欄位依 TDX Swagger 防禦性解析；北捷看板資料有限，空資料時回傳空 trains。
import { UserError, normName, zh, enField, arr, odataStr as q } from '../util.js';

/** 支援的捷運系統（TDX Operator 代碼） */
export const METRO_SYSTEMS = {
  TRTC: '台北捷運',
  TYMC: '桃園機場捷運',
  TMRT: '台中捷運',
  KRTC: '高雄捷運',
};


/** 看板分鐘數 → 易讀文字 */
export function metroStatusText(etaMin) {
  if (etaMin == null) return '—';
  if (etaMin <= 0) return '進站中';
  if (etaMin <= 1) return '即將進站';
  return `${etaMin} 分`;
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

export function createMetroServices(tdx) {
  const metro = {
    /** 車站清單（同一站多條線時以第一個代碼為準，lines 列出所有代碼） */
    async stations({ system }) {
      const op = mustSystem(system);
      const rows = await tdx.get(`/basic/v2/Rail/Metro/Station/${op}`, { $select: 'StationID,StationName,StationPosition' }, 86400);
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
    },

    /** 某站即時到站（各線各方向） */
    async liveBoard({ system, station }) {
      const op = mustSystem(system);
      const st = findMetroStation(await metro.stations({ system: op }), station, op);
      const filter = st.ids.map((id) => `StationID eq '${q(id)}'`).join(' or ');
      const rows = await tdx.get(`/basic/v2/Rail/Metro/LiveBoard/${op}`, { $filter: filter }, 20);
      const list = arr(rows, 'LiveBoards');
      const trains = list.map((r) => {
        const etaMin = Number.isFinite(r.EstimateTime) ? r.EstimateTime : null;
        return {
          line: zh(r.LineName) || r.LineID || r.LineNO || '', ...enField('lineEn', r.LineName),
          lineId: r.LineID || r.LineNO || null,
          destination: zh(r.DestinationStationName) || zh(r.TripHeadSign) || '', ...enField('destinationEn', r.DestinationStationName),
          etaMin, status: metroStatusText(etaMin),
        };
      }).sort(sortByEta);
      const updatedAt = list.map((r) => r.UpdateTime).filter(Boolean).sort().at(-1) || new Date().toISOString();
      return {
        system: op, station: st.name, ...(st.nameEn && { stationEn: st.nameEn }), stationId: st.id,
        ...(st.lat != null && { lat: st.lat, lon: st.lon }),
        updatedAt, trains,
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
