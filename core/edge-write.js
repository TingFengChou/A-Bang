// 回答也在手機上寫（ADR-0017）：伺服器給「程式版總結」（draft，數字都來自資料）＋精簡事實清單（facts），
// 手機上的模型（Gemini Nano／Apple Intelligence）改寫成自然的一兩句；這裡是改寫結果的程式護欄（不信任模型）。
// 純函式：伺服器以 /core/edge-write.js、/core/output-guards.js 提供給前端（public/js/edge-write.js），App 打包時一起複製（scripts/build-app.js）。
// 檢查不過就用程式版總結。防詐 agent 一律不改寫（固定安全句、165 不能被改掉）。
import { applyOutputGuardrails } from './output-guards.js';

/** 改寫的目標長度（給模型的指示）與上限（超過就不採用） */
export const WRITE_TARGET_CHARS = 80;
/** 程式版總結太長或數字太多時不改寫（模型一定漏，白花時間）：直接用程式版 */
export const WRITE_SKIP = { chars: 220, numbers: 10 };
/** 會交給手機改寫的 agent 與它的工具包（與 core/agents/*.json 的 packs 相同，test/edge-write.test.js 比對）：L2 輸出護欄照工具包套用。防詐不改寫 */
export const WRITE_PACKS = { life: ['transit', 'weather', 'ridehail', 'life', 'finance', 'drama', 'gov'] }; // 與 core/agents/life.json 的 packs 一致（drama：ADR-0019；gov：去政府辦事，M16-04a）
export const WRITE_AGENTS = Object.keys(WRITE_PACKS);
/** 給原生端的輸入上限（指示＋輸入，字數）；原生 write() 超過一樣拒絕 */
export const WRITE_MAX_INPUT = 4000;

/** 給手機模型的指示（兩個平台共用；語氣見 docs/BRAND.md §4：先講結論、口語短句、台灣用語） */
export const WRITE_INSTRUCTIONS = {
  zh: `你是「阿幫」，台灣的交通與生活小幫手，說話親切、簡短、先講結論，用台灣的繁體中文；稱呼使用者用「您」。
把「草稿」改寫成自然的一兩句話（${WRITE_TARGET_CHARS} 字以內）。
規則：
1. 草稿裡的每個數字、時間、站名、路線、金額都要原樣保留，順序也不要換：不能改、不能少、不能換算、不能改用國字。
2. 不能加入草稿和事實清單以外的任何資訊、數字、時段或建議；提醒（帶傘、末班、示範資料…）不能改成相反的意思。
3. 不能說已經幫使用者叫車、訂票、預約、設提醒或付款（阿幫只給連結）。
4. 只回改寫後的句子，不要引號、標題、網址或說明。`,
  en: `You are "Abang", a friendly Taiwan transit and daily-life helper. Lead with the answer; keep it short and warm.
Rewrite the "draft" as one or two natural English sentences (under 45 words).
Rules:
1. Keep every number, time, station name, route and price exactly as written and in the same order: do not change, drop, convert or spell out numbers.
2. Do not add any information, numbers, times of day or advice that is not in the draft or the fact list; never flip a reminder (umbrella, last train, demo data) into its opposite.
3. Never say you booked, ordered, reserved, set a reminder, called a taxi or paid for the user (Abang only gives links).
4. Reply with the rewritten sentences only: no quotes, titles, links or notes.`,
};

/** 全形數字、冒號、小數點、百分號 → 半形；千分位逗號拿掉 */
export function normDigits(s) {
  return String(s ?? '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':').replace(/．/g, '.').replace(/％/g, '%').replace(/℃/g, '°C')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

// 數字後面的單位（長的放前面）；同義的單位正規化成同一個（分鐘＝分＝min、塊＝元＝NT$…）
const UNIT = '分鐘|個小時|小時|公里|公尺|°C|°|%|分|元|塊|度|號|站|秒|班|家|人|輛|級|成|倍|天|日|樓|次|張|則|個|趟|月|年|週|點|minutes|minute|mins|min|hours|hour|hrs|hr|seconds|second|secs|sec|stops|stop|stations|station|people|km|m(?![a-z])';
const UNIT_NORM = { 分鐘: '分', min: '分', mins: '分', minute: '分', minutes: '分', 塊: '元', '°': '°C', 個小時: '小時', hour: '小時', hours: '小時', hr: '小時', hrs: '小時', second: '秒', seconds: '秒', sec: '秒', secs: '秒', stop: '站', stops: '站', station: '站', stations: '站', km: '公里', m: '公尺', people: '人' };
const TOKEN = new RegExp(`(?<![\\d.:])(\\d{1,2}):(\\d{2})(?![\\d:])|(?:(NT\\$|\\$|新台幣)\\s?)?(?<![\\d.])(\\d+(?:\\.\\d+)?)(?:\\s?(${UNIT}))?`, 'gi');

/**
 * 文字裡依序出現的時間與數字（數字帶單位）：{ t: '8:30' }｜{ n: '270', u: '元' }（沒有單位 u 是 ''）。
 * @returns {Array<{ t?: string, n?: string, u?: string, i: number }>} i：在文字裡的位置
 */
export function tokensIn(text) {
  const out = [];
  for (const m of normDigits(text).matchAll(TOKEN)) {
    if (m[1] != null) { out.push({ t: `${Number(m[1])}:${m[2]}`, i: m.index }); continue; }
    const raw = m[5] ? m[5].toLowerCase() : '';
    const u = m[3] ? '元' : (UNIT_NORM[raw] ?? UNIT_NORM[m[5]] ?? m[5] ?? '');
    out.push({ n: String(Number(m[4])), u, i: m.index });
  }
  return out;
}

/**
 * 文字裡的時間（HH:mm → H:mm）與其他數字（數值正規化：07 → 7、2.50 → 2.5）。
 * @returns {{ times: string[], numbers: string[] }}
 */
export function numbersIn(text) {
  const tk = tokensIn(text);
  return { times: tk.filter((x) => x.t).map((x) => x.t), numbers: tk.filter((x) => x.n).map((x) => x.n) };
}

/** 事實清單的所有值串成一段文字（只看值，不看鍵名；舊用法保留） */
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

const num = (v) => Number.isFinite(v);
const optZh = (label, o) => [`${label}：${o.name}`, num(o.minutes) && `約 ${o.minutes} 分`, num(o.cost) && `${o.cost} 元`, o.arriveAt && `${o.arriveAt} 到`].filter(Boolean).join('，');
const optEn = (label, o) => [`${label}: ${o.name}`, num(o.minutes) && `about ${o.minutes} min`, num(o.cost) && `NT$${o.cost}`, o.arriveAt && `arrives ${o.arriveAt}`].filter(Boolean).join(', ');

/**
 * 事實清單 → 帶鍵名的句子（給模型看，也是護欄比對的依據；數字帶單位才比得出「15 元」不是「15 分」）。
 * @returns {Array<{ line: string, other?: string }>} other：其他方案的簡稱（這行的數字只能用在提到它的那一句）
 */
export function factLines(facts = {}, lang = 'zh') {
  const en = lang === 'en';
  const f = facts && typeof facts === 'object' ? facts : {};
  const out = [];
  if (f.demo === true) out.push({ line: en ? 'This round uses demo data.' : '這一輪是示範資料。' });
  for (const p of Array.isArray(f.points) ? f.points : []) out.push({ line: `${en ? 'Helper' : '小幫手'}：${p}` });
  const t = f.trip && typeof f.trip === 'object' ? f.trip : null;
  if (t) {
    if (t.departAt) out.push({ line: en ? `Departs: ${t.departAt}` : `出發時間：${t.departAt}` });
    if (t.arriveBy) out.push({ line: en ? `Must arrive by ${t.arriveBy}` : `要在 ${t.arriveBy} 前到` });
    if (t.best?.name) out.push({ line: en ? optEn('Best option', t.best) : optZh('建議方案', t.best) });
    for (const o of Array.isArray(t.others) ? t.others : []) if (o?.name) out.push({ line: en ? optEn('Other option', o) : optZh('其他方案', o), other: shortName(o.name) });
    if (t.reason) out.push({ line: `${en ? 'Why' : '建議理由'}：${t.reason}` });
    for (const x of Array.isArray(t.tips) ? t.tips : []) out.push({ line: `${en ? 'Note' : '提醒'}：${x}` });
  }
  return out;
}
/** 方案簡稱：「叫車（Uber）」→「叫車」、「捷運（板南線…）」→「捷運」 */
const shortName = (name) => String(name).split(/[（(]/)[0].trim();

/** 程式版總結裡「一定要留下」的數字（依出現順序、不重複）：名稱裡括號的編號（例「民生捷運站(1號出口)」的 1）不算 */
export function keyNumbers(draft) {
  const bare = String(draft ?? '').replace(/([「『][^」』]*?)[(（][^)）」』]*[)）]/g, '$1');
  const tk = tokensIn(bare);
  const order = [...new Set(tk.map((x) => x.t || x.n))];
  return { times: [...new Set(tk.filter((x) => x.t).map((x) => x.t))], numbers: [...new Set(tk.filter((x) => x.n).map((x) => x.n))], order };
}

// 國字或英文寫的數量（「十分鐘」「兩站」「一小時」「半小時」「一一九」「八成」「seven minutes」「two-minute」「a dozen」）：不在草稿裡就是模型自己加的數字。
// 單獨一個「一」只看不會是慣用語的單位（「下一班」「一點」「一下」「一次」不算）
const CN_D = '零〇一二兩三四五六七八九十百千萬';
const CN_UNIT = '分鐘|分|元|塊|公里|公尺|個小時|小時|秒|點|號|班|站|度|級|家|趟|輛|人|個|成|倍|天|日|樓|次|張|線|週|個月|月|年|%';
const CN_COUNT = new RegExp(`(?:[零〇二兩三四五六七八九十百千萬][${CN_D}]*|一[${CN_D}]+)\\s*(?:${CN_UNIT})|一\\s*(?:分鐘|元|塊|公里|公尺|個小時|小時|秒|成|倍|樓|張|趟|輛|週|個月)|半(?:個)?(?:小時|天|點)|[零〇一二三四五六七八九]{2,}`, 'g');
const EN_W = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen|half(?:\\s+an?)?|a\\s+couple(?:\\s+of)?';
const EN_COUNT = new RegExp(`\\b(?:${EN_W})(?:[\\s-]+(?:${EN_W}))*[\\s-]+(?:mins?|minutes?|hours?|hrs?|seconds?|secs?|stops?|stations?|dollars?|km|kilometers?|kilometres?|meters?|metres?|blocks?|days?|times?|floors?|people)\\b`, 'gi');
const EN_BIG = /\b(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen|seconds?)\b/gi;
// 時段（「早上會下雨」）：資料沒說就是模型自己加的
const DAYPART = /早上|上午|中午|下午|傍晚|晚上|凌晨|半夜|清晨|深夜|\b(?:morning|afternoon|evening|tonight|noon|midnight)\b/gi;

// ADR-0011：阿幫只產生官方連結，不能說已經幫你叫車、訂票、預約、安排、設提醒、付款
const DONE_ZH = /(?:已|已經|幫[你您]|替[你您]|為[你您]|幫您|替您|為您)[^。！？\n]{0,6}(?:叫好|叫到|叫了|訂好|訂到|訂了|預訂|預約|付款|付好|付了|付清|買好|買了|下單|安排好|安排了|設好|設定好|排好|完成預訂|完成付款|完成預約)|(?:叫好|訂好|買好|付好|設好)(?:車|票|位|提醒)?了|(?:提醒|鬧鐘)(?:已經?)?(?:設好|設定好)|(?:司機|車子?)(?:已經?|正)在路上|(?:已經?)出發去接[你您]/;
const DONE_EN = /\b(?:i|we)(?:'ve| have)?\s+(?:already\s+)?(?:booked|ordered|paid|reserved|bought|purchased|arranged|scheduled|set up|set|called)\b|\b(?:has|have|is|are) been (?:booked|paid|reserved|ordered|purchased|arranged|scheduled)\b|\bbooked for you\b|\b(?:your|the)\s+(?:uber|taxi|cab|ride|car|driver)\s+(?:is|'s)\s+on\s+(?:its|the|their|his|her)\s+way\b|\bdriver is on the way\b|\breminder (?:is|has been) set\b/i;
/** 說「已經幫你叫車、訂票、預約、設提醒、付款」（ADR-0011，中英文）：阿幫只給連結。手機出的題目（core/edge-ask.js）也用同一條 */
export const claimsDone = (text) => DONE_ZH.test(String(text || '')) || DONE_EN.test(String(text || ''));
// 草稿有這些提醒，改寫也要有（示範資料、末班、停駛、沒拿到位置、帶傘、時間很緊、到設定頁的固定路徑）
const KEEP = [
  { draft: /示範/, zh: /示範/, en: /demo/i, name: 'demo' },
  { draft: /末班|last (?:train|bus|service)/i, zh: /末班/, en: /\blast\b/i, name: 'last' },
  { draft: /停駛|suspended/i, zh: /停駛/, en: /suspend/i, name: 'suspended' },
  { draft: /沒拿到[你您您]的位置|couldn't get your location/i, zh: /沒拿到.{0,4}位置/, en: /location/i, name: 'noLocation' },
  { draft: /傘|umbrella/i, zh: /傘/, en: /umbrella/i, name: 'umbrella' },
  { draft: /時間很緊|tight/i, zh: /緊|趕/, en: /tight|hurry|now/i, name: 'tight' },
  // 使用者指定的交通方式（「照你說的選捷運（分數最高的是公車 939）」）：改寫不能拿掉「照你說的」，否則變成阿幫推薦分數較低的方案（腦袋審查 #2，Pixel 實測）
  { draft: /照[你您您]說的/, zh: /(?:照|依|按)[你您您](?:所)?說|[你您您](?:說要|指定|要的|選的)/, en: /you (?:asked|chose|picked|wanted)|as you (?:asked|said)|requested/i, name: 'userPick' },
  { draft: /設定與隱私 → 常用地點/, zh: /設定與隱私 → 常用地點/, en: /設定與隱私 → 常用地點/, name: 'settings' }, // 畫面靠這串字放「到常用地點設定」按鈕
];
// 否定詞加在提醒或數字前面（「不用帶傘」「不是末班」「不用打 119」）：草稿沒這樣說就是把意思改反了
const NEG_ZH = /不用|不必|不需要?|無須|無需|不要|(?<![特分區類級個告識性])別|沒有|不是|不會|(?<!避)免(?![費稅])/g;
const NEG_EN = /\b(?:don't|do not|doesn't|does not|no need to|not|isn't|aren't|never|without)\b/gi;
const NEG_KEY_ZH = /傘|趕|緊|末班|停駛|示範|位置|叫車|\d+/;
const NEG_KEY_EN = /umbrella|hurry|rush|tight|last|demo|suspend|location|taxi|\d+/i;
const LATIN_OK = new Set(['youbike', 'aqi', 'pm', 'mrt', 'ok', 'app', 'uber', 'qr', 'code', 'km', 'nt']);
const CJK_RUN = /[㐀-鿿豈-﫿]+/g;
const tw = (s) => String(s).replace(/臺/g, '台');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 沒加引號的地名：以站、路、線、出口結尾的詞要在資料裡（「板橋站」「中山路」）。泛稱不算地名；名詞類泛稱（車站、捷運站…）前面不能接著沒出現過的字（「中山捷運站」）
const PLACE_END = /(?:站|路|線|出口)(?![牌名內外前長務點況上口線])/g;
const GENERIC_VERB = new Set(['到站', '進站', '出站', '這站', '那站', '一站', '下一站', '上一站', '上車站', '下車站', '起站', '走路', '馬路', '一路', '上路', '問路', '找路', '帶路', '迷路', '順路', '路線', '直線', '專線', '在線', '這條線', '那條線', '這條路', '那條路', '同一條線', '換線', '轉線']);
const GENERIC_NOUN = new Set(['站', '車站', '公車站', '捷運站', '火車站', '高鐵站', '台鐵站', '轉運站', '終點站', '出口', '路', '線']);
const FUNC = new Set([...'到在從去往於的是或和跟及與搭坐至經過近離回由向朝在之要可先再就也、，']);
function unquotedPlace(text, refTw) {
  const s = tw(text.replace(/[「『][^」』]*[」』]/g, '　'));
  for (const m of s.matchAll(PLACE_END)) {
    const end = m.index + m[0].length;
    let start = end;
    while (start > 0 && end - start < 12 && /[㐀-鿿]/.test(s[start - 1])) start--;
    const run = s.slice(start, end);
    let hit = null;
    for (let k = run.length; k >= 1 && !hit; k--) {
      const suf = run.slice(run.length - k);
      if (GENERIC_VERB.has(suf)) hit = { suf, ok: true };
      else if ((k >= 2 && refTw.includes(suf)) || GENERIC_NOUN.has(suf)) hit = { suf, ok: false };
    }
    if (!hit) return run.slice(-4);
    if (hit.ok) continue;
    const before = run.slice(0, run.length - hit.suf.length);
    if (before && !FUNC.has(before.at(-1)) && !refTw.includes(run)) return run.slice(-(hit.suf.length + 2));
  }
  // 英文：Banqiao Station、Zhongshan Road、Bannan Line
  for (const m of text.matchAll(/\b((?:[A-Z][a-z]+\s+){1,3})(Station|Road|Rd|Line|Exit|Street|St)\b/g)) {
    if (!refTw.toLowerCase().includes(m[0].toLowerCase())) return m[0];
  }
  return null;
}

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

/** 一句一句切開（數字裡的小數點、千分位不切） */
const clauses = (s) => normDigits(s).split(/[，。；！？;!?\n]|,(?!\d)|\.(?!\d)/);

/**
 * 檢查手機寫的回答能不能用。任何一條不過就不用（呼叫端改用程式版 draft）。
 * @param {string} candidate 手機模型的輸出
 * @param {{ draft: string, facts?: object, lang?: 'zh'|'en', agent?: string }} o
 * @returns {{ ok: true, text: string } | { ok: false, reason: string, detail?: string }}
 *   reason：agent 這個 agent 不改寫｜empty｜long｜format 網址、網域、markdown、工具名稱｜lang 語言不對｜time 時間或時段不在資料裡｜
 *           number 多出數字或數字配錯單位｜missing 漏了關鍵數字｜order 關鍵數字順序被換｜count 用國字或英文寫數量｜
 *           action 說已經叫車訂票預約付款（ADR-0011）｜guard L2 輸出護欄（例：投資建議）｜keep 漏了重要提醒｜negation 提醒或數字前加了否定｜
 *           name 名稱（引號裡、或以站路線出口結尾）不在資料裡
 */
export function checkRewrite(candidate, { draft, facts = {}, lang = 'zh', agent = 'life' } = {}) {
  if (!WRITE_AGENTS.includes(agent)) return { ok: false, reason: 'agent' };
  const text = cleanRewrite(candidate);
  const d = String(draft ?? '');
  if (text.length < 4) return { ok: false, reason: 'empty' };
  const en = lang === 'en';
  if (text.length > Math.max(en ? 320 : 140, d.length * 1.2)) return { ok: false, reason: 'long' };
  const lines = factLines(facts, lang);
  const strongRef = [d, ...lines.filter((l) => !l.other).map((l) => l.line)].join('\n');
  const ref = [strongRef, ...lines.filter((l) => l.other).map((l) => l.line), factsText(facts)].join('\n');
  const refTw = tw(ref), refLow = ref.toLowerCase();
  // 格式：網址、裸網域、markdown 連結（草稿沒有的）、工具英文名稱、markdown
  const urls = text.match(/https?:\/\/\S+|\b(?:[a-z0-9-]+\.)+(?:com|tw|net|org|io|gov|edu|xyz|app|co|me|info|link|top|site|online|cc|example)\b/gi) || [];
  if (urls.some((u) => !refLow.includes(u.toLowerCase())) || /\[[^\]]*\]\([^)]*\)|javascript:/i.test(text) || /\b[a-z]+(?:_[a-z0-9]+)+\b/.test(text) || /```|^#|\*\*/m.test(text)) return { ok: false, reason: 'format' };
  // 語言：英文那一輪的中文只能是草稿或資料裡的名稱；中文那一輪要有中文、英文字只能是資料裡有的或常見縮寫
  if (en) {
    const bad = (text.match(CJK_RUN) || []).find((w) => !refTw.includes(tw(w)));
    if (bad) return { ok: false, reason: 'lang', detail: bad };
  } else {
    if (!/[㐀-鿿]/.test(text)) return { ok: false, reason: 'lang' };
    const bad = (text.match(/[A-Za-z]{2,}/g) || []).find((w) => !LATIN_OK.has(w.toLowerCase()) && !refLow.includes(w.toLowerCase()));
    if (bad) return { ok: false, reason: 'lang', detail: bad };
  }
  // 時間與數字：每個時間要在資料裡；每個「數字＋單位」要在草稿或事實清單裡出現過同樣的組合
  // （其他方案的數字只能用在提到那個方案的那一句：「搭公車要 285 元」不行，285 元是叫車的）
  const strong = tokensIn(strongRef);
  const others = lines.filter((l) => l.other).map((l) => ({ name: tw(l.other), tk: tokensIn(l.line) }));
  const allTimes = new Set([...strong, ...others.flatMap((o) => o.tk)].filter((x) => x.t).map((x) => x.t));
  const pairOk = (n, u, clause) => {
    const same = (x) => x.n === n && (x.u === u || (!u && x.u !== undefined) || (u === '號' && x.u === ''));
    if (strong.some(same)) return true;
    return others.some((o) => o.tk.some(same) && tw(clause).includes(o.name));
  };
  for (const c of clauses(text)) {
    for (const x of tokensIn(c)) {
      if (x.t && !allTimes.has(x.t)) return { ok: false, reason: 'time', detail: x.t };
      if (x.n && !pairOk(x.n, x.u, c)) return { ok: false, reason: 'number', detail: `${x.n}${x.u}` };
    }
  }
  const dayparts = (text.match(DAYPART) || []).find((w) => !refLow.includes(w.toLowerCase()));
  if (dayparts) return { ok: false, reason: 'time', detail: dayparts };
  // 草稿的關鍵數字一個都不能少，出現的先後順序也要一樣
  const key = keyNumbers(d);
  const gotSeq = tokensIn(text.replace(/([「『][^」』]*?)[(（][^)）」』]*[)）]/g, '$1')).map((x) => x.t || x.n);
  const lost = key.order.find((k) => !gotSeq.includes(k));
  if (lost) return { ok: false, reason: 'missing', detail: lost };
  const firstSeen = [...new Set(gotSeq.filter((k) => key.order.includes(k)))];
  if (firstSeen.join('|') !== key.order.join('|')) return { ok: false, reason: 'order', detail: firstSeen.join(',') };
  const counts = [...(text.match(CN_COUNT) || []), ...(text.match(EN_COUNT) || []), ...(text.match(EN_BIG) || [])];
  const madeUp = counts.find((c) => !refLow.includes(c.toLowerCase()));
  if (madeUp) return { ok: false, reason: 'count', detail: madeUp };
  // ADR-0011：草稿本來就不會有，改寫多出來就不用
  if ((DONE_ZH.test(text) && !DONE_ZH.test(d)) || (DONE_EN.test(text) && !DONE_EN.test(d))) return { ok: false, reason: 'action' };
  // L2 輸出護欄：直接重用伺服器那一份（依這個 agent 的工具包；finance：投資建議與漲跌預測）
  const g = applyOutputGuardrails({ packs: WRITE_PACKS[agent] }, text);
  if (g.hits.length || g.text !== text) return { ok: false, reason: 'guard', detail: g.hits[0]?.rule };
  // 重要提醒不能被改寫掉，也不能被否定成相反的意思
  const gone = KEEP.find((k) => k.draft.test(d) && !(en ? k.en : k.zh).test(text) && !k.draft.test(text));
  if (gone) return { ok: false, reason: 'keep', detail: gone.name };
  // 使用者指定的方案不是分數最高的：改寫不能說它「比較好、最好、最推薦」（草稿沒這樣說）
  const PRAISE = en ? /\b(?:better|best|recommend(?:ed)?|top choice)\b/i : /比較好|較好|更好|最好|最佳|較佳|最推薦|最划算|最適合/;
  if (/分數最高的是/.test(d) && PRAISE.test(text) && !PRAISE.test(d)) return { ok: false, reason: 'claim', detail: text.match(PRAISE)[0] };
  const neg = negated(text, d, en);
  if (neg) return { ok: false, reason: 'negation', detail: neg };
  // 名稱：引號裡的、以及沒加引號但以站、路、線、出口結尾的，都要是資料裡有的
  const names = [...text.matchAll(/[「『《]([^」』》]{1,30})[」』》]/g)].map((m) => m[1]);
  // 劇名、書名（《》）要跟資料一字不差：截短（《夜班公車》）或改字都不行（短劇，ADR-0019）
  const titles = new Set([...ref.matchAll(/《([^》]{1,40})》/g)].map((m) => tw(m[1])));
  const badTitle = [...text.matchAll(/《([^》]{1,40})》/g)].map((m) => m[1]).find((x) => !titles.has(tw(x)));
  const badName = badTitle || names.find((x) => !refTw.includes(tw(x))) || unquotedPlace(text, refTw);
  if (badName) return { ok: false, reason: 'name', detail: badName };
  return { ok: true, text };
}

/** 改寫在提醒詞或數字前加了否定（草稿沒有同樣的說法）→ 回那一段 */
function negated(text, draft, en) {
  const NEG = en ? NEG_EN : NEG_ZH, KEY = en ? NEG_KEY_EN : NEG_KEY_ZH;
  text = text.replace(/要不要|會不會|是不是|有沒有|用不用|需不需要|do you want|don't you/gi, (q) => '　'.repeat(q.length)); // 問句（「要不要到站前 3 分提醒你」）不是否定
  for (const m of text.matchAll(NEG)) {
    const after = text.slice(m.index + m[0].length).split(/[，。；！？,;.!?\n]/)[0].slice(0, en ? 30 : 6);
    const k = KEY.exec(after);
    if (!k) continue;
    if (!new RegExp(`${esc(m[0])}[^，。；！？,;.!?\\n]{0,${en ? 30 : 6}}${esc(k[0])}`, 'i').test(draft)) return `${m[0]}${after.slice(0, k.index + k[0].length)}`;
  }
  return null;
}

/** 草稿要不要交給手機改寫：太長或數字太多就直接用程式版（模型一定漏） */
export function worthRewriting(draft) {
  const d = String(draft ?? '');
  if (!d.trim() || d.length > WRITE_SKIP.chars) return false;
  return keyNumbers(d).order.length <= WRITE_SKIP.numbers;
}

/** 給手機模型的一段輸入（草稿＋帶鍵名的事實清單；兩個平台共用）。總長不超過 WRITE_MAX_INPUT（扣掉指示） */
export function writePrompt(draft, facts = {}, lang = 'zh') {
  const en = lang === 'en';
  const lines = factLines(facts, lang).map((l) => l.line);
  const room = WRITE_MAX_INPUT - WRITE_INSTRUCTIONS[en ? 'en' : 'zh'].length - String(draft).length - 40;
  const kept = [];
  let used = 0;
  for (const l of lines) { if (used + l.length + 3 > room) break; kept.push(l); used += l.length + 3; }
  return `${en ? 'Draft' : '草稿'}：${draft}\n${kept.length ? `${en ? 'Facts' : '事實清單'}：\n- ${kept.join('\n- ')}\n` : ''}${en ? 'Rewrite' : '改寫'}：`;
}
