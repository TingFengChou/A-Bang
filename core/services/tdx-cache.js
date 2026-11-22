// 服務層使用 TDX 快取的共用介面（可被瀏覽器示範版打包：這裡不 import 任何 node 模組）。
// 測試常給只有 get() 的假 tdx：沒有快取層時，cached 直接下載、stored 回 undefined、meta 包成 { data, at }。

/** 靜態資料（站牌、站序、車站、時刻表）：新鮮 1 天；過期仍可用 30 天（背景更新），存檔讓重啟後不必重抓 */
export const STATIC_TTL = 86400;

export function cacheOf(tdx) {
  return {
    /** 靜態資料：記憶體 → 檔案 → 下載；loader 回傳正規化結果（會存檔） */
    cached: (key, ttl, loader, o) => (tdx.cached ? tdx.cached(key, ttl, loader, o) : loader({ background: false })),
    /** 只拿記憶體或檔案裡已有的（不在使用者這一次下載整個縣市的大檔）；沒有回 undefined */
    stored: async (key, ttl, loader) => (tdx.cached ? tdx.cached(key, ttl, loader, { onlyStored: true }) : undefined),
    /** 即時資料：回 { data, at, stale }（at＝資料取得時間；stale＝額度快用完時用了不到一分鐘前的舊資料） */
    meta: (path, q, ttl, o) => (tdx.getMeta ? tdx.getMeta(path, q, ttl, o) : tdx.get(path, q, ttl).then((data) => ({ data, at: Date.now(), stale: false }))),
  };
}

/** loader 裡打 TDX 的選項：照傳 background，原始大回應不放記憶體（正規化結果另外保存） */
export const rawOpts = (o = {}) => ({ background: Boolean(o.background), cache: false });
