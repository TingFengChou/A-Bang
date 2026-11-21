// 回答也在手機上寫（ADR-0017）：伺服器給「程式版總結」（draft，數字都來自資料）＋精簡事實清單（facts），
// 手機上的模型（Gemini Nano／Apple Intelligence）改寫成自然的一兩句；這裡是改寫結果的程式護欄（不信任模型）。
// 純函式、無相依：伺服器以 /core/edge-write.js 提供給前端（public/js/edge-write.js），App 打包時一起複製（scripts/build-app.js）。
// 檢查不過就用程式版總結。防詐 agent 一律不改寫（固定安全句、165 不能被改掉）。

/** 改寫的目標長度（給模型的指示）與上限（超過就不採用） */
export const WRITE_TARGET_CHARS = 80;
/** 程式版總結太長或數字太多時不改寫（模型一定漏，白花時間）：直接用程式版 */
export const WRITE_SKIP = { chars: 220, numbers: 10 };
/** 只改寫這些 agent（防詐不改寫） */
export const WRITE_AGENTS = ['life'];

/** 給手機模型的指示（兩個平台共用；語氣見 docs/BRAND.md §4：先講結論、口語短句、台灣用語） */
export const WRITE_INSTRUCTIONS = {
  zh: `你是「阿幫」，台灣的交通與生活小幫手，說話親切、簡短、先講結論，用台灣的繁體中文。
把「草稿」改寫成自然的一兩句話（${WRITE_TARGET_CHARS} 字以內）。
規則：
1. 草稿裡的每個數字、時間、站名、路線、金額都要原樣保留：不能改、不能少、不能換算、不能改用國字。
2. 不能加入草稿和事實清單以外的任何資訊、數字或建議。
3. 不能說已經幫使用者叫車、訂票或付款（阿幫只給連結）。
4. 只回改寫後的句子，不要引號、標題或說明。`,
  en: `You are "Abang", a friendly Taiwan transit and daily-life helper. Lead with the answer; keep it short and warm.
Rewrite the "draft" as one or two natural English sentences (under 45 words).
Rules:
1. Keep every number, time, station name, route and price exactly as written: do not change, drop, convert or spell out numbers.
2. Do not add any information, numbers or advice that is not in the draft or the fact list.
3. Never say you booked, ordered, called a taxi or paid for the user (Abang only gives links).
4. Reply with the rewritten sentences only: no quotes, titles or notes.`,
};

/** 全形數字、冒號、小數點 → 半形；千分位逗號拿掉 */
export function normDigits(s) {
  return String(s ?? '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':').replace(/．/g, '.')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

/**
 * 文字裡的時間（HH:mm → H:mm）與其他數字（數值正規化：07 → 7、2.50 → 2.5）。
 * @returns {{ times: string[], numbers: string[] }}
 */
export function numbersIn(text) {
  const times = [];
  const rest = normDigits(text).replace(/(?<![\d.])(\d{1,2}):(\d{2})(?![\d:])/g, (_, h, m) => { times.push(`${Number(h)}:${m}`); return ' '; });
  const numbers = (rest.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n)));
  return { times, numbers };
}

/** 事實清單的所有值串成一段文字（只看值，不看鍵名） */
export function factsText(facts) {
  const out = [];
  const walk = (v) => {
    if (v == null || typeof v === 'boolean') return;
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
    else out.push(String(v));
  };
  walk(facts);
  return out.join('\n');
}

/** 程式版總結裡「一定要留下」的數字：名稱裡括號的編號（例「民生捷運站(1號出口)」的 1）不算，其他都算 */
export function keyNumbers(draft) {
  const bare = String(draft ?? '').replace(/([「『][^」』]*?)[(（][^)）」』]*[)）]/g, '$1');
  const { times, numbers } = numbersIn(bare);
  return { times: [...new Set(times)], numbers: [...new Set(numbers)] };
}

// 國字或英文寫的數量（「十分鐘」「兩站」「seven minutes」）：不在草稿裡就是模型自己加的數字（單獨一個「一」是「下一班」「一點」這類說法，不算）
const CN_DIGIT = '零〇一二兩三四五六七八九十百千萬';
const CN_COUNT = new RegExp(`(?:[零〇二兩三四五六七八九十百千萬][${CN_DIGIT}]*|一[${CN_DIGIT}]+)\\s*(?:分鐘|分|元|塊|公里|公尺|小時|秒|點|號|班|站|度|級|家|趟|輛|人|個|%)`, 'g');
const EN_COUNT = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|half an?)\s+(?:mins?|minutes?|hours?|stops?|stations?|dollars?|km|kilometers?|kilometres?|meters?|metres?|blocks?)\b/gi;

// ADR-0011：阿幫只產生官方連結，不能說已經幫你叫車、訂票、付款
const DONE_ZH = /(?:已|已經|幫你|替你|為你|幫您|替您|為您)[^。！？\n]{0,6}(?:叫好|叫到|叫了|訂好|訂到|訂了|預訂好|付款|付好|付了|付清|買好|買了|下單|完成預訂|完成付款|預約好)|(?:叫好|訂好|買好|付好)(?:車|票|位)?了/;
const DONE_EN = /\b(?:i|we)(?:'ve| have)?\s+(?:already\s+)?(?:booked|ordered|paid|reserved|bought|purchased|called (?:you )?an? (?:taxi|cab|car|ride))\b|\b(?:has|have) been (?:booked|paid|reserved|ordered|purchased)\b|\bbooked for you\b/i;
// 投資建議與漲跌預測（與 core/agent/guardrails.js 的 finance 護欄同一個方向；改寫不能多出來）
const ADVICE = /(?:建議|推薦|可以|適合|值得)(?:你|您)?(?:買進|買入|賣出|加碼|減碼|進場|出場|布局|佈局|逢低)|看(?:漲|跌)(?!倒)|目標價|明牌|(?:會|將|可望|有望)(?:繼續)?(?:上漲|下跌|反彈|回檔)|\b(?:should|recommend)\b[^.]{0,20}\b(?:buy|sell)\b/i;
// 草稿有這些提醒，改寫也要有（示範資料、末班、停駛、沒拿到位置、帶傘、時間很緊）
const KEEP = [
  { draft: /示範/, zh: /示範/, en: /demo/i, name: 'demo' },
  { draft: /末班|last (?:train|bus|service)/i, zh: /末班/, en: /\blast\b/i, name: 'last' },
  { draft: /停駛|suspended/i, zh: /停駛/, en: /suspend/i, name: 'suspended' },
  { draft: /沒拿到你的位置|couldn't get your location/i, zh: /沒拿到.{0,4}位置/, en: /location/i, name: 'noLocation' },
  { draft: /傘|umbrella/i, zh: /傘/, en: /umbrella/i, name: 'umbrella' },
  { draft: /時間很緊|tight/i, zh: /緊|趕/, en: /tight|hurry|now/i, name: 'tight' },
];
const LATIN_OK = new Set(['youbike', 'aqi', 'pm', 'mrt', 'ok', 'app', 'uber', 'qr', 'code', 'km', 'nt']);
const CJK_RUN = /[㐀-鿿豈-﫿]+/g;
const tw = (s) => String(s).replace(/臺/g, '台');

/** 引號成對（「」『』巢狀深度不會變負、最後歸零；直引號不能再出現） */
function balanced(s) {
  let a = 0, b = 0;
  for (const ch of s) {
    if (ch === '「') a++; else if (ch === '」' && --a < 0) return false;
    if (ch === '『') b++; else if (ch === '』' && --b < 0) return false;
    if (ch === '"' || ch === '“' || ch === '”') return false;
  }
  return a === 0 && b === 0;
}

/** 模型輸出的清理：去頭尾空白與包住整句的引號、「改寫：」這類前綴、多餘空行 */
export function cleanRewrite(raw) {
  let s = String(raw ?? '').trim();
  s = s.replace(/^(?:改寫(?:後)?|回答|草稿|Rewritten|Answer)\s*[:：]\s*/i, '');
  for (let i = 0; i < 2; i++) {
    const m = /^(["「『“'])([\s\S]*)(["」』”'])$/.exec(s);
    if (!m || !balanced(m[2])) break; // 裡面的引號沒配好：是「站名」…「站名」這種句子，不是整句被包住
    s = m[2].trim();
  }
  return s.replace(/\n{2,}/g, '\n');
}

/**
 * 檢查手機寫的回答能不能用。任何一條不過就不用（呼叫端改用程式版 draft）。
 * @param {string} candidate 手機模型的輸出
 * @param {{ draft: string, facts?: object, lang?: 'zh'|'en', agent?: string }} o
 * @returns {{ ok: true, text: string } | { ok: false, reason: string, detail?: string }}
 *   reason：agent 這個 agent 不改寫｜empty｜long｜lang 語言不對｜number 多出數字｜time 時間不在資料裡｜missing 漏了關鍵數字｜
 *           count 用國字或英文寫數量｜action 說已經叫車訂票付款（ADR-0011）｜advice 投資建議｜keep 漏了重要提醒｜name 引號裡的名稱不在資料裡｜format 網址、工具名稱或格式字元
 */
export function checkRewrite(candidate, { draft, facts = {}, lang = 'zh', agent = 'life' } = {}) {
  if (!WRITE_AGENTS.includes(agent)) return { ok: false, reason: 'agent' };
  const text = cleanRewrite(candidate);
  const d = String(draft ?? '');
  if (text.length < 4) return { ok: false, reason: 'empty' };
  const en = lang === 'en';
  if (text.length > Math.max(en ? 320 : 140, d.length * 1.2)) return { ok: false, reason: 'long' };
  const ref = `${d}\n${factsText(facts)}`;
  const refTw = tw(ref);
  // 格式：網址（草稿沒有的）、工具英文名稱、markdown
  const urls = text.match(/https?:\/\/\S+/g) || [];
  if (urls.some((u) => !ref.includes(u)) || /\b[a-z]+(?:_[a-z0-9]+)+\b/.test(text) || /```|^#|\*\*/m.test(text)) return { ok: false, reason: 'format' };
  // 語言：英文那一輪的中文只能是草稿或資料裡的名稱；中文那一輪要有中文、英文字只能是資料裡有的或常見縮寫
  if (en) {
    const cjk = text.match(CJK_RUN) || [];
    const bad = cjk.find((w) => !refTw.includes(tw(w)));
    if (bad) return { ok: false, reason: 'lang', detail: bad };
  } else {
    if (!/[\u3400-\u9fff]/.test(text)) return { ok: false, reason: 'lang' };
    const lower = ref.toLowerCase();
    const bad = (text.match(/[A-Za-z]{2,}/g) || []).find((w) => !LATIN_OK.has(w.toLowerCase()) && !lower.includes(w.toLowerCase()));
    if (bad) return { ok: false, reason: 'lang', detail: bad };
  }
  // 數字：改寫裡的每個時間、數字都要在草稿或事實清單裡；草稿的關鍵數字一個都不能少
  const got = numbersIn(text);
  const have = numbersIn(ref);
  const haveTimes = new Set(have.times), haveNums = new Set(have.numbers);
  const t = got.times.find((x) => !haveTimes.has(x));
  if (t) return { ok: false, reason: 'time', detail: t };
  const n = got.numbers.find((x) => !haveNums.has(x));
  if (n) return { ok: false, reason: 'number', detail: n };
  const key = keyNumbers(d);
  const gotTimes = new Set(got.times), gotNums = new Set(got.numbers);
  const lostT = key.times.find((x) => !gotTimes.has(x));
  if (lostT) return { ok: false, reason: 'missing', detail: lostT };
  const lostN = key.numbers.find((x) => !gotNums.has(x));
  if (lostN) return { ok: false, reason: 'missing', detail: lostN };
  const counts = [...(text.match(CN_COUNT) || []), ...(text.match(EN_COUNT) || [])];
  const madeUp = counts.find((c) => !ref.toLowerCase().includes(c.toLowerCase()));
  if (madeUp) return { ok: false, reason: 'count', detail: madeUp };
  // ADR-0011 與投資建議：草稿本來就不會有，改寫多出來就不用
  if ((DONE_ZH.test(text) && !DONE_ZH.test(d)) || (DONE_EN.test(text) && !DONE_EN.test(d))) return { ok: false, reason: 'action' };
  if (ADVICE.test(text) && !ADVICE.test(d)) return { ok: false, reason: 'advice' };
  // 重要提醒不能被改寫掉
  const lost = KEEP.find((k) => k.draft.test(d) && !(en ? k.en : k.zh).test(text) && !k.draft.test(text));
  if (lost) return { ok: false, reason: 'keep', detail: lost.name };
  // 引號裡的名稱（站名、地點、路線）要是資料裡有的
  const names = [...text.matchAll(/[「『]([^」』]{1,30})[」』]/g)].map((m) => m[1]);
  const badName = names.find((x) => !refTw.includes(tw(x)));
  if (badName) return { ok: false, reason: 'name', detail: badName };
  return { ok: true, text };
}

/** 草稿要不要交給手機改寫：太長或數字太多就直接用程式版（模型一定漏） */
export function worthRewriting(draft) {
  const d = String(draft ?? '');
  if (!d.trim() || d.length > WRITE_SKIP.chars) return false;
  const k = keyNumbers(d);
  return k.times.length + k.numbers.length <= WRITE_SKIP.numbers;
}

/** 給手機模型的一段輸入（草稿＋事實清單；兩個平台共用） */
export function writePrompt(draft, facts = {}, lang = 'zh') {
  const en = lang === 'en';
  const lines = factsText(facts).split('\n').filter(Boolean).slice(0, 12);
  return `${en ? 'Draft' : '草稿'}：${draft}\n${lines.length ? `${en ? 'Facts' : '事實清單'}：\n- ${lines.join('\n- ')}\n` : ''}${en ? 'Rewrite' : '改寫'}：`;
}
