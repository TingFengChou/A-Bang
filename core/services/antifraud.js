// 防詐資料（M7-02，AGENT_ANTIFRAUD.md §2）：165 遭停止解析涉詐網站、165 詐騙闢謠專區（政府開放資料 CSV，免金鑰）。
// 只比對網域、不開啟使用者的連結；資料在伺服器記憶體建索引，24 小時更新一次。
import { csvObjects } from '../csv.js';
import { shown } from '../util.js';
import { recordFetch } from '../metrics.js';

const BASE = 'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset';
export const SOURCES = {
  sites: { url: `${BASE}/29E8E643-88ED-4952-B21E-BD42A3B7108C/resource/E0CFB126-EE74-40E6-8E68-F368920F7227/download`, cols: ['民國年月', '網域', '網站性質'] },
  myths: { url: `${BASE}/4F4DF9A5-DF4C-4EE8-A50D-869347D38D9E/resource/A4E75CC0-0EBC-4605-B317-08C517A9F18E/download`, cols: ['編號', '標題', '發佈時間', '發佈內容'] },
};
const TTL_MS = 24 * 3600e3;

export class OpenDataError extends Error {
  constructor(msg) { super(msg); this.name = 'OpenDataError'; this.status = 502; }
}

/** 網址或網域 → 小寫主機名稱（去 www.、結尾點、port）；不是合理的主機名稱回 null */
export function hostOf(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^@/]*@/, '');
  s = s.split(/[/?#\\\s]/)[0].replace(/:\d+$/, '').replace(/\.+$/, '').replace(/^www\./, '');
  try { s = new URL(`http://${s}`).hostname; } catch { return null; } // 中文網域轉 punycode
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s.replace(/^www\./, '') : null;
}

/** 民國年月 11412 → '2025-12' */
const rocMonth = (v) => { const m = String(v).match(/^(\d{2,3})(\d{2})$/); return m ? `${Number(m[1]) + 1911}-${m[2]}` : String(v || ''); };

/** 由 CSV 文字建立索引（真實與示範共用） */
export function buildIndex({ sitesCsv, mythsCsv }) {
  const sites = new Map(); // 網域 → { category, month, basis }
  for (const r of csvObjects(sitesCsv, SOURCES.sites.cols)) {
    const d = hostOf(r['網域']);
    if (d && !sites.has(d)) sites.set(d, { category: r['網站性質'] || '未分類', month: rocMonth(r['民國年月']), basis: r['法律依據'] || '' });
  }
  const myths = csvObjects(mythsCsv, SOURCES.myths.cols).map((r) => ({
    id: String(r['編號']), title: r['標題'], date: (r['發佈時間'] || '').slice(0, 10).replaceAll('/', '-'), body: r['發佈內容'].replace(/\s+/g, ' ').trim(),
  })).filter((m) => m.title);
  return { sites, myths };
}

/** 主機名稱本身或任一上層網域在清單上就算命中（sub.bad.com 命中 bad.com） */
function lookup(index, domain) {
  const parts = domain.split('.');
  const matches = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    const hit = index.sites.get(d);
    if (hit) matches.push({ domain: d, ...hit });
  }
  return matches;
}

/** 闢謠搜尋：把查詢切成詞（中文 2 字一組＋英數詞），標題命中權重 3、內文 1 */
export function searchMyths(myths, query, limit = 5) {
  const q = String(query ?? '').toLowerCase();
  const words = [...new Set([...(q.match(/[a-z0-9]{2,}/g) || []), ...[...q.replace(/[^一-鿿]/g, '')].map((c, i, a) => (a[i + 1] ? c + a[i + 1] : '')).filter(Boolean)])];
  if (!words.length) return [];
  return myths.map((m) => {
    const t = m.title.toLowerCase(), b = m.body.toLowerCase();
    const score = words.reduce((n, w) => n + (t.includes(w) ? 3 : 0) + (b.includes(w) ? 1 : 0), 0);
    return { m, score };
  }).filter((x) => x.score >= Math.min(3, words.length)).sort((a, b) => b.score - a.score || b.m.date.localeCompare(a.m.date)).slice(0, limit)
    .map(({ m }) => ({ id: m.id, title: m.title, date: m.date, summary: m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body }));
}

/**
 * @param {{ load: () => Promise<{ sitesCsv: string, mythsCsv: string }>, now?: () => number }} opts load：取得兩份 CSV（真實：下載；示範：fixtures）
 */
export function createAntifraudFromLoader({ load, now = () => Date.now() }) {
  let cached = null; // { exp, index } 或載入中的 Promise
  async function index() {
    if (cached?.index && now() < cached.exp) { recordFetch({ cacheHit: true, data: [] }); return cached.index; }
    if (cached?.pending) return cached.pending;
    const pending = load().then((csv) => {
      const idx = buildIndex(csv);
      recordFetch({ cacheHit: false, data: [...idx.sites.keys(), ...idx.myths] });
      cached = { exp: now() + TTL_MS, index: idx };
      return idx;
    }).catch((e) => {
      cached = cached?.index ? { ...cached, pending: null } : null; // 失敗時保留舊索引（若有）
      if (cached?.index) return cached.index;
      throw e instanceof OpenDataError ? e : new OpenDataError(`165 開放資料讀取失敗：${e.message}`);
    });
    cached = { ...(cached || {}), pending };
    return pending;
  }
  return {
    antifraud: {
      async lookupUrl(input) {
        const domain = hostOf(input);
        if (!domain) return { input, domain: null, listed: false, matches: [] };
        const matches = lookup(await index(), domain);
        return { input, domain, listed: matches.length > 0, matches };
      },
      async searchMyths(query, limit) { return searchMyths((await index()).myths, query, limit); },
      async stats() { const i = await index(); return { sites: i.sites.size, myths: i.myths.length }; },
    },
  };
}

/** 真實：下載政府開放資料 CSV（30 秒逾時）；不帶任何使用者資料 */
export function createAntifraudServices({ fetchImpl = fetch } = {}) {
  const get = async (src) => {
    let res;
    try { res = await fetchImpl(src.url, { signal: AbortSignal.timeout(30_000) }); } catch { throw shown(new OpenDataError('165 開放資料連線失敗，請稍後再試')); }
    if (!res.ok) throw shown(new OpenDataError(`165 開放資料回應錯誤（HTTP ${res.status}）`), '165 開放資料暫時無法取得，請稍後再試；有疑問請直接撥 165。');
    return res.text();
  };
  return createAntifraudFromLoader({ load: async () => { const [sitesCsv, mythsCsv] = await Promise.all([get(SOURCES.sites), get(SOURCES.myths)]); return { sitesCsv, mythsCsv }; } });
}
