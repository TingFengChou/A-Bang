// 去政府辦事（M16-04a）：辦某件事要帶什麼、怎麼辦、要幾天、能不能線上辦。
// 資料：我的E政府入口網－申辦服務資訊（data.gov.tw 146973，免金鑰，政府資料開放授權條款－第1版）：
//   線上申辦、臨櫃、電郵傳真三個 JSON（www.gov.tw），同一個服務代碼出現在哪個檔就代表有哪個管道。
// 品質（2026-11-27 研究）：約四分之一沒填應備證件、有些條目多年沒更新、內容是整段文字、臨櫃檔約 2,800 筆是臺中市版；
// 所以中央機關版優先、照實附上資料修改日期與「以機關公告為準」、沒填的照實說。www.gov.tw 前面有 Cloudflare，下載失敗時沿用上一份（opendata-client）。

export const GOV_URLS = {
  online: 'https://www.gov.tw/govonlineservice.json',
  counter: 'https://www.gov.tw/govcounterservice.json',
  other: 'https://www.gov.tw/govotherservice.json',
};
const PREFIX = { online: '線上申辦', counter: '臨櫃', other: '電郵傳真' };
const LINK = { online: '線上申辦連結', counter: '臨櫃_表單下載連結', other: '電郵傳真_連結' };
/** 中央機關的 OID 前綴（2.16.886.101.20003…；地方政府是 900xx） */
const CENTRAL = '2.16.886.101.20003';
export const GOV_TTL_SEC = 24 * 3600;
const MAX_BYTES = 15 * 1024 * 1024;

const COUNTIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];
const tw = (s) => String(s || '').replace(/台/g, '臺');

/** 整理欄位文字：去掉 HTML、雜訊字串、「無資料」，空白收成一個 */
export function cleanText(s) {
  const t = String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\$font\$/g, '').replace(/&nbsp;/g, ' ').replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return /^(?:無資料|無|-|－|null|undefined)?$/.test(t) ? '' : t;
}
const httpsOnly = (u) => { try { const x = new URL(String(u).trim()); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const day = (s) => { const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(s || '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

/**
 * 三個檔的原始列 → 以服務代碼合併的服務清單（管道、應備證件、天數、連結、修改日期）。
 * @param {{ online?: object[], counter?: object[], other?: object[] }} raw
 */
export function mergeServices(raw) {
  const byId = new Map();
  for (const ch of ['counter', 'online', 'other']) { // 應備證件以臨櫃為主（最完整），沒有再用線上、電郵
    for (const r of raw?.[ch] || []) {
      const id = cleanText(r['服務代碼']);
      const title = cleanText(r['標題']);
      if (!id || !title) continue;
      const p = PREFIX[ch];
      const cur = byId.get(id) || { id, title, central: String(r['單位OID'] || '').startsWith(CENTRAL), channels: [], url: httpsOnly(r['頁面連結']), updated: day(r['修改日期時間']) };
      cur.channels.push(ch);
      const f = (k) => cleanText(r[`${p}_${k}`]);
      for (const [key, col] of [['docs', '應備證件'], ['days', '作業天數'], ['eligibility', '申辦資格'], ['process', '申辦流程'], ['contact', '聯絡窗口'], ['content', '服務內容']]) if (!cur[key] && f(col)) cur[key] = f(col);
      const link = httpsOnly(r[LINK[ch]]);
      if (ch === 'online' && link) cur.onlineUrl = link;
      else if (ch === 'counter' && link) cur.formUrl ||= link;
      const up = day(r['修改日期時間']);
      if (up && (!cur.updated || up > cur.updated)) cur.updated = up;
      byId.set(id, cur);
    }
  }
  return [...byId.values()];
}

// 口語 → 公文用字（比對標題用）
const SYNONYMS = [
  // 台語用字（「阮孫仔欲報戶口，愛紮啥物」，PM 審查 2026-11-28）
  [/欲/g, '要'], [/愛(?=紮|帶|準備)/g, '要'], [/紮/g, '帶'], [/啥物|啥咪/g, '什麼'], [/^阮/g, '我'], [/孫仔/g, '孫子'],
  [/(?:孫子?|囝仔|小孩|嬰仔|寶寶|新生兒|小朋友).{0,4}報戶口/g, '出生登記'],
  // 長輩常辦的：口語 → 標題用字
  [/(?:補辦|補發|換)健保卡|健保卡(?:補辦|補發|換發|不見了?|遺失|掉了)/g, '換發健保卡'],
  [/(?<!重陽)敬老禮金|重陽禮金/g, '敬老禮金'], [/老人(?:生活)?津貼/g, '中低收入老人生活津貼'],
  [/身障(?:手冊|證明)|殘障手冊/g, '身心障礙證明'], [/(?:換|補)(?:發|辦)?身心障礙證明|身心障礙證明(?:換|補)(?:發|辦|證明|新)?/g, '身心障礙證明換發'], [/印章(?:登記)?|(?<!印鑑)登記印鑑/g, '印鑑登記'],
  [/(?<!中)低收入戶(?!申請|資格|房屋|.{0,2}減免)/g, '低收入戶申請'], [/中低收入戶(?!申請|資格)/g, '中低收入戶申請'],
  [/身分證|身份證/g, '國民身分證'], [/換(?:新)?(?:的)?國民身分證|國民身分證換(?:新|發)?/g, '國民身分證換發'], [/補(?:辦)?國民身分證|國民身分證(?:不見|遺失|掉了)/g, '國民身分證補發'],
  [/(?<!電子|英文|戶籍|戶口)謄本/g, '戶籍謄本'], [/戶口謄本/g, '戶籍謄本'], [/戶口本/g, '戶口名簿'],
  [/搬家|遷戶口|戶口遷/g, '遷入登記'], [/結婚(?!登記)/g, '結婚登記'], [/(?:報)?(?:出生|生小孩|新生兒)(?:報戶口)?(?!登記)/g, '出生登記'], [/(?:辦)?死亡(?!登記)/g, '死亡登記'],
  [/護照(?:掉了|不見|遺失)/g, '護照遺失申報'], [/(?:第一次|首次)(?:辦|申請|申辦)?護照/g, '首次申請護照'], [/(?<!首次)(?:辦|申辦)護照/g, '申請護照'], // 標題用「申請護照」
  [/(行照|駕照)(?:不見了?|遺失|掉了)/g, '$1補發'], [/國保/g, '國民年金'], [/老人年金/g, '老年年金'], // 勞保：標題本來就寫「勞保」，不換
];
/** 問法裡跟辦什麼事無關的字（要帶什麼、怎麼辦、我想…） */
const FILLER = /^(?:那(?:麼)?)|^(?:我的?(?!要|想)|老人(?:家)?的?|長輩的?|阿公的?|阿嬤的?)|(?:要)?去?(?:區公所|市公所|鄉公所|公所|戶政事務所|戶政)(?:辦)?|(?:不見了?|遺失|掉了|補辦)(?=$|[？?！!。，,\s]|要|怎|如)|(?:怎麼|如何|要去哪裡?|去哪|哪裡)領|(?:請問|我想要?|我要|想要|要去|幫我查|幫我|查一下)|(?:需要|要|得|該)?(?:帶|準備|攜帶)(?:什麼|哪些|甚麼|啥)(?:東西|文件|證件|資料)?|(?:要|需要)?(?:什麼|哪些)(?:文件|證件|資料)|應備(?:文件|證件)?|(?:怎麼|如何|要怎麼|去哪|哪裡可以?|在哪)(?:辦理?|申請|弄)?|(?:要|需要)(?:多久|幾天)|手續|流程|規定|[？?！!。，,\s]|(?:嗎|呢|啊|喔|欸|耶)$/g;

/** 使用者的問法 → 比對用的關鍵字串 */
export function serviceQuery(text) {
  let s = tw(String(text || '')).replace(/臺/g, '台'); // 先統一成「台」比對口語，最後再轉回「臺」對標題
  for (const [re, to] of SYNONYMS) s = s.replace(re, to);
  return tw(s.replace(FILLER, '').replace(/(.{2,})\1/g, '$1')).slice(0, 40); // 「搬家遷戶口」兩個都換成同一詞：留一個
}

const grams = (s) => { const t = tw(s).replace(/[\s()（）「」、，,.。:：/／-]/g, ''); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };

/**
 * 找最符合的申辦服務：二字詞重疊（Dice）＋中央機關加分＋別的縣市扣分；同名只留一筆（中央優先）。
 * @param {ReturnType<typeof mergeServices>} services
 * @param {string} query 使用者的問法（會先整理）
 * @param {{ county?: string|null, limit?: number }} [o]
 */
export function searchServices(services, query, { county = null, limit = 3 } = {}) {
  const q = serviceQuery(query);
  const qg = grams(q);
  if (qg.size === 0) return { query: q, items: [] };
  const mine = county ? tw(county) : null;
  const scored = [];
  for (const s of services) {
    const tg = grams(s.title);
    let hit = 0;
    for (const g of qg) if (tg.has(g)) hit++;
    if (!hit) continue;
    let score = (2 * hit) / (qg.size + tg.size) + hit / qg.size; // 標題涵蓋多少問的字＋長度相近
    if (s.central) score += 0.2;
    const other = COUNTIES.find((c) => tw(s.title).includes(c) && c !== mine);
    if (other) score -= 0.3;
    if (mine && tw(s.title).includes(mine)) score += 0.2;
    if (!s.docs) score -= 0.05; // 沒填應備證件的排後面
    for (const w of ['英文', '單位申辦', '工商憑證', '法人', '外國人', '農民', '國外']) if (s.title.includes(w) && !q.includes(w)) score -= 0.5; // 一般人沒說就不是這種（英文謄本、公司代辦）
    scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.s.updated || '').localeCompare(a.s.updated || ''));
  const seen = new Set();
  const items = [];
  const top = scored[0]?.score ?? 0;
  for (const { s, score } of scored) {
    if (score < 0.75 || score < top * 0.8 || seen.has(s.title)) continue; // 跟最符合的差太多就不列（「結婚登記」不帶出「出生登記」）
    seen.add(s.title);
    items.push(s);
    if (items.length >= limit) break;
  }
  return { query: q, items };
}

/** 應備證件的整段文字 → 一條一條（「一、」「(一)」「1.」分段；最多 12 條、每條 120 字） */
export function docsList(text) {
  const t = cleanText(text);
  if (!t) return [];
  const parts = t.split(/\n|(?=(?:^|\s|。|；)(?:[一二三四五六七八九十]{1,3}、|[(（][一二三四五六七八九十0-9]{1,3}[)）]|\d{1,2}[.、]))/).map((x) => x.replace(/^[\s。；]+/, '').trim()).filter((x) => x.length > 1);
  const seen = new Set();
  return parts.filter((x) => !seen.has(x) && seen.add(x)).slice(0, 12).map((x) => ([...x].length > 120 ? `${[...x].slice(0, 119).join('')}…` : x)); // 原文常重複同一條（初領與補領都要照片）
}

/** 給卡片與回答的正規化資料（不含原始欄位名稱，CLAUDE.md 架構規則 5） */
export function toItem(s) {
  return {
    id: s.id, title: s.title, central: s.central, channels: s.channels,
    docs: docsList(s.docs), days: s.days || null, eligibility: s.eligibility ? clipText(s.eligibility, 300) : null, process: s.process ? clipText(s.process, 200) : null,
    contact: s.contact ? clipText(s.contact, 120) : null, url: s.url, onlineUrl: s.onlineUrl || null, formUrl: s.formUrl || null, updated: s.updated || null,
  };
}
const clipText = (s, n) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);

/**
 * @param {{ load: () => Promise<{ online: object[], counter: object[], other: object[] }> }} fx
 */
export function createGovServices(fx) {
  let memo = null; // { raw, services }：同一份原始資料只合併一次
  const services = async () => {
    const raw = await fx.load();
    const same = memo && ['online', 'counter', 'other'].every((k) => memo.raw[k] === raw[k]); // 快取的陣列沒換就不重算
    if (!same) memo = { raw, services: mergeServices(raw) };
    return memo.services;
  };
  return {
    /** @param {{ query: string, county?: string|null, limit?: number }} a */
    async serviceInfo({ query, county = null, limit = 3 }) {
      const all = await services();
      const r = searchServices(all, query, { county, limit });
      return { query: r.query, items: r.items.map(toItem), total: all.length, source: '我的E政府' };
    },
  };
}

const NONE = Object.freeze([]);
/** 真實資料：三個檔各自快取一天（opendata-client：失敗時沿用上一份，最多 2 天） */
export function createLiveGovFetchers({ od }) {
  const get = (ch) => od.get(GOV_URLS[ch], { ttlSec: GOV_TTL_SEC, label: '我的E政府申辦服務資料', as: 'text', maxBytes: MAX_BYTES, parse: (t) => { const j = JSON.parse(String(t).replace(/^\uFEFF/, '')); if (!Array.isArray(j)) throw new Error('不是陣列'); return j; } });
  return {
    async load() {
      const [online, counter, other] = await Promise.all([get('online'), get('counter'), get('other').catch(() => NONE)]); // 電郵傳真檔少、拿不到不影響（同一個空陣列：合併結果的快取才認得）
      return { online, counter, other };
    },
  };
}
