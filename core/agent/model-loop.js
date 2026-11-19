// 模型模式的一輪對話（M5-05，AGENT.md §4、ADR-0012）：Claude 與地端模型共用。
// 模型在呼叫工具前的文字 → agent_note；沒有工具呼叫的那輪文字 → text；工具一律走 execTools（與示範模式相同的事件）。
import { describeTool, getTool } from '../tools/index.js';
import { getProfile } from '../agents/index.js';
import { buildSystemPrompt } from './prompt.js';
import { ev } from './events.js';
import { validateRequest, execTools, deviceLocation, guardedText, LOCATION_CALL_ID, MAX_TOOL_ROUNDS } from './run.js';

/**
 * @typedef {{ name: string, description: string, schema: object }} ToolDef
 * @typedef {{ id: string, name: string, input: object, bad?: string }} ModelCall bad：參數不是有效 JSON（原字串）
 * @typedef {{ text: string, calls: ModelCall[], stop: 'end'|'tool'|'max_tokens'|'refusal'|'other', usage: { input: number, output: number } }} ModelTurn
 * @typedef {{ id: string, content: string, isError?: boolean }} ToolResultMsg
 * @typedef {{ mode: 'claude'|'local', model: string,
 *   start(o: { system: string, tools: ToolDef[], messages: Array<{ role: string, content: string }> }):
 *     { next(): Promise<ModelTurn>, addResults(turn: ModelTurn, results: ToolResultMsg[]): void } }} Provider
 */

/** 裝置端工具（ADR-0008）：客戶端支援時才提供給模型 */
export const DEVICE_LOCATION_TOOL = {
  name: 'device_location',
  description: '取得使用者裝置目前的位置（緯度、經度）。只在需要使用者所在位置、而使用者沒說起點或所在地時使用。',
  schema: { type: 'object', properties: {}, additionalProperties: false },
};

export const FALLBACK = {
  rounds: '我查了好幾輪資料，結果都在上面的卡片；想再縮小範圍可以換個問法。',
  truncated: '回答太長被截斷了，換個簡短一點的問法試試看。',
  refusal: '這個問題我沒辦法協助；我可以幫你查公車、捷運、台鐵、高鐵、YouBike，或規劃從 A 到 B 怎麼去。',
  empty: '查好了，結果在上面的卡片。',
  noLocation: '使用者沒有提供位置。請改問使用者從哪裡出發（或人在哪裡），不要猜。',
};

/** 有卡片的工具，回給模型的清單最多幾筆（完整結果已在卡片上） */
export const MODEL_LIST_MAX = 6;
const ITEM = /^\s*-\s/;

/**
 * 回填給模型的工具結果文字（AGENT.md §4）：有卡片的工具，清單只留前幾筆並註明「已用卡片顯示」，
 * 讓模型只講重點、不逐條重抄（地端小模型尤其會照抄，回答又長又慢）。沒有卡片的工具照原文。
 * @param {{ text?: string, speak?: string|null, card?: string|null }} result callTool() 的結果
 */
export function modelText(result) {
  const text = result.text || result.speak || FALLBACK.empty;
  if (!result.card || !result.text) return text;
  const lines = text.split('\n');
  const total = lines.filter((l) => ITEM.test(l)).length;
  if (total <= MODEL_LIST_MAX) return `${text}\n（以上已用卡片顯示給使用者；回答只講重點，不要逐條重複）`;
  let kept = 0;
  const out = lines.filter((l) => !ITEM.test(l) || kept++ < MODEL_LIST_MAX);
  return [result.speak, ...out, `…（共 ${total} 筆，這裡只列前 ${MODEL_LIST_MAX} 筆；完整清單已用卡片顯示給使用者，回答不要逐條列出）`].filter(Boolean).join('\n');
}

/** 模型常把沒填的選填欄位送成 null 或空字串（尤其地端小模型）；一律視為沒給，交給 zod 用預設值 */
export function dropNulls(v) {
  const blank = (x) => x === null || (typeof x === 'string' && !x.trim());
  if (Array.isArray(v)) return v.filter((x) => !blank(x)).map(dropNulls);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => !blank(x)).map(([k, x]) => [k, dropNulls(x)]));
  return v;
}

/** profile 的工具 → 模型看的工具定義（registry 產生，ADR-0002） */
export function toolDefs(profile, { deviceLocation: withLocation = false } = {}) {
  const defs = profile.tools.map((n) => {
    const d = describeTool(getTool(n));
    const { $schema, ...schema } = d.inputSchema; // eslint-disable-line no-unused-vars
    return { name: d.name, description: `${d.title}：${d.description}`, schema };
  });
  return withLocation ? [...defs, DEVICE_LOCATION_TOOL] : defs;
}

/**
 * @param {object} svc createServices() 的結果
 * @param {object} body /api/v1/agent 的請求（會驗證）
 * @param {(e: object) => void} emit
 * @param {{ provider: Provider, profileId?: string, now?: number, onModelCall?: () => void }} opts
 */
export async function runModel(svc, body, emit, { provider, profileId = 'life', now = Date.now(), onModelCall = () => {} }) {
  const req = validateRequest(body);
  const profile = getProfile(profileId);
  const picked = req.userState?.picked || [];
  const canLocate = !!req.clientTools?.includes(DEVICE_LOCATION_TOOL.name);
  emit(ev.status({ mode: provider.mode, model: provider.model, profile: profile.id }));

  const conv = provider.start({
    system: buildSystemPrompt(profile, { now, context: req.context, picked }),
    tools: toolDefs(profile, { deviceLocation: canLocate }),
    messages: req.messages,
  });
  let n = 0;
  const nextId = () => `t${++n}`;
  const used = new Set();
  const usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const finish = (text) => {
    if (used.size) emit(ev.discussionEnd({ tools: [...used] }));
    emit(ev.text(guardedText(profile, text, emit))); // L2 輸出護欄（防詐：不保證安全、固定附 165）
    emit(ev.done(usage));
  };

  for (let round = 0; ; round++) {
    onModelCall();
    const turn = await conv.next();
    usage.modelCalls++;
    usage.inputTokens += turn.usage.input;
    usage.outputTokens += turn.usage.output;
    const text = turn.text.trim();
    if (turn.stop === 'refusal') return finish(FALLBACK.refusal);
    if (!turn.calls.length) {
      if (turn.stop === 'max_tokens') return finish(text ? `${text}…（${FALLBACK.truncated}）` : FALLBACK.truncated);
      return finish(text || FALLBACK.empty);
    }
    if (turn.stop === 'max_tokens') return finish(FALLBACK.truncated); // 工具參數可能被截斷，不執行
    if (round >= MAX_TOOL_ROUNDS) return finish(FALLBACK.rounds); // 第 6 輪還要查 → 不再呼叫工具
    if (text) emit(ev.agentNote(text));

    /** @type {Map<string, { content: string, isError?: boolean }>} */
    const results = new Map();
    // 裝置定位：還沒有結果 → 請客戶端定位後重送（與示範模式相同的協定，AGENT.md §3.4）
    const locCalls = turn.calls.filter((c) => c.name === DEVICE_LOCATION_TOOL.name);
    if (locCalls.length) {
      const loc = canLocate ? deviceLocation(req) : null;
      if (loc === undefined) {
        emit(ev.clientToolCall({ id: LOCATION_CALL_ID, name: DEVICE_LOCATION_TOOL.name }));
        emit(ev.done(usage));
        return;
      }
      for (const c of locCalls) results.set(c.id, loc ? { content: JSON.stringify(loc) } : { content: FALLBACK.noLocation, isError: true });
    }
    for (const c of turn.calls) if (!results.has(c.id) && c.bad !== undefined) results.set(c.id, { content: `參數不是有效的 JSON：${c.bad}`, isError: true });

    const run = turn.calls.filter((c) => !results.has(c.id));
    const out = await execTools(svc, run.map((c) => ({ name: c.name, args: dropNulls(c.input) })), emit, { profile, nextId, picked });
    run.forEach((c, i) => {
      const o = out[i];
      used.add(c.name);
      // 回填模型的只有文字摘要（清單截短），不放整包 data（AGENT.md §4）
      results.set(c.id, o.ok ? { content: modelText(o.result) } : { content: o.error, isError: true });
    });
    conv.addResults(turn, turn.calls.map((c) => ({ id: c.id, ...results.get(c.id) })));
  }
}
