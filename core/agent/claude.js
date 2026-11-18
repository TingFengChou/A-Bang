// Claude provider（M5-05，ADR-0012）：官方 @anthropic-ai/sdk，messages.stream() ＋ finalMessage() 的手動迴圈。
// 一輪＝一次模型呼叫；事件轉換與工具執行在 model-loop.js（與地端模型共用）。
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MAX_TOKENS = 2048;
/** 工具參數 JSON 無法解析時（eager input streaming）最多重送幾次；API 錯誤由 SDK 自己重試 */
const MAX_JSON_RETRIES = 2;
const STOP = { end_turn: 'end', tool_use: 'tool', max_tokens: 'max_tokens', refusal: 'refusal' };

/**
 * @param {{ apiKey?: string, model: string, baseURL?: string, client?: Anthropic, effort?: 'low'|'medium'|'high' }} opts
 * @returns {import('./model-loop.js').Provider}
 */
export function createClaudeProvider({ apiKey, model, baseURL, client, effort = 'low' }) {
  const c = client || new Anthropic({ apiKey, ...(baseURL && { baseURL }), maxRetries: 2, timeout: 30_000 });
  return {
    mode: 'claude',
    model,
    start({ system, tools, messages }) {
      // 工具定義在提示最前面且不隨時間變 → 最後一個工具設快取斷點；system 含現在時間，同一次對話的後續輪次才命中
      const apiTools = tools.map((t, i) => ({
        name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true,
        ...(i === tools.length - 1 && { cache_control: { type: 'ephemeral' } }),
      }));
      const sys = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      let last = null;
      return {
        async next() {
          for (let attempt = 0; ; attempt++) {
            try {
              const stream = c.messages.stream({
                model, max_tokens: CLAUDE_MAX_TOKENS, system: sys, tools: apiTools, messages: history,
                output_config: { effort },
              });
              last = await stream.finalMessage();
              break;
            } catch (e) {
              // 只重送「工具參數不是有效 JSON」；API 錯誤（含 429／5xx，SDK 已重試）直接丟給上層
              if (e instanceof Anthropic.APIError || attempt >= MAX_JSON_RETRIES) throw e;
            }
          }
          const u = last.usage || {};
          return {
            text: last.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
            calls: last.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} })),
            stop: STOP[last.stop_reason] || 'other',
            usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 },
          };
        },
        addResults(turn, results) {
          history.push({ role: 'assistant', content: last.content }); // 原樣回填（含 thinking 區塊）
          history.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError && { is_error: true }) })) });
        },
      };
    },
  };
}
