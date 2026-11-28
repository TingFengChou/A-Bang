// 股市收盤行情（證交所、櫃買中心開放資料，免金鑰）：上市、上櫃個股與 ETF 的收盤價、漲跌、成交量，加權指數與櫃買指數。
// 只報開放資料的數字，不做買賣建議（PACK_GUARDRAILS.finance）。每個交易日收盤後更新，不是即時報價。
// 欄位已實測（2026-11-19，docs/DATA_SOURCES.md §5.3）。
import { normName } from '../util.js';
import { rocDate } from './life.js';
import { csvObjects } from '../csv.js';

export const STOCK_URLS = {
  twse: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  tpex: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
  twseIndex: 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX',
  tpexIndex: 'https://www.tpex.org.tw/openapi/v1/tpex_index',
  // 證交所網站同一份資料（欄位相同）：收盤後很快就更新；OpenAPI 常晚好幾個小時（2026-11-23 16:38 實測 OpenAPI 仍是 11/20、網站已是 11/23）
  twseSite: 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?response=open_data',
  twseIndexSite: 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&type=IND',
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

/** 證交所網站 STOCK_DAY_ALL（CSV，中文表頭）→ 跟 OpenAPI 同一個形狀再正規化 */
export const parseTwseCsv = (text) => parseTwse(csvObjects(String(text ?? ''), ['日期', '證券代號', '證券名稱', '收盤價']).map((r) => ({
  Date: r['日期'], Code: r['證券代號'], Name: r['證券名稱'], TradeVolume: r['成交股數'], TradeValue: r['成交金額'],
  OpeningPrice: r['開盤價'], HighestPrice: r['最高價'], LowestPrice: r['最低價'], ClosingPrice: r['收盤價'], Change: r['漲跌價差'], Transaction: r['成交筆數'],
})));

/** 證交所網站 MI_INDEX（type=IND）→ 跟 OpenAPI MI_INDEX 同形狀的列（`漲跌` 欄是 HTML，例 `<p style='color:red'>+</p>`，只留 +／-） */
export function parseTwseIndexSite(j) {
  if (j?.stat !== 'OK' || !Array.isArray(j.tables)) return [];
  for (const t of j.tables) {
    const f = Array.isArray(t?.fields) ? t.fields.map((x) => String(x).trim()) : [];
    const at = (re) => f.findIndex((x) => re.test(x));
    const [iName, iClose, iSign, iPts] = [at(/^指數$/), at(/^收盤指數$/), at(/^漲跌\(/), at(/^漲跌點數$/)];
    if ([iName, iClose, iSign, iPts].some((i) => i < 0)) continue;
    const r = (Array.isArray(t.data) ? t.data : []).find((row) => String(row?.[iName]).trim() === '發行量加權股價指數');
    if (r) return [{ '日期': j.date, '指數': r[iName], '收盤指數': r[iClose], '漲跌': String(r[iSign] ?? '').replace(/<[^>]*>/g, '').trim(), '漲跌點數': r[iPts] }];
  }
  return [];
}

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
export const splitQuery = (q) => String(q ?? '').split(/[、,，;；/\s]+/).flatMap((p) => conjParts(p)).map((s) => s.trim()).filter((s) => s && !/^[和跟與及]$/.test(s)).slice(0, 5);
/** 「台積電和聯發科」用連接詞分開；名稱本身以連接詞開頭（和碩、和大、和成、與時…）不拆（生活資料審查 #1：「和碩」原本變成「碩」→ 碩天） */
const CONJ = /(?<=[^和跟與及\s]{2})[和跟與及](?=[^\s]{2})/g;
function conjParts(p) {
  return String(p).split(CONJ);
}
/** 查詢詞整個是代號或名稱就不拆（「和碩」「仁寶和碩」以外的少見情形交給 findStock） */
const keepWhole = (quotes, raw) => raw.split(/[、,，;；/\s]+/).filter(Boolean).filter((p) => quotes.some((x) => x.code === p.toUpperCase() || normName(x.name) === normName(p)));

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
  const whole = keepWhole(quotes, String(query ?? ''));
  const parts = [...whole, ...splitQuery(String(query ?? '').split(/[、,，;；/\s]+/).filter((p) => !whole.includes(p)).join(' '))].slice(0, 5);
  for (const q of parts) {
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
        let idxErr = null;
        const soft = (p) => p.catch((e) => { idxErr ||= e; return []; });
        const [twse, tpex, ti, pi] = await Promise.all([need ? fx.twse() : [], need ? fx.tpex() : [], soft(fx.twseIndex()), soft(fx.tpexIndex())]);
        // 只問大盤、兩個指數都抓不到：丟上游的錯（連不上），不說成「目前沒有行情資料」（P0-2 B 降級盤點）
        if (!need && !ti.length && !pi.length && idxErr) throw idxErr;
        return stockQuote({ quotes: [...twse, ...tpex], indices: parseIndices(ti, pi) }, a);
      },
    },
  };
}

/**
 * 同一份資料的幾個來源：取日期最新的；一個失敗用另一個，全部失敗丟第一個錯誤。
 * @template T
 * @param {Promise<T>[]} jobs
 * @param {(r: T) => string|null} dateOf 回傳 YYYY-MM-DD（可比大小）
 */
export async function newest(jobs, dateOf) {
  const rs = await Promise.allSettled(jobs);
  const ok = rs.filter((r) => r.status === 'fulfilled').map((r) => /** @type {PromiseFulfilledResult<T>} */ (r).value);
  if (!ok.length) throw /** @type {PromiseRejectedResult} */ (rs[0]).reason;
  return ok.reduce((best, r) => (String(dateOf(r) ?? '') > String(dateOf(best) ?? '') ? r : best));
}

/** 真實：od＝createOpenDataClient()；上市個股與加權指數同時抓 OpenAPI 與證交所網站，取日期新的；解析後才快取（上櫃原始檔約 5 MB，只留股票與 ETF） */
export function createLiveStockFetchers({ od, now = () => Date.now() }) {
  const nonEmpty = (f) => (x) => { const r = f(x); if (!Array.isArray(r) || !r.length) throw new Error('沒有資料'); return r; };
  const opt = (label, parse, as = 'json') => ({ ttlSec: 1800, label, as, parse: nonEmpty(parse) });
  // 網站來源是加分（較早有今天的資料）：失敗（假日沒資料、改版、連不上）後 10 分鐘內不再抓，不拖慢每次查詢
  const down = new Map();
  const site = (url, o) => {
    if (now() < (down.get(url) ?? 0)) return Promise.reject(new Error(`${o.label}暫停使用`));
    return od.get(url, o).catch((e) => { down.set(url, now() + 600_000); throw e; });
  };
  return {
    twse: () => newest([od.get(STOCK_URLS.twse, opt('證交所收盤行情', parseTwse)), site(STOCK_URLS.twseSite, opt('證交所網站收盤行情', parseTwseCsv, 'text'))], (r) => r[0]?.date), // 正規化後已是 YYYY-MM-DD
    tpex: () => od.get(STOCK_URLS.tpex, opt('櫃買中心收盤行情', parseTpex)),
    twseIndex: () => newest([od.get(STOCK_URLS.twseIndex, opt('證交所指數', (x) => x)), site(STOCK_URLS.twseIndexSite, opt('證交所網站指數', parseTwseIndexSite))], (r) => isoDate(r.find((x) => x?.['日期'])?.['日期'])),
    tpexIndex: () => od.get(STOCK_URLS.tpexIndex, opt('櫃買指數', (x) => x)),
  };
}
