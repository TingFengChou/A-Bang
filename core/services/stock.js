// 股市收盤行情（證交所、櫃買中心 OpenAPI，免金鑰）：上市、上櫃個股與 ETF 的收盤價、漲跌、成交量，加權指數與櫃買指數。
// 只報開放資料的數字，不做買賣建議（PACK_GUARDRAILS.finance）。每個交易日收盤後更新，不是即時報價。
// 欄位已實測（2026-11-19，docs/DATA_SOURCES.md §5.3）。
import { normName } from '../util.js';
import { rocDate } from './life.js';

export const STOCK_URLS = {
  twse: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  tpex: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
  twseIndex: 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX',
  tpexIndex: 'https://www.tpex.org.tw/openapi/v1/tpex_index',
};

/** 數字欄位：去掉空白、逗號、「+」；「---」或空字串為 null */
const num = (v) => {
  const s = String(v ?? '').trim().replace(/,/g, '').replace(/^\+/, '');
  if (!s || /^-+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round(n * 100) / 100;
/** 漲跌幅（%）＝ 漲跌 ÷ 前一日收盤 */
const pct = (close, change) => (close == null || change == null || close - change <= 0 ? null : round2((change / (close - change)) * 100));
/** 20261119 → 2026-11-19；民國 1151119 → 2026-11-19 */
const isoDate = (s) => { const t = String(s ?? '').trim(); return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}` : rocDate(t); };
// 上櫃資料含大量權證（6 碼數字），只留股票（4 碼）與 ETF（00 開頭）
const STOCK_CODE = /^(\d{4}|00\d{2,4}[A-Z]?)$/;

function quote({ code, name, market, date, open, high, low, close, change, volume, value, trades }) {
  const c = num(close);
  const ch = c == null ? null : num(change);
  const shares = num(volume);
  return {
    code: String(code).trim(), name: String(name).trim(), market, date: isoDate(date),
    open: num(open), high: num(high), low: num(low), close: c, change: ch, changePct: pct(c, ch),
    volumeLots: shares == null ? null : Math.round(shares / 1000), // 成交量（張）
    value: num(value), trades: num(trades),
  };
}

/** 證交所 STOCK_DAY_ALL → 正規化 */
export const parseTwse = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r?.Code && r?.Name).map((r) => quote({
  code: r.Code, name: r.Name, market: '上市', date: r.Date, open: r.OpeningPrice, high: r.HighestPrice, low: r.LowestPrice,
  close: r.ClosingPrice, change: r.Change, volume: r.TradeVolume, value: r.TradeValue, trades: r.Transaction,
}));

/** 櫃買中心 tpex_mainboard_daily_close_quotes → 正規化（略過權證） */
export const parseTpex = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => STOCK_CODE.test(String(r?.SecuritiesCompanyCode ?? '').trim()) && r.CompanyName).map((r) => quote({
  code: r.SecuritiesCompanyCode, name: r.CompanyName, market: '上櫃', date: r.Date, open: r.Open, high: r.High, low: r.Low,
  close: r.Close, change: r.Change, volume: r.TradingShares, value: r.TransactionAmount, trades: r.TransactionNumber,
}));

/** 加權指數（MI_INDEX）與櫃買指數（tpex_index 最後一筆） */
export function parseIndices(twseRows, tpexRows) {
  const out = [];
  const t = (Array.isArray(twseRows) ? twseRows : []).find((r) => String(r?.['指數']).trim() === '發行量加權股價指數');
  if (t) {
    const close = num(t['收盤指數']);
    const pts = num(t['漲跌點數']);
    const change = pts == null ? null : String(t['漲跌']).trim() === '-' ? -pts : pts;
    out.push({ id: 'taiex', name: '加權指數', date: isoDate(t['日期']), close, change, changePct: pct(close, change) });
  }
  const p = (Array.isArray(tpexRows) ? tpexRows : []).filter((r) => num(r?.Close) != null).at(-1);
  if (p) {
    const close = num(p.Close), change = num(p.Change);
    out.push({ id: 'tpex', name: '櫃買指數', date: isoDate(p.Date), close, change, changePct: pct(close, change) });
  }
  return out;
}

/** 「台積電、聯發科」「2330 0050」→ 查詢詞（最多 5 個） */
export const splitQuery = (q) => String(q ?? '').split(/[、,，;；/\s和跟與及]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);

/**
 * 找一檔：代號完全相同 → 名稱相同 → 名稱開頭 → 名稱包含（短名優先）。
 * @returns {{ hit: object|null, similar: Array<{ code: string, name: string }> }}
 */
export function findStock(quotes, q) {
  const code = q.toUpperCase();
  const byCode = quotes.find((x) => x.code === code);
  if (byCode) return { hit: byCode, similar: [] };
  const n = normName(q);
  const exact = quotes.find((x) => normName(x.name) === n);
  if (exact) return { hit: exact, similar: [] };
  const starts = quotes.filter((x) => normName(x.name).startsWith(n));
  const has = quotes.filter((x) => !starts.includes(x) && normName(x.name).includes(n));
  const list = [...starts, ...has].sort((a, b) => (starts.includes(b) - starts.includes(a)) || a.name.length - b.name.length);
  return { hit: list[0] || null, similar: list.slice(1, 5).map(({ code: c, name }) => ({ code: c, name })) };
}

const TAIEX_RE = /^(台股|台灣|上市)?(大盤|加權|加權指數|加權股價指數|發行量加權股價指數)$|^(台股|上市指數|集中市場|TAIEX|TWII)$/;
const TPEX_RE = /^(櫃買|櫃買指數|櫃買中心指數|櫃檯指數|櫃檯買賣指數|上櫃指數|OTC|TPEX)$/;
/**
 * 查詢詞是不是在問指數：加權指數（大盤、台股、TAIEX…）→ 'taiex'；櫃買指數（上櫃指數、OTC…）→ 'tpex'；都不是回 null。
 * 指數不是個股，不拿去個股清單找（2026-11-22 實測：以前問「加權指數」先回收盤又說找不到）。
 */
export function indexOf(q) {
  const n = normName(q).toUpperCase();
  return TAIEX_RE.test(n) ? 'taiex' : TPEX_RE.test(n) ? 'tpex' : null;
}

/**
 * @param {{ quotes: object[], indices: object[] }} market
 * @param {{ query?: string }} a
 */
export function stockQuote({ quotes, indices }, { query } = {}) {
  const found = [], notFound = [], asked = [];
  for (const q of splitQuery(query)) {
    const idx = indexOf(q);
    if (idx) { if (!asked.includes(idx)) asked.push(idx); continue; }
    const { hit, similar } = findStock(quotes, q);
    if (!hit) { notFound.push(q); continue; }
    if (!found.some((x) => x.code === hit.code)) found.push({ ...hit, query: q, ...(similar.length && { similar }) });
  }
  // 問到的指數排前面（speak 講第一個指數）；問了指數卻沒有那個指數的資料才算找不到
  const rank = (i) => { const k = asked.indexOf(i.id); return k < 0 ? asked.length : k; };
  const list = asked.length ? [...indices].sort((a, b) => rank(a) - rank(b)) : indices;
  for (const id of asked) if (!list.some((i) => i.id === id)) notFound.push(id === 'taiex' ? '加權指數' : '櫃買指數');
  return { indices: list, quotes: found, notFound };
}

/**
 * @param {{ twse: () => Promise<any[]>, tpex: () => Promise<any[]>, twseIndex: () => Promise<any[]>, tpexIndex: () => Promise<any[]> }} fx
 */
export function createStockServices(fx) {
  return {
    stock: {
      quote: async (a = {}) => {
        const need = splitQuery(a.query).some((q) => !indexOf(q)); // 只問指數不用抓個股清單
        const [twse, tpex, ti, pi] = await Promise.all([need ? fx.twse() : [], need ? fx.tpex() : [], fx.twseIndex().catch(() => []), fx.tpexIndex().catch(() => [])]);
        return stockQuote({ quotes: [...twse, ...tpex], indices: parseIndices(ti, pi) }, a);
      },
    },
  };
}

/** 真實：od＝createOpenDataClient()；解析後才快取（上櫃原始檔約 5 MB，只留股票與 ETF） */
export function createLiveStockFetchers({ od }) {
  const nonEmpty = (f) => (x) => { const r = f(x); if (!Array.isArray(r) || !r.length) throw new Error('沒有資料'); return r; };
  const opt = (label, parse) => ({ ttlSec: 1800, label, as: 'json', parse: nonEmpty(parse) });
  return {
    twse: () => od.get(STOCK_URLS.twse, opt('證交所收盤行情', parseTwse)),
    tpex: () => od.get(STOCK_URLS.tpex, opt('櫃買中心收盤行情', parseTpex)),
    twseIndex: () => od.get(STOCK_URLS.twseIndex, opt('證交所指數', (x) => x)),
    tpexIndex: () => od.get(STOCK_URLS.tpexIndex, opt('櫃買指數', (x) => x)),
  };
}
