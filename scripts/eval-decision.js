// 「意圖與狀態判斷」小實驗：同一份評估集（scripts/eval/decision-set.json，172 題）比較
//   rules     ：示範模式的規則式判斷（core/agent/demo-intent.js）
//   local     ：地端模型（OpenAI 相容；預設 Ollama qwen3:8b），基準提示詞，要求回 JSON
//   local-opt ：地端模型＋自動優化後的提示詞（實驗 B，scripts/eval-optimize-prompt.js 產出 local-prompt.optimized.txt）
//   embed     ：嵌入分類器（實驗 A，開源、可在裝置上跑：transformers.js＋multilingual-e5-small；訓練範例 decision-train.json）
//   hybrid    ：嵌入分類器信心 ≥ 門檻就用它，否則改問地端模型（狀態一律用嵌入分類器）
//   jev       ：TypeSafe Jev（POST {JEV_BASE_URL}/v1/systemone），choice＋noul、附信心（需 JEV_API_KEY）
// 每個方法同時報告「驗收集」（雙數 id，實驗 B 優化時沒看過）的分數，公平比較。
// 用法：npm run eval:decision -- [--methods rules,embed,hybrid,local,local-opt,jev] [--limit 50] [--out docs/research/decision-eval.md]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseIntent } from '../core/agent/demo-intent.js';
import { loadEnv } from '../core/index.js';
import { INTENTS, STATES, STATE_KEYS, BASE_PROMPT, LOCAL_MODEL, loadItems, localClassify, createEmbedClassifier, score, isHoldout } from './eval/lib.js';

await loadEnv(); // 讀 .env（不印出）
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const METHODS = (args.methods || 'rules,embed,hybrid,local,local-opt,jev').split(',');
const LIMIT = Number(args.limit) || Infinity;
const OUT = args.out || 'docs/research/decision-eval.md';
const HYBRID_T = Number(args.threshold) || 0.8;

const set = (await loadItems('decision-set.json')).slice(0, LIMIT);
const history = (it) => (it.history || []).map((content) => ({ role: 'user', content }));
const optimizedPrompt = await readFile(new URL('./eval/local-prompt.optimized.txt', import.meta.url), 'utf8').then((s) => s.trim()).catch(() => null);

// ── 方法 ──
async function rules(it) {
  const r = parseIntent(it.text, { history: history(it) });
  return { intent: r.intent, states: r.states.filter((k) => STATE_KEYS.includes(k)) };
}
let embedFn = null;
const getEmbed = async () => (embedFn ||= await createEmbedClassifier(await loadItems('decision-train.json')));
const embed = async (it) => (await getEmbed())(it);
async function hybrid(it) {
  const e = await embed(it);
  if (e.confidence >= HYBRID_T) return { ...e, routed: false };
  const l = await localClassify(it);
  return { intent: l.intent, states: e.states, confidence: e.confidence, routed: true, tokens: l.tokens };
}
const local = (it) => localClassify(it, BASE_PROMPT);
const localOpt = (it) => localClassify(it, optimizedPrompt);

const JEV_URL = (process.env.JEV_BASE_URL || 'https://api.typesafe.ai').replace(/\/+$/, '');
const JEV_MODEL = process.env.JEV_MODEL || 'jev-latest';
async function jev(it) {
  const state = it.history?.length ? { 前文: it.history, 這句話: it.text } : it.text;
  const questions = {
    intent: { type: 'choice', instructions: '這位使用者想請交通與生活助理做什麼？有前文時，簡短追問沿用前文的意圖。', criteria: INTENTS },
    ...Object.fromEntries(Object.entries(STATES).map(([k, v]) => [`state_${k}`, { type: 'noul', instructions: `使用者是否明確表達：${v}？` }])),
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${JEV_URL}/v1/systemone`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.JEV_API_KEY}` },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }), signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    if (!res.ok) throw new Error(`jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const a = j.answers || {};
    return { intent: a.intent?.choice in INTENTS ? a.intent.choice : 'unknown', confidence: a.intent?.confidence ?? null, states: STATE_KEYS.filter((k) => (a[`state_${k}`]?.noul ?? 0) > 0.5), tokens: j.usage?.input_tokens ?? 0, model: j.model };
  }
  throw new Error('jev：重試後仍失敗（429／5xx）');
}

const RUNNERS = { rules, embed, hybrid, local, 'local-opt': localOpt, jev };
const SKIP = { jev: !process.env.JEV_API_KEY && '沒有設定 JEV_API_KEY', 'local-opt': !optimizedPrompt && '還沒有優化後的提示詞（先跑 scripts/eval-optimize-prompt.js）' };

// ── 執行與計分 ──
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

async function evaluate(name) {
  const fn = RUNNERS[name];
  if (name === 'embed' || name === 'hybrid') await getEmbed(); // 載入模型不算進延遲
  const rows = [];
  const conc = name === 'jev' ? 4 : 1;
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < set.length) {
      const it = set[next++];
      const t0 = performance.now();
      try { rows.push({ it, r: await fn(it), ms: performance.now() - t0 }); } catch (e) { rows.push({ it, r: { intent: 'ERROR', states: [], error: e.message }, ms: performance.now() - t0 }); }
      if (rows.length % 40 === 0) process.stderr.write(`  ${name}: ${rows.length}/${set.length}\n`);
    }
  }));
  rows.sort((a, b) => a.it.id - b.it.id);
  const by = (f) => score(rows.filter((x) => f(x.it)));
  const ms = rows.map((x) => x.ms);
  const calib = rows.some((x) => x.r.confidence != null) ? [0.5, 0.7, 0.8, 0.9].map((th) => {
    const hi = rows.filter((x) => (x.r.confidence ?? 0) >= th);
    return { th, coverage: hi.length / rows.length, acc: hi.length ? hi.filter((x) => x.r.intent === x.it.intent).length / hi.length : null };
  }) : null;
  return {
    name, all: score(rows), easy: by((it) => it.level === 'easy'), hard: by((it) => it.level === 'hard'), hold: by(isHoldout),
    p50: q(ms, 0.5), p95: q(ms, 0.95), calib, routed: rows.filter((x) => x.r.routed).length, n: rows.length,
    tokens: rows.reduce((n, x) => n + (x.r.tokens || 0), 0), errors: rows.filter((x) => x.r.intent === 'ERROR').length, model: rows.find((x) => x.r.model)?.r.model,
    wrong: rows.filter((x) => x.r.intent !== x.it.intent).map((x) => `${x.it.id}「${x.it.history ? `${x.it.history.at(-1)} → ` : ''}${x.it.text}」：答 ${x.r.intent}，應為 ${x.it.intent}`),
    stateWrong: rows.filter((x) => [...x.r.states].sort().join() !== [...x.it.states].sort().join()).map((x) => `${x.it.id}「${x.it.text}」：答 [${x.r.states.join(', ')}]，應為 [${x.it.states.join(', ')}]`),
  };
}

const results = [];
for (const m of METHODS) {
  if (!RUNNERS[m]) { console.error(`沒有這個方法：${m}`); continue; }
  if (SKIP[m]) { console.error(`略過 ${m}：${SKIP[m]}`); continue; }
  console.error(`▶ ${m}（${set.length} 題）`);
  results.push(await evaluate(m));
}

const LABEL = { rules: '規則（示範模式）', embed: '嵌入分類器（A，multilingual-e5-small）', hybrid: `混合（A 信心 ≥ ${HYBRID_T} 用 A，否則地端模型）`, local: `地端模型（${LOCAL_MODEL()}）`, 'local-opt': '地端模型＋自動優化提示詞（B）', jev: `Jev（${JEV_MODEL}）` };
const lat = (r) => (r.p95 < 5 ? '< 5 ms' : `${Math.round(r.p50)}／${Math.round(r.p95)} ms`);
const md = [
  `# 意圖與狀態判斷小實驗（${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} 台灣時間）`,
  '',
  `評估集：\`scripts/eval/decision-set.json\`，${set.length} 題自行撰寫的繁中提問（${set.filter((x) => x.level === 'easy').length} 題容易、${set.filter((x) => x.level === 'hard').length} 題困難：口語、沒有關鍵字、追問），intent 15 類、states 6 種。驗收集＝雙數 id（${set.filter(isHoldout).length} 題，實驗 B 優化時沒看過）。嵌入分類器的訓練範例另外撰寫（\`decision-train.json\`，不與評估集重複）。`,
  '',
  '| 方法 | 意圖正確率 | 容易 | 困難 | 狀態 precision | 狀態 recall | 狀態 F1 | 全對 | 驗收集：意圖／狀態 F1／全對 | 延遲 p50／p95 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${LABEL[r.name]}${r.model && r.model !== JEV_MODEL ? `（實際 ${r.model}）` : ''} | ${pct(r.all.intentAcc)} | ${pct(r.easy.intentAcc)} | ${pct(r.hard.intentAcc)} | ${pct(r.all.prec)} | ${pct(r.all.rec)} | ${pct(r.all.f1)} | ${pct(r.all.exact)} | ${pct(r.hold.intentAcc)}／${pct(r.hold.f1)}／${pct(r.hold.exact)} | ${lat(r)}${r.routed ? `（${r.routed} 題改問模型，${pct(r.routed / r.n)}）` : ''}${r.errors ? `；錯誤 ${r.errors}` : ''} |`),
  '',
  ...results.filter((r) => r.calib).flatMap((r) => [`## ${LABEL[r.name]}：信心門檻（低於門檻改交給大模型）`, '', '| 門檻 | 涵蓋率 | 門檻以上的意圖正確率 |', '|---|---|---|', ...r.calib.map((c) => `| ≥ ${c.th} | ${pct(c.coverage)} | ${pct(c.acc)} |`), '', ...(r.name === 'jev' ? [`token：${r.tokens}（約 US$${((r.tokens / 1e6) * 0.042).toFixed(5)}，以 $0.042／百萬 input token 估）`, ''] : [])]),
  ...results.flatMap((r) => [`## ${LABEL[r.name]} 意圖答錯（${r.wrong.length}）`, '', ...r.wrong.slice(0, 60).map((w) => `- ${w}`), '',
    `## ${LABEL[r.name]} 狀態答錯（${r.stateWrong.length}）`, '', ...r.stateWrong.slice(0, 40).map((w) => `- ${w}`), '']),
].join('\n');
const outPath = resolve(OUT);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${md}\n`);
// 給 docs/index.html 用的摘要（不含逐題清單）
await writeFile(outPath.replace(/\.md$/, '.json'), `${JSON.stringify(results.map((r) => ({ name: r.name, label: LABEL[r.name], all: r.all, easy: r.easy, hard: r.hard, hold: r.hold, p50: r.p50, p95: r.p95, calib: r.calib, routed: r.routed, n: r.n })), null, 2)}\n`);
console.log(md.split('\n').slice(0, 6 + results.length).join('\n'));
console.error(`\n完整報告：${OUT}`);
