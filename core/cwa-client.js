// 中央氣象署開放資料平臺 client：授權碼放在 query（只在伺服器端）、回應快取
// 文件：https://opendata.cwa.gov.tw/dist/opendata-swagger.html
const API_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';

export class CwaError extends Error {
  constructor(status, msg) { super(msg); this.name = 'CwaError'; this.status = status; }
}

export function createCwaClient({ apiKey, fetchImpl = fetch }) {
  const cache = new Map(); // dataId+query -> { exp, data }

  /**
   * @param {string} dataId 例如 'O-A0001-001'
   * @param {object} query 其他查詢參數，例如 { LocationName: '中正區' }
   * @param {number} ttlSec 快取秒數
   */
  async function get(dataId, query = {}, ttlSec = 600) {
    const qs = new URLSearchParams({ format: 'JSON', ...query });
    const key = `${dataId}?${qs}`; // 快取鍵不含授權碼
    const hit = cache.get(key);
    if (hit && Date.now() < hit.exp) return hit.data;
    let res;
    try {
      res = await fetchImpl(`${API_BASE}/${dataId}?${qs}&Authorization=${encodeURIComponent(apiKey)}`);
    } catch {
      // 不保留原始例外（cause 可能含請求網址，網址裡有授權碼）；只留不含金鑰的訊息
      throw new CwaError(502, `氣象署連線失敗（${dataId}）`);
    }
    if (res.status === 401 || res.status === 403) throw new CwaError(res.status, '氣象署授權碼無效，請確認 CWA_API_KEY');
    if (!res.ok) throw new CwaError(res.status, `氣象署 API 錯誤 ${res.status}`);
    const data = await res.json();
    if (data?.success === 'false' || data?.success === false) throw new CwaError(502, '氣象署 API 回應失敗');
    cache.set(key, { exp: Date.now() + ttlSec * 1000, data });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return data;
  }
  return { get };
}
