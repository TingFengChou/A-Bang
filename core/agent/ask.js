// 阿幫問你（ADR-0016）：答案取決於使用者、問一句會讓整體更快時，由程式產生一個問題（不交給模型）。
// 事件 ask（events.js）：{ type: 'ask', id, question, options: [Option], why?, about?, pending? }
//   Option：{ label, kind, guess? } ＋ 依 kind 的欄位——
//     state   { state, say? }   把狀態加進這一輪的決策即時重算（不呼叫伺服器）；say＝不能即時重算的客戶端改送這一句
//     reply   { say }           把 say（完整的一句，pending 遺失也解析得對）當成使用者的下一句送出
//     store   { value }         存成手機上的偏好（public/js/habits.js applyStore），並把效果套到這一輪
//     action  { action }        手機做事：{ name: 'openLink', url, confirm? }｜{ name: 'watchArrival', ...公車 }｜{ name: 'remind', at, text }（L2 照 ADR-0011 先確認）
//                               ｜{ name: 'navigate', to: '#/…' }（App 內的頁面）｜{ name: 'focusInput' }（游標放到輸入框）
//                               ｜{ name: 'handOff', agent: 'antifraud', text }（帶著這一句到防詐，只在手機記憶體，public/js/vision.js handOff）
//     dismiss {}                不做事（「不趕」「不用」也是回答，只是不改變結果）
//   pending：{ slot, state?, intent? }＝在等什麼答案；使用者直接打字回答時，客戶端把它當 pendingAsk 帶回來，
//     validateRequest 先用 resolvePending 把「好」「台中」改寫成完整的一句（例「我趕時間」），再交給規則或模型。
// 規則：一輪最多一個問題；使用者已經說過、或答案不會改變結果時不問；問了之後直接打別的話＝略過。
export const ASK_KINDS = ['state', 'reply', 'store', 'dismiss', 'action'];
export const ASK_ACTIONS = ['openLink', 'watchArrival', 'remind', 'navigate', 'focusInput', 'handOff', 'addCalendar', 'share']; // navigate：App 內的頁面（#/…，例：到防詐、發票）；focusInput：游標放到輸入框（請他貼上訊息）；addCalendar／share：用畫面上最近的行程卡片開系統畫面（ADR-0021）

import { decide, keyQuestion } from '../decide.js';
import { edgeAskShape, askNorm } from '../edge-ask.js';
import { matchRules } from '../scam-check.js';
import { placesInText, parseIntent, isEnglish, modeOf } from './demo-intent.js';
import { LANDMARKS, normPlace } from '../services/places.js';
import { railPendingSay, topicSay, busStopSay, whereSay, tripSay, TOPIC_KEYS, airportAnswer, answerHead } from './clarify.js';

const MODE = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車' };
const MODE_DO = { walk: '走路', bike: '騎 YouBike', bus: '坐公車', metro: '搭捷運', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運', ridehail: '叫車' };
const MODE_EN = { walk: 'walking', bike: 'YouBike', bus: 'the bus', metro: 'the MRT', thsr: 'high speed rail', tra: 'the train', intercity: 'the coach', ridehail: 'a taxi' };
/** 關鍵問題（core/decide.js keyQuestion）的答案按鈕：第一個＝加上這個狀態重算，第二個＝不改；say＝說成完整的一句 */
const STATE_ANSWERS = {
  rush: { zh: ['趕', '不趕'], en: ['Yes, hurry', 'No rush'], say: '我趕時間', sayEn: "I'm in a hurry" },
  budget: { zh: ['想省錢', '不用'], en: ['Save money', 'No need'], say: '我想省錢', sayEn: 'I want to save money' },
  luggage: { zh: ['有', '沒有'], en: ['Yes', 'No'], say: '我有帶行李', sayEn: "I'm carrying luggage" },
  lessWalk: { zh: ['想少走', '不用'], en: ['Less walking', 'No need'], say: '我想少走路', sayEn: 'I want to walk less' },
};

/**
 * 行程那一輪要問的一句（最多一個）：① 習慣確認（手機說有候選、這次的方案裡有那種方式）
 * ② 說過的預設狀況會改變建議時「這次也帶東西嗎？」（不自動套用）③ 關鍵因子（plan_trip 的 ask；key＝同一段起訖同一題，手機 24 小時內問過就不顯示）。
 * @param {object} trip plan_trip 的 data
 * @param {{ habitAsk?: { mode: string, count: number }, usual?: string[], lang?: 'en'|null }} [o]
 * @returns {{ question: string, options: object[], why?: string, about: string, key?: string, pending?: object } | null}
 */
export function tripAsk(trip, { habitAsk = null, usual = [], lang = null, device = null } = {}) {
  const en = lang === 'en';
  // 順序（ADR-0020，PR #116 審查）：① 習慣確認 ② 說過的預設狀況 ③ 關鍵因子——手機上的 AI 提議的狀態題只取代 ③（通過驗證時）
  if (habitAsk && trip?.options?.some((o) => o.role === habitAsk.mode)) {
    if (device?.ask?.slot === 'state') rejectDevice(device, 'taken');
    const m = habitAsk.mode, n = habitAsk.count;
    if (m === 'ridehail') { // 有理由才推叫車：先問原因
      return {
        about: 'habit:ridehail',
        question: en ? `You often take a taxi (${n} times). Usually because…?` : `你常叫車（${n} 次），通常是因為？`,
        why: en ? 'Your answer stays on this phone; change it in Settings.' : '答案只存在這支手機，可以在設定撤銷。',
        options: [['rush', '趕時間', 'In a hurry'], ['luggage', '常帶東西', 'Carrying things'], ['lessWalk', '不想走路', 'Less walking'], ['love', '就是喜歡叫車', 'I just like taxis'], ['depends', '不一定', 'It depends']]
          .map(([v, zh, e]) => ({ label: en ? e : zh, kind: 'store', value: `ride:${v}` })),
      };
    }
    return {
      about: `habit:${m}`,
      question: en ? `You've picked ${MODE_EN[m]} a lot lately (${n} times). When you don't mention anything else, should I put ${MODE_EN[m]} first?`
        : `我注意到你最近常${MODE_DO[m]}（${n} 次）。以後你沒說條件時，要我優先推${MODE[m]}嗎？`,
      why: en ? 'Only counts on this phone; no places are stored.' : '只記在這支手機、只記交通方式與次數，可以在設定撤銷。',
      options: [{ label: en ? 'Yes' : '好', kind: 'store', value: `habit:yes:${m}`, guess: true }, { label: en ? 'No thanks' : '不用', kind: 'store', value: `habit:no:${m}` }],
    };
  }
  const u = usualAsk(trip, usual, en);
  if (u) return deviceUsualAsk(device, u) || u;
  const d = deviceStateAsk(device, trip, { lang, usual }); // 手機的狀態題通過驗證就取代關鍵因子那一題
  if (d) return d;
  const q = trip?.ask;
  const A = q && STATE_ANSWERS[q.state];
  if (!A || usual?.includes(q.state)) return null; // 說過的狀況：上面已經判斷過（不會改變建議就不問）
  const [yes, no] = A[en ? 'en' : 'zh'];
  return {
    about: `state:${q.state}`, question: en ? q.textEn : q.text,
    options: [{ label: yes, kind: 'state', state: q.state, say: en ? A.sayEn : A.say }, { label: no, kind: 'dismiss' }],
    key: `${q.state}@${spot(trip.from)}>${spot(trip.to)}`, // 同一段起訖（座標到小數 2 位）、同一題：手機 24 小時內問過就不顯示
    pending: { slot: 'state', state: q.state }, // 直接打「好」「嗯」也算回答
  };
}

const spot = (p) => (Number.isFinite(p?.lat) ? `${p.lat.toFixed(2)},${p.lon.toFixed(2)}` : String(p?.name || ''));
/** 說過的預設狀況（叫車原因）怎麼問「這一次」 */
const USUAL_ASK = {
  rush: { zh: '這次也趕時間嗎？', en: 'In a hurry this time too?' },
  luggage: { zh: '這次也帶東西嗎？', en: 'Carrying things this time too?' },
  lessWalk: { zh: '這次也想少走路嗎？', en: 'Want to walk less this time too?' },
};
const USUAL_SAID = { rush: '你說過常趕時間', luggage: '你說過常帶東西', lessWalk: '你說過不想走路' };

/** 這一輪沒說狀況、沒指定方式，而且加上說過的預設狀況會換建議 → 問「這次也帶東西嗎？」〔是（猜的）〕〔這次沒有〕 */
function usualAsk(trip, usual, en) {
  if (!usual?.length || !trip?.options?.length || trip.mode || trip.states?.some((s) => s.source !== 'auto')) return null;
  const ctx = { states: trip.states.map((s) => s.key), arriveBy: trip.arriveBy, arriveByMin: trip.arriveByMin, avoid: trip.avoid, habit: trip.habit };
  for (const k of usual) {
    if (!USUAL_ASK[k] || ctx.states.includes(k)) continue;
    const alt = decide(trip.options, { ...ctx, states: [...ctx.states, k], said: true }).best;
    if (!alt || alt.id === trip.best) continue;
    const A = STATE_ANSWERS[k];
    return {
      about: `usual:${k}`,
      question: en ? USUAL_ASK[k].en : USUAL_ASK[k].zh,
      why: en ? `You told me this before; if so I'd suggest ${MODE_EN[alt.role] || alt.name}.` : `${USUAL_SAID[k]}；是的話改推${alt.name}。`,
      options: [{ label: en ? 'Yes' : '是', kind: 'state', state: k, source: 'usual', say: en ? A.sayEn : A.say, guess: true }, { label: en ? 'Not this time' : '這次沒有', kind: 'dismiss' }],
      pending: { slot: 'state', state: k },
    };
  }
  return null;
}

const YES = /^(好|好啊|好的|要|是|是的|對|對啊|嗯|可以|有|ok|okay|yes|yeah|yep|sure)[!！。.]?$/i;

/**
 * 等待中的答案（pendingAsk）：使用者直接打字回答時，把短答改寫成完整的一句；不是答案（問了別的）回 null＝照原句。
 * 之後的情境（缺起站、地名有歧義…）在 PENDING_SLOTS 加一個 slot 處理函式即可。
 * @param {{ slot: string, state?: string, intent?: object } | undefined} pending
 * @param {string} text 使用者這一句
 * @returns {string|null}
 */
export function resolvePending(pending, text) {
  const slot = pending?.slot;
  if (typeof slot !== 'string' || !Object.hasOwn(PENDING_SLOTS, slot)) return null; // 不走原型鏈（constructor、toString…）
  const out = PENDING_SLOTS[slot](pending, String(text ?? '').trim());
  return typeof out === 'string' && out.trim() ? out.slice(0, 500) : null;
}

/** slot → (pending, text) => 改寫後的一句｜null（沒有原型：slot 名稱只認這裡列的） */
export const PENDING_SLOTS = Object.assign(Object.create(null), {
  // 關鍵因子：「好」「嗯」「有」＝加上這個狀態（「我趕時間」會接著上一輪的行程重算）；英文同理
  state: (p, t) => {
    const A = STATE_ANSWERS[p.state];
    if (!A || !YES.test(t)) return null;
    return /^[a-z]/i.test(t) ? A.sayEn : A.say;
  },
});

/**
 * 聽不懂的問題（意圖 unknown）在手機寫回答的那一輪（ADR-0017：一律不退回伺服器模型）：不只列清單，
 * 給幾個阿幫查得到的選項，按了就把完整的一句當成下一句送出（reply）。選項的句子都是規則聽得懂的（test/edge-write.test.js 驗證）。
 * @param {'en'|null} [lang]
 */
export function unknownAsk(lang = null) {
  const en = lang === 'en';
  const opts = en
    ? [['Get to Taipei 101', 'How do I get to Taipei 101?'], ['YouBike nearby', 'Is YouBike available nearby?'], ['Weather now', "What's the weather now?"], ['Next MRT', 'Next MRT train']]
    : [['怎麼去台北101', '怎麼去台北101'], ['附近公車站', '附近的公車站'], ['現在天氣', '現在天氣如何'], ['發票對獎', '這期發票號碼是多少？']];
  return {
    about: 'unknown',
    question: en ? "I can't look that up. Want one of these instead?" : '這題我查不到，要不要改查這些？',
    options: opts.map(([label, say]) => ({ label, kind: 'reply', say })),
  };
}
/** 配合 unknownAsk 的簡短回答（選項在上面，不再列一長串） */
export const UNKNOWN_SHORT = {
  zh: '我能查交通和生活的即時資料（公車、捷運、台鐵、高鐵、YouBike、天氣、空品、發票…），點上面一個試試看。',
  en: 'I can look up live transit and daily-life data (bus, MRT, trains, YouBike, weather…). Tap one above to try.',
};

// ───── 缺必要欄位就問那個欄位（2026-11-22，「該問就問、不要自己猜」；試判斷看出的缺口）─────
// parseIntent 標 it.needs（route＝哪一路公車、to＝要去哪裡），runDemo 與模型模式在查資料前問一句；
// 沒定位、預設起點又就在目的地旁邊時（臺北車站到臺北車站），runDemo 問「你從哪裡出發？」（slot from）。
// 選項都是 reply（按了送出完整的一句）；直接打字回答時 pendingAsk 帶回 slot，validateRequest 用 PENDING_SLOTS 接回原問題。

/** 常用地點的標籤：選項帶 saved，手機有設定才顯示（伺服器不知道手機設了哪些） */
export const SAVED_LABELS = ['家', '公司', '學校'];
const ROUTE_RE = /^[紅藍綠棕橘小幹]?\d{1,4}[區副]?$/;
/** 對話裡最近提到的公車路線（使用者問過的、阿幫回答裡的「公車 601」），新的在前 */
export function recentRoutes(history = [], max = 3) {
  const out = [];
  for (const m of [...history].reverse()) {
    const t = String(m?.content || '');
    const re = m?.role === 'assistant' ? /公車\s*([紅藍綠棕橘小幹]?\d{1,4}[區副]?)/g : /(?:^|[^\d])([紅藍綠棕橘小幹]?\d{1,4}[區副]?)(?=\s*(?:號|路)?\s*(?:公車|還要|多久|到哪|什麼時候|幾分|在哪|呢|怎麼還沒))/g;
    for (const x of t.matchAll(re)) if (!out.includes(x[1])) out.push(x[1]);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
/** 對話裡最近提到的地點（使用者說過的），新的在前；不含 except */
export function recentPlaces(history = [], except = [], max = 3) {
  const out = [];
  const skip = except.filter(Boolean).map(normPlace);
  for (const m of [...history].reverse()) {
    if (m?.role !== 'user') continue;
    for (const p of placesInText(String(m.content || '')).reverse()) if (!out.includes(p) && !skip.includes(normPlace(p))) out.push(p);
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
/** 英文那一輪：地標的英文名稱（沒有就照原名） */
const enName = (name) => { const n = normPlace(name); return LANDMARKS.items.find((x) => [x.name, ...x.aliases].some((k) => normPlace(k) === n))?.en || name; };

/**
 * 缺必要欄位要問的一句（it.needs）。沒缺回 null。
 * @param {object} it parseIntent 的結果
 * @param {{ lang?: 'en'|null, history?: Array<{ role: string, content: string }> }} [o]
 * @returns {{ ask: object, short: string } | null} ask＝ask 事件的內容；short＝這一輪的回答（只有一句，選項在上面）
 */
export function slotAsk(it, { lang = null, history = [] } = {}) {
  const en = lang === 'en' || it?.lang === 'en';
  if (it?.needs === 'route' && it.last && !en) { // 末班車沒說哪一路（真實資料健檢）：問哪一路公車，或改查捷運
    const opts = recentRoutes(history).map((r) => ({ label: r, kind: 'reply', say: `${r} 公車末班車幾點？` }));
    opts.push({ label: '捷運末班車', kind: 'reply', say: '捷運末班車幾點？' });
    return {
      ask: { about: 'slot:route', question: '要查哪一路公車的末班車？', why: '直接打路線號碼也可以，例如 307；捷運就點「捷運末班車」。', options: opts, pending: { slot: 'route', last: true } },
      short: '你要查哪一路公車的末班車？告訴我路線號碼（例如 307）；要查捷運就說「捷運末班車」。',
    };
  }
  if (it?.needs === 'route') {
    const opts = recentRoutes(history).map((r) => ({ label: en ? `Bus ${r}` : r, kind: 'reply', say: en ? `How long until bus ${r}?` : `${r} 公車還要多久？` }));
    opts.push(en ? { label: 'Bus stops nearby', kind: 'reply', say: 'Any bus stops nearby?' } : { label: '看附近有哪些公車', kind: 'reply', say: '附近的公車站' });
    return {
      ask: { about: 'slot:route', question: en ? 'Which bus route?' : '哪一路公車？', why: en ? 'Or just type the route number, e.g. 307.' : '直接打路線號碼也可以，例如 307。', options: opts, pending: { slot: 'route', ...(en && { lang: 'en' }) } },
      short: en ? "Which bus route? Tell me the number (e.g. 307) and I'll check how long until it comes." : '你要查哪一路公車？告訴我路線號碼（例如 307），我幫你看還要多久。',
    };
  }
  if (it?.needs === 'od') { // 國道路況沒有起訖（「國道一號現在塞車嗎」）：問從哪到哪，不拿同一個點亂查（真實資料健檢 S7）
    const fw = it.freeway ? `${it.freeway}` : '國道';
    const said = recentPlaces(history, [], 2);
    const pairs = said.length === 2 ? [[said[1], said[0]]] : [];
    const opts = [...pairs, ...TRAFFIC_EXAMPLES].slice(0, 3).map(([a, b]) => ({ label: en ? `${enName(a)} → ${enName(b)}` : `${a}到${b}`, kind: 'reply', say: `${a}到${b}國道塞車嗎？` }));
    return {
      ask: { about: 'slot:od', question: en ? 'From where to where?' : '從哪裡到哪裡？', why: en ? 'Freeway traffic is checked along a route. Or type it, e.g. “Taipei to Hsinchu”.' : `${fw}很長，我要知道你從哪裡開到哪裡；直接打「台北到新竹」也可以。`, options: opts, pending: { slot: 'od', ...(en && { lang: 'en' }) } },
      short: en ? 'Which stretch? Tell me where you start and where you are going (e.g. Taipei to Hsinchu), and I will check the freeway traffic along it.' : `你要從哪裡到哪裡？${fw}很長，告訴我起訖（例如「台北到新竹」），我幫你看沿途的國道路況。`,
    };
  }
  if (it?.needs === 'to') {
    const from = it.from || null;
    const mode = it.mode === 'ridehail' ? 'ridehail' : null; // 只說「叫車」：選項的句子帶著叫車（PM Q-11）
    const fromSay = en && from ? enName(from) : from; // 英文那一輪用英文名稱（沒有就照原名，打字回答時再換成規則聽得懂的句子）
    const tripSayOf = (p) => (mode ? tripSay(p, { from, mode, en: en ? enName(p) : null }) : en ? (from ? `How do I get from ${fromSay} to ${enName(p)}?` : `How do I get to ${enName(p)}?`) : from ? `從${from}到${p}怎麼去？` : `怎麼去${p}？`);
    const opts = recentPlaces(history, [from]).map((p) => ({ label: (en ? enName(p) : p).slice(0, 20), kind: 'reply', say: tripSayOf(p) }));
    if (!en) opts.push({ label: '回家', kind: 'reply', say: from ? `從${from}回家怎麼走？` : mode ? '叫車回家' : '回家怎麼走？', saved: '家' }, { label: '去公司', kind: 'reply', say: from ? `從${from}去公司怎麼走？` : mode ? '叫車去公司' : '去公司怎麼走？', saved: '公司' });
    if (!opts.length || (en && mode && !opts.some((o) => !o.saved))) opts.push({ label: 'Taipei 101', kind: 'reply', say: tripSayOf('台北101') }); // 英文、沒有說過的地點：給一個例子（也可以直接打）
    if (!en && mode && !opts.some((o) => !o.saved)) opts.unshift({ label: '台北101', kind: 'reply', say: tripSayOf('台北101') }); // 叫車又沒說過地點：給一個例子（手機沒設定家、公司時才不會只剩「略過」）
    return {
      ask: { about: 'slot:to', question: en ? 'Where are you going?' : '要去哪裡？', why: en ? 'Or just type the place.' : '直接打地名也可以。', options: opts.slice(0, 6), pending: { slot: 'to', ...(fromSay && { from: fromSay }), ...(mode && { mode }), ...(en && { lang: 'en' }) } },
      short: en ? `Where are you going?${from ? ` Starting from ${fromSay}, tell` : ' Tell'} me the destination and I'll compare the ways to get there${mode ? ' (taxi included)' : ''}.` : `${mode ? '叫車' : ''}要去哪裡？${from ? `從「${from}」出發，` : ''}告訴我目的地，我幫你比較${mode ? '叫車和其他方式' : '怎麼去'}。`,
    };
  }
  return null;
}

/** 國道路況沒說起訖時的例子（常走的國道路段） */
const TRAFFIC_EXAMPLES = [['台北', '新竹'], ['台北', '台中'], ['台中', '高雄']];

/** 上一輪阿幫是不是在問起點（originAsk 的回答）：這一輪定位又失敗就不再給「用我的位置」（不無限循環） */
export const ORIGIN_ASKED = /你從哪裡出發？沒拿到你的位置|還是沒拿到你的位置|^Where are you starting from\? I didn't get|still couldn't get your location/;
const NEAR_RAIL_SAY = { THSR: ['最近的高鐵站', 'the nearest HSR station'], TRA: ['最近的火車站', 'the nearest train station'] };

/**
 * 沒有定位、預設起點又就在目的地旁邊（臺北車站到臺北車站）：問「你從哪裡出發？」，不亂算（2026-11-22）。
 * @param {string|null} to 目的地（常用地點是標籤「家」；去最近的火車站時 null，帶 nearRail）
 * @param {'en'|null} [lang]
 * @param {{ again?: boolean, nearRail?: 'THSR'|'TRA'|null }} [o] again：上一輪問過、這一輪定位又失敗——不再給「用我的位置」
 * @returns {{ ask: object|null, short: string }} ask 為 null：只回一句（英文又沒有其他選項時）
 */
export function originAsk(to, lang = null, { again = false, nearRail = null } = {}) {
  const en = lang === 'en';
  const zhTo = nearRail ? NEAR_RAIL_SAY[nearRail][0] : to;
  const enTo = nearRail ? NEAR_RAIL_SAY[nearRail][1] : enName(to);
  const useEn = en && !nearRail && enTo !== to; // 英文那一輪、目的地有英文名稱才用英文句（規則才聽得懂）
  const toSay = useEn ? enTo : zhTo;
  const opts = again ? [] : [{ label: en ? 'Use my location' : '用我的位置', kind: 'reply', say: useEn ? `How do I get to ${enTo}?` : `怎麼去${zhTo}？` }];
  if (!en) opts.push({ label: '從家出發', kind: 'reply', say: `從家到${zhTo}怎麼去？`, saved: '家' }, { label: '從公司出發', kind: 'reply', say: `從公司到${zhTo}怎麼去？`, saved: '公司' });
  const short = again
    ? (en ? `I still couldn't get your location. Type where you are (e.g. Ximending) and I'll work it out from there.` : '還是沒拿到你的位置。直接打你在哪裡（例如：西門町），我就從那裡幫你算。')
    : nearRail
      ? (en ? `Where are you starting from? I didn't get your location, so I won't guess which station is nearest. Tell me where you are and I'll find ${enTo}.` : `你從哪裡出發？沒拿到你的位置，我先不亂猜哪一站最近。告訴我你在哪裡，我幫你找${zhTo}。`)
      : (en ? `Where are you starting from? I didn't get your location, and ${enTo} is right next to the default start, so I won't guess. Tell me where you are and I'll compare the ways.` : `你從哪裡出發？沒拿到你的位置，「${zhTo}」又就在預設起點旁邊，我先不亂算。告訴我你在哪裡，我幫你比較怎麼去。`);
  return {
    ask: opts.length ? { about: 'slot:from', question: en ? 'Where are you starting from?' : '你從哪裡出發？', why: en ? "I didn't get your location. Or just type where you are." : again ? '還是沒拿到你的位置；直接打你在哪裡（例如：西門町）。' : '沒拿到你的位置；直接打你在哪裡也可以。', options: opts, pending: { slot: 'from', to: toSay, ...(useEn && { lang: 'en' }) } } : null,
    short,
  };
}

// ───── 打字回答（pendingAsk）：只收「地名」（地標庫認得的，或常用地點標籤）；其他（算了、謝謝、不用了、我趕時間、叫車…）當略過或新問題 ─────
/** 這一句是不是在問別的（天氣、公車、油價…）——是就不當答案（寧可略過，不能把新問題吞成答案） */
const OTHER_ASK = /[?？嗎呢]|天氣|下雨|空氣|空品|地震|藥局|垃圾車|油價|發票|股|捷運|高鐵|台鐵|臺鐵|火車|youbike|ubike|詐騙|短劇|公車|怎麼|幾點|多久|\bhow\b|\bwhat\b|\bwhen\b|\bweather\b/i;
/** 回答裡的地點：地標庫的正式中文名稱、或常用地點標籤；不是地名回 null */
function placeAnswer(t, prefix) {
  const c = String(t || '').trim().replace(prefix, '').replace(/\s*(?:出發|這邊|那邊|附近)?\s*(?:啦|喔|吧|囉|呀)?[。！!～~.]*$/u, '').trim();
  if (SAVED_LABELS.includes(c)) return { zh: c, saved: true }; // 常用地點的標籤（「家」「公司」）
  if (c.length < 2 || c.length > 30 || /[\n\r]/.test(c) || OTHER_ASK.test(c)) return null;
  const places = placesInText(c);
  if (places.length !== 1) return null; // 沒有地名（「算了」「謝謝」「叫車」）或好幾個：不當答案
  const it = parseIntent(c, {});
  if (!['unknown', 'trip'].includes(it.intent)) return null;
  return { zh: places[0], en: enName(places[0]) !== places[0] ? enName(places[0]) : null };
}
/** pending 裡的另一端地名（可能是中文或英文）→ { zh, en } */
const nameBoth = (v) => {
  const t = typeof v === 'string' && v.trim() && v.length <= 40 && !/[\n\r]/.test(v) ? v.trim() : null;
  if (!t) return null;
  const rail = Object.values(NEAR_RAIL_SAY).find((x) => x.includes(t));
  if (rail) return { zh: rail[0], en: null };
  const zh = SAVED_LABELS.includes(t) ? t : placesInText(t)[0] || t;
  return { zh, en: enName(zh) !== zh ? enName(zh) : isEnglish(t) ? t : null };
};
/** 句型語言跟地名一致：英文那一輪、兩邊都有英文名稱才用英文句；否則用中文正式名稱的中文句（規則都聽得懂）；mode：只說「叫車」時帶著叫車 */
const tripSentence = (from, to, en, mode = null) => {
  if (mode) return tripSay(to.zh, { from: from?.zh || null, mode, en: en && to.en && !from ? to.en : null });
  return en && to.en && (!from || from.en)
    ? (from ? `How do I get from ${from.en} to ${to.en}?` : `How do I get to ${to.en}?`)
    : (from ? `從${from.zh}到${to.zh}怎麼去？` : `怎麼去${to.zh}？`);
};
Object.assign(PENDING_SLOTS, {
  // 哪一路公車：「307」「坐 307」「307 號」「bus 307」→「307 公車還要多久？」
  route: (p, t) => {
    const m = /^(?:我)?(?:要)?(?:坐|搭|等|查)?\s*([紅藍綠棕橘小幹]?\d{1,4}[區副]?)\s*(?:號|路)?\s*(?:公車)?\s*(?:的|啦|喔|吧|呀)?[。!！.]?$/u.exec(t) || /^(?:the\s+)?(?:bus\s*)?(?:no\.?\s*)?(\d{1,4}[a-z]?)\.?$/i.exec(t);
    if (!m || !ROUTE_RE.test(m[1])) return null;
    if (p.last) return `${m[1]} 公車末班車幾點？`; // 問末班車時回的路線
    return p.lang === 'en' || /^(?:the\s+)?bus/i.test(t) ? `How long until bus ${m[1]}?` : `${m[1]} 公車還要多久？`;
  },
  // 國道路況的起訖：「台北到新竹」「從桃園到台中」→「台北到新竹國道塞車嗎？」（只收兩個地名）
  od: (p, t) => {
    const c = String(t || '').trim().replace(/[。！!～~.?？]+$/u, '');
    if (c.length > 30 || /[\n\r]/.test(c) || /天氣|下雨|公車|捷運|高鐵|台鐵|油價|發票|股/.test(c)) return null;
    const ps = placesInText(c);
    if (ps.length !== 2 || !/到|→|至|去|往|\bto\b/i.test(c)) return null;
    const short = (x) => x.replace(/(?:車站|站)$/, '').replace(/^臺/, '台');
    if (p.lang === 'en' || isEnglish(c)) return `Is the freeway jammed from ${enName(ps[0])} to ${enName(ps[1])}?`; // 英文那一輪：英文句（規則也聽得懂）
    return `${/從/.test(c) ? '從' : ''}${short(ps[0])}到${short(ps[1])}國道塞車嗎？`;
  },
  // 要去哪裡：「台北101」「去西門町」「Taipei 101」→「從起點到台北101怎麼去？」或「怎麼去台北101？」（英文那一輪用英文句）
  to: (p, t) => {
    const c = placeAnswer(t, /^(?:我)?(?:要|想)?(?:去|到|往)\s*|^(?:to|go to)\s+/iu);
    if (!c) return null;
    return tripSentence(nameBoth(p.from), c, p.lang === 'en', p.mode || null);
  },
  // 你從哪裡出發：「板橋」「我在西門町」「Ximending」→「從板橋到目的地怎麼去？」；「用我的位置」→「怎麼去目的地？」（手機會定位）
  from: (p, t) => {
    const to = nameBoth(p.to);
    if (!to) return null;
    if (/^(?:用)?(?:我的位置|我現在的位置|現在位置|這裡|這邊|use my location|my location|here)[。.!！]?$/iu.test(t.trim())) return tripSentence(null, to, p.lang === 'en');
    const c = placeAnswer(t, /^(?:我)?(?:現在)?(?:人)?(?:在|從)\s*|^(?:i'?m\s+(?:at|in)|from)\s+/iu);
    if (!c) return null;
    return tripSentence(c, to, p.lang === 'en');
  },
});

/** 看起來像公車站名的字 */
const STOP_LIKE = /站|路口|捷運|國小|國中|高中|大學|醫院|市場|公園|廟|宮|里|新村|社區|轉運|廣場|橋|街|路|商場|大樓|中心|學校|分局|公所|派出所|郵局|銀行|圖書館|體育館|夜市|教會|寺/;
const COUNTY_ONLY = /^(?:[臺台](?:北|中|南|東)|新北|桃園|高雄|基隆|新竹|嘉義|苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|澎湖|金門)(?:市|縣)?$/;
// ───── PM 的 Q 情境（2026-11-22，core/agent/clarify.js）：缺起站／迄站、地點有歧義、只說類別、沒定位問在哪、公車在哪一站、發票號碼 ─────
Object.assign(PENDING_SLOTS, {
  // 高鐵／台鐵缺起站、缺迄站：「台中」「我從左營出發」→「高鐵台中到台北多少錢」（只收站名）
  railFrom: (p, t) => (p.system ? railPendingSay({ ...p, slot: 'railFrom' }, t) : null),
  railTo: (p, t) => (p.system ? railPendingSay({ ...p, slot: 'railTo' }, t) : null),
  // 是哪一個地方（「中山大學」「改去松山機場」「是林口長庚」）：只收地標庫認得的地名，接回「怎麼去 X？」
  place: (p, t) => {
    if (p.road && COUNTY_ONLY.test(String(t).trim().replace(/[。！!～~.]+$/u, ''))) return null; // 問路名附近的地標，回城市名接不回那條路（交回原本流程）
    const air = p.airport && airportAnswer(t); // 問哪個機場：「桃園」「小港」「松山的」「台北」就是那個機場（不是桃園車站）
    if (air) { // 後面的附加詞（「松山，叫車」「桃園，搭機捷」）：交通方式一起帶上
      const extra = String(t).trim().slice(answerHead(t).length);
      const mode = (extra && modeOf(extra.replace(/機捷/g, '捷運'))) || p.mode || null;
      return tripSentence(nameBoth(p.from), { zh: air, en: enName(air) !== air ? enName(air) : null }, p.lang === 'en', mode);
    }
    const c = placeAnswer(String(t).replace(/^(?:不是[^，,。]{0,8}[，,]?\s*)?(?:我是說|我說的是|是要|應該是|改|換|是)\s*/u, ''), /^(?:我)?(?:要|想)?(?:去|到|往)\s*|^(?:to|go to)\s+/iu);
    if (!c || c.saved) return null;
    return tripSentence(nameBoth(p.from), c, p.lang === 'en', p.mode || null);
  },
  // 只說類別、你就在那裡：「下一班」「票價」「附近」→ 那一類的完整一句
  topic: (p, t) => (TOPIC_KEYS.includes(p.topic) ? topicSay(p.topic, t, typeof p.to === 'string' ? p.to : null) : null),
  // 沒定位問天氣、空品、出門：「台中」「我在板橋」→「台中天氣」
  where: (p, t) => {
    if (!['weather', 'aqi', 'outing'].includes(p.topic)) return null;
    const c = String(t).trim().replace(/^(?:我)?(?:現在)?(?:人)?在\s*/u, '').replace(/\s*(?:這邊|那邊|附近)?(?:啦|喔|吧)?[。！!～~.]*$/u, '').trim();
    if (!c || c.length > 12 || OTHER_ASK.test(c)) return null;
    const ok = COUNTY_ONLY.test(c) || placesInText(c).length === 1;
    return ok ? whereSay(p, c) : null;
  },
  // 公車在哪一站等：「市政府」「我在敦化市場」「往板橋」→「307 公車到「市政府」還要多久」
  busStop: (p, t) => {
    const s = String(t).trim();
    if (OTHER_ASK.test(s) && !/^往/.test(s)) return null;
    const it = /^往/.test(s) ? null : parseIntent(s.replace(/^(?:我)?(?:現在)?(?:人)?(?:在|從)\s*/u, ''), {}); // 站名可以是地標（「市政府」），但不能是狀況、道謝、別的問題
    if (it && (it.states?.length || it.thanks || it.sorry || it.reset || it.ack || it.help || !['unknown', 'trip'].includes(it.intent) || (it.intent === 'trip' && !it.bare))) return null;
    const name = s.replace(/^(?:我)?(?:現在)?(?:人)?(?:在|從)\s*/u, '').replace(/\s*(?:站牌|這站|那站)?\s*(?:等(?:車)?)?[。！!～~.]*$/u, '');
    if (!/^往/.test(s) && !(placesInText(name).length === 1 || STOP_LIKE.test(name))) return null; // 只收看起來像站名的（地標庫、或含站、路口、捷運、國小、市場…；「等一下」不收，審查 #121）
    return busStopSay(p, s);
  },
  // 發票號碼：8 碼或末 3 碼 →「發票 12345678 有中獎嗎」
  invoiceNo: (p, t) => { const m = /^(?:[a-z]{2}-?)?(\d{8}|\d{3})[。.!！]?$/i.exec(String(t).trim()); return m ? `發票 ${m[1]} 有中獎嗎` : null; },
});

// ───── 問什麼由手機上的 AI 決定（ADR-0020）：deviceJudge.ask 是候選，程式驗證；不通過就丟掉，照上面的規則問（保底）─────
// 驗證只做「寧可不問」：題目的欄位要真的是這一句缺的（規則的 slotAsk／originAsk 也認為缺）、狀態題要真的會改變建議（keyQuestion 只試那個狀態）、
// 每個選項都要接得回（跟打字回答同一套 PENDING_SLOTS：地名要在地標庫或是常用地點標籤、路線要像路線號）。
// 題目文字用手機的；說明（why）、等待中的答案（pending）、只問一次的鍵（key）、這一輪的一句回答（short）仍由程式產生。

/**
 * 這一輪手機提議的題目的去向（一個請求一個）：形狀先檢查（core/edge-ask.js，手機也跑過），之後在問的時機逐一驗證。
 * @param {object|undefined} ask deviceJudge.ask
 * @param {'en'|'zh'} lang 這一輪的語言
 * @returns {{ ask: object, verdict: 'used'|'rejected'|null, reason: string|null, blocked: boolean } | null}
 */
export function deviceAskTracker(ask, lang = 'zh') {
  if (!ask) return null;
  const shape = edgeAskShape(ask, { lang: lang === 'en' ? 'en' : 'zh' })
    || ([ask.question, ...ask.options].some((t) => matchRules(askNorm(t)).length || matchRules(askNorm(t, true)).length) ? 'unsafe' : null); // 伺服器另外跑防詐規則庫（點數卡、解除分期…）
  return { ask, verdict: shape ? 'rejected' : null, reason: shape, blocked: !!shape };
}
const useDevice = (t) => { t.verdict = 'used'; t.reason = null; };
const rejectDevice = (t, reason) => { if (t && t.verdict !== 'used') { t.verdict = 'rejected'; t.reason = reason; } };
/** 這一輪結束時的結果（done 事件的 askCheck、log）：沒用到的視為被擋（沒有缺這個欄位／這一輪沒有行程可以驗證狀態題） */
export function deviceAskCheck(t) {
  if (!t) return null;
  const used = t.verdict === 'used';
  return { slot: t.ask.slot, ...(t.ask.slot === 'state' && { state: t.ask.state }), verdict: used ? 'used' : 'rejected', ...(!used && { reason: t.reason || (t.ask.slot === 'state' ? 'no-trip' : 'not-missing') }) };
}

const SAVED_TO = /^(?:回|去|到)?\s*(家|公司|學校)$/;
const SAVED_FROM = /^(?:從)?\s*(家|公司|學校)\s*(?:出發)?$/;
const NEARBY_STOPS = /^(?:看)?附近(?:有哪些|的)?公車(?:站牌?|站)?$|^(?:any\s+)?(?:bus\s+stops?\s+nearby|nearby\s+(?:bus\s+)?stops?)\??$/i;
const MY_SPOT = /^(?:用)?(?:我的位置|我現在的位置|現在位置|這裡|這邊)$|^(?:use\s+)?my\s+location$|^here$/i;
const ROUTE_LABEL = /^(?:bus\s*)?([紅藍綠棕橘小幹]?\d{1,4}[區副]?)\s*(?:號|路)?\s*(?:公車)?$/i;
const ROUTE_ANY = /(?:^|[^\d])([紅藍綠棕橘小幹]?\d{1,4}[區副]?)(?=\s*(?:號|路)?\s*(?:公車|bus))|(?:公車|bus)\s*([紅藍綠棕橘小幹]?\d{1,4}[區副]?)/gi;
/** 地標庫裡「整個選項就是這個地名」的那一筆（去掉「去／到／從／我在」與「出發」）；「西門町領紅包」「台北101加賴」不算 */
function exactPlace(label) {
  const core = askNorm(label).trim()
    .replace(/^(?:我)?(?:要|想)?(?:去|到|往)\s*|^(?:我)?(?:現在)?(?:人)?(?:在|從)\s*|^(?:to|go to|from|i'?m at)\s+/i, '')
    .replace(/\s*出發$/, '').trim();
  const n = normPlace(core);
  if (!n) return null;
  return LANDMARKS.items.find((x) => [x.name, x.en, ...(x.aliases || [])].filter(Boolean).some((k) => normPlace(k) === n)) || null;
}
const placeOf = (name) => (name ? exactPlace(name) || LANDMARKS.items.find((x) => normPlace(x.name) === normPlace(placesInText(String(name))[0] || '')) || null : null);

/**
 * 手機的一個選項 → ask 事件的選項（reply：按了送出規則聽得懂的完整一句）；接不回回 null。
 * 地名：整個選項要就是地標庫的一個地名、而且是前文或情境出現過的（不收模型自己想的），也不能是另一端（起點＝目的地）；
 * 路線：前文或情境出現過的路線號碼（不收模型自己想的 9999）或「附近公車」；常用地點標籤與「用我的位置」照收。
 */
function deviceOption(slot, label, pending, { again = false, places = [], routes = [], accept = null } = {}) {
  const en = pending?.lang === 'en';
  if (!['route', 'to', 'from'].includes(slot)) { // PM Q 情境的新種類：選項要接得回、而且是程式的候選之一（站名、候選地點、城市；不收模型自己想的）
    const say = resolvePending(pending, label);
    return say && accept?.has(say) ? { label, kind: 'reply', say } : null;
  }
  if (slot === 'route') {
    if (NEARBY_STOPS.test(label)) return { label, kind: 'reply', say: en || /^[a-z]/i.test(label) ? 'Any bus stops nearby?' : '附近的公車站' };
    const m = ROUTE_LABEL.exec(askNorm(label).trim());
    if (!m || !routes.includes(m[1])) return null;
  }
  if (slot === 'to' && !en) {
    const m = SAVED_TO.exec(label);
    if (m) { const go = m[1] === '家' ? '回家' : `去${m[1]}`; return { label, kind: 'reply', say: pending.from ? `從${pending.from}${go}怎麼走？` : `${go}怎麼走？`, saved: m[1] }; }
  }
  if (slot === 'from') {
    if (MY_SPOT.test(label)) { if (again) return null; } // 上一輪按了「用我的位置」定位又失敗：不再給這個選項
    else {
      const m = !en && SAVED_FROM.exec(label);
      if (m) return { label, kind: 'reply', say: `從${m[1]}到${pending.to}怎麼去？`, saved: m[1] };
    }
  }
  if ((slot === 'to' || slot === 'from') && !(slot === 'from' && MY_SPOT.test(label))) {
    const lm = exactPlace(label);
    if (!lm || !places.includes(lm.name)) return null;
    const other = placeOf(slot === 'to' ? pending.from : pending.to);
    if (other && other.name === lm.name) return null; // 起點＝目的地
  }
  const say = resolvePending(pending, label); // 跟打字回答同一套：只收路線號碼、地標庫認得的地名、常用地點標籤
  return say ? { label, kind: 'reply', say } : null;
}

/** 前文（使用者說過的）與情境（頁面）出現過的地名（地標庫正式名稱）與路線號碼：手機出題的選項只能從這裡挑 */
function mentioned(history = [], context = '') {
  const texts = [...history.filter((m) => m?.role === 'user').map((m) => String(m.content || '')), String(context || '')];
  const places = new Set(), routes = new Set(recentRoutes(history, 10));
  for (const t of texts) {
    for (const p of placesInText(t)) { const lm = placeOf(p); if (lm) places.add(lm.name); }
    for (const x of t.matchAll(ROUTE_ANY)) routes.add(x[1] || x[2]);
  }
  return { places: [...places], routes: [...routes] };
}

/**
 * 缺欄位的題目（route／to／from）：規則也認為這一句缺這個欄位（rule＝slotAsk／originAsk 的結果）、每個選項都接得回，才用手機的題目。
 * @param {ReturnType<typeof deviceAskTracker>} t
 * @param {'route'|'to'|'from'} slot 規則這一輪要問的欄位
 * @param {{ ask: object|null, short: string }} rule
 * @param {{ again?: boolean, history?: Array<{ role: string, content: string }>, context?: string }} [o] again：上一輪問過起點、定位又失敗；history／context：選項只能用前文與情境出現過的地名、路線
 * @returns {{ ask: object, short: string } | null} null：不用手機的（照規則）
 */
export function deviceSlotAsk(t, slot, rule, { again = false, history = [], context = '' } = {}) {
  if (!t || t.blocked || t.verdict === 'used' || t.ask.slot !== slot) return null;
  if (!rule?.ask?.pending) { rejectDevice(t, 'asked'); return null; } // 英文、上一輪已問過起點：規則只回一句，不再出選項
  const seen = mentioned(history, context);
  const accept = new Set([...(rule.accept || []), ...rule.ask.options.filter((o) => o.kind === 'reply').map((o) => o.say)]); // 新種類：程式的候選句子
  const guessSay = rule.ask.options.find((o) => o.guess)?.say;
  const options = [];
  for (const label of t.ask.options) {
    const o = deviceOption(slot, label, rule.ask.pending, { again, accept, ...seen });
    if (!o) { rejectDevice(t, 'option'); return null; }
    if (options.some((x) => x.say === o.say)) { rejectDevice(t, 'duplicate'); return null; }
    options.push(o.say === guessSay ? { ...o, guess: true } : o);
  }
  if (guessSay && options.some((o) => o.guess)) options.sort((a, b) => !!b.guess - !!a.guess); // 先查了的那個（猜的）放第一個
  else if (guessSay) { rejectDevice(t, 'option'); return null; } // 程式已經用猜的查了：選項要包含它（不然使用者沒辦法說「對，就是這個」）
  useDevice(t);
  return { ask: { ...rule.ask, question: t.ask.question, options, askSource: 'device' }, short: rule.short };
}

/** 手機的狀態題可以用嗎（題目在形狀檢查已經驗過問到那個狀態、沒反著問）：使用者這一輪沒說狀況、沒指定方式 */
const stateSaid = (trip, st) => !!(trip.mode || (trip.states || []).some((s) => s.source !== 'auto' || s.key === st));

/**
 * 說過的預設狀況（「這次也帶東西嗎？」）跟手機問的是同一個狀態：用手機的題目文字，選項照程式（source usual、guess）；不同狀態就讓給說過的預設狀況。
 */
function deviceUsualAsk(t, u) {
  if (!t || t.blocked || t.verdict === 'used' || t.ask.slot !== 'state') return null;
  if (u.about !== `usual:${t.ask.state}`) { rejectDevice(t, 'taken'); return null; }
  useDevice(t);
  return { ...u, question: t.ask.question, askSource: 'device' };
}

/**
 * 狀態題（state）：只取代關鍵因子那一題。使用者這一輪沒說狀況、沒指定方式，而且只加上這個狀態時建議會換、差別值得問（keyQuestion 只試這個狀態）。
 * 題目用手機的（形狀檢查已驗過問到那個狀態、沒反著問）；選項一律用程式的（STATE_ANSWERS），數字（快幾分、多幾元）由程式算、放在 why。
 * @returns {object|null} tripAsk 的形狀
 */
export function deviceStateAsk(t, trip, { lang = null, usual = [] } = {}) {
  if (!t || t.blocked || t.verdict === 'used' || t.ask.slot !== 'state' || !trip?.options?.length) return null;
  const st = t.ask.state;
  if (stateSaid(trip, st)) { rejectDevice(t, 'said'); return null; }
  if (usual?.includes(st)) { rejectDevice(t, 'no-change'); return null; } // 說過的預設狀況上面已經判斷過（不會換建議才走到這裡）
  const ctx = { states: (trip.states || []).map((s) => s.key), arriveBy: trip.arriveBy, arriveByMin: trip.arriveByMin, avoid: trip.avoid, habit: trip.habit };
  const kq = keyQuestion(trip.options, ctx, [st]);
  if (!kq) { rejectDevice(t, 'no-change'); return null; }
  const en = lang === 'en', A = STATE_ANSWERS[st];
  const [yes, no] = A[en ? 'en' : 'zh'];
  useDevice(t);
  return {
    about: `state:${st}`, question: t.ask.question, why: en ? kq.textEn : kq.text,
    options: [{ label: yes, kind: 'state', state: st, say: en ? A.sayEn : A.say }, { label: no, kind: 'dismiss' }],
    key: `${st}@${spot(trip.from)}>${spot(trip.to)}`, pending: { slot: 'state', state: st }, askSource: 'device',
  };
}
