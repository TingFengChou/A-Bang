// 停車場（2026-11-22 產品負責人「要搭配停車場資訊更好」）：自己開車時，目的地附近的路外停車場與剩餘車位。
// TDX：/basic/v1/Parking/OffStreet/CarPark/City/{City}（$spatialFilter 附近；靜態，1 天）＋ ParkingAvailability（$filter 站 ID；即時 60 秒）。
// ⚠️ 2026-11-23 實測：台北市、新北市的 CarPark 清單是空的（只有空位、沒有座標）→ 這兩市改用市府開放資料（parking-open.js）；
// 台北市空位仍走 TDX（ID 相同），新北市空位用新北開放資料。其他縣市（桃園、台中、高雄、台南…）照舊用 TDX。查不到就回空清單，畫面照實說沒有資料。
import { assertLatLon, distanceM, zh, arr } from '../util.js';
import { cacheOf, rawOpts, STATIC_TTL } from './tdx-cache.js';
import { cityNear } from './places.js';
import { createOpenParkingSource, OPEN_PARKING_CITIES } from './parking-open.js';

/** 找多遠內的停車場（公尺） */
export const PARKING_RADIUS_M = 600;
/** 最多列幾個 */
export const PARKING_MAX = 5;
/** 空位即時資料快取（秒） */
export const AVAIL_TTL = 60;

const pos = (p) => (Number.isFinite(p?.PositionLat) && Number.isFinite(p?.PositionLon) ? { lat: p.PositionLat, lon: p.PositionLon } : null);
/** TDX CarPark → 正規化（防禦性解析：欄位缺就省略） */
export function normCarPark(x) {
  const p = pos(x?.CarParkPosition);
  if (!x?.CarParkID || !p) return null;
  return { id: String(x.CarParkID), name: zh(x.CarParkName) || String(x.CarParkID), ...p, ...(x.Address && { address: String(x.Address) }), ...(x.FareDescription && { fare: String(x.FareDescription).slice(0, 80) }), live: x.LiveOccuppancyAvailable === 1 };
}
/** 空位：AvailableSpaces（< 0 或缺＝不知道） */
export function normAvail(list) {
  const out = new Map();
  for (const a of arr(list)) {
    const n = Number(a?.AvailableSpaces);
    if (a?.CarParkID) out.set(String(a.CarParkID), { available: Number.isFinite(n) && n >= 0 ? n : null, ...(Number.isFinite(Number(a.TotalSpaces)) && { total: Number(a.TotalSpaces) }), full: a.FullStatus === 1 });
  }
  return out;
}
const noRoom = (l) => (l.available === 0 || l.full === true ? 1 : 0);
/** 依距離排序、有空位的優先（知道沒空位的放後面） */
export function rankLots(lots, to) {
  return lots.map((l) => ({ ...l, distanceM: Math.round(distanceM(to.lat, to.lon, l.lat, l.lon)) }))
    .filter((l) => l.distanceM <= PARKING_RADIUS_M)
    .sort((a, b) => noRoom(a) - noRoom(b) || a.distanceM - b.distanceM)
    .slice(0, PARKING_MAX);
}

/**
 * @param {object} tdx
 * @param {{ od?: { get: Function } | null }} [opts] od：免金鑰開放資料 client；有才用台北市、新北市的市府資料
 */
export function createParkingServices(tdx, { od = null } = {}) {
  const { cached } = cacheOf(tdx);
  const open = od ? createOpenParkingSource(od) : null;
  const tdxAvail = async (c, near) => {
    const ids = near.filter((l) => l.live && /^[\w-]+$/.test(l.id)).map((l) => `'${l.id}'`); // ID 會放進 OData 篩選：只收英數字
    if (!ids.length) return new Map();
    const v = await tdx.get(`/basic/v1/Parking/OffStreet/ParkingAvailability/City/${c}`, { $filter: `CarParkID in (${ids.join(',')})` }, AVAIL_TTL).catch(() => null);
    return normAvail(v?.ParkingAvailabilities ?? v);
  };
  return {
    parking: {
      /**
       * 目的地附近的停車場（含剩餘車位，查得到才有）
       * @returns {Promise<{ city: string|null, lots: Array<object>, noData?: boolean }>}
       */
      async nearby({ lat, lon, city }) {
        [lat, lon] = assertLatLon(lat, lon);
        const c = city || cityNear({ lat, lon });
        if (!c) return { city: null, lots: [], noData: true };
        if (open && OPEN_PARKING_CITIES.includes(c)) {
          // 台北市、新北市：整市清單（1 天）裡挑 600 公尺內的；空位台北走 TDX、新北走開放資料（查不到空位照列停車場，只是不知道剩幾位）
          const near = rankLots(await open.lots(c), { lat, lon });
          if (!near.length) return { city: c, lots: [], noData: true };
          const avail = c === 'Taipei' ? await tdxAvail(c, near) : await open.availability(c).catch(() => new Map());
          return { city: c, lots: rankLots(near.map((l) => ({ ...l, ...(avail.get(l.id) || {}) })), { lat, lon }) };
        }
        const key = `parking-${c}-${lat.toFixed(3)}-${lon.toFixed(3)}`; // 約 100 公尺一格
        const lots = await cached(key, STATIC_TTL, async (o) => {
          const r = await tdx.get(`/basic/v1/Parking/OffStreet/CarPark/City/${c}`, { $spatialFilter: `nearby(${lat},${lon},${PARKING_RADIUS_M})` }, 60, rawOpts(o));
          return arr(r?.CarParks ?? r).map(normCarPark).filter(Boolean);
        });
        if (!lots.length) return { city: c, lots: [], noData: true };
        const near = rankLots(lots, { lat, lon });
        const avail = await tdxAvail(c, near);
        return { city: c, lots: rankLots(near.map((l) => ({ ...l, ...(avail.get(l.id) || {}) })), { lat, lon }) };
      },
    },
  };
}
