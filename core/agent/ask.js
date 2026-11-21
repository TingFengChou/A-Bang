// 阿幫問你（ADR-0016）：答案取決於使用者、問一句會讓整體更快時，由程式產生一個問題（不交給模型）。
// 事件 ask（events.js）：{ type: 'ask', id, question, options: [Option], why?, about?, pending? }
//   Option：{ label, kind, guess? } ＋ 依 kind 的欄位——
//     state   { state, say? }   把狀態加進這一輪的決策即時重算（不呼叫伺服器）；say＝不能即時重算的客戶端改送這一句
//     reply   { say }           把 say（完整的一句，pending 遺失也解析得對）當成使用者的下一句送出
//     store   { value }         存成手機上的偏好（public/js/habits.js applyStore），並把效果套到這一輪
//     action  { action }        手機做事：{ name: 'openLink', url, confirm? }｜{ name: 'watchArrival', ...公車 }｜{ name: 'remind', at, text }（L2 照 ADR-0011 先確認）
//     dismiss {}                不做事（「不趕」「不用」也是回答，只是不改變結果）
//   pending：{ slot, state?, intent? }＝在等什麼答案；使用者直接打字回答時，客戶端把它當 pendingAsk 帶回來，
//     validateRequest 先用 resolvePending 把「好」「台中」改寫成完整的一句（例「我趕時間」），再交給規則或模型。
// 規則：一輪最多一個問題；使用者已經說過、或答案不會改變結果時不問；問了之後直接打別的話＝略過。
export const ASK_KINDS = ['state', 'reply', 'store', 'dismiss', 'action'];
export const ASK_ACTIONS = ['openLink', 'watchArrival', 'remind'];

import { decide } from '../decide.js';

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
export function tripAsk(trip, { habitAsk = null, usual = [], lang = null } = {}) {
  const en = lang === 'en';
  if (habitAsk && trip?.options?.some((o) => o.role === habitAsk.mode)) {
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
  if (u) return u;
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
