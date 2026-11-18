// 網頁 agent 的模型選擇（M5-05，ADR-0012）：claude｜local｜demo。金鑰只從環境變數讀，不寫 log。
import { createClaudeProvider } from './claude.js';
import { createLocalProvider } from './local.js';

export const AGENT_MODES = ['claude', 'local', 'demo'];

/**
 * 依環境變數決定模式。DEMO_MODE=1 一律示範；AGENT_PROVIDER 指定時照指定（缺設定直接丟錯，啟動就看得到）；
 * 未指定時：有 ANTHROPIC_API_KEY → claude；有 LOCAL_LLM_URL＋LOCAL_LLM_MODEL → local；否則 demo。
 * @param {Record<string, string|undefined>} env
 * @param {{ defaultModel: string }} opts profile 的模型（ANTHROPIC_MODEL 未設定時用）
 * @returns {import('./model-loop.js').Provider | null} null＝示範模式
 */
export function pickProvider(env, { defaultModel }) {
  if (env.DEMO_MODE === '1') return null;
  const want = (env.AGENT_PROVIDER || '').trim().toLowerCase();
  if (want && !AGENT_MODES.includes(want)) throw new Error(`AGENT_PROVIDER 只能是 ${AGENT_MODES.join('／')}`);
  const hasClaude = !!env.ANTHROPIC_API_KEY;
  const hasLocal = !!(env.LOCAL_LLM_URL && env.LOCAL_LLM_MODEL);
  const mode = want || (hasClaude ? 'claude' : hasLocal ? 'local' : 'demo');

  if (mode === 'claude') {
    if (!hasClaude) throw new Error('AGENT_PROVIDER=claude 需要設定 ANTHROPIC_API_KEY');
    return createClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || defaultModel, baseURL: env.ANTHROPIC_BASE_URL || undefined });
  }
  if (mode === 'local') {
    if (!hasLocal) throw new Error('AGENT_PROVIDER=local 需要設定 LOCAL_LLM_URL 與 LOCAL_LLM_MODEL');
    let u;
    try { u = new URL(env.LOCAL_LLM_URL); } catch { throw new Error('LOCAL_LLM_URL 不是有效網址，例如 http://localhost:11434/v1'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('LOCAL_LLM_URL 只支援 http／https');
    return createLocalProvider({ url: env.LOCAL_LLM_URL, model: env.LOCAL_LLM_MODEL, apiKey: env.LOCAL_LLM_API_KEY || undefined, reasoningEffort: env.LOCAL_LLM_REASONING_EFFORT || undefined });
  }
  return null;
}
