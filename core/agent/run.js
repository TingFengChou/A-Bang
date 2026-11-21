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
import { parseIntent, demoSteps, demoSummary, needsLocation, contextNote, isEnglish } from './demo-intent.js';
import { parseAntifraud, antifraudSteps, antifraudSummary } from './demo-antifraud.js';
import { applyOutputGuardrails } from './guardrails.js';
import { impactOf, judgeNote, outingNote, moreStatesNote } from './impact.js';
import { createJudge, JUDGE_INTENTS, JUDGE_STATES, DEVICE_ENGINES } from './judge.js';

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

export const MAX_MESSAGES = 10;
export const MAX_CHARS = 500;
export const MAX_TOOL_ROUNDS = 5;
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
  userState: z.object({ picked: z.array(z.enum(Object.keys(STATES))).max(6).optional() }).optional(),
  clientTools: z.array(z.string()).max(10).optional(),
  clientToolResults: z.array(z.object({ id: z.string(), ok: z.boolean(), result: z.any().optional() })).max(10).optional(),
  context: z.string().max(200).optional(),
  // 常用地點（S1）：存在手機，只在使用者提到時送（「回家」→ 家）；台灣範圍內的座標
  savedPlaces: z.partialRecord(z.enum(['家', '公司', '學校']), z.object({ name: z.string().trim().min(1).max(40), lat: z.number().min(21).max(27), lon: z.number().min(118).max(123) })).optional(),
  // 手機上的模型先判斷好的意圖與狀態（ADR-0014）：只是提示，列舉值以外一律拒絕；方案排序仍由 decide.js 計分
  deviceJudge: z.object({ intent: z.enum(Object.keys(JUDGE_INTENTS)), states: z.array(z.enum(JUDGE_STATES)).max(JUDGE_STATES.length), engine: z.enum(DEVICE_ENGINES) }).optional(),
});

/** 驗證 /api/v1/agent 請求；錯誤丟 UserError（繁體中文、可行動） */
export function validateRequest(body) {
  const r = RequestSchema.safeParse(body ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    throw new UserError(`請求格式錯誤：${i.path.join('.') || '內容'}（${i.message}）；訊息最多 ${MAX_CHARS} 字、最多 ${MAX_MESSAGES} 則`);
  }
  if (r.data.messages.at(-1).role !== 'user') throw new UserError('最後一則訊息必須是使用者的提問');
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

/**
 * 執行一批 tool 呼叫（平行）：先送全部 tool_start，再依完成順序送 tool_result；plan_trip 成功時接著送 decision。
 * 只允許 profile 白名單內的 tool。plan_trip 選了公車時，接著自動查上車站的即時到站（`followUp`，事件照常送出）。
 * @param {object} svc
 * @param {Array<{ name: string, args: object }>} calls
 * @param {(e: object) => void} emit
 * @param {{ profile: object, nextId: () => string, picked?: string[] }} opts
 * @returns {Promise<Array<{ name: string, ok: boolean, result?: object, error?: string, followUp?: object }>>} 依 calls 順序
 */
export async function execTools(svc, calls, emit, { profile, nextId, picked = [], judgedStates, lang = null }) {
  const started = calls.map((c) => ({ ...c, id: nextId() }));
  // 英文提問（S12d）：小幫手的一句話用英文版；「→ 影響」是中文，英文那一輪不附
  const en = lang === 'en';
  const shown = (name, r) => (en ? { ...r, speak: speakEn(name, r.data, r.args) ?? r.speak } : r);
  const impactFor = (name, data) => (en ? impactEn(name, data) ?? undefined : impactOf(name, data)); // 英文：只留要馬上注意的（YouBike 車位、公車趕不趕得上）
  for (const c of started) emit(ev.toolStart({ id: c.id, name: c.name, input: c.args }));
  return Promise.all(started.map(async (c) => {
    try {
      if (!profile.tools.includes(c.name)) throw new UserError(`這個 agent 不能使用 ${c.name}`);
      const result = await callTool(svc, c.name, c.name === 'plan_trip' ? withPickedPrefs(c.args, picked, judgedStates) : c.args);
      // 行程比較內部查的天氣、空品、路況：各出一行「資料＋影響」（程式產生；排在行程的結論前面）
      if (c.name === 'plan_trip') for (const item of result.data?.considered || []) emit(ev.dataNote({ parent: c.id, item, lang }));
      emit(ev.toolResult({ id: c.id, result: shown(c.name, result), impact: impactFor(c.name, result.data) }));
      if (c.name !== 'plan_trip') return { name: c.name, ok: true, result };
      emit(ev.decision(withPicked(result.data, picked)));
      const f = busFollowUp(result.data);
      if (!f || !profile.tools.includes('bus_route_eta')) return { name: c.name, ok: true, result };
      emit(ev.agentNote(en ? enNote(f.note) : f.note));
      const id = nextId();
      emit(ev.toolStart({ id, name: 'bus_route_eta', input: f.args }));
      try {
        const followUp = await callTool(svc, 'bus_route_eta', f.args);
        emit(ev.toolResult({ id, result: shown('bus_route_eta', followUp), impact: impactFor('bus_route_eta', followUp.data) }));
        return { name: c.name, ok: true, result, followUp, followWalkMin: f.walkMin };
      } catch (e) {
        emit(ev.toolResult({ id, error: publicMessage(e) })); // 盯不到不影響行程結果
        return { name: c.name, ok: true, result };
      }
    } catch (e) {
      const error = publicMessage(e);
      emit(ev.toolResult({ id: c.id, error }));
      return { name: c.name, ok: false, error };
    }
  }));
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

/** 對話裡之前的使用者訊息（判斷層看追問用） */
export const priorUserTexts = (messages) => messages.slice(0, -1).filter((m) => m.role === 'user').map((m) => m.content);

/** 判斷層結果給前端看（不含對話內容） */
export const judgeInfo = (j) => (j ? { intent: j.intent, source: j.source, ...(j.engine && { engine: j.engine }), ...(j.confidence != null && { confidence: Math.round(j.confidence * 100) / 100 }) } : undefined);

/**
 * 判斷層的兩段呼叫（快速版先說聽懂了什麼、完整版定案）。帶 deviceJudge 時一起交給判斷層；
 * 伺服器沒有判斷層（JUDGE=off）但手機有判斷時，用規則＋裝置提示。只有生活 agent 用。
 * @returns {{ quick: () => Promise<object|null>, full: (q0: object|null) => Promise<object|null> } | null}
 */
export function judgeCalls(judge, req, profile) {
  if (profile.id !== 'life') return null;
  const device = req.deviceJudge;
  const J = judge || (device ? createJudge() : null);
  if (!J) return null;
  const last = req.messages.at(-1).content, prior = priorUserTexts(req.messages), opts = device ? { device } : {};
  return {
    quick: () => (J.quick || J)(last, prior, opts).catch(() => null),
    full: (q0) => (J.quick ? J(last, prior, opts).catch(() => q0) : Promise.resolve(q0)),
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
 * @param {{ profileId?: string, now?: number, notice?: string, mode?: 'demo'|'rules' }} [opts] notice：模型額度用完而降級時，在 status 後先說明；mode：rules＝地端模型的英文提問改由規則回答（資料照常是真的，不是示範）
 */
export async function runDemo(svc, body, emit, { profileId = 'life', now = Date.now(), notice, judge, mode = 'demo' } = {}) {
  const req = validateRequest(body);
  const profile = getProfile(profileId);
  const picked = req.userState?.picked || [];
  let n = 0;
  const nextId = () => `t${++n}`;
  const plan = PLANNERS[profile.id] || PLANNERS.life;
  const last = req.messages.at(-1).content;
  let it = plan.parse(last, { history: req.messages.slice(0, -1), saved: req.savedPlaces, now });
  // 判斷層（judge.js）：先用快速版（A＋規則，幾毫秒）說聽懂了什麼，再用完整版（含模型）定案意圖與狀態
  const jc = judgeCalls(judge, req, profile);
  const q0 = jc ? await jc.quick() : null;
  emit(ev.status({ mode, profile: profile.id, judge: judgeInfo(q0), lang: isEnglish(last) ? 'en' : 'zh' }));
  // 安全情境（S18）：提到自傷或正在發生的緊急狀況 → 先給求助電話，不查交通（所有 agent 都一樣）
  const safe = safetyCheck(last, { profileId: profile.id }); // 安全情境在請定位之前就回答，不會有帶定位的重送
  if (safe) { emit(ev.guardrail({ tier: 'L0', rule: `safety:${safe.kind}`, calls: safe.calls })); emit(ev.text(safe.reply)); emit(ev.done()); return; }
  if (!req.clientToolResults?.length && it.reset) emit(ev.contextReset());
  if (notice) emit(ev.agentNote(it.lang === 'en' ? "Today's AI quota is used up; answering in demo mode" : notice));
  // 帶定位結果重送的是同一輪（客戶端接在同一個討論串）：「聽懂了什麼」上一次已經說過，不重複
  const heard = !req.clientToolResults?.length && (contextNote(parseIntent(last, { history: req.messages.slice(0, -1) })) || (it.intent === 'outing' ? outingNote([...(it.states || []), ...(q0?.states || [])]) : q0 && judgeNote(q0)));
  if (heard && it.lang !== 'en') emit(ev.agentNote(heard)); // 「聽懂了」的句子是中文：英文那一輪不說
  const j = jc ? await jc.full(q0) : null;
  if (j) {
    // 出門建議是天氣＋空品的組合：判斷層說天氣或空品時保留（判斷層沒有 outing 這個意圖）
    const keep = it.followUp || it.intent === 'outing' || it.also?.length || (it.intent === 'metro' && it.station) || it.nearRail || it.thanks || it.sorry; // 說了站名的捷運（「捷運西門站下一般」被判成行程，P5-5 模型模式）、去最近的火車站、禮貌話：規則已經很明確 // 判斷層常把「出門要注意什麼」判成空品或行程（設計審查實測）；一句問好幾件事以規則分段為準（P5-8）
    if (j.intent !== it.intent && !keep && !it.savedTrip && it.intent !== 'savedMissing') it = parseIntent(last, { history: req.messages.slice(0, -1), intent: j.intent, saved: req.savedPlaces, now }) || it;
    it.states = j.states;
    const more = !req.clientToolResults?.length && moreStatesNote(q0, j);
    if (more && it.lang !== 'en') emit(ev.agentNote(more));
  }
  // 需要使用者位置（M5-07）：客戶端支援 device_location 時先請它定位，拿到結果後客戶端帶 clientToolResults 重送
  if (plan.needsLocation(it) && req.clientTools?.includes('device_location')) {
    const loc = deviceLocation(req);
    if (loc === undefined) {
      emit(ev.agentNote(it.lang === 'en' ? '@定位 checking where you are' : '@定位 先看看你在哪裡'));
      emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: 'device_location' }));
      emit(ev.done());
      return;
    }
    if (loc) it.fromPoint = loc; // 拒絕定位或無效時，照示範預設起點（總結會說明）
    else it.noLocation = true; // 總結說「沒拿到你的位置」（不是「你沒說」）
  }
  // 使用者點選的狀態一併交給 plan_trip 計分
  if (picked.length && it.states) it.states = [...new Set([...it.states, ...picked])];
  const results = {};
  const used = [];
  let rounds = 0;
  for (const step of plan.steps(it, now)) {
    if (++rounds > MAX_TOOL_ROUNDS) break;
    const s = step(results);
    if (!s) break;
    emit(ev.agentNote(it.lang === 'en' ? enNote(s.note) : s.note)); // 英文提問：說明用英文（S12c）
    const out = await execTools(svc, s.calls, emit, { profile, nextId, picked, lang: it.lang });
    for (const o of out) {
      used.push(o.name);
      if (o.ok) (results[o.name] ||= []).push(o.result);
      if (o.followUp) { used.push('bus_route_eta'); (results.bus_route_eta ||= []).push(o.followUp); }
    }
    if (out.some((o) => !o.ok)) break; // 有一步失敗就不往下，總結會說明
  }
  if (used.length) emit(ev.discussionEnd({ tools: [...new Set(used)] }));
  emit(ev.text(guardedText(profile, plan.summary(it, results, profile.suggestions), emit)));
  emit(ev.done());
}
