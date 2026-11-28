// 地點查詢（find_place，docs/MCP_TOOLS.md §7）：把「台北101」「北車」這類說法轉成座標。
// 順序：內建地標 core/data/landmarks.json（車站類標 source=station）→ 外部地理編碼（⚠️ 待 M1 驗證，尚未串接）。
// 不呼叫外部 API，live 與示範模式共用同一份資料。
import landmarks from '../data/landmarks.json' with { type: 'json' };
import towns from '../data/towns.json' with { type: 'json' };
import { resolveCity } from '../cities.js';
import { UserError, distanceM } from '../util.js';

export const MAX_RESULTS = 5;

/** 比對用：臺→台、去空白與常見標點、英文小寫（不去「站」，避免「西門站」對到「西門」） */
export const normPlace = (s = '') => String(s).replace(/臺/g, '台').replace(/[\s·・()（）「」]/g, '').toLowerCase();

const ITEMS = landmarks.items.map((x) => ({ ...x, keys: [x.name, ...x.aliases].map(normPlace) }));

/**
 * 行政區（2026-11-28 Claude 與 Antigravity 第十一輪）：「去新莊」「汐止會下雨嗎」以前查不到（內建地標沒有區）。
 * core/data/towns.json：365 區，代表點是那一區的戶政事務所（不是區的中心，名稱標「概略位置」）。認得的寫法：
 *   「新北市新莊區」「新北新莊區」「新北新莊」都認；「新莊區」「新莊」只在全台只有一個時認（中正區、中山區、東區要說縣市）；
 *   跟路名、日常用語撞的雙字短名（中山、信義、和平、成功…）只認有「區、鄉、鎮」的（Antigravity：「和平」「成功」不該變成區）。
 */
export const COMMON_SHORT = new Set(['中山', '中正', '信義', '仁愛', '和平', '成功', '大同', '光復', '復興', '民生', '三民', '新興', '中西', '太平', '清水', '新市', '長治', '永安']); // 也是常見路名或日常用語：要說「區、鄉、鎮」
const townShort = (t) => t.replace(/[區鄉鎮市]$/, '');
const countyShort = (c) => c.replace(/[市縣]$/, '');
const townCount = new Map();
for (const t of towns.items) townCount.set(t.town, (townCount.get(t.town) || 0) + 1);
export const TOWN_ITEMS = towns.items.map((t) => {
  const only = townCount.get(t.town) === 1, short = townShort(t.town), suffix = short !== t.town;
  // 沒寫詞尾的鄉鎮（資料是「臺東縣成功」）：名字本身就是短名，一樣要過護欄（「成功嶺」不是成功鎮）
  const keys = [`${t.county}${t.town}`, `${countyShort(t.county)}${t.town}`, ...(short.length >= 2 ? [`${countyShort(t.county)}${short}`] : []), ...(only && suffix ? [t.town] : []), ...(only && short.length >= 2 && !COMMON_SHORT.has(short) ? [short] : []), ...(!suffix && only ? ['鄉', '鎮', '市'].map((x) => `${t.town}${x}`) : [])]; // 沒寫詞尾的：「成功鎮」「卑南鄉」也認
  return { name: `${t.county}${t.town}`, county: t.county, town: t.town, city: t.city, lat: t.lat, lon: t.lon, kind: 'district', keys: [...new Set(keys.map(normPlace))] };
});
/** 查詢字完全對得上的區（「新莊」「新北新莊」「新莊區」）；全台不只一個的（「中正區」「大安區」）回全部，讓同名流程出題 */
export const townHits = (q) => { const hit = TOWN_ITEMS.filter((x) => x.keys.includes(q)); return hit.length ? hit : /[區鄉鎮]$/.test(q) ? TOWN_ITEMS.filter((x) => normPlace(x.town) === q) : []; };
const asTown = (x) => ({ name: x.name, lat: x.lat, lon: x.lon, city: x.city, source: 'district', kind: 'district', approx: true });

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
      // 有「區、鄉、鎮」詞尾（「大安區」）：區名優先，不被大安站搶走（Antigravity 第十一輪）
      const towns0 = townHits(q).filter((x) => !c || x.city === c.city);
      if (towns0.length && /[區鄉鎮]$/.test(q)) return towns0.slice(0, Math.min(limit, MAX_RESULTS)).map(asTown);
      const marks = ITEMS
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
      return marks.length ? marks : towns0.slice(0, Math.min(limit, MAX_RESULTS)).map(asTown); // 地標找不到才用區（「去新莊」）
    },
  };
}

/**
 * 把「座標或地名」轉成 { name, lat, lon }（traffic_status、plan_trip 共用）。
 * @param {{ find: Function }} places createPlaceServices() 的結果
 * @param {{ lat: number, lon: number, name?: string } | string} x
 */
export async function resolvePoint(places, x) {
  if (typeof x === 'string') {
    const [p] = await places.find({ query: x });
    if (!p) throw new UserError(`找不到「${x}」，請改用座標或更完整的地名（例如「台中車站」）`);
    return { name: p.approx ? `${p.name}（概略位置）` : p.name, lat: p.lat, lon: p.lon }; // 區的代表點是戶政事務所：照實說是概略位置（Antigravity 第十一輪）
  }
  return { name: x.name || `${x.lat.toFixed(4)}, ${x.lon.toFixed(4)}`, lat: x.lat, lon: x.lon };
}

/**
 * 座標所在的縣市（用最近的內建地標推估；40 公里內都沒有地標回 null）。給只有裝置定位、沒說縣市的查詢用（例：「307 到哪了？」）。
 * @returns {string|null} 縣市代碼（例 Taipei）
 */
export function cityNear({ lat, lon }) {
  let best = null, bestD = 40_000;
  for (const x of ITEMS) {
    const d = distanceM(lat, lon, x.lat, x.lon);
    if (d < bestD) { bestD = d; best = x; }
  }
  return best?.city ?? null;
}

/** 測試與資料檢查用 */
export const LANDMARKS = landmarks;
