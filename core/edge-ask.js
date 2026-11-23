// 問什麼由手機上的 AI 決定（ADR-0020）：手機判斷（AbangEdgeAI.judge）一次呼叫同時回「意圖、狀態、要不要問使用者一題」。
// 這裡是手機與伺服器共用的純函式（伺服器以 /core/edge-ask.js 提供給前端，App 打包時一起複製）：
//   - 給模型看的「各意圖需要哪些欄位」（INTENT_SLOTS，試判斷 core/agent/trial.js 也用這一份）與出題規則（EDGE_ASK_GUIDE）
//   - 整理模型回傳（normalizeEdgeAsk）與形狀檢查（edgeAskShape：種類、長度、選項數、數字、誘導內容、L2 護欄、代辦說法、語言）
// 「這一句真的缺嗎、選項接不接得回、值不值得問」要用規則解析與資料，只在伺服器驗（core/agent/ask.js deviceSlotAsk／deviceStateAsk）。
// 原則同 ADR-0010、PR #112：模型提候選、程式驗證；不通過就丟掉，改用規則的 ask（規則是保底）。
import { ASK_STATES } from './decide.js';
import { unsafeAsk } from './suggest.js';
import { OUTPUT_GUARDS } from './output-guards.js';
import { claimsDone } from './edge-write.js';

/**
 * 各意圖需要的欄位：[欄位, 必要嗎, 沒說時怎麼補]
 * 補法：location＝用你的位置（問阿幫會先請手機定位；試判斷不送定位）｜now＝現在｜today＝今天｜all＝全部列出｜hot＝熱門排行｜latest＝最新一期｜saved＝要先設定常用地點
 */
export const INTENT_SLOTS = {
  trip: [['to', true], ['from', false, 'location'], ['when', false, 'now']],
  bus_route: [['route', true], ['stop', false, 'location']],
  youbike: [['place', false, 'location']],
  nearby_bus: [['place', false, 'location']],
  metro: [['station', false, 'location']],
  rail: [['to', true], ['from', false, 'location'], ['when', false, 'now']],
  weather: [['place', false, 'location'], ['day', false, 'today']],
  aqi: [['place', false, 'location']],
  outing: [['place', false, 'location']],
  pharmacy: [['place', false, 'location']],
  garbage: [['place', false, 'location']],
  quake: [],
  fuel: [['grade', false, 'all']],
  invoice: [],
  stock: [['stock', false, 'index']],
  traffic: [['to', true], ['from', false, 'location']], // 國道路況（2026-11-22）：沒說從哪到哪程式先問（不開放給手機出題）
  drama: [['drama', false, 'hot']],
  savedMissing: [['saved', true, 'saved']],
};

/** 手機可以提議問的種類：缺路線、缺目的地、缺起點（沒定位又沒說）、會改變建議的狀況（state）；
 *  PM 的 Q 情境（2026-11-22）：高鐵台鐵缺起站（railFrom）、缺迄站（railTo）、地點有歧義（place）、沒定位問在哪（where）、只說類別問要查什麼（topic） */
export const EDGE_ASK_SLOTS = ['route', 'to', 'from', 'state', 'railFrom', 'railTo', 'place', 'where', 'topic'];
/** state 只能問這幾種（使用者自己最清楚、程式猜不到的；同 decide.js keyQuestion） */
export const EDGE_ASK_STATES = [...ASK_STATES];
/** 問題最多 30 字；選項 2～4 個、每個最多 12 字（沒有中文的英文字串放寬成 60／24 個字元：「Where are you starting from?」「Use my location」） */
export const EDGE_ASK_LIMITS = { question: 30, option: 12, questionEn: 60, optionEn: 24, min: 2, max: 4 };
/** 手機提議的題目被擋下的原因（畫面「阿幫的腦袋」用字典照列） */
export const EDGE_ASK_REASONS = ['shape', 'slot', 'state', 'question-length', 'question-form', 'digits', 'options-count', 'option-length', 'duplicate', 'unsafe', 'guard', 'claim', 'lang', 'off-topic', 'option', 'asked', 'not-missing', 'no-change', 'said', 'no-trip', 'taken'];

/** 給手機模型的出題規則（接在 EDGE_INSTRUCTIONS 後面；短：手機模型上下文小、要快） */
export const EDGE_ASK_GUIDE = `另外決定要不要先問使用者一題（ask）。寧可不問：句子資料夠就 ask 留空。
只有這幾種可以問（slot）：route＝問公車到站但沒說哪一路；to＝行程沒說要去哪裡（只說起點、只說叫車也算）；from＝情境說沒有定位、也沒說從哪裡出發；state＝行程沒說狀況，而答案會改變建議（state 只能是 rush 趕時間、luggage 帶行李、budget 想省錢、lessWalk 少走路）；railFrom＝問高鐵台鐵票價沒說起站；railTo＝問高鐵台鐵班次或票價沒說到哪一站；place＝地名有好幾個地方（同名、連鎖醫院、區名）；where＝沒有定位又問天氣空品；topic＝只說高鐵、公車這種類別。
各意圖必要的欄位：trip 要 to；bus_route 要 route；rail 要 to；traffic 要 to（國道路況的起訖由程式問，ask 留空）；其他意圖不用問。使用者說過的、剛問過的不要再問。
question：一句 30 字內的問句，只問這一件事，不要有數字；state 要直接問那個狀況（例：你趕時間嗎？），不要反著問。options：2～4 個 12 字內的短答，要是使用者會點的答案：前文或情境出現過的路線號碼與地名、回家、去公司、用我的位置、附近公車、高鐵台鐵的站名、縣市名、下一班、票價；不要自己編。
英文提問就用英文出題。`;

const CJK = /[㐀-鿿豈-﫿]/;
const NL = /[\n\r]/;
/** 這段字的長度上限：有中文照中文算，沒有中文（英文）放寬 */
export const askMax = (text, kind = 'question') => (CJK.test(String(text || '')) ? EDGE_ASK_LIMITS[kind] : EDGE_ASK_LIMITS[`${kind}En`]);
/** 控制字元與格式字元（零寬、雙向控制、\u0000、\u0007…）：題目與選項一律不收（伺服器 zod 也擋） */
export const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/u;
/** 比對前先正規化：NFKC（全形、相容字）、去掉控制與格式字元；squash 另外去掉空白（「加 L I N E」「先匯 款」） */
export const askNorm = (t, squash = false) => {
  const n = String(t || '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '');
  return squash ? n.replace(/\s+/g, '') : n;
};
/** 題目與選項不該出現的話（手機出題只問路線、目的地、起點、狀況；這些是誘導或離題，PR #116 審查） */
const ASK_BLOCK = /加賴|賴我|line|紅包|點數|禮物卡|禮券|身分證|密碼|驗證碼|信用卡|卡號|提款|客服|中獎|領獎|抽獎|投資|股票|股價|獲利|穩賺|匯|轉帳|帳號|帳戶|個資|instagram|telegram|whatsapp|wechat|giftcard|bitcoin|crypto|password|verify|login|otp/i;
const ASK_BLOCK_WORDS = /\b(?:ig|dm|pm me|gift cards?|send money|pay)\b/i;
/** 連續 6 個以上的數字（含全形、圈圈數字、國字）：電話、帳號 */
const NUM_RUN = /[0-9零〇一二三四五六七八九壹貳參肆伍陸柒捌玖❶-❿①-⑳⑴-⒇⓪-⓿➀-➓]{6,}/;
/** 題目裡的數量（「省五十元」「快十分」）：還沒查資料，一定是編的 */
const NUM_IN_Q = /[0-9❶-❿①-⑳⑴-⒇⓪-⓿➀-➓]|(?:(?<![哪那這每])一|[零〇二兩三四五六七八九十百千])[零〇一二兩三四五六七八九十百千]*\s*(?:元|塊|分鐘|分|公里|小時|站|班)/; // 只豁免「哪一站」「那一班」「這一站」「每一班」的「一」（「這三站」照擋）
/** 誘導內容（手機與伺服器共用；伺服器另外加跑防詐規則庫）：原字與正規化後都比 */
export function askUnsafe(text) {
  const a = askNorm(text), b = askNorm(text, true);
  return unsafeAsk(text) || unsafeAsk(a) || unsafeAsk(b) || ASK_BLOCK.test(b) || ASK_BLOCK_WORDS.test(a) || NUM_RUN.test(b);
}

/** 每一種題目要切題（route 問哪一路、to 問去哪、from 問從哪出發） */
const TOPIC = { route: /哪|路|公車|bus|route|which/i, to: /哪|去|where/i, from: /哪|出發|from|where/i,
  railFrom: /哪|出發|起站|from|which/i, railTo: /哪|去|到|迄站|where|which/i, place: /哪|是|where|which|mean/i, where: /哪|在|where/i, topic: /什麼|哪|what|which/i };
/** 狀態題要問到那個狀態（題目要有這些字） */
const STATE_WORDS = { rush: /趕|急|遲到|hurry|rush|late/i, luggage: /行李|大包小包|東西|推車|luggage|bags?\b/i, budget: /省錢|便宜|省一點|cheap|save money|budget/i, lessWalk: /少走|走路|走太多|walk/i };
/** 狀態題不能反著問（「不趕吧？」「東西很少吧？」「Not in a hurry, right?」）或改問交通方式（「要不要坐捷運」） */
const STATE_NEG = /不趕|不急|不想|不用|不要|不需|不必|沒有|沒帶|很少|還好|吧|right\s*\?|\bnot\b|n't\b|\bno\b|\bnever\b/i;
const STATE_MODE = /捷運|公車|客運|叫車|計程車|uber|taxi|高鐵|台鐵|臺鐵|火車|youbike|坐|搭|騎|mrt|\bbus\b|train|\bride\b|\bcab\b/i;
/** 題目只能一句：句末一個問號（或「嗎／呢」結尾），中間不能有其他句末標點 */
const oneSentence = (q) => {
  const body = q.replace(/[?？]\s*$/, '');
  return !/[?？!！。.;；…]/.test(body) && (q.match(/[嗎呢]/g) || []).length <= 1;
};

/**
 * 狀態題的題目對不對（題目要有那個狀態的字、不能有別的狀態的字、不能反著問、不能改問交通方式）。
 * 選項一律用程式的（core/agent/ask.js STATE_ANSWERS），不看手機給的選項。
 */
export function stateQuestionOk(question, state) {
  const q = askNorm(question);
  if (!STATE_WORDS[state]?.test(q)) return false;
  if (Object.entries(STATE_WORDS).some(([k, re]) => k !== state && re.test(q) && !(state === 'lessWalk' && k === 'luggage' && !/行李|大包|推車|luggage|bag/i.test(q)))) return false;
  return !STATE_NEG.test(q) && !STATE_MODE.test(q);
}

/**
 * 模型回傳 → { slot, state?, question, options }（還沒驗證）；沒有要問（ask 留空、slot none）回 null。
 * 接受 Android 的 JSON（options 是字串陣列，或 { label } 物件陣列）與 iOS @Generable 的字典。
 */
export function normalizeEdgeAsk(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const slot = String(raw.slot ?? raw.kind ?? '').trim();
  if (!slot || /^(?:none|null|no|nil)$/i.test(slot)) return null;
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map((o) => (typeof o === 'string' ? o : typeof o?.label === 'string' ? o.label : ''))
    .map((o) => o.trim()).filter(Boolean);
  const out = { slot, question: typeof raw.question === 'string' ? raw.question.trim() : '', options };
  if (slot === 'state') out.state = String(raw.state ?? '').trim();
  return out;
}

/** 這題問的是什麼（同 ask 事件的 about；比對「剛問過」用） */
export const askAbout = (ask) => (ask?.slot === 'state' ? `state:${ask.state}` : `slot:${ask?.slot}`);

/** L2 輸出護欄（投資建議、保證安全…）有沒有改到這段字：有就算命中 */
const guardHit = (text) => Object.values(OUTPUT_GUARDS).flat().some((g) => !g.silent && g.apply(text) !== text);

/**
 * 形狀檢查（手機送出前、伺服器收到後都跑一次）：通過回 null，不通過回原因（EDGE_ASK_REASONS）。
 * 手機一定要先過這一關再送：伺服器的請求驗證（zod）是嚴格的，長度或選項數不對整個請求會 400。
 * @param {object} ask normalizeEdgeAsk 的結果
 * @param {{ lang?: 'en'|'zh'|null }} [o] 這一輪的語言：英文輪問題不能是中文、中文輪問題要有中文
 */
export function edgeAskShape(ask, { lang = null } = {}) {
  const L = EDGE_ASK_LIMITS;
  if (!ask || typeof ask !== 'object' || typeof ask.question !== 'string' || !Array.isArray(ask.options)) return 'shape';
  if (!EDGE_ASK_SLOTS.includes(ask.slot)) return 'slot';
  if (ask.slot === 'state' && !EDGE_ASK_STATES.includes(ask.state)) return 'state';
  if (ask.options.some((o) => typeof o !== 'string')) return 'shape';
  const all = [ask.question, ...ask.options];
  if (all.some((t) => HIDDEN_CHARS.test(t) || NL.test(t) || /[<>{}[\]`*|\\]/.test(t))) return 'shape'; // 零寬、雙向控制、\u0000 一律不收
  const q = ask.question.trim();
  if (q.length < 2 || q.length > askMax(q)) return 'question-length';
  if (ask.options.length < L.min || ask.options.length > L.max) return 'options-count';
  if (ask.options.some((o) => !o.trim() || o.trim().length > askMax(o, 'option'))) return 'option-length';
  if (!/[?？]\s*$|嗎|呢/.test(q)) return 'question-form';
  if (NUM_IN_Q.test(askNorm(q, true))) return 'digits'; // 手機在查資料之前出題：題目裡的數字一定是編的（ADR-0009）
  const seen = new Set(ask.options.map((o) => askNorm(o, true).replace(/臺/g, '台').toLowerCase()));
  if (seen.size !== ask.options.length) return 'duplicate';
  if (all.some((t) => askUnsafe(t))) return 'unsafe';
  if (all.some((t) => guardHit(askNorm(t)) || guardHit(askNorm(t, true)))) return 'guard';
  if (all.some((t) => claimsDone(askNorm(t)))) return 'claim';
  if (lang === 'en' && CJK.test(q)) return 'lang';
  if (lang === 'zh' && !CJK.test(q)) return 'lang';
  if (!oneSentence(askNorm(q).trim())) return 'off-topic'; // 只能一句（「要去哪裡？先加賴領紅包嗎？」）
  if (ask.slot === 'state' ? !stateQuestionOk(q, ask.state) : !TOPIC[ask.slot].test(askNorm(q))) return 'off-topic';
  return null;
}

/** 送伺服器的 ask（只有這幾個欄位；伺服器 zod 嚴格驗證） */
export const requestAsk = (ask) => ({ slot: ask.slot, ...(ask.slot === 'state' && { state: ask.state }), question: ask.question.trim(), options: ask.options.map((o) => o.trim()) });
