// 台北市、新北市停車場（2026-11-23）：TDX 的 CarPark 清單這兩市是空的，改用市府開放資料（免金鑰）拿停車場座標。
// 台北市：交通局停管處「臺北市停車場資訊」TCMSV_alldesc.json（每月更新，TWD97 座標＋入口座標）；剩餘車位仍走 TDX（ID 相同，TPE0001…，即時）。
// 新北市：交通局「新北市路外公共停車場資訊」＋「新北市公有路外停車場即時賸餘車位數」（data.ntpc.gov.tw，每頁最多 1000 筆，空位約 3 分鐘更新）。
// 只用傳進來的 od（core/opendata-client.js）下載；這裡不 import 任何 node 模組。
import { twd97ToWgs84 } from '../twd97.js';
import { distanceM } from '../util.js';

/** 停車場清單（靜態）快取（秒）：1 天 */
export const OPEN_LOTS_TTL = 86400;
/** 新北市剩餘車位快取（秒） */
export const OPEN_AVAIL_TTL = 60;
/** 台北市 TWD97 座標與入口座標差多遠就當位置不確定、不列（公尺）：寧可不列，也不要叫人開到錯的地方 */
export const COORD_MISMATCH_M = 300;

export const TPE_DESC_URL = 'https://tcgbusfs.blob.core.windows.net/blobtcmsv/TCMSV_alldesc.json';
export const NTPC_DESC = 'https://data.ntpc.gov.tw/api/datasets/b1464ef0-9c7c-4a6f-abf7-6bdf32847e68/json';
export const NTPC_AVAIL = 'https://data.ntpc.gov.tw/api/datasets/e09b35a5-a738-48cc-b0f5-570b67ad9c78/json';
const NTPC_PAGE = 1000; // 平台每頁上限（size=2000 也只回 1000 筆）
const NTPC_MAX_PAGES = 5;

/** 用開放資料的縣市 */
export const OPEN_PARKING_CITIES = ['Taipei', 'NewTaipei'];

const str = (v) => (v == null ? '' : String(v).trim());
/** 收費說明只留第一句（卡片放得下）：「計時：100元/時，停車未滿1小時…」→「計時：100元/時」 */
export function fareOf(v) {
  let s = str(v).split(/[。；;\n]/).map((x) => x.trim()).find(Boolean) || '';
  if (s.length > 40) s = s.split(/[，,]/)[0].trim();
  return s.slice(0, 60);
}
const carTotal = (v) => { const n = Number(v); return str(v) !== '' && Number.isFinite(n) && n >= 0 ? n : null; };

/** TWD97 座標（防禦：東距、北距寫反的換回來） */
function fromTwd97(x, y) {
  const a = Number(x), b = Number(y);
  if (a > 1e6 && b > 1e5 && b < 1e6) return twd97ToWgs84(b, a);
  return twd97ToWgs84(a, b);
}
/** 台北市入口座標（WGS84；Xcod 是緯度、Ycod 是經度，寫反的換回來） */
function entranceOf(p) {
  const e = p?.EntranceCoord?.EntrancecoordInfo;
  const first = Array.isArray(e) ? e[0] : e;
  let lat = Number(first?.Xcod), lon = Number(first?.Ycod);
  if (lat > 100 && lon < 30) [lat, lon] = [lon, lat];
  return lat > 21.5 && lat < 25.6 && lon > 119.2 && lon < 122.2 ? { lat, lon } : null;
}

/**
 * 台北市停車場一筆 → 正規化。座標：TWD97 換算與入口座標都有且相近 → 用入口（車子開進去的地方）；
 * 兩個差太多（資料有誤，2026-11-23 實測約一成）→ 不收；只有一個 → 用那一個。只收得下機車的（小型車 0 格）不收。
 */
export function normTaipeiLot(p) {
  const id = str(p?.id);
  if (!id) return null;
  const total = carTotal(p.totalcar);
  if (total === 0) return null;
  const tw = fromTwd97(p.tw97x, p.tw97y);
  const en = entranceOf(p);
  if (tw && en && distanceM(tw.lat, tw.lon, en.lat, en.lon) > COORD_MISMATCH_M) return null;
  const pos = en || tw;
  if (!pos) return null;
  const fare = fareOf(p.payex);
  return { id, name: str(p.name) || id, ...pos, ...(str(p.address) && { address: str(p.address) }), ...(fare && { fare }), ...(total != null && { total }), live: true };
}

/** 新北市停車場一筆 → 正規化（只有 TWD97；座標 0 或不在台灣的不收；小型車 0 格不收） */
export function normNtpcLot(p) {
  const id = str(p?.ID);
  if (!id) return null;
  const total = carTotal(p.TOTALCAR);
  if (total === 0) return null;
  const pos = fromTwd97(p.TW97X, p.TW97Y);
  if (!pos) return null;
  const fare = fareOf(p.PAYEX);
  return { id, name: str(p.NAME) || id, ...pos, ...(str(p.ADDRESS) && { address: str(p.ADDRESS) }), ...(fare && { fare }), ...(total != null && { total }), live: true };
}

/** 新北市剩餘車位：AVAILABLECAR（說明文件寫 AVAILABLE，兩個都收）；-9 或缺＝不知道 */
export function normNtpcAvail(list) {
  const out = new Map();
  for (const a of Array.isArray(list) ? list : []) {
    const raw = a?.AVAILABLECAR ?? a?.AVAILABLE;
    const n = Number(raw);
    if (a?.ID != null && str(raw) !== '') out.set(str(a.ID), { available: Number.isFinite(n) && n >= 0 ? n : null });
  }
  return out;
}

/** 台北市清單（整包）：{ data: { park: [...] } } */
export function parseTaipeiDesc(raw) {
  const list = raw?.data?.park ?? raw?.park;
  if (!Array.isArray(list)) throw new Error('沒有停車場清單');
  const lots = list.map(normTaipeiLot).filter(Boolean);
  if (!lots.length) throw new Error('停車場清單是空的');
  return lots;
}

/**
 * @param {{ get: Function }} od core/opendata-client.js
 */
export function createOpenParkingSource(od) {
  /** 新北市分頁下載（每頁最多 1000 筆；不滿一頁就是最後一頁） */
  async function pages(base, ttlSec, label, norm) {
    const out = [];
    for (let i = 0; i < NTPC_MAX_PAGES; i++) {
      const page = await od.get(`${base}?page=${i}&size=${NTPC_PAGE}`, {
        ttlSec, label, as: 'json', maxBytes: 4_000_000,
        parse: (raw) => { if (!Array.isArray(raw)) throw new Error('不是清單'); return { n: raw.length, items: norm(raw) }; },
      });
      out.push(page.items);
      if (page.n < NTPC_PAGE) break;
    }
    return out;
  }
  return {
    /**
     * 整個縣市的停車場（正規化、已有 WGS84 座標）
     * @param {'Taipei'|'NewTaipei'} city
     */
    async lots(city) {
      if (city === 'Taipei') return od.get(TPE_DESC_URL, { ttlSec: OPEN_LOTS_TTL, label: '台北市停車場資料', as: 'json', maxBytes: 16_000_000, parse: parseTaipeiDesc });
      if (city === 'NewTaipei') {
        const lots = (await pages(NTPC_DESC, OPEN_LOTS_TTL, '新北市停車場資料', (raw) => raw.map(normNtpcLot).filter(Boolean))).flat();
        if (!lots.length) throw new Error('新北市停車場資料是空的');
        return lots;
      }
      return [];
    },
    /** 新北市剩餘車位（ID → { available }）；台北市的空位走 TDX */
    async availability(city) {
      if (city !== 'NewTaipei') return new Map();
      const maps = await pages(NTPC_AVAIL, OPEN_AVAIL_TTL, '新北市停車場空位', (raw) => [...normNtpcAvail(raw)]);
      return new Map(maps.flat());
    },
  };
}
