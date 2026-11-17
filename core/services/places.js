// 地點查詢（find_place，docs/MCP_TOOLS.md §7）：把「台北101」「北車」這類說法轉成座標。
// 順序：內建地標 core/data/landmarks.json（車站類標 source=station）→ 外部地理編碼（⚠️ 待 M1 驗證，尚未串接）。
// 不呼叫外部 API，live 與示範模式共用同一份資料。
import landmarks from '../data/landmarks.json' with { type: 'json' };
import { resolveCity } from '../cities.js';
import { UserError } from '../util.js';

export const MAX_RESULTS = 5;

/** 比對用：臺→台、去空白與常見標點、英文小寫（不去「站」，避免「西門站」對到「西門」） */
export const normPlace = (s = '') => String(s).replace(/臺/g, '台').replace(/[\s·・()（）「」]/g, '').toLowerCase();

const ITEMS = landmarks.items.map((x) => ({ ...x, keys: [x.name, ...x.aliases].map(normPlace) }));

/**
 * 比對分數：3 名稱或別名完全相同、2 以查詢字開頭、1 互相包含（「我要去台北101」也能找到）；0 不相符。
 * @param {string} q 已正規化的查詢
 */
function score(item, q) {
  let best = 0;
  for (const k of item.keys) {
    if (k === q) return 3;
    if (k.startsWith(q)) best = Math.max(best, 2);
    else if (k.includes(q) || (k.length >= 2 && q.includes(k))) best = Math.max(best, 1);
  }
  return best;
}

export function createPlaceServices() {
  return {
    /**
     * @param {{ query: string, city?: string, limit?: number }} p
     * @returns {Promise<Array<{ name: string, lat: number, lon: number, city: string, source: 'landmark'|'station'|'geocode', kind: string }>>}
     */
    async find({ query, city, limit = MAX_RESULTS }) {
      const q = normPlace(query);
      if (!q) throw new UserError('請提供要找的地點名稱，例如「台北101」或「高雄車站」');
      let c = null;
      if (city) {
        c = resolveCity(city);
        if (!c) throw new UserError(`無法辨識縣市「${city}」，可用 Taipei、台北市、臺北 等寫法`);
      }
      return ITEMS
        .filter((x) => !c || x.city === c.city)
        .map((x) => ({ x, s: score(x, q) }))
        .filter((r) => r.s > 0)
        // 分數高優先；同分時車站優先（行程起訖最常用），再取名稱短的（較精準）
        .sort((a, b) => b.s - a.s || (b.x.kind === 'station') - (a.x.kind === 'station') || a.x.name.length - b.x.name.length)
        .slice(0, Math.min(limit, MAX_RESULTS))
        .map(({ x }) => ({
          name: x.name, lat: x.lat, lon: x.lon, city: x.city,
          source: x.kind === 'station' ? 'station' : 'landmark', kind: x.kind,
        }));
    },
  };
}

/** 測試與資料檢查用 */
export const LANDMARKS = landmarks;
