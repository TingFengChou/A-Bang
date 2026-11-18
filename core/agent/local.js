// 地端模型 provider（M5-05，ADR-0012）：OpenAI 相容 POST {LOCAL_LLM_URL}/chat/completions
//（Ollama、LM Studio、llama.cpp、vLLM 都提供）。用 Node 內建 fetch，不新增依賴；不串流，一輪回一次。

export class LocalModelError extends Error {
  constructor(message) { super(message); this.name = 'LocalModelError'; }
}

/** 推理模型（例如 Qwen3）會把思考放在 <think>…</think>，不給使用者看 */
export const stripThink = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim();

/** arguments 可能是 JSON 字串或物件；解析失敗時保留原字串（bad）讓模型知道 */
function parseArgs(a) {
  if (a && typeof a === 'object') return { input: a };
  const s = typeof a === 'string' ? a.trim() : '';
  if (!s) return { input: {} };
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? { input: v } : { input: {}, bad: s.slice(0, 200) };
  } catch {
    return { input: {}, bad: s.slice(0, 200) };
  }
}

/**
 * @param {{ url: string, model: string, apiKey?: string, reasoningEffort?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 *   reasoningEffort：OpenAI 相容的 reasoning_effort（Ollama 的推理模型設 none 可關閉思考，回應快很多）
 * @returns {import('./model-loop.js').Provider}
 */
export function createLocalProvider({ url, model, apiKey, reasoningEffort, fetchImpl = fetch, timeoutMs = 120_000 }) {
  const endpoint = `${String(url).replace(/\/+$/, '')}/chat/completions`;
  return {
    mode: 'local',
    model,
    start({ system, tools, messages }) {
      const apiTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
      const history = [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))];
      let last = null;
      return {
        async next() {
          let r;
          try {
            r = await fetchImpl(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...(apiKey && { authorization: `Bearer ${apiKey}` }) },
              body: JSON.stringify({ model, messages: history, tools: apiTools, stream: false, ...(reasoningEffort && { reasoning_effort: reasoningEffort }) }),
              signal: AbortSignal.timeout(timeoutMs),
            });
          } catch {
            throw new LocalModelError('地端模型連線失敗（請確認 LOCAL_LLM_URL 的服務有在執行）');
          }
          if (!r.ok) throw new LocalModelError(`地端模型回應錯誤（HTTP ${r.status}）`);
          const j = await r.json().catch(() => null);
          const choice = j?.choices?.[0];
          if (!choice?.message) throw new LocalModelError('地端模型回應格式不符 OpenAI 相容格式');
          last = choice.message;
          const calls = (Array.isArray(last.tool_calls) ? last.tool_calls : []).map((c, i) => {
            const { input, bad } = parseArgs(c?.function?.arguments);
            return { id: String(c?.id || `call_${i}`), name: String(c?.function?.name || ''), input, ...(bad !== undefined && { bad }) };
          });
          return {
            text: stripThink(typeof last.content === 'string' ? last.content : ''),
            calls,
            stop: choice.finish_reason === 'length' ? 'max_tokens' : calls.length ? 'tool' : 'end',
            usage: { input: j.usage?.prompt_tokens || 0, output: j.usage?.completion_tokens || 0 },
          };
        },
        addResults(turn, results) {
          history.push({
            role: 'assistant', content: typeof last.content === 'string' ? last.content : '',
            tool_calls: turn.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.bad ?? JSON.stringify(c.input) } })),
          });
          for (const r of results) history.push({ role: 'tool', tool_call_id: r.id, content: r.content });
        },
      };
    },
  };
}
