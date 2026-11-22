// 情境對話評測（A0，模型模式）：用 test/scenarios/life.json（＋life-q.json）跑真的模型（地端或 Claude，依 .env），報告每個情境過不過。
// 不進 CI（要模型、會花時間或額度）。PR 改了 agent 行為時附上結果。
//   node --env-file=.env scripts/eval-scenarios.js [情境 id…]（EVAL_DEBUG=1 印出每個工具呼叫的參數）
import { readFile } from 'node:fs/promises';
import { runModel } from '../core/agent/model-loop.js';
import { pickProvider } from '../core/agent/provider.js';
import { judgeFromEnv } from '../core/agent/judge.js';
import { createServices } from '../core/index.js';
import { getProfile } from '../core/agents/index.js';
import { check } from './eval/scenario-check.js';

const load = async (f) => JSON.parse(await readFile(new URL(`../test/scenarios/${f}`, import.meta.url), 'utf8'));
const set = await load('life.json');
// PM「該問就問、不該問就不問」的 Q 情境（test/scenarios/life-q.json）一起跑；各檔的 here 是那一份的預設定位
for (const sc of (await load('life-q.json')).scenarios) set.scenarios.push(sc);
const only = process.argv.slice(2);
const provider = pickProvider(process.env, { defaultModel: getProfile('life').model });
if (!provider) throw new Error('沒有設定模型（LOCAL_LLM_URL 或 ANTHROPIC_API_KEY）');
const { judge, ready } = judgeFromEnv(process.env);
await ready;
let pass = 0, n = 0;
// 與 test/scenarios.test.js 相同：情境指定的時間（at，例：23:20 末班）、沒指定用白天 10:00；常用地點（saved）
const atTW = (hhmm = '10:00') => Date.parse(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T${hhmm}:00+08:00`);
for (const sc of set.scenarios.filter((x) => !only.length || only.includes(x.id))) {
  const svc = createServices({ forceMock: true, ...(sc.demo && { demo: sc.demo }) });
  const messages = [];
  const fails = [];
  const t0 = Date.now();
  let pendingAsk; // 上一輪「阿幫問你」在等的答案（與 test/scenarios.test.js 相同，ADR-0016）
  for (const t of sc.turns) {
    messages.push({ role: 'user', content: t.say });
    const es = [];
    await runModel(svc, { messages, clientTools: ['device_location'], clientToolResults: [sc.location === false ? { id: 'loc1', ok: false } : { id: 'loc1', ok: true, result: sc.here || set.here }], ...(sc.saved && { savedPlaces: sc.saved }), ...(pendingAsk && { pendingAsk }) }, (e) => es.push(e), { provider, judge, now: atTW(sc.at), ...(sc.profile && { profileId: sc.profile }) }); // profile：情境指定的 agent（例 antifraud）；here：情境的定位
    const ask = es.find((e) => e.type === 'ask');
    pendingAsk = ask?.pending ? { id: ask.id, ...ask.pending } : undefined;
    if (process.env.EVAL_DEBUG) for (const e of es) if (e.type === 'tool_start') console.log(`    · ${e.name} ${JSON.stringify(e.input)}`);
    const bad = check(es, t.expect);
    if (bad.length) fails.push(`「${t.say}」${bad.join('；')}`);
    messages.push({ role: 'assistant', content: es.filter((e) => e.type === 'text').map((e) => e.delta).join('').slice(0, 500) || '好' });
  }
  n++;
  if (!fails.length) pass++;
  console.log(`${fails.length ? '✗' : '✓'} ${sc.id} ${sc.title}${sc.todo ? '（todo）' : ''}（${Math.round((Date.now() - t0) / 1000)} 秒）${fails.length ? `\n    ${fails.join('\n    ')}` : ''}`);
}
console.log(`\n${provider.mode}（${provider.model}）：${pass}／${n} 個情境通過`);
