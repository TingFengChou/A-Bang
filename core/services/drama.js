// 短劇（MyDrama，ADR-0019）：第一個非政府開放資料的內容合作來源。
// 只用不需登入的公開讀取端點（片庫排行、搜尋、單劇、簡介、熱搜）；不送任何使用者識別資料（搜尋只送關鍵字）。
// API 網址只從環境變數來（MYDRAMA_API_BASE），repo 不放；回應防禦性解析，正規化成阿幫自己的欄位（架構規則 5）。
// 深層連結、商店頁也由環境變數設定（MYDRAMA_LINK_EPISODE、MYDRAMA_LINK_EXERCISE、MYDRAMA_STORE_IOS、MYDRAMA_STORE_ANDROID）。
// 封面圖（2026-11-23 產品負責人「要，經伺服器代抓」）：由阿幫伺服器代抓（/api/v1/drama/cover/:id），手機只跟阿幫拿圖，片庫的圖片伺服器看不到使用者的 IP；
// 只抓 https、只抓允許的主機（MYDRAMA_COVER_HOSTS，預設＝API 的主機）、不跟轉址、只收 JPEG／PNG／WebP／GIF（看檔頭，不收 SVG）、最大 1.5 MB、快取一天。
import { UserError } from '../util.js';
import { DRAMA_ID, linkFrom, isAppLink, isStoreLink } from '../drama-say.js';

/** 排行種類：hot 熱門、new 新劇、completed 已完結、taiwan 台灣自製 */
export const DRAMA_LISTS = ['hot', 'new', 'completed', 'taiwan'];
export const DRAMA_LIST_NAME = { hot: '熱門排行', new: '新上架', completed: '已完結', taiwan: '台灣自製' };
/** 快取秒數（DATA_SOURCES.md §短劇）：排行、片庫、搜尋、熱搜 10 分；單劇與簡介 1 小時 */
export const DRAMA_TTL = { list: 600, series: 3600 };
/** 不推薦的分級（限制級、18 禁；中文或英文代碼）：阿幫是大眾助手，排行與搜尋都濾掉。分級欄位不是字串（缺了、格式不對）也當限制級，寧可少推 */
const ADULT = /限制|成人|adult|restrict|R ?-?18|18 ?\+|^18$/i;
export const isAdult = (rating) => typeof rating !== 'string' || !rating.trim() || ADULT.test(rating.trim());

const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (v) => { if (typeof v !== 'number' && typeof v !== 'string') return null; const n = Number(v); return String(v).trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
const bool = (v) => v === true || v === 'true' || v === 1;
/** 上游的封面網址（欄位名稱待 MyDrama 實測確認：cover／coverUrl／poster／coverImage）：只收 https、沒有帳密、500 字以內；不合格當沒有 */
export function coverSrc(v) {
  if (typeof v !== 'string' || v.length > 500) return null;
  try { const u = new URL(v.trim()); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
/** 簡介最多 160 字（卡片與模型都夠用；完整簡介看 drama_series） */
export const SYNOPSIS_MAX = 160;

/**
 * 一部劇（上游欄位）→ 阿幫的欄位。id 或劇名不合格回 null；限制級回 null（不推薦）。
 * 只留阿幫用得到的欄位（價格、解鎖設定等一律不往上傳）。封面網址只留在伺服器（_cover），往上只說「有封面」（cover: true），圖由阿幫伺服器代抓。
 * @returns {{ id: string, title: string, tags: string[], genre: string|null, episodes: number|null, freeEpisodes: number|null, completed: boolean, isNew: boolean, taiwanOriginal: boolean, heat: number|null, synopsis: string|null } | null}
 */
export function normSeries(raw, { synopsisMax = SYNOPSIS_MAX } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const title = str(raw.title, 40);
  if (!DRAMA_ID.test(id) || !title) return null;
  if (isAdult(raw.contentRating)) return null;
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((t) => str(t, 12)).filter(Boolean))].slice(0, 5);
  const episodes = int(raw.episodes);
  const free = int(raw.freeEpisodes);
  const synopsis = str(raw.synopsis, synopsisMax);
  return {
    id, title, tags, genre: str(raw.category, 12) || null,
    episodes, freeEpisodes: free == null ? null : episodes == null ? free : Math.min(free, episodes),
    completed: bool(raw.completed), isNew: bool(raw.newRelease), taiwanOriginal: bool(raw.taiwanOriginal),
    heat: int(raw.heat), synopsis: synopsis || null,
    ...(int(raw.availableEpisodes) != null && { ready: int(raw.availableEpisodes) }), // 已上架的集數（內部用：推第 1 集前確認有片）
    ...(coverSrc(raw.cover ?? raw.coverUrl ?? raw.poster ?? raw.coverImage) && { _cover: coverSrc(raw.cover ?? raw.coverUrl ?? raw.poster ?? raw.coverImage) }), // 內部用：伺服器代抓封面
  };
}

/** 清單（上游陣列）→ 正規化、去重、濾掉不合格與限制級 */
export function normList(rows, opts) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = normSeries(r, opts);
    if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
  }
  return out;
}

/** 熱搜關鍵字：字串陣列，每個 1～12 字，最多 8 個 */
export const normKeywords = (rows) => [...new Set((Array.isArray(rows) ? rows : []).map((k) => str(k, 12)).filter(Boolean))].slice(0, 8);

/** 搜尋詞：去掉「短劇」「推薦」等套話，只留要找的（例：「有沒有甜寵的短劇」→「甜寵」）；劇名中間的字不動（「總裁的便當外送員」） */
export function dramaQuery(q) {
  const s = str(q, 40).replace(/[《》「」"'？?！!，,。]/g, ' ')
    .replace(/(?:有沒有|有什麼|推薦|一部|幾部|好看的?|微短劇|短劇|連續劇|劇集|戲劇|一下|嗎|呢|吧)/g, ' ')
    .replace(/^\s*(?:找|看)/, ' ')
    .split(/\s+/).map((w) => w.replace(/^的|的$/g, '').replace(/^(.{2,})劇$/, '$1')).filter(Boolean).join(' '); // 「甜寵的」「甜寵劇」→「甜寵」
  return s.slice(0, 20);
}

/**
 * 連結設定（環境變數）：不合格的一律當沒設定（不會產生危險連結）。
 * @param {{ episode?: string, exercise?: string, storeIos?: string, storeAndroid?: string }} [cfg]
 */
export function dramaLinks(cfg = {}) {
  const episode = typeof cfg.episode === 'string' && /\{id\}/.test(cfg.episode) && linkFrom(cfg.episode, { id: 'x', ep: 1 }) ? cfg.episode : null;
  const exercise = isAppLink(cfg.exercise) ? cfg.exercise : null;
  const ios = isStoreLink(cfg.storeIos) ? cfg.storeIos : null;
  const android = isStoreLink(cfg.storeAndroid) ? cfg.storeAndroid : null;
  return {
    /** 某部劇某一集的 App 連結；沒設定回 null */
    episode: (id, ep = 1) => (episode ? linkFrom(episode, { id, ep }) : null),
    exercise: () => exercise,
    store: () => (ios || android ? { ios, android } : null),
  };
}

/** 卡片與模型看的一部劇：加上第 1 集的 App 連結（ready、_cover 是內部欄位，不往上傳；有封面只說 cover: true） */
const shown = (links) => ({ ready: _r, _cover, ...s }, rank) => ({ ...s, ...(rank != null && { rank }), ...(_cover && { cover: true }), appLink: links.episode(s.id, 1) });

// ───── 封面圖（伺服器代抓）─────
/** 封面最大位元組、快取（一天、最多 200 張、合計 30 MB；抓不到的 10 分內不再試） */
export const COVER_MAX_BYTES = 1_500_000;
export const COVER_TTL_MS = 24 * 3600e3;
const COVER_FAIL_MS = 10 * 60e3;
const COVER_MAX_ITEMS = 200;
const COVER_CACHE_BYTES = 30_000_000;
/** 看檔頭判斷圖片種類（不信上游的 content-type）；不是 JPEG／PNG／WebP／GIF 回 null（SVG 可能夾帶程式，不收） */
export function sniffImage(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(0);
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (b.length > 6 && String.fromCharCode(...b.subarray(0, 4)) === 'GIF8') return 'image/gif';
  return null;
}
/**
 * 抓上游封面（真實版用）：只抓 https、只抓允許的主機、不跟轉址、逾時 8 秒、最大 1.5 MB、看檔頭確認是圖。
 * @param {{ hosts: string[], fetchImpl?: typeof fetch, timeoutMs?: number, maxBytes?: number }} o
 * @returns {(s: { _cover: string }) => Promise<{ body: Buffer, type: string }>}
 */
export function createCoverFetcher({ hosts, fetchImpl = fetch, timeoutMs = 8000, maxBytes = COVER_MAX_BYTES }) {
  const allow = new Set((hosts || []).map((h) => String(h).trim().toLowerCase()).filter(Boolean));
  return async (s) => {
    const u = new URL(s?._cover || '');
    if (u.protocol !== 'https:' || !allow.has(u.hostname.toLowerCase()) || u.username || u.password || (u.port && u.port !== '443')) throw new Error('封面主機不在允許清單');
    const res = await fetchImpl(u.href, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'image/avif,image/webp,image/jpeg,image/png,image/gif' } });
    if (!res.ok) throw new Error(`封面 HTTP ${res.status}`);
    if (Number(res.headers?.get?.('content-length')) > maxBytes) throw new Error('封面太大');
    const parts = [];
    let n = 0;
    for await (const chunk of res.body) { n += chunk.length; if (n > maxBytes) throw new Error('封面太大'); parts.push(chunk); }
    const body = Buffer.concat(parts);
    const type = sniffImage(body);
    if (!type) throw new Error('封面不是圖片');
    return { body, type };
  };
}

/** 等車推劇從熱門排行前幾部裡輪替（產品負責人 2026-11-22：不要永遠推同一部） */
export const WAIT_POOL = 5;
/** 台灣日期 → 從 1970-01-01 起第幾天（同一天同一個數） */
const twDay = (now) => Math.floor((now + 8 * 3600e3) / 864e5);

/**
 * 從排行挑一部「等車時看一集」的劇：熱門前 5 部裡非限制級、有免費集數、第 1 集已上架的，
 * 依台灣日期＋這段對話的輪次輪替（同一天、同一輪重問仍是同一部，畫面不閃動；換一輪或隔天換一部）。
 * @param {ReturnType<typeof normSeries>[]} list
 * @param {{ turn?: number, now?: number }} [at] turn：這段對話第幾輪（使用者第幾句）
 */
export function pickForWait(list, { turn = 0, now = Date.now() } = {}) {
  const pool = (list || []).slice(0, WAIT_POOL).filter((s) => (s.freeEpisodes ?? 0) >= 1 && (s.ready == null || s.ready >= 1));
  if (!pool.length) return null;
  const k = twDay(now) + (Number.isInteger(turn) && turn > 0 ? turn : 0);
  return pool[((k % pool.length) + pool.length) % pool.length];
}

/** 一次最多留幾部（排行、搜尋）：只快取正規化後的這幾部 */
export const LIST_MAX = 50;
/** 回應大小上限（位元組）：太大視為上游異常，不解析 */
export const RESPONSE_MAX_BYTES = 2_000_000;
/** 上游清單 → 正規化（最多 LIST_MAX 部）；不是清單丟錯（上游錯誤） */
export function parseList(x) {
  if (!Array.isArray(x)) throw new Error('不是清單');
  return normList(x.slice(0, LIST_MAX * 4)).slice(0, LIST_MAX);
}
const obj = (x) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('不是物件'); return x; };
/** 單劇 → 正規化（簡介最多 600 字）；限制級或不合格回 null */
export const parseSeries = (x) => normSeries(obj(x), { synopsisMax: 600 });
/** 簡介 → { id, synopsis } */
export const parseSynopsis = (x) => { const o = obj(x); return { id: typeof o.seriesId === 'string' ? o.seriesId : null, synopsis: str(o.synopsis, 600) }; };
/** 熱搜 → 關鍵字 */
export const parseKeywords = (x) => { if (!Array.isArray(x)) throw new Error('不是清單'); return normKeywords(x); };

/**
 * @param {{ ranking: (type: string) => Promise<object[]>, search: (q: string) => Promise<object[]>, series: (id: string) => Promise<object|null>, synopsis: (id: string) => Promise<{ id: string|null, synopsis: string }>, keywords: () => Promise<string[]> }} fx
 *   取資料並正規化（parseList／parseSeries／parseSynopsis／parseKeywords；真實：MyDrama 公開讀取端點；示範：core/data/demo/drama.json）。介面相同（Mock 對等）。
 * @param {{ links?: object }} [opts]
 */
export function createDramaServices(fx, { links: cfg, now = () => Date.now() } = {}) {
  const links = dramaLinks(cfg);
  const show0 = shown(links);
  // 封面：id → 上游網址（從排行、搜尋、單劇記下來；最多 500 筆）；id → 圖（快取）
  const coverOf = new Map();
  const remember = (s) => { if (s?._cover) { coverOf.delete(s.id); coverOf.set(s.id, s); if (coverOf.size > 500) coverOf.delete(coverOf.keys().next().value); } return s; };
  const show = (s, rank) => show0(remember(s), rank);
  const covers = new Map(); // id → { body, type, at } 或 { fail: at }
  let coverBytes = 0;
  const dropCover = (id) => { const c = covers.get(id); if (c?.body) coverBytes -= c.body.length; covers.delete(id); };
  const keepCover = (id, v) => {
    dropCover(id);
    covers.set(id, v);
    if (v.body) coverBytes += v.body.length;
    while (covers.size > COVER_MAX_ITEMS || coverBytes > COVER_CACHE_BYTES) dropCover(covers.keys().next().value);
  };
  const coverInflight = new Map();
  const keywords = () => fx.keywords().catch(() => []); // 熱搜失敗不影響主要結果
  const gone = () => new UserError('找不到這部短劇，可能已經下架；換個劇名搜尋看看。');
  return {
    drama: {
      /** 排行（hot／new／completed／taiwan） */
      async picks({ list = 'hot', limit = 5 } = {}) {
        if (!DRAMA_LISTS.includes(list)) throw new UserError(`排行種類只有：${DRAMA_LISTS.join('、')}`);
        const [rows, kw] = await Promise.all([fx.ranking(list), keywords()]);
        const items = rows.slice(0, limit).map((s, i) => show(s, i + 1));
        return { kind: 'list', list, listName: DRAMA_LIST_NAME[list], items, keywords: kw, store: links.store() };
      },
      /** 搜尋（劇名或類型關鍵字；比對交給片庫） */
      async search({ query, limit = 5 } = {}) {
        const q = dramaQuery(query);
        if (!q) throw new UserError('要找什麼短劇？說劇名或類型，例如「甜寵」「懸疑」「重生」。');
        const all = await fx.search(q);
        return { kind: 'search', query: q, total: all.length, items: all.slice(0, limit).map((s) => show(s)), store: links.store() };
      },
      /** 單劇＋完整簡介（簡介端點失敗時用單劇自帶的） */
      async series({ id } = {}) {
        if (typeof id !== 'string' || !DRAMA_ID.test(id)) throw new UserError('劇的代號格式不對。');
        let s;
        try { s = await fx.series(id); } catch (e) {
          if (e?.upstreamStatus === 404 || e?.upstreamStatus === 410) throw gone();
          throw e;
        }
        if (!s || s.id !== id) throw gone();
        const syn = await fx.synopsis(id).then((r) => (r?.id == null || r.id === id ? r?.synopsis : '')).catch(() => '');
        return { kind: 'series', items: [show({ ...s, synopsis: syn || s.synopsis })], store: links.store() };
      },
      /** 等車推劇：熱門前 5 部可以從第 1 集看的，依日期＋輪次輪替（找不到回 null；上游失敗也回 null，不影響交通資訊） */
      async waitPick({ turn = 0, now = Date.now() } = {}) {
        const s = pickForWait(await fx.ranking('hot').catch(() => []), { turn, now });
        return s ? { ...show(s), ep: 1 } : null;
      },
      /**
       * 封面圖（伺服器代抓，/api/v1/drama/cover/:id）：沒有封面、抓不到、不是圖 → null（畫面改用劇名第一個字）。
       * @returns {Promise<{ body: Buffer, type: string } | null>}
       */
      async cover({ id } = {}) {
        if (typeof id !== 'string' || !DRAMA_ID.test(id) || !fx.cover) return null;
        const c = covers.get(id);
        if (c && now() - c.at < (c.fail ? COVER_FAIL_MS : COVER_TTL_MS)) { if (c.body) { covers.delete(id); covers.set(id, c); } return c.body ? { body: c.body, type: c.type } : null; }
        if (coverInflight.has(id)) return coverInflight.get(id);
        const p = (async () => {
          let s = coverOf.get(id);
          if (!s) s = remember(await fx.series(id).catch(() => null)); // 沒在排行或搜尋看過：查單劇（快取 1 小時）
          if (!s || s.id !== id || !s._cover) { keepCover(id, { fail: true, at: now() }); return null; } // 沒有這部劇或沒有封面：10 分內不再查（亂猜 id 也不會一直打片庫）
          try {
            const img = await fx.cover(s);
            keepCover(id, { ...img, at: now() });
            return img;
          } catch {
            keepCover(id, { fail: true, at: now() });
            return null;
          }
        })().finally(() => coverInflight.delete(id));
        coverInflight.set(id, p);
        return p;
      },
      /** 合作 App 活動頁的連結（給「天氣好、動得少」的運動建議接用；沒設定回 null） */
      exerciseLink: () => links.exercise(),
      /** 商店頁（沒裝 MyDrama 時開） */
      store: () => links.store(),
    },
  };
}

/**
 * 真實：MyDrama 公開讀取端點（od＝createOpenDataClient()，逾時、快取、計量、錯誤訊息不含網址）。
 * 下載後先正規化再快取（只留阿幫的欄位、最多 50 部）；回應超過 2 MB 視為上游異常。
 * base 只能是 https（本機開發可用 http://localhost）；不合格就不建（回 null，系統改用示範資料）。
 * @param {{ od: { get: Function }, base: string, coverHosts?: string[], fetchImpl?: typeof fetch }} a coverHosts：允許抓封面的主機（MYDRAMA_COVER_HOSTS；沒設定＝API 的主機）
 */
export function createLiveDramaFetchers({ od, base, coverHosts, fetchImpl }) {
  const b = typeof base === 'string' ? base.trim().replace(/\/+$/, '') : '';
  if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(b) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s]*)?$/i.test(b)) return null;
  const get = (path, ttlSec, label, parse) => od.get(`${b}${path}`, { ttlSec, label, as: 'json', parse, maxBytes: RESPONSE_MAX_BYTES, headers: { accept: 'application/json' } });
  const enc = encodeURIComponent;
  return {
    ranking: (type) => get(`/catalog/ranking?type=${enc(type)}`, DRAMA_TTL.list, 'MyDrama 排行', parseList),
    search: (q) => get(`/catalog/search?q=${enc(q)}`, DRAMA_TTL.list, 'MyDrama 搜尋', parseList),
    series: (id) => get(`/catalog/series/${enc(id)}`, DRAMA_TTL.series, 'MyDrama 劇集資訊', parseSeries),
    synopsis: (id) => get(`/series/${enc(id)}/synopsis`, DRAMA_TTL.series, 'MyDrama 劇集簡介', parseSynopsis),
    keywords: () => get('/catalog/hot-keywords', DRAMA_TTL.list, 'MyDrama 熱搜', parseKeywords),
    cover: createCoverFetcher({ hosts: coverHosts?.length ? coverHosts : [new URL(b).hostname], ...(fetchImpl && { fetchImpl }) }),
  };
}
