// 情境對話評測（A0，模型模式）：用 test/scenarios/life.json 跑真的模型（地端或 Claude，依 .env），報告每個情境過不過。
// 不進 CI（要模型、會花時間或額度）。PR 改了 agent 行為時附上結果。
//   node --env-file=.env scripts/eval-scenarios.js [情境 id…]
import { readFile } from 'node:fs/promises';
import { runModel } from '../core/agent/model-loop.js';
import { pickProvider } from '../core/agent/provider.js';
import { judgeFromEnv } from '../core/agent/judge.js';
import { createServices } from '../core/index.js';
import { getProfile } from '../core/agents/index.js';
import { check } from './eval/scenario-check.js';

const set = JSON.parse(await readFile(new URL('../test/scenarios/life.json', import.meta.url), 'utf8'));
const only = process.argv.slice(2);
const provider = pickProvider(process.env, { defaultModel: getProfile('life').model });
if (!provider) throw new Error('沒有設定模型（LOCAL_LLM_URL 或 ANTHROPIC_API_KEY）');
const { judge, ready } = judgeFromEnv(process.env);
await ready;
let pass = 0, n = 0;
for (const sc of set.scenarios.filter((x) => !only.length || only.includes(x.id))) {
  const svc = createServices({ forceMock: true, ...(sc.demo && { demo: sc.demo }) });
  const messages = [];
  const fails = [];
  const t0 = Date.now();
  for (const t of sc.turns) {
    messages.push({ role: 'user', content: t.say });
    const es = [];
    await runModel(svc, { messages, clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: set.here }] }, (e) => es.push(e), { provider, judge });
    const bad = check(es, t.expect);
    if (bad.length) fails.push(`「${t.say}」${bad.join('；')}`);
    messages.push({ role: 'assistant', content: es.filter((e) => e.type === 'text').map((e) => e.delta).join('').slice(0, 500) || '好' });
  }
  n++;
  if (!fails.length) pass++;
  console.log(`${fails.length ? '✗' : '✓'} ${sc.id} ${sc.title}${sc.todo ? '（todo）' : ''}（${Math.round((Date.now() - t0) / 1000)} 秒）${fails.length ? `\n    ${fails.join('\n    ')}` : ''}`);
}
console.log(`\n${provider.mode}（${provider.model}）：${pass}／${n} 個情境通過`);
