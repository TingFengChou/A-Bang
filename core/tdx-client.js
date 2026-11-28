// TDX 運輸資料流通服務 client：OIDC client_credentials token 快取 + 回應快取 + 每分鐘額度排程
// 文件：https://github.com/tdxmotc/SampleCode
// 只在伺服器端載入（依賴 metrics.js 的 AsyncLocalStorage）；瀏覽器示範版不會打包到這裡。
import { recordFetch } from './metrics.js';
import { shown } from './util.js';

const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_BASE = 'https://tdx.transportdata.tw/api';

export class TdxError extends Error {
  constructor(status, msg) { super(msg); this.name = 'TdxError'; this.status = status; }
}

/**
 * 背景工作讓位（額度留給使用者、或碰到每秒上限）：不是「額度用完」。
 * 併入同一份下載的使用者看到這個錯誤，就以前景身分自己重新下載；不記成額度用完（core/index.js quota.at）。
 */
export class TdxYield extends TdxError {
  constructor(msg = 'TDX 背景下載讓位給使用者') { super(429, msg); this.yielded = true; }
}
const isYield = (e) => Boolean(e?.yielded);

/**
 * 頻率限制（2026-11-22 實測：基本會員每把金鑰每分鐘 5 次，依時鐘整分重置，標頭 x-ratelimit-remaining-minute、ratelimit-reset）。
 * concurrent／gapMs：同時幾個、兩次至少間隔多久；perMinute：每分鐘上限（null＝不知道，等回應標頭告訴我們）；
 * backgroundPerMinute：背景預熱每分鐘最多用幾次（留給使用者）；waitMs：額度在這麼短的時間內就重置時，等一下而不是直接放棄；timeoutMs：單次請求逾時（含讀 body、token）；
 * maxStatics：記憶體裡最多放幾份靜態資料（逐條查的路線站序、形狀會越來越多；超過淘汰最久沒用的，有存檔的之後再讀檔）。
 */
export const TDX_LIMIT = { concurrent: 3, gapMs: 220, retryMs: 1200, perMinute: null, backgroundPerMinute: 3, waitMs: 2500, timeoutMs: 30000, maxStatics: 400 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400;

/** 計量與 log 用的端點類別：只留路徑裡的固定字（例 Bus/EstimatedTimeOfArrival/City），不含縣市、路線、站名、查詢參數 */
const SKIP_SEG = new Set(['basic', 'advanced', 'v2', 'v3', 'api']);
const STOP_SEG = /^(Taipei|NewTaipei|Taoyuan|Taichung|Tainan|Kaohsiung|Keelung|Hsinchu|HsinchuCounty|MiaoliCounty|ChanghuaCounty|NantouCounty|YunlinCounty|ChiayiCounty|Chiayi|PingtungCounty|YilanCounty|HualienCounty|TaitungCounty|KinmenCounty|PenghuCounty|LienchiangCounty|TRTC|TYMC|TMRT|KRTC|KLRT|NTDLRT|TRTCMG|NTMC|NTALRT)$/;
export function endpointCategory(path) {
  const out = [];
  for (const s of String(path).split('?')[0].split('/').filter(Boolean)) {
    if (SKIP_SEG.has(s)) continue;
    if (!/^[A-Za-z]+$/.test(s) || STOP_SEG.test(s)) break;
    out.push(s);
  }
  return out.join('/') || 'other';
}

/**
 * 每分鐘額度：依時鐘整分的視窗計數；TDX 回應標頭（剩幾次、幾秒後重置）來了就以它為準。
 * 用完時不再送出（直接回 429 走示範資料或舊快取），不白打。
 */
export function createQuotaGate({ perMinute = null, backgroundPerMinute = 3, userReserve = 2, now = Date.now } = {}) {
  const st = { limit: perMinute, end: 0, used: 0, waitingUser: 0 };
  const roll = () => { const t = now(); if (t >= st.end) { st.end = Math.ceil((t + 1) / 60000) * 60000; st.used = 0; } };
  const left = () => { roll(); return st.limit == null ? Infinity : Math.max(0, st.limit - st.used); };
  return {
    /** 這一分鐘還剩幾次（不知道上限時 Infinity）、幾毫秒後重置 */
    status() { const n = left(); return { left: n, used: st.used, limit: st.limit, resetMs: Math.max(0, st.end - now()), waiting: st.waitingUser }; },
    /** 背景工作現在可以用一次嗎：沒有使用者在等、這分鐘用量還沒到背景上限，且至少留 userReserve 次給使用者 */
    backgroundOk() { const n = left(); return st.waitingUser === 0 && st.used < backgroundPerMinute && n > userReserve; }, // left() 先算（跨分鐘時重置用量）
    userWaiting(d) { st.waitingUser = Math.max(0, st.waitingUser + d); },
    /** 送出前呼叫：可以送就記一次並回 true */
    take({ background = false } = {}) {
      if (background ? !this.backgroundOk() : left() < 1) return false;
      st.used++;
      return true;
    },
    /** 依回應標頭校正（同一視窗取較大的用量，避免並行請求的回應比較晚到時把用量算少） */
    sync({ limit, remaining, resetSec }) {
      if (Number.isFinite(limit) && limit > 0) st.limit = limit;
      if (!Number.isFinite(remaining) || st.limit == null) return;
      const usedByServer = Math.max(0, st.limit - remaining);
      if (Number.isFinite(resetSec) && resetSec >= 0) {
        const end = now() + resetSec * 1000;
        if (Math.abs(end - st.end) > 2000) { st.end = end; st.used = usedByServer; return; } // 伺服器的視窗跟我們估的不同：以伺服器為準
      }
      roll();
      st.used = Math.max(st.used, usedByServer);
    },
    /** 被擋 429（額度用完）：這個視窗不再送 */
    exhausted(resetSec) {
      if (Number.isFinite(resetSec) && resetSec >= 0) st.end = now() + resetSec * 1000;
      else roll();
      if (st.limit == null) st.limit = Math.max(1, st.used);
      st.used = st.limit;
    },
  };
}

const num = (v) => (v == null || v === '' ? NaN : Number(v));

/**
 * @param {{ clientId: string, clientSecret: string, fetchImpl?: Function, log?: Function, limit?: Partial<typeof TDX_LIMIT>,
 *   store?: { read(key: string): Promise<{ at: number, data: any } | null>, write(key: string, v: { at: number, data: any }): Promise<void> } | null, now?: () => number }} opts
 *   store：靜態資料存檔（core/tdx-store.js；只存正規化結果）；沒有就只放記憶體
 */
export function createTdxClient({ clientId, clientSecret, fetchImpl = fetch, log = () => {}, limit: limitIn = TDX_LIMIT, store = null, now = Date.now }) {
  const limit = { ...TDX_LIMIT, ...limitIn };
  const gate = createQuotaGate({ perMinute: limit.perMinute, backgroundPerMinute: limit.backgroundPerMinute, now });
  const stats = { sent: 0, cacheHits: 0, stale: 0, refused: 0, byCategory: {} }; // 整個程序的累計（只記端點類別），除錯用

  // 請求排隊：最多 limit.concurrent 個同時進行，且每次送出至少間隔 limit.gapMs
  let active = 0;
  let lastAt = 0;
  const queue = [];
  const pump = () => {
    while (active < limit.concurrent && queue.length) {
      const job = queue.shift();
      active++;
      const wait = Math.max(0, lastAt + limit.gapMs - Date.now());
      lastAt = Date.now() + wait;
      sleep(wait).then(job.run).then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
  };
  const throttled = (run, background = false) => new Promise((resolve, reject) => {
    const job = { run, resolve, reject, background };
    const i = background ? -1 : queue.findIndex((j) => j.background);
    if (i < 0) queue.push(job); else queue.splice(i, 0, job);
    pump();
  });
  let token = null;
  let tokenExp = 0;
  let tokenPromise = null;
  const cache = new Map(); // url -> { exp, at, data }
  const inflight = new Map(); // url -> Promise：同一網址同時只打一次

  async function getToken() {
    if (token && Date.now() < tokenExp) return token;
    // single-flight：token endpoint 每 IP 每分鐘限 20 次（不算 API 額度）
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const res = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
          signal: AbortSignal.timeout(limit.timeoutMs),
        }).catch((e) => { throw timeoutOr(e); });
        if (!res.ok) throw new TdxError(res.status, `TDX token 取得失敗 (${res.status})，請確認 Client ID / Secret`);
        const j = await res.json().catch((e) => { throw timeoutOr(e); });
        token = j.access_token;
        tokenExp = Date.now() + (j.expires_in - 300) * 1000; // 提前 5 分鐘換新
        log('[tdx] token refreshed');
        return token;
      })().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }

  /** 逾時（連線或讀 body）→ TdxError 504；其他錯誤原樣 */
  const timeoutOr = (e) => (e?.name === 'TimeoutError' || e?.name === 'AbortError' ? shown(new TdxError(504, 'TDX 回應逾時，請稍後再試'), '交通資料（TDX）回應太慢，請稍後再試。') : e);

  const limitError = (resetMs) => {
    const s = Math.ceil(resetMs / 1000);
    const per = gate.status().limit;
    return shown(new TdxError(429, `TDX 呼叫次數已達方案上限${per ? `（每分鐘 ${per} 次）` : ''}，請${s > 0 ? `約 ${s} 秒後` : '稍後'}再試`)); // 額度用完：說要等多久（可以給使用者看）
  };

  /** 取得這一次的額度：使用者請求在幾秒內就重置時等一下；背景工作拿不到就讓位（TdxYield，之後再試） */
  async function acquire(background) {
    if (gate.take({ background })) return;
    if (background) throw new TdxYield();
    const { resetMs } = gate.status();
    if (!background && resetMs <= limit.waitMs) {
      gate.userWaiting(1);
      try { await sleep(resetMs + 50); } finally { gate.userWaiting(-1); }
      if (gate.take({ background })) return;
    }
    stats.refused++;
    throw limitError(gate.status().resetMs);
  }

  async function send(url, background) {
    if (!background) gate.userWaiting(1); // 排隊中的使用者請求優先：背景工作看到有人在等就讓
    let waitingMarked = !background;
    const unmark = () => { if (waitingMarked) { waitingMarked = false; gate.userWaiting(-1); } };
    try {
      return await throttled(async () => {
        unmark();
        const tok = await getToken(); // 先拿 token：token 失敗不扣 API 額度
        await acquire(background);
        // 逾時：上游卡住時不要一直占著排隊位置（背景預熱也會卡住）；同一個 signal 也管讀 body（readBody）
        const res = await fetchImpl(url, { headers: { authorization: `Bearer ${tok}`, 'accept-encoding': 'br, gzip' }, signal: AbortSignal.timeout(limit.timeoutMs) })
          .catch((e) => { throw timeoutOr(e); });
        const h = (k) => res.headers?.get?.(k);
        gate.sync({ limit: num(h('x-ratelimit-limit-minute')), remaining: num(h('x-ratelimit-remaining-minute')), resetSec: num(h('ratelimit-reset')) });
        return res;
      }, background);
    } finally { unmark(); }
  }

  async function fetchJson(url, path, background) {
    let res = await send(url, background);
    if (res.status === 401) { token = null; res = await send(url, background); } // token 失效重試一次
    if (res.status === 429) {
      const h = (k) => res.headers?.get?.(k);
      const remaining = num(h('x-ratelimit-remaining-minute'));
      const reset = num(h('ratelimit-reset') ?? h('retry-after'));
      // 分鐘額度真的用完（remaining 0）才鎖這一分鐘；背景碰到每秒上限（分鐘額度還有）只讓位、不動閘門
      if (remaining === 0) { gate.exhausted(reset); stats.refused++; throw background ? new TdxYield('TDX 這分鐘額度用完，背景下次再試') : limitError(Number.isFinite(reset) ? reset * 1000 : gate.status().resetMs); }
      if (background) throw new TdxYield('TDX 每秒上限，背景下次再試');
      // 每秒次數超過（分鐘額度還有）：照 Retry-After（沒有就等一下）重試一次
      const after = num(h('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 5000) : limit.retryMs);
      log('[tdx] 429, retry once');
      res = await send(url, background);
    }
    if (res.status === 429) { // 額度用完：照 TDX 回的重置秒數說清楚
      const h = (k) => res.headers?.get?.(k);
      const reset = num(h('ratelimit-reset') ?? h('retry-after'));
      const perMin = num(h('x-ratelimit-limit-minute'));
      gate.exhausted(reset);
      stats.refused++;
      throw shown(new TdxError(429, `TDX 呼叫次數已達方案上限${Number.isFinite(perMin) && perMin > 0 ? `（每分鐘 ${perMin} 次）` : ''}，請${Number.isFinite(reset) && reset > 0 ? `約 ${Math.ceil(reset)} 秒後` : '稍後'}再試`));
    }
    if (!res.ok) throw shown(new TdxError(res.status, `TDX API 錯誤 ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`), '交通資料（TDX）暫時無法取得，請稍後再試。'); // 上游回應內容只進 log
    const data = await res.json().catch((e) => { throw e instanceof SyntaxError ? shown(new TdxError(502, 'TDX 回應格式錯誤'), '交通資料（TDX）暫時無法取得，請稍後再試。') : timeoutOr(e); });
    const cat = endpointCategory(path);
    stats.sent++;
    stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
    return { data, cat };
  }

  /**
   * GET TDX API（回傳資料與取得時間）
   * @param {string} path 例如 '/basic/v2/Bus/Route/City/Taipei'
   * @param {object} query OData 參數，例如 { $top: 10, $filter: "..." }
   * @param {number} ttlSec 快取秒數（即時資料建議 20~30，靜態資料 3600+）
   * @param {{ staleSec?: number, background?: boolean, cache?: boolean }} [opts]
   *   staleSec：即時資料的舊快取最多用幾秒——額度快用完（這分鐘剩 ≤ 1 次）或被擋 429 時，先用這份舊資料（stale: true）而不是退回示範
   *   background：背景預熱；只在額度有餘時送出（留給使用者）
   *   cache：false＝不把原始回應放進記憶體（整個縣市的大回應由 cached() 正規化後另外保存）
   * @returns {Promise<{ data: any, at: number, stale: boolean }>}
   */
  async function getMeta(path, query = {}, ttlSec = 20, { staleSec = 0, background = false, cache: keep = true } = {}) {
    const qs = new URLSearchParams({ $format: 'JSON', ...query });
    const url = `${API_BASE}${path}?${qs.toString().replace(/\+/g, '%20')}`; // OData 空白用 %20 較保險
    const t = now();
    const hit = cache.get(url);
    const cat = endpointCategory(path);
    if (hit && t < hit.exp) { stats.cacheHits++; recordFetch({ cacheHit: true, data: hit.data }); return { data: hit.data, at: hit.at, stale: false }; }
    const staleOk = hit && staleSec > 0 && t - hit.at <= staleSec * 1000;
    const useStale = () => { stats.stale++; recordFetch({ cacheHit: true, data: hit.data, stale: true }); return { data: hit.data, at: hit.at, stale: true }; };
    if (staleOk && gate.status().left <= 1) return useStale(); // 額度快用完：用不到一分鐘前的資料，把最後一次留給沒有快取的請求

    const joined = inflight.get(url);
    let p;
    if (!joined) {
      p = fetchJson(url, path, background).then(({ data }) => {
        const at = now();
        if (keep) {
          cache.delete(url); // 重新放到最後（淘汰最舊的）
          cache.set(url, { exp: at + ttlSec * 1000, at, data });
          if (cache.size > 2000) cache.delete(cache.keys().next().value);
        }
        return { data, at };
      }).finally(() => { if (inflight.get(url)?.p === p) inflight.delete(url); });
      inflight.set(url, { p, background });
    } else {
      recordFetch({ cacheHit: true, data: null }); // 同一網址正在下載：等同一份（不另外打）
      let r;
      try {
        r = await joined.p;
      } catch (e) {
        // 併入的是背景下載、而它讓位了：使用者以前景身分自己下載（不跟著退回示範）
        if (isYield(e) && !background) return getMeta(path, query, ttlSec, { staleSec, background, cache: keep });
        if (e?.status === 429 && staleOk) return useStale();
        throw e;
      }
      return { ...r, stale: false };
    }
    try {
      const r = await p;
      recordFetch({ cacheHit: false, data: r.data, category: cat });
      return { ...r, stale: false };
    } catch (e) {
      if (e?.status === 429 && staleOk) return useStale();
      throw e;
    }
  }

  /** GET TDX API，只回資料（參數同 getMeta） */
  const get = async (path, query, ttlSec, opts) => (await getMeta(path, query, ttlSec, opts)).data;

  // ───────── 靜態資料（站牌、路線、站序、車站、形狀）：正規化後快取，有 store 就存檔，重啟後先讀檔 ─────────
  const statics = new Map(); // key -> { at, data, ttl? }（LRU：最近用到的在後面）
  const loading = new Map(); // key -> { p, background }（single-flight）
  const refreshing = new Set();
  const remember = (key, v) => {
    statics.delete(key);
    statics.set(key, v);
    while (statics.size > limit.maxStatics) statics.delete(statics.keys().next().value); // 淘汰最久沒用的（有存檔的之後再讀檔）
  };
  const recall = (key) => { const v = statics.get(key); if (v) { statics.delete(key); statics.set(key, v); } return v; };
  /** 空結果（空陣列、null）：不存檔，只在記憶體放 10 分鐘（別每次都打，也別把一時的空當成真的） */
  const isEmpty = (d) => d == null || (Array.isArray(d) && d.length === 0);
  const EMPTY_TTL = 600;
  /**
   * 靜態資料下載失敗（上游壞了、整個系統回空）後退避：1、2、4、8、15 分鐘（P0-2 量測）。
   * 不退避的話，失敗的清單每一題都重新下載（一題最多十幾次），把每分鐘 5 次的額度連同即時到站一起吃光。
   * 退避期間有舊資料照用舊的（cached 的背景更新也擋），沒有就立刻丟同樣的錯，不打 TDX；預熱（force）照排程重試。
   * 只算上游的失敗（TDX 錯誤、5xx、連線失敗）；額度用完（429）與背景讓位不算，那由全站的額度閘門管（gate.exhausted）；
   * 使用者輸入錯誤（UserError）也不算。
   */
  const BACKOFF_MS = [1, 2, 4, 8, 15].map((m) => m * 60_000);
  const failed = new Map(); // key -> { n, until, err }
  const upstreamFail = (e) => !isYield(e) && e?.status !== 429 && (e instanceof TdxError || e?.status >= 500 || (e instanceof TypeError && /fetch failed/i.test(e.message)));
  const again = (e) => Object.assign(e instanceof TdxError ? new TdxError(e.status, e.message) : new Error(e.message), { name: e.name, status: e.status, backoff: true });
  const ttlOf = (v, ttlSec) => Math.min(ttlSec, v.ttl ?? Infinity);

  async function fromStore(key) {
    if (!store) return null;
    try {
      const v = await store.read(key);
      return v && Number.isFinite(v.at) && v.data !== undefined ? v : null;
    } catch { return null; }
  }

  function load(key, loader, background, persist, force = false) {
    const cur = loading.get(key);
    if (cur) {
      // 使用者併入背景預熱的同一份下載：背景讓位時，使用者以前景身分自己下載（不跟著退回示範）
      return background || !cur.background ? cur.p : cur.p.catch((e) => { if (isYield(e)) return load(key, loader, false, persist); throw e; });
    }
    const f = failed.get(key);
    if (f && !force && now() < f.until) return Promise.reject(again(f.err));
    const p = (async () => {
      let data;
      try {
        data = await loader({ background });
      } catch (e) {
        if (upstreamFail(e)) {
          const n = (failed.get(key)?.n || 0) + 1;
          failed.delete(key); // 重新放到最後（超過上限淘汰最舊的）
          failed.set(key, { n, until: now() + BACKOFF_MS[Math.min(n, BACKOFF_MS.length) - 1], err: e });
          while (failed.size > limit.maxStatics) failed.delete(failed.keys().next().value);
          if (n === 1) log(`[tdx] ${key} 下載失敗，退避重試：${e?.message || e}`);
        }
        throw e;
      }
      failed.delete(key);
      const empty = isEmpty(data);
      const v = { at: now(), data, ...(empty && { ttl: EMPTY_TTL }) };
      remember(key, v);
      if (store && persist && !empty) store.write(key, v).catch((e) => log(`[tdx] cache write failed: ${e?.code || e?.message || e}`));
      return data;
    })().finally(() => { if (loading.get(key)?.p === p) loading.delete(key); });
    loading.set(key, { p, background });
    return p;
  }

  /**
   * 靜態資料快取：新鮮就直接用；過期但有舊資料就先用舊的、背景慢慢更新（額度有餘才打）；都沒有才在使用者這一次下載。
   * loader 收到 { background }，要原樣傳給 get() 的 opts；回傳值必須是正規化後的資料（會存檔，不可含金鑰、token、網址參數、使用者位置）。
   * @param {string} key 存檔名稱（英數與 - _；例 'bus-stations-Taipei'）
   * @param {number} ttlSec 新鮮多久
   * @param {(o: { background: boolean }) => Promise<any>} loader
   * @param {{ maxStaleSec?: number, background?: boolean, persist?: boolean, onlyStored?: boolean, force?: boolean }} [opts]
   *   maxStaleSec：舊資料最多用多久（預設 30 天）；onlyStored：記憶體與檔案都沒有就回 undefined（不在使用者這一次下載大檔，等預熱）；
   *   force：不新鮮就等它下載完（預熱用）
   */
  async function cached(key, ttlSec, loader, { maxStaleSec = 30 * DAY, background = false, persist = true, onlyStored = false, force = false } = {}) {
    let v = recall(key);
    if (!v && persist) {
      v = await fromStore(key);
      if (v) remember(key, v);
    }
    const age = v ? now() - v.at : Infinity;
    if (v && age < ttlOf(v, ttlSec) * 1000) { recordFetch({ cacheHit: true, data: v.data }); return v.data; }
    if (force) return load(key, loader, background, persist, true);
    if (v && !v.ttl && age < maxStaleSec * 1000) {
      // 舊資料先用，背景更新（額度不夠就下次再說）
      if (!refreshing.has(key) && !loading.has(key)) {
        refreshing.add(key);
        load(key, loader, true, persist).catch(() => {}).finally(() => refreshing.delete(key));
      }
      recordFetch({ cacheHit: true, data: v.data });
      return v.data;
    }
    if (onlyStored) return undefined;
    return load(key, loader, background, persist);
  }

  /** 只看記憶體裡有沒有（不讀檔、不下載）；給「有預熱的整個縣市資料就用、沒有就逐條查」的判斷 */
  const peek = (key) => statics.get(key)?.data;
  /** 記憶體或檔案裡有沒有、新不新鮮（預熱用：新鮮就跳過） */
  async function fresh(key, ttlSec) {
    let v = recall(key);
    if (!v) { v = await fromStore(key); if (v) remember(key, v); }
    return Boolean(v) && now() - v.at < ttlOf(v, ttlSec) * 1000;
  }

  return { get, getMeta, cached, peek, fresh, now, perMinute: () => gate.status().limit, quota: () => gate.status(), backgroundOk: () => gate.backgroundOk(), stats: () => structuredClone(stats) };
}
