// Agent 共用執行器（M5-04，AGENT.md §2–§3）：呼叫 tool → tool_start／tool_result；plan_trip 時發 decision。
// 示範模式（demo-intent）與 Claude 模式（M5-05）共用 execTools，事件流相同。不加假延遲（ADR-0009）。
import { z } from 'zod';
import { callTool } from '../tools/index.js';
import { UserError, publicMessage } from '../util.js';
import { ev } from './events.js';
import { getProfile } from '../agents/index.js';
import { parseIntent, demoSteps, demoSummary } from './demo-intent.js';
import { STATES } from '../decide.js';

export const MAX_MESSAGES = 10;
export const MAX_CHARS = 500;
export const MAX_TOOL_ROUNDS = 5;

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
      const result = await callTool(svc, c.name, c.args);
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

/** 使用者在畫面上點選的狀態（picked）標示來源；plan_trip 已依 prefs 計分，這裡只改標示 */
function withPicked(trip, picked) {
  if (!picked.length) return trip;
  return { ...trip, states: trip.states.map((s) => (s.source === 'user' && picked.includes(s.key) ? { ...s, source: 'picked' } : s)) };
}

/**
 * 示範模式的一輪對話：規則式意圖 → 分段呼叫工具 → 總結。事件格式與 Claude 模式相同。
 * @param {object} svc createServices() 的結果
 * @param {object} body /api/v1/agent 的請求（會驗證）
 * @param {(e: object) => void} emit
 * @param {{ profileId?: string, now?: number }} [opts]
 */
export async function runDemo(svc, body, emit, { profileId = 'life', now = Date.now() } = {}) {
  const req = validateRequest(body);
  const profile = getProfile(profileId);
  const picked = req.userState?.picked || [];
  let n = 0;
  const nextId = () => `t${++n}`;
  emit(ev.status({ mode: 'demo', profile: profile.id }));

  const it = parseIntent(req.messages.at(-1).content);
  // 使用者點選的狀態一併交給 plan_trip 計分
  if (picked.length) it.states = [...new Set([...it.states, ...picked])];
  const results = {};
  const used = [];
  let rounds = 0;
  for (const step of demoSteps(it, now)) {
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
  emit(ev.text(demoSummary(it, results, profile.suggestions)));
  emit(ev.done());
}
