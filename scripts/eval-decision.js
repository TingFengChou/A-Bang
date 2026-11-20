// 「意圖與狀態判斷」小實驗：同一份評估集（scripts/eval/decision-set.json）比較
//   rules：示範模式的規則式判斷（core/agent/demo-intent.js）
//   local：地端模型（OpenAI 相容；預設 Ollama qwen3:8b），要求回 JSON
//   jev  ：TypeSafe Jev（System One 決策模型；POST {JEV_BASE_URL}/v1/systemone），choice＋noul 題型、附信心
// 評估集是自行撰寫的假想提問，不含使用者資料；金鑰只從環境變數讀，不印出。不加新依賴（Node 內建 fetch）。
//
// 用法：node scripts/eval-decision.js [--methods rules,local,jev] [--limit 50] [--out docs/research/decision-eval.md]
//   JEV_API_KEY（必要，沒有就略過 jev）、JEV_BASE_URL（預設 https://api.typesafe.ai）、JEV_MODEL（預設 jev-latest）
//   LOCAL_LLM_URL（預設 http://localhost:11434/v1）、LOCAL_LLM_MODEL（預設 qwen3:8b）
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseIntent } from '../core/agent/demo-intent.js';
import { loadEnv } from '../core/index.js';

await loadEnv(); // 讀 .env（不印出）
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const METHODS = (args.methods || 'rules,local,jev').split(',');
const LIMIT = Number(args.limit) || Infinity;
const OUT = args.out || 'docs/research/decision-eval.md';

const INTENTS = {
  trip: '從 A 到 B 怎麼去、行程規劃、比較交通方式（含只說目的地）',
  bus_route: '某一條公車路線到哪、多久到站、末班車',
  youbike: 'YouBike／公共自行車借車還車、站點車位',
  nearby_bus: '附近有哪些公車站牌、站牌有哪些路線',
  metro: '捷運下一班、捷運到站時間、班距',
  rail: '高鐵或台鐵（火車）班次、時刻、車票',
  weather: '天氣、氣溫、會不會下雨、帶傘、颱風',
  aqi: '空氣品質、AQI、PM2.5、空汙、要不要戴口罩',
  quake: '地震、震度、震央',
  pharmacy: '藥局、領藥、買藥',
  garbage: '垃圾車、倒垃圾、資源回收車時間',
  fuel: '油價、汽油、柴油價格',
  invoice: '統一發票、對獎、中獎號碼、開獎',
  stock: '台股股價、大盤、指數、個股（含問該不該買）',
  unknown: '以上都不是：閒聊、其他服務、阿幫不提供的資訊',
};
const STATES = {
  rush: '使用者趕時間、快遲到、很急',
  luggage: '使用者帶行李、大包小包、嬰兒車',
  budget: '使用者想省錢、預算有限、要便宜',
  lessWalk: '使用者不想多走路、行動不便、帶長輩、腳不舒服',
  rain: '使用者說正在下雨或雨很大（不是只問會不會下雨）',
  badAir: '使用者說空氣很差、霧霾、空汙嚴重（不是只問空氣品質）',
};
const STATE_KEYS = Object.keys(STATES);

const set = JSON.parse(await readFile(new URL('./eval/decision-set.json', import.meta.url), 'utf8')).items.slice(0, LIMIT);
const history = (it) => (it.history || []).map((content) => ({ role: 'user', content }));

// ── 方法 ──
async function rules(it) {
  const r = parseIntent(it.text, { history: history(it) });
  return { intent: r.intent, states: r.states.filter((k) => STATE_KEYS.includes(k)) };
}

const LOCAL_URL = (process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1').replace(/\/+$/, '');
const LOCAL_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen3:8b';
const SYSTEM = `你是交通與生活助理的「意圖與狀態判斷器」。只回 JSON：{"intent": "<意圖>", "states": ["<狀態>", ...]}。
意圖（只能選一個）：
${Object.entries(INTENTS).map(([k, v]) => `- ${k}：${v}`).join('\n')}
狀態（使用者這句話或前文明確表達的才列，可以是空陣列）：
${Object.entries(STATES).map(([k, v]) => `- ${k}：${v}`).join('\n')}
有前文時，簡短的追問（例如「那聯發科呢？」）沿用前文的意圖。`;
async function local(it) {
  const msgs = [{ role: 'system', content: SYSTEM }, ...(it.history?.length ? [{ role: 'user', content: `前文：${it.history.join(' ／ ')}` }] : []), { role: 'user', content: `${it.text}\n/no_think` }];
  const res = await fetch(`${LOCAL_URL}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: LOCAL_MODEL, messages: msgs, temperature: 0, stream: false, response_format: { type: 'json_object' }, reasoning_effort: 'none' }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`local HTTP ${res.status}`);
  const j = await res.json();
  const text = String(j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const m = /\{[\s\S]*\}/.exec(text);
  const o = m ? JSON.parse(m[0]) : {};
  return { intent: INTENTS[o.intent] ? o.intent : 'unknown', states: (Array.isArray(o.states) ? o.states : []).filter((k) => STATE_KEYS.includes(k)), tokens: (j.usage?.prompt_tokens || 0) + (j.usage?.completion_tokens || 0) };
}

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
    return {
      intent: a.intent?.choice in INTENTS ? a.intent.choice : 'unknown',
      confidence: a.intent?.confidence ?? null,
      states: STATE_KEYS.filter((k) => (a[`state_${k}`]?.noul ?? 0) > 0.5),
      tokens: j.usage?.input_tokens ?? 0,
      model: j.model,
    };
  }
  throw new Error('jev：重試後仍失敗（429／5xx）');
}

const RUNNERS = { rules, local, jev };
const AVAILABLE = { rules: true, local: true, jev: Boolean(process.env.JEV_API_KEY) };

// ── 執行與計分 ──
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

async function evaluate(name) {
  const fn = RUNNERS[name];
  const rows = [];
  const conc = name === 'jev' ? 4 : 1;
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < set.length) {
      const it = set[next++];
      const t0 = performance.now();
      try {
        const r = await fn(it);
        rows.push({ it, r, ms: performance.now() - t0 });
      } catch (e) {
        rows.push({ it, r: { intent: 'ERROR', states: [], error: e.message }, ms: performance.now() - t0 });
      }
      if (rows.length % 20 === 0) process.stderr.write(`  ${name}: ${rows.length}/${set.length}\n`);
    }
  }));
  rows.sort((a, b) => a.it.id - b.it.id);
  let tp = 0, fp = 0, fn_ = 0, exact = 0;
  for (const { it, r } of rows) {
    const g = new Set(it.states), p = new Set(r.states);
    for (const k of p) (g.has(k) ? tp++ : fp++);
    for (const k of g) if (!p.has(k)) fn_++;
    if (r.intent === it.intent && g.size === p.size && [...g].every((k) => p.has(k))) exact++;
  }
  const acc = (lv) => { const rs = rows.filter((x) => !lv || x.it.level === lv); return { n: rs.length, ok: rs.filter((x) => x.r.intent === x.it.intent).length }; };
  const prec = tp + fp ? tp / (tp + fp) : 1, rec = tp + fn_ ? tp / (tp + fn_) : 1;
  const ms = rows.map((x) => x.ms);
  const tokens = rows.reduce((n, x) => n + (x.r.tokens || 0), 0);
  // 信心（只有 jev）：門檻以上的涵蓋率與正確率；低於門檻改交給大模型
  const calib = rows.some((x) => x.r.confidence != null) ? [0.5, 0.7, 0.9].map((th) => {
    const hi = rows.filter((x) => (x.r.confidence ?? 0) >= th);
    return { th, coverage: hi.length / rows.length, acc: hi.length ? hi.filter((x) => x.r.intent === x.it.intent).length / hi.length : null };
  }) : null;
  const errors = rows.filter((x) => x.r.intent === 'ERROR').length;
  const wrong = rows.filter((x) => x.r.intent !== x.it.intent).map((x) => `${x.it.id}「${x.it.history ? `${x.it.history.at(-1)} → ` : ''}${x.it.text}」：答 ${x.r.intent}，應為 ${x.it.intent}`);
  const stateWrong = rows.filter((x) => [...x.r.states].sort().join() !== [...x.it.states].sort().join())
    .map((x) => `${x.it.id}「${x.it.text}」：答 [${x.r.states.join(', ')}]，應為 [${x.it.states.join(', ')}]`);
  return { name, all: acc(), easy: acc('easy'), hard: acc('hard'), prec, rec, f1: prec + rec ? (2 * prec * rec) / (prec + rec) : 0, exact, p50: q(ms, 0.5), p95: q(ms, 0.95), tokens, calib, errors, wrong, stateWrong, model: rows.find((x) => x.r.model)?.r.model };
}

const results = [];
for (const m of METHODS) {
  if (!RUNNERS[m]) { console.error(`沒有這個方法：${m}`); continue; }
  if (!AVAILABLE[m]) { console.error(`略過 ${m}：沒有設定 JEV_API_KEY`); continue; }
  console.error(`▶ ${m}（${set.length} 題）`);
  results.push(await evaluate(m));
}

const LABEL = { rules: '規則（示範模式）', local: `地端模型（${LOCAL_MODEL}）`, jev: `Jev（${JEV_MODEL}）` };
const md = [
  `# 意圖與狀態判斷小實驗（${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} 台灣時間）`,
  '',
  `評估集：\`scripts/eval/decision-set.json\`，${set.length} 題自行撰寫的繁中提問（${set.filter((x) => x.level === 'easy').length} 題容易、${set.filter((x) => x.level === 'hard').length} 題困難：口語、沒有關鍵字、追問），intent 15 類、states 6 種。`,
  '',
  '| 方法 | 意圖正確率 | 容易 | 困難 | 狀態 precision | 狀態 recall | 狀態 F1 | 意圖＋狀態全對 | 延遲 p50／p95 | 錯誤 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${LABEL[r.name]}${r.model && r.model !== JEV_MODEL ? `（實際 ${r.model}）` : ''} | ${pct(r.all.ok, r.all.n)} | ${pct(r.easy.ok, r.easy.n)} | ${pct(r.hard.ok, r.hard.n)} | ${(r.prec * 100).toFixed(1)}% | ${(r.rec * 100).toFixed(1)}% | ${(r.f1 * 100).toFixed(1)}% | ${pct(r.exact, r.all.n)} | ${Math.round(r.p50)}／${Math.round(r.p95)} ms | ${r.errors} |`),
  '',
  ...results.filter((r) => r.calib).flatMap((r) => ['## Jev 信心門檻（低於門檻改交給大模型）', '', '| 門檻 | 涵蓋率 | 門檻以上的正確率 |', '|---|---|---|', ...r.calib.map((c) => `| ≥ ${c.th} | ${(c.coverage * 100).toFixed(1)}% | ${c.acc == null ? '—' : `${(c.acc * 100).toFixed(1)}%`} |`), '', `token：${r.tokens}（約 US$${((r.tokens / 1e6) * 0.042).toFixed(5)}，以 $0.042／百萬 input token 估）`, '']),
  ...results.flatMap((r) => [`## ${LABEL[r.name]} 意圖答錯（${r.wrong.length}）`, '', ...r.wrong.slice(0, 60).map((w) => `- ${w}`), '',
    `## ${LABEL[r.name]} 狀態答錯（${r.stateWrong.length}）`, '', ...r.stateWrong.slice(0, 40).map((w) => `- ${w}`), '']),
].join('\n');
const outPath = resolve(OUT); // 相對路徑以目前目錄（repo 根目錄）為準
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, md + '\n');
console.log(md.split('\n').slice(0, 8 + results.length).join('\n'));
console.error(`\n完整報告：${OUT}`);
