// Agent 共用執行器（M5-04，AGENT.md §2–§3）：呼叫 tool → tool_start／tool_result；plan_trip 時發 decision。
// 示範模式（demo-intent）與模型模式（model-loop.js：Claude／地端，M5-05）共用 execTools，事件流相同。不加假延遲（ADR-0009）。
import { z } from 'zod';
import { callTool } from '../tools/index.js';
import { UserError, publicMessage } from '../util.js';
import { ev } from './events.js';
import { getProfile } from '../agents/index.js';
import { parseIntent, demoSteps, demoSummary, needsLocation } from './demo-intent.js';
import { parseAntifraud, antifraudSteps, antifraudSummary } from './demo-antifraud.js';
import { applyOutputGuardrails } from './guardrails.js';

/** 示範模式的規則式規劃（依 agent）：parse → steps → summary；needsLocation 只有生活 agent 用 */
const PLANNERS = {
  life: { parse: parseIntent, steps: demoSteps, summary: demoSummary, needsLocation },
  antifraud: { parse: parseAntifraud, steps: antifraudSteps, summary: antifraudSummary, needsLocation: () => false },
};

/** 最後的文字經輸出護欄（L2）：有改寫時先送 guardrail 事件 */
export function guardedText(profile, text, emit) {
  const g = applyOutputGuardrails(profile, text);
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
 * 執行一批 tool 呼叫（平行）：先送全部 tool_start，再依完成順序送 tool_result；plan_trip 成功時接著送 decision。
 * 只允許 profile 白名單內的 tool。
 * @param {object} svc
 * @param {Array<{ name: string, args: object }>} calls
 * @param {(e: object) => void} emit
 * @param {{ profile: object, nextId: () => string, picked?: string[] }} opts
 * @returns {Promise<Array<{ name: string, ok: boolean, result?: object, error?: string }>>} 依 calls 順序
 */
export async function execTools(svc, calls, emit, { profile, nextId, picked = [] }) {
  const started = calls.map((c) => ({ ...c, id: nextId() }));
  for (const c of started) emit(ev.toolStart({ id: c.id, name: c.name, input: c.args }));
  return Promise.all(started.map(async (c) => {
    try {
      if (!profile.tools.includes(c.name)) throw new UserError(`這個 agent 不能使用 ${c.name}`);
      const result = await callTool(svc, c.name, c.name === 'plan_trip' ? withPickedPrefs(c.args, picked) : c.args);
      emit(ev.toolResult({ id: c.id, result }));
      if (c.name === 'plan_trip') emit(ev.decision(withPicked(result.data, picked)));
      return { name: c.name, ok: true, result };
    } catch (e) {
      const error = publicMessage(e);
      emit(ev.toolResult({ id: c.id, error }));
      return { name: c.name, ok: false, error };
    }
  }));
}

/** 使用者點選的狀態一律交給 plan_trip 計分（Claude／地端模型可能漏帶；示範模式已帶，重複無妨） */
function withPickedPrefs(args, picked) {
  if (!picked.length || !args || typeof args !== 'object') return args;
  const prefs = args.prefs && typeof args.prefs === 'object' ? args.prefs : {};
  const states = [...new Set([...(Array.isArray(prefs.states) ? prefs.states : []), ...picked])];
  return { ...args, prefs: { ...prefs, states } };
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
 * @param {{ profileId?: string, now?: number, notice?: string }} [opts] notice：模型額度用完而降級時，在 status 後先說明
 */
export async function runDemo(svc, body, emit, { profileId = 'life', now = Date.now(), notice } = {}) {
  const req = validateRequest(body);
  const profile = getProfile(profileId);
  const picked = req.userState?.picked || [];
  let n = 0;
  const nextId = () => `t${++n}`;
  emit(ev.status({ mode: 'demo', profile: profile.id }));
  if (notice) emit(ev.agentNote(notice));

  const plan = PLANNERS[profile.id] || PLANNERS.life;
  const it = plan.parse(req.messages.at(-1).content);
  // 需要使用者位置（M5-07）：客戶端支援 device_location 時先請它定位，拿到結果後客戶端帶 clientToolResults 重送
  if (plan.needsLocation(it) && req.clientTools?.includes('device_location')) {
    const loc = deviceLocation(req);
    if (loc === undefined) {
      emit(ev.agentNote('@定位 先看看你在哪裡'));
      emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: 'device_location' }));
      emit(ev.done());
      return;
    }
    if (loc) it.fromPoint = loc; // 拒絕定位或無效時，照示範預設起點（總結會說明）
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
    emit(ev.agentNote(s.note));
    const out = await execTools(svc, s.calls, emit, { profile, nextId, picked });
    for (const o of out) {
      used.push(o.name);
      if (o.ok) (results[o.name] ||= []).push(o.result);
    }
    if (out.some((o) => !o.ok)) break; // 有一步失敗就不往下，總結會說明
  }
  if (used.length) emit(ev.discussionEnd({ tools: [...new Set(used)] }));
  emit(ev.text(guardedText(profile, plan.summary(it, results, profile.suggestions), emit)));
  emit(ev.done());
}
