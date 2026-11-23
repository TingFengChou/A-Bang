// Agent 共用執行器（M5-04，AGENT.md §2–§3）：呼叫 tool → tool_start／tool_result；plan_trip 時發 decision。
// 示範模式（demo-intent）與模型模式（model-loop.js：Claude／地端，M5-05）共用 execTools，事件流相同。不加假延遲（ADR-0009）。
import { safetyCheck } from './safety.js';
import { enNote } from './en-notes.js';
import { speakEn, impactEn } from '../tools/speak-en.js';
import { z } from 'zod';
import { callTool, listTools } from '../tools/index.js';
import { UserError, publicMessage } from '../util.js';
import { ev } from './events.js';
import { getProfile } from '../agents/index.js';
import { parseIntent, demoSteps, demoSummary, needsLocation, contextNote, isEnglish, nearDefaultFrom, localStations, hasShortStation } from './demo-intent.js';
import { parseAntifraud, antifraudSteps, antifraudSummary } from './demo-antifraud.js';
import { applyOutputGuardrails } from './guardrails.js';
import { impactOf, judgeNote, outingNote, moreStatesNote } from './impact.js';
import { createJudge, JUDGE_INTENTS, JUDGE_STATES, DEVICE_ENGINES } from './judge.js';
import { waitDrama } from './wait-drama.js';
import { answerFacts } from './answer-facts.js';
import { trialInfo } from './trial.js';
import { WRITE_AGENTS } from '../edge-write.js';
import { BUS_OFF, withoutBus, withBusOff, busOffEntry } from '../services/trip.js';
import { MAX_ROUTES } from '../services/bus-direct.js';
import { planTripTool, tripText } from '../tools/trip.js';

/** 示範模式的規則式規劃（依 agent）：parse → steps → summary；needsLocation 只有生活 agent 用 */
const PLANNERS = {
  life: { parse: parseIntent, steps: demoSteps, summary: demoSummary, needsLocation },
  antifraud: { parse: parseAntifraud, steps: antifraudSteps, summary: antifraudSummary, needsLocation: () => false },
};

/** 工具英文名稱（metro_stations、plan_trip…）→ 口語名稱「…」：使用者不該看到內部名稱（地端模型會照抄工具說明，2026-11-21 實機）。
 *  網址裡的字不動；名稱前後的引號、空白、() 一起換掉，句子才通順。 */
const TOOL_SAY = { plan_trip: '行程比較', find_place: '地點查詢' };
const TOOL_NAMES = new Map(listTools().map((t) => [t.name, TOOL_SAY[t.name] || t.title || '查詢']));
export function hideToolNames(text) {
  return String(text ?? '').replace(/(https?:\/\/\S+)|\s?[「『"`]?\b([a-z]+(?:_[a-z0-9]+)+)\b(?:\(\))?[」』"`]?\s?/g, (m, url, name) => {
    if (url || !TOOL_NAMES.has(name)) return m;
    return `「${TOOL_NAMES.get(name)}」`;
  });
}

/** 最後的文字經輸出護欄（L2）：有改寫時先送 guardrail 事件 */
export function guardedText(profile, text, emit) {
  const g = applyOutputGuardrails(profile, hideToolNames(text));
  for (const h of g.hits) emit(ev.guardrail(h));
  return g.text;
}
import { STATES } from '../decide.js';
import { HabitSchema } from '../tools/trip.js';
import { tripAsk, resolvePending, PENDING_SLOTS, unknownAsk, UNKNOWN_SHORT, slotAsk, originAsk, ORIGIN_ASKED, deviceAskTracker, deviceAskCheck, deviceSlotAsk } from './ask.js';
import { planAsk } from './clarify-plan.js';
import { remindAsk, TOPIC_KEYS } from './clarify.js';
import { EDGE_ASK_SLOTS, EDGE_ASK_STATES, EDGE_ASK_LIMITS } from '../edge-ask.js';
import { METRO_SYSTEMS } from '../services/metro.js';
import { normPlace } from '../services/places.js';

/**
 * 說了「X站」「X捷運站」但地標庫沒有（「去大安站」「去士林捷運站」）：用捷運站資料找座標，離使用者最近的那個系統優先（審查 #121）。
 * @returns {Promise<{ lat: number, lon: number, name: string } | null>}
 */
export async function metroPoint(svc, name, at = null) {
  const n = normPlace(name);
  const hits = [];
  for (const system of Object.keys(METRO_SYSTEMS)) {
    try { for (const st of await svc.metro.stations({ system })) if (normPlace(st.name) === n && Number.isFinite(st.lat)) hits.push(st); } catch { /* 這個系統查不到就略過 */ }
  }
  const d = (x) => (at ? (x.lat - at.lat) ** 2 + (x.lon - at.lon) ** 2 : 0);
  const st = hits.sort((a, b) => d(a) - d(b))[0];
  return st ? { lat: st.lat, lon: st.lon, name: `捷運${st.name}站` } : null;
}

/** 規則已經很明確、判斷層不改意圖的標記（PM Q 情境：只回好、地點歧義、路名、只說類別、要出門了、沒說去哪的高鐵、公車方向、問中獎） */
const RULE_FINAL = ['ack', 'ambig', 'category', 'askTo', 'anyTo', 'toward', 'wantCheck', 'metroTo']; // 路名（road）、去機場（airport）不在這裡：判斷層說是別的意圖時可以更正（審查 #121、#122）；去機場只有判斷層說「聽不懂」時不改（限縮）
/** 「你說過」的預設狀況只能是這幾種（habits.js 叫車原因） */
export const USUAL_STATES = ['rush', 'luggage', 'lessWalk'];
export const MAX_MESSAGES = 10;
export const MAX_CHARS = 500;
export const MAX_TOOL_ROUNDS = 5;
/** 輔助資料（決策的參考，不是答案本身）：失敗時照樣往下一步，plan_trip 自己也會照實說哪項資料沒拿到 */
export const AUX_TOOLS = new Set(['weather_now', 'weather_tomorrow', 'aqi_nearby', 'traffic_status']);
/** 裝置定位的 client tool 呼叫 id（客戶端回傳 clientToolResults 時用同一個 id） */
export const LOCATION_CALL_ID = 'loc1';
export const MY_LOCATION = '你的位置';

/** 從 clientToolResults 取出裝置定位（台灣範圍內才採用）；沒有回 undefined、拒絕或無效回 null */
export function deviceLocation(req) {
  const r = req.clientToolResults?.find((x) => x.id === LOCATION_CALL_ID);
  if (!r) return undefined;
  const lat = Number(r.result?.lat), lon = Number(r.result?.lon);
  return r.ok && lat >= 21 && lat <= 27 && lon >= 118 && lon <= 123 ? { name: MY_LOCATION, lat, lon } : null;
}

const RequestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(MAX_CHARS) })).min(1).max(MAX_MESSAGES),
  // habit：手機算好的常選比例（public/js/habits.js；只有方式與比例，沒有地點）。由程式帶進 plan_trip，不交給模型
  // usual：使用者說過的預設狀況（問「你常叫車，通常是因為？」答的：趕時間、常帶東西、不想走路）；不自動套用——會改變建議時問「這次也帶東西嗎？」（ADR-0016）
  // habitAsk：手機說「這種方式選得夠多、還沒問過」（只有方式與次數）→ 這一輪行程後問一次要不要優先推（ADR-0016）
  userState: z.object({ picked: z.array(z.enum(Object.keys(STATES))).max(6).optional(), habit: HabitSchema.optional(), usual: z.array(z.enum(USUAL_STATES)).max(USUAL_STATES.length).optional(),
    habitAsk: z.object({ mode: z.enum(['walk', 'bike', 'bus', 'metro', 'thsr', 'tra', 'intercity', 'ridehail', 'drive']), count: z.number().int().min(1).max(50) }).optional(),
    // 等車推短劇（ADR-0019）：設定頁關掉時手機送 false；沒送＝開（預設開）
    dramaHint: z.boolean().optional(),
    // 我有車（我的 → 設定，2026-11-22）：行程比較加入「自己開車」；沒送＝沒有車
    car: z.boolean().optional() }).optional(),
  // 這段對話第幾輪（手機算，整數）：等車推劇的輪替依據（訊息只送最近 10 則，不能用訊息數推；沒送就退回用訊息數）
  turn: z.number().int().min(1).max(100000).optional(),
  clientTools: z.array(z.string()).max(10).optional(),
  clientToolResults: z.array(z.object({ id: z.string(), ok: z.boolean(), result: z.any().optional() })).max(10).optional(),
  context: z.string().max(200).optional(),
  // 常用地點（S1）：存在手機，只在使用者提到時送（「回家」→ 家）；台灣範圍內的座標
  // 阿幫問你：使用者直接打字回答上一個問題時，客戶端帶回那個問題的 pending（ADR-0016；只有 slot 與意圖，不含個資）
  // slot 只能是有處理函式的；其他欄位只收明確的（intent 等之後有 slot 讀它時再加，不收就會被拿掉）
  // from／to：缺欄位的問題（slot route／to／from）接回原問題用的另一端地名；lang：英文那一輪（2026-11-22）
  pendingAsk: z.object({ id: z.string().max(60), slot: z.enum(Object.keys(PENDING_SLOTS)), state: z.enum(Object.keys(STATES)).optional(),
    from: z.string().trim().min(1).max(40).regex(/^[^\n\r]+$/).optional(), to: z.string().trim().min(1).max(40).regex(/^[^\n\r]+$/).optional(), lang: z.enum(['en']).optional(),
    // PM 的 Q 情境（core/agent/clarify.js）：高鐵／台鐵（system、fare）、只說叫車（mode）、問什麼（topic）、哪一路公車在等（route）、明天的天氣（tomorrow）
    system: z.enum(['THSR', 'TRA']).optional(), fare: z.boolean().optional(), mode: z.enum(['walk', 'bike', 'bus', 'metro', 'thsr', 'tra', 'intercity', 'ridehail']).optional(), topic: z.enum(TOPIC_KEYS).optional(), road: z.boolean().optional(), airport: z.boolean().optional(),
    route: z.string().regex(/^[紅藍綠棕橘小幹]?\d{1,4}[區副]?$/).optional(), tomorrow: z.boolean().optional(), last: z.boolean().optional() }).optional(), // last：問哪一路公車的末班車（真實資料健檢）
  savedPlaces: z.partialRecord(z.enum(['家', '公司', '學校']), z.object({ name: z.string().trim().min(1).max(40), lat: z.number().min(21).max(27), lon: z.number().min(118).max(123) })).optional(),
  // 手機上的模型先判斷好的意圖與狀態（ADR-0014）：只是提示，列舉值以外一律拒絕；方案排序仍由 decide.js 計分
  // ask：手機上的 AI 提議先問使用者的一題（ADR-0020）：只收形狀對的（種類、狀態列舉、長度、選項數、沒有控制與格式字元〔零寬、雙向控制〕），內容另外由程式驗證，不通過就照規則問
  deviceJudge: z.object({ intent: z.enum(Object.keys(JUDGE_INTENTS)), states: z.array(z.enum(JUDGE_STATES)).max(JUDGE_STATES.length), engine: z.enum(DEVICE_ENGINES),
    ask: z.object({ slot: z.enum(EDGE_ASK_SLOTS), state: z.enum(EDGE_ASK_STATES).optional(), question: z.string().trim().min(2).max(EDGE_ASK_LIMITS.questionEn).regex(/^[^\p{Cc}\p{Cf}]+$/u), // 中文 30、英文 60（core/edge-ask.js 依語言再檢查）
      options: z.array(z.string().trim().min(1).max(EDGE_ASK_LIMITS.optionEn).regex(/^[^\p{Cc}\p{Cf}]+$/u)).min(EDGE_ASK_LIMITS.min).max(EDGE_ASK_LIMITS.max) }).strict().nullish() }).optional(), // null＝沒有要問
  // 手機能自己寫回答（ADR-0017）：伺服器不呼叫模型，送程式版總結（answer_draft）由手機改寫
  // trial：「阿幫的腦袋」的現場試判斷（#/ai）：同樣走 edge 模式（不呼叫任何伺服器模型），另外送 trial 事件（資料夠不夠、資料來源）；
  // 網頁版沒有手機上的模型，所以 trial 時 engine 可以不帶（一般請求一定要帶）
  clientCaps: z.object({ edgeWrite: z.boolean(), engine: z.enum(DEVICE_ENGINES).optional(), trial: z.literal(true).optional() }).strict()
    .refine((c) => c.engine || (c.trial && c.edgeWrite), { message: '要有 engine' }).optional(),
});

/** 這個請求是「阿幫的腦袋」的試判斷（只有生活 agent；一定走 edge 模式） */
export const isTrial = (req, profileId = 'life') => req?.clientCaps?.trial === true && req.clientCaps.edgeWrite === true && WRITE_AGENTS.includes(profileId);

/** 這個請求的回答要交給手機寫（只有生活 agent；防詐的固定安全句不改寫） */
export const wantsEdgeWrite = (req, profileId = 'life') => req?.clientCaps?.edgeWrite === true && WRITE_AGENTS.includes(profileId);

/** 驗證 /api/v1/agent 請求；錯誤丟 UserError（繁體中文、可行動） */
export function validateRequest(body) {
  const r = RequestSchema.safeParse(body ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    throw new UserError(`請求格式錯誤：${i.path.join('.') || '內容'}（${i.message}）；訊息最多 ${MAX_CHARS} 字、最多 ${MAX_MESSAGES} 則`);
  }
  if (r.data.messages.at(-1).role !== 'user') throw new UserError('最後一則訊息必須是使用者的提問');
  // 等待中的答案：「好」「台中」→ 完整的一句（「我趕時間」），規則與模型都看改寫後的話；不是答案就照原句
  const said = resolvePending(r.data.pendingAsk, r.data.messages.at(-1).content);
  if (said) {
    r.data.messages = [...r.data.messages.slice(0, -1), { role: 'user', content: said }];
    Object.defineProperty(r.data, 'answered', { value: true }); // 手機上的 AI 判斷的是原本的短答（「台中」像是要去台中）：意圖與狀態不採用，改寫成完整的一句後以程式為準（PM Q-1）；題目照常驗證
  }
  return r.data;
}

/**
 * 決策選了公車 → 接著盯這條路線在上車站的即時到站（L-14）。由程式決定、不靠模型記得要查（ADR-0010 精神：決策與後續一致）。
 * @param {object} trip plan_trip 的 data
 * @returns {{ note: string, args: object } | null}
 */
export function busFollowUp(trip) {
  const best = trip?.options?.find((o) => o.id === trip.best);
  const f = best?.role === 'bus' && best.follow;
  if (!f?.routeName || !f.stop) return null;
  return {
    walkMin: f.walkMin ?? null,
    note: `@公車 你選了公車，我幫你盯 ${f.routeName} 在「${f.stop}」的到站`,
    args: { city: f.city, routeName: f.routeName, stop: f.stop, ...(f.direction != null && { direction: f.direction }) },
  };
}

/** 盯到站後排除不會來的公車、重新排出的行程資料 → 工具結果（文字、小幫手的一句跟著資料改） */
const tripResult = (prev, data) => ({ ...prev, data, text: tripText(data), speak: planTripTool.speak(data) });
/** 重排前先盯推薦的公車（盯到今天不會來時，討論串的說明） */
const offNote = (a) => `@公車 先看 ${a.routeName} 在「${a.stop}」今天有沒有車`;

/**
 * 執行一批 tool 呼叫（平行）：先送全部 tool_start，再依完成順序送 tool_result；plan_trip 成功時接著送 decision。
 * 只允許 profile 白名單內的 tool。plan_trip 選了公車時，接著自動查上車站的即時到站（`followUp`，事件照常送出）。
 * @param {object} svc
 * @param {Array<{ name: string, args: object }>} calls
 * @param {(e: object) => void} emit
 * @param {{ profile: object, nextId: () => string, picked?: string[], habit?: Record<string, number>, ask?: { done: boolean, habitAsk?: object, usual?: string[] } }} opts habit：手機送來、使用者同意過的常選比例（plan_trip 一律用這個，模型給的不採用）；ask：這一輪的「阿幫問你」（一輪最多一個；usual＝說過的預設狀況，會改變建議時問一句）
 * @returns {Promise<Array<{ name: string, ok: boolean, result?: object, error?: string, followUp?: object, watched?: true }>>} 依 calls 順序；watched＝盯過推薦的公車、今天不會來而重排
 */
export async function execTools(svc, calls, emit, { profile, nextId, picked = [], judgedStates, lang = null, habit = null, car = false, ask = null, now = null, aside = null }) {
  const started = calls.map((c) => ({ ...c, id: nextId() }));
  // 英文提問（S12d）：小幫手的一句話用英文版；「→ 影響」是中文，英文那一輪不附
  const en = lang === 'en';
  const shown = (name, r) => (en ? { ...r, speak: speakEn(name, r.data, r.args) ?? r.speak } : r);
  const impactFor = (name, data) => (en ? impactEn(name, data) ?? undefined : impactOf(name, data)); // 英文：只留要馬上注意的（YouBike 車位、公車趕不趕得上）
  for (const c of started) emit(ev.toolStart({ id: c.id, name: c.name, input: c.args }));
  return Promise.all(started.map(async (c) => {
    try {
      if (!profile.tools.includes(c.name)) throw new UserError(`這個 agent 不能使用 ${c.name}`);
      const args = c.name === 'plan_trip' ? withHabit(withPickedPrefs(c.args, picked, judgedStates), habit, car) : c.args;
      const planSvc = c.name === 'plan_trip' && now != null ? { ...svc, now } : svc; // 行程比較用這一輪的「現在」（示範時鐘；深夜說「現在 00:10」）
      let result = await callTool(planSvc, c.name, args);
      if (c.name !== 'plan_trip') {
        emit(ev.toolResult({ id: c.id, result: shown(c.name, result), impact: impactFor(c.name, result.data) }));
        await emitAside(svc, emit, aside, { tool: c.name, data: result.data, parent: c.id, lang });
        return { name: c.name, ok: true, result };
      }
      // 選了公車：先盯上車站（L-14）。盯到的是今天不會來（BUS_OFF：今日未營運、末班已過、交管不停靠）就排除這條路線重排，
      // 卡片、決策圖、回答都照重排後的（2026-11-22 三峽→台北 101：推了今日未營運的公車，還問要不要到站提醒）。
      // 重排最多 MAX_ROUTES − 1 次（directTrips 最多 MAX_ROUTES 條、busOff 只增）；重排失敗或次數用完時不再重查，把盯到不會來的公車排除、用同一套 decide() 重排（withoutBus，不打 TDX）
      const watch = profile.tools.includes('bus_route_eta');
      const busOff = [], offSeen = [];
      let f = watch ? busFollowUp(result.data) : null, followUp = null, followErr = null;
      while (f) {
        try { followUp = await callTool(svc, 'bus_route_eta', f.args); } catch (e) { followErr = e; break; }
        const st = followUp.data?.focus?.status;
        if (!BUS_OFF[st]) break;
        offSeen.push({ f, followUp, status: st });
        busOff.push({ routeName: f.args.routeName, status: st });
        followUp = null;
        const offs = busOff.map((x) => busOffEntry(x.routeName, x.status));
        const again = offSeen.length < MAX_ROUTES ? await callTool({ ...planSvc, busOff: [...busOff] }, c.name, args).catch(() => null) : null;
        const fixed = again && withBusOff(again.data, offs); // 重排時公車整個查不到（資料暫時查不到）也照樣說盯到的那條為什麼不在
        result = again ? (fixed === again.data ? again : tripResult(again, fixed)) : tripResult(result, withoutBus(result.data, offs));
        f = again ? busFollowUp(result.data) : null; // withoutBus 已排除全部盯到不會來的公車（plan_trip 只列一條公車），不用再盯
      }
      for (const x of offSeen) { // 盯到的證據照樣出現在討論串（工具發言：「X 在「站」：今日未營運」），再說重新比較
        emit(ev.agentNote(en ? enNote(offNote(x.f.args)) : offNote(x.f.args)));
        const id = nextId();
        emit(ev.toolStart({ id, name: 'bus_route_eta', input: x.f.args }));
        emit(ev.toolResult({ id, result: shown('bus_route_eta', x.followUp), impact: impactFor('bus_route_eta', x.followUp.data) }));
        const again = `@行程 ${x.f.args.routeName} ${BUS_OFF[x.status].why.replace(/（站牌即時資訊）$/, '')}，不列入，重新比較`;
        emit(ev.agentNote(en ? enNote(again) : again));
      }
      // 行程比較內部查的天氣、空品、路況：各出一行「資料＋影響」（程式產生；排在行程的結論前面）
      for (const item of result.data?.considered || []) emit(ev.dataNote({ parent: c.id, item, lang }));
      emit(ev.toolResult({ id: c.id, result: shown(c.name, result), impact: impactFor(c.name, result.data) }));
      emit(ev.decision(withPicked(result.data, picked)));
      // 阿幫問你（ADR-0016）：這一輪還沒問過才問（ask 是整輪共用的 { done, habitAsk }）
      const free = ask && !ask.done;
      let q = free ? tripAsk(result.data, { habitAsk: ask.habitAsk, usual: ask.usual, lang, device: ask.device }) : null; // device：手機上的 AI 提議的狀態題（ADR-0020）
      if (q) ask.done = true;
      const sayQ = () => { if (q) emit(ev.ask({ id: `ask-${nextId()}`, ...q })); };
      if (!f) { sayQ(); return { name: c.name, ok: true, result, ...(offSeen.length && { watched: true }) }; }
      emit(ev.agentNote(en ? enNote(f.note) : f.note));
      const id = nextId();
      emit(ev.toolStart({ id, name: 'bus_route_eta', input: f.args }));
      if (followErr || !followUp) {
        emit(ev.toolResult({ id, error: publicMessage(followErr || new Error('沒有盯到上車站')) })); // 盯不到不影響行程結果
        sayQ();
        return { name: c.name, ok: true, result, ...(offSeen.length && { watched: true }) };
      }
      emit(ev.toolResult({ id, result: shown('bus_route_eta', followUp), impact: impactFor('bus_route_eta', followUp.data) }));
      await emitAside(svc, emit, aside, { tool: 'bus_route_eta', data: followUp.data, parent: id, walkMin: f.walkMin, lang }); // 行程選了公車：扣掉走到站牌的時間
      // 選了公車、阿幫在盯上車站：回答會問「要我在公車快到站時提醒你嗎？」——規則原本要問的是舒適類的關鍵因子（帶行李、少走路，只是猜）時，
      // 改問這一題（一輪一題，問題跟回答一致；按鈕或直接打「好」由前端設提醒；PM Q-25）。趕時間、省錢（快 5 分、省 50 元以上）、習慣確認、說過的預設狀況、手機提議的題目照舊優先
      const r = q && q.askSource !== 'device' && /^state:(?:luggage|lessWalk)$/.test(q.about || '') && remindAsk(f.args, followUp, lang);
      if (r) q = r;
      sayQ();
      return { name: c.name, ok: true, result, followUp, followWalkMin: f.walkMin, ...(offSeen.length && { watched: true }) };
    } catch (e) {
      const error = publicMessage(e);
      emit(ev.toolResult({ id: c.id, error }));
      return { name: c.name, ok: false, error };
    }
  }));
}

/**
 * 這一輪「等車推短劇」的狀態（ADR-0019）：profile 有 drama 工具包、使用者沒在設定關掉才開；一輪最多一次（done）。
 * @returns {{ on: boolean, done: boolean, turn: number, now: number, pick: Promise<object|null>|null }}
 */
export function asideState(req, profile, now = Date.now(), svc = null) {
  const on = req.userState?.dramaHint !== false && !!profile.packs?.includes('drama');
  const turn = Number.isInteger(req.turn) ? req.turn : (req.messages || []).filter((m) => m.role === 'user').length; // 推哪一部依台灣日期與對話輪次輪替
  // 一開始就並行拿排行（有快取），到站結果出來時劇已經準備好，推劇不拖慢回答
  const pick = on && svc?.drama?.waitPick ? svc.drama.waitPick({ turn, now }).catch(() => null) : null;
  return { on, done: false, turn, now, pick };
}

/** 到站結果之後：等得夠久就在卡片下方推一集短劇（失敗或逾時都不影響交通結果） */
async function emitAside(svc, emit, aside, a) {
  if (!aside?.on || aside.done) return;
  try { const x = await waitDrama(svc, a, aside); if (x) emit(ev.aside(x)); } catch { /* 提示失敗不影響回答 */ }
}

/** 使用者點選的狀態一律交給 plan_trip 計分（Claude／地端模型可能漏帶；示範模式已帶，重複無妨） */
function withPickedPrefs(args, picked, judgedStates) {
  if (!args || typeof args !== 'object' || (!picked.length && !judgedStates)) return args;
  const prefs = args.prefs && typeof args.prefs === 'object' ? args.prefs : {};
  // 有判斷層時，使用者狀態以判斷層為準（實驗：模型自己加的狀態只有 3 成對），不採用模型猜的
  const said = judgedStates ?? (Array.isArray(prefs.states) ? prefs.states : []);
  const states = [...new Set([...said, ...picked])];
  return { ...args, prefs: { ...prefs, states } };
}

/** 習慣只採用手機送來的（模型或規則帶的一律拿掉；手機沒送就不帶） */
export function withHabit(args, habit, car = false) {
  if (!args || typeof args !== 'object') return args;
  const { habit: _model, car: _car, ...prefs } = args.prefs && typeof args.prefs === 'object' ? args.prefs : {};
  const next = { ...prefs, ...(habit && Object.keys(habit).length && { habit }), ...(car && { car: true }) }; // 我有車：只採用手機設定（模型帶的拿掉）
  const { prefs: _p, ...rest } = args;
  return Object.keys(next).length ? { ...rest, prefs: next } : rest;
}

/**
 * 這一輪結束時（不是請定位那一次）在 done 事件帶上手機提議的題目的去向（askCheck：用了／被擋與原因；ADR-0020）。
 * 狀態題要等行程比較完才知道，所以放在最後的 done，不放在一開始的 status。沒有手機題目時原樣送出。
 */
export function withAskCheck(emit, dask) {
  if (!dask) return emit;
  let locating = false;
  return (e) => {
    if (e?.type === 'client_tool_call') locating = true;
    emit(e?.type === 'done' && !locating ? { ...e, askCheck: deviceAskCheck(dask) } : e);
  };
}

/** 對話裡之前的使用者訊息（判斷層看追問用） */
export const priorUserTexts = (messages) => messages.slice(0, -1).filter((m) => m.role === 'user').map((m) => m.content);

/** 判斷層結果給前端看（不含對話內容） */
export const judgeInfo = (j) => (j ? { intent: j.intent, source: j.source, ...(j.engine && { engine: j.engine }), ...(j.confidence != null && { confidence: Math.round(j.confidence * 100) / 100 }), ...(j.followUp && { followUp: true }) } : undefined); // followUp：接著上一輪改（前端長對話不分段）

/**
 * 判斷層的兩段呼叫（快速版先說聽懂了什麼、完整版定案）。帶 deviceJudge 時一起交給判斷層；
 * 伺服器沒有判斷層（JUDGE=off）但手機有判斷時，用規則＋裝置提示。只有生活 agent 用。
 * noModel：這一輪伺服器不呼叫任何 AI 模型（手機寫回答，ADR-0017），完整版直接沿用快速版。
 * @returns {{ quick: () => Promise<object|null>, full: (q0: object|null) => Promise<object|null> } | null}
 */
export function judgeCalls(judge, req, profile, { noModel = false } = {}) {
  if (profile.id !== 'life') return null;
  const device = req.answered ? null : req.deviceJudge; // 打字回答被改寫成完整的一句：手機的判斷是對短答做的，不用
  const J = judge || (device ? createJudge() : null);
  if (!J) return null;
  const last = req.messages.at(-1).content, prior = priorUserTexts(req.messages), opts = device ? { device } : {};
  return {
    quick: () => (J.quick || J)(last, prior, opts).catch(() => null),
    full: (q0) => (J.quick && !noModel ? J(last, prior, opts).catch(() => q0) : Promise.resolve(q0)), // noModel（手機寫回答，ADR-0017）：不呼叫伺服器的判斷模型，快速版（分類器＋規則＋手機判斷）就定案
  };
}

/** 使用者在畫面上點選的狀態（picked）標示來源；plan_trip 已依 prefs 計分，這裡只改標示 */
function withPicked(trip, picked) {
  if (!picked.length) return trip;
  return { ...trip, states: trip.states.map((s) => (s.source === 'user' && picked.includes(s.key) ? { ...s, source: 'picked' } : s)) };
}

/**
 * 示範模式的一輪對話：規則式意圖 → 分段呼叫工具 → 總結。事件格式與模型模式（Claude／地端）相同。
 * @param {object} svc createServices() 的結果
 * @param {object} body /api/v1/agent 的請求（會驗證）
 * @param {(e: object) => void} emit
 * @param {{ profileId?: string, now?: number, notice?: string, mode?: 'demo'|'rules'|'edge' }} [opts] notice：模型額度用完而降級時，在 status 後先說明；mode：rules＝地端模型的英文提問改由規則回答（資料照常是真的，不是示範）；
 *   edge＝回答交給手機寫（ADR-0017）：最後送 answer_draft（程式版總結＋事實清單）而不是 text
 */
export async function runDemo(svc, body, emit0, { profileId = 'life', now = Date.now(), notice, judge, mode = 'demo' } = {}) {
  const req = validateRequest(body);
  const profile = getProfile(profileId);
  const edgeWrite = mode === 'edge' && wantsEdgeWrite(req, profile.id);
  if (mode === 'edge' && !edgeWrite) mode = 'demo';
  const picked = req.userState?.picked || [];
  let n = 0;
  const nextId = () => `t${++n}`;
  const plan = PLANNERS[profile.id] || PLANNERS.life;
  const last = req.messages.at(-1).content;
  let it = plan.parse(last, { history: req.messages.slice(0, -1), saved: req.savedPlaces, now });
  // 手機上的 AI 提議的題目（ADR-0020）：形狀先檢查，之後在問的時機驗證；結束時 done 帶 askCheck（用了／被擋與原因）
  const dask = profile.id === 'life' ? deviceAskTracker(req.deviceJudge?.ask, it.lang === 'en' ? 'en' : 'zh') : null;
  const emit = withAskCheck(emit0, dask);
  // 判斷層（judge.js）：先用快速版（A＋規則，幾毫秒）說聽懂了什麼，再用完整版（含模型）定案意圖與狀態
  const jc = judgeCalls(judge, req, profile, { noModel: edgeWrite });
  const q0 = jc ? await jc.quick() : null;
  emit(ev.status({ mode, profile: profile.id, judge: judgeInfo(q0), lang: isEnglish(last) ? 'en' : 'zh' }));
  // 安全情境（S18）：提到自傷或正在發生的緊急狀況 → 先給求助電話，不查交通（所有 agent 都一樣）
  const safe = safetyCheck(last, { profileId: profile.id }); // 安全情境在請定位之前就回答，不會有帶定位的重送
  const trial = edgeWrite && isTrial(req, profile.id) && !req.clientToolResults?.length; // 試判斷：帶定位結果的重送不再送一次
  if (safe) { if (trial) emit(ev.trial(trialInfo(svc, it, { judge: q0, lang: isEnglish(last) ? 'en' : 'zh', now, safety: safe.kind }))); emit(ev.guardrail({ tier: 'L0', rule: `safety:${safe.kind}`, calls: safe.calls })); emit(ev.text(safe.reply)); emit(ev.done()); return; }
  if (!req.clientToolResults?.length && it.reset) emit(ev.contextReset());
  if (notice) emit(ev.agentNote(it.lang === 'en' ? "Today's AI quota is used up; answering in demo mode" : notice));
  // 帶定位結果重送的是同一輪（客戶端接在同一個討論串）：「聽懂了什麼」上一次已經說過，不重複
  const heard = !req.clientToolResults?.length && !it.needs && (contextNote(parseIntent(last, { history: req.messages.slice(0, -1) })) || (it.intent === 'outing' ? outingNote([...(it.states || []), ...(q0?.states || [])]) : q0 && judgeNote(q0)));
  if (heard && it.lang !== 'en') emit(ev.agentNote(heard)); // 「聽懂了」的句子是中文：英文那一輪不說
  // 缺必要欄位（哪一路公車、要去哪裡）：先問，不查資料、不請定位（「該問就問、不要自己猜」，ADR-0016）。
  // 快速版判斷同意（或沒有判斷層）就不再呼叫完整版的判斷模型；判斷層說是別的意圖時交給下面重判（可以更正規則）
  let trialSent = false;
  const askGap = (judged) => {
    const rule = profile.id === 'life' && slotAsk(it, { lang: it.lang, history: req.messages.slice(0, -1) });
    if (!rule) return false;
    const g = deviceSlotAsk(dask, rule.ask.about.replace(/^slot:/, ''), rule, { history: req.messages.slice(0, -1), context: req.context }) || rule; // 手機的題目通過驗證就用它，否則照規則（保底）
    if (trial && !trialSent) { trialSent = true; emit(ev.trial(trialInfo(svc, it, { judge: judged, lang: it.lang === 'en' ? 'en' : 'zh', now }))); }
    emit(ev.ask({ id: `ask-${nextId()}`, ...g.ask })); emit(ev.text(g.short)); emit(ev.done());
    return true;
  };
  if (it.needs && (!q0 || q0.intent === it.intent) && askGap(q0)) return;
  const j = jc ? await jc.full(q0) : null;
  if (j) {
    // 出門建議是天氣＋空品的組合：判斷層說天氣或空品時保留（判斷層沒有 outing 這個意圖）；找短劇也是（判斷層沒有 drama，規則的關鍵字很明確）
    const byModel = (j.source === 'device' || j.source === 'llm') && j.intent !== 'unknown'; // 模型說聽不懂不算更正
    const keep = it.followUp || it.intent === 'outing' || it.intent === 'drama' || it.also?.length || (it.intent === 'metro' && (it.station || it.system || it.last)) || (it.intent === 'traffic' && !byModel) || (it.intent === 'bus_route' && it.last) || it.nearRail || it.thanks || it.sorry || RULE_FINAL.some((k) => it[k]) || (it.airport && j.intent === 'unknown') || (!Object.hasOwn(JUDGE_INTENTS, it.intent) && !(it.pasted && byModel)); // 路況、貼上的簡訊：模型（手機或伺服器）判斷不同時可以更正（PR #127 審查） // 判斷層沒有的意圖（防詐請到防詐頁、代按代付、電梯）判斷層無從更正：歧義、路名、只說類別、要出門了、沒說去哪的高鐵、公車方向、問中獎——規則已經很明確 // 說了站名的捷運（「捷運西門站下一般」被判成行程，P5-5 模型模式）、去最近的火車站、禮貌話：規則已經很明確 // 判斷層常把「出門要注意什麼」判成空品或行程（設計審查實測）；一句問好幾件事以規則分段為準（P5-8）
    if (j.intent !== it.intent && !keep && !it.savedTrip && it.intent !== 'savedMissing') it = parseIntent(last, { history: req.messages.slice(0, -1), intent: j.intent, saved: req.savedPlaces, now }) || it;
    it.states = j.states;
    const more = !req.clientToolResults?.length && moreStatesNote(q0, j);
    if (more && it.lang !== 'en') emit(ev.agentNote(more));
  }
  if (askGap(j || q0)) return; // 判斷層重判後才缺欄位（例：手機判斷是行程、句子只說了起點）
  if (trial && !trialSent) emit(ev.trial(trialInfo(svc, it, { judge: j || q0, lang: it.lang === 'en' ? 'en' : 'zh', now }))); // 資料夠不夠、會查哪些資料（程式算，不經模型）
  // 需要使用者位置（M5-07）：客戶端支援 device_location 時先請它定位，拿到結果後客戶端帶 clientToolResults 重送
  // 「桃園到台北101」的「桃園」可能是高鐵站或火車站：有定位才知道人是不是就在桃園市區（localStations，z11）
  const localPick = profile.id === 'life' && hasShortStation(it, last);
  if ((plan.needsLocation(it) || localPick) && req.clientTools?.includes('device_location')) {
    const loc = deviceLocation(req);
    if (loc === undefined) {
      emit(ev.agentNote(it.lang === 'en' ? '@定位 checking where you are' : '@定位 先看看你在哪裡'));
      emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: 'device_location' }));
      emit(ev.done());
      return;
    }
    if (loc) { it.fromPoint = loc; localStations(it, last, loc); } // 拒絕定位或無效時，照示範預設起點（總結會說明）；「桃園」人在桃園市區＝桃園車站（z11）
    else it.noLocation = true; // 總結說「沒拿到你的位置」（不是「你沒說」）
  }
  if (it.metroTo && !it.toSaved) { const p = await metroPoint(svc, it.metroTo, it.fromPoint); if (p) { it.toSaved = p; it.to = p.name; } } // 「去大安站」：捷運站的座標
  // 沒有位置、預設起點又就在目的地旁邊（< 300 公尺；去最近的火車站也是從預設起點找，一樣會是同一站）：不算「臺北車站到臺北車站」，問從哪裡出發。
  // 上一輪已經問過、這一輪定位又失敗（按了「用我的位置」但拿不到）：不再給「用我的位置」，避免一直重複
  if (profile.id === 'life' && it.intent === 'trip' && !it.from && !it.fromSaved && !it.fromPoint && (it.nearRail || nearDefaultFrom(it.toSaved || it.to))) {
    const again = ORIGIN_ASKED.test(String(req.messages.slice(0, -1).filter((m) => m.role === 'assistant').at(-1)?.content || ''));
    const rule = originAsk(it.nearRail ? null : it.toSaved?.name || it.to, it.lang, { again, nearRail: it.nearRail });
    const o = deviceSlotAsk(dask, 'from', rule, { again, history: req.messages.slice(0, -1), context: req.context }) || rule;
    if (o.ask) emit(ev.ask({ id: `ask-${nextId()}`, ...o.ask }));
    emit(ev.text(o.short)); emit(ev.done()); return;
  }
  // 該問就問（PM 的 Q 情境，core/agent/clarify-plan.js）：stop＝不查、只問；after＝先用猜的查，查完再問（選項第一個標「猜的」）
  const history = req.messages.slice(0, -1);
  const sayAsk = (rule) => { // 手機上的 AI 提議同一種題目、通過驗證就用它（ADR-0020），否則照規則
    const slot = /^slot:/.test(rule.ask.about || '') ? rule.ask.about.slice(5) : null;
    const g = (slot && deviceSlotAsk(dask, slot, rule, { history, context: req.context })) || rule;
    emit(ev.ask({ id: `ask-${nextId()}`, ...g.ask }));
  };
  const cl = planAsk(it, { profileId: profile.id, history, text: last });
  if (cl?.stop) { sayAsk(cl.stop); emit(ev.text(cl.stop.short)); emit(ev.done()); return; }
  // 使用者點選的狀態一併交給 plan_trip 計分
  if (picked.length && it.states) it.states = [...new Set([...it.states, ...picked])];
  const results = {};
  const used = [];
  let rounds = 0;
  const ask = { done: !!cl?.after && it.intent === 'trip', habitAsk: req.userState?.habitAsk, usual: req.userState?.usual, device: dask }; // 阿幫問你：這一輪最多一個（device：手機提議的狀態題；先查並問的那一題先預留）
  const aside = asideState(req, profile, now, svc); // 等車推短劇：這一輪最多一次（排行先並行拿）
  for (const step of plan.steps(it, now)) {
    if (++rounds > MAX_TOOL_ROUNDS) break;
    const s = step(results);
    if (!s) break;
    emit(ev.agentNote(it.lang === 'en' ? enNote(s.note) : s.note)); // 英文提問：說明用英文（S12c）
    const out = await execTools(svc, s.calls, emit, { profile, nextId, picked, lang: it.lang, habit: req.userState?.habit, car: req.userState?.car === true, ask, now, aside });
    for (const o of out) {
      used.push(o.name);
      if (o.ok) (results[o.name] ||= []).push(o.result);
      if (o.followUp) { used.push('bus_route_eta'); (results.bus_route_eta ||= []).push(o.followUp); } else if (o.watched) used.push('bus_route_eta'); // watched：盯過推薦的公車、今天不會來而重排（結果不放進 results，總結不會說成「選公車」）
    }
    if (out.some((o) => !o.ok && !AUX_TOOLS.has(o.name))) break; // 主要的一步失敗就不往下，總結會說明；天氣、空品、路況是輔助資料，失敗照樣往下（三峽→台北101 路況 404 時不能因此不排行程）
  }
  if (used.length) emit(ev.discussionEnd({ tools: [...new Set(used)] }));
  if (cl?.after) { const r = cl.after(results); if (r) sayAsk(r); } // 先查並問：查完才問（選項第一個是剛剛用的那個）
  // 手機寫回答的那一輪聽不懂（ADR-0017：不退回伺服器模型）：問一句給幾個查得到的選項，回答只留一句短的
  const lost = edgeWrite && it.intent === 'unknown' && !it.thanks && !it.sorry && !it.reset && !it.ack && !ask.done;
  if (lost) { ask.done = true; emit(ev.ask({ id: `ask-${nextId()}`, ...unknownAsk(it.lang) })); } // 一輪最多一個問題
  const summary = lost ? UNKNOWN_SHORT[it.lang === 'en' ? 'en' : 'zh'] : guardedText(profile, plan.summary(it, results, profile.suggestions), emit);
  // 畫面靠固定字串放按鈕的回答（還沒設定常用地點：「設定與隱私 → 常用地點」）不交給手機改寫
  if (edgeWrite && it.intent !== 'savedMissing') { // 手機改寫；程式版總結與事實清單都只來自這一輪的資料（不含座標）
    const lang = it.lang === 'en' ? 'en' : 'zh';
    emit(ev.answerDraft({ text: summary, facts: answerFacts(it, results, { lang }), lang }));
  } else emit(ev.text(summary));
  emit(ev.done());
}
