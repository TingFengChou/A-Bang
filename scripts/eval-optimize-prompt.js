// 實驗 B：自動優化地端模型的判斷提示詞（Harness² 的概念：提出修改 → 試跑 → 只留下變好的）。
// 與 Harness² 不同：我們有標好答案的評估集，所以用「優化集」（單數 id）打分、「驗收集」（雙數 id）只在最後驗收，避免背答案。
// 優化建議由地端模型（開啟推理）提出；提示詞不得出現優化集的原句（出現就丟掉該候選）。
//
// 用法：node scripts/eval-optimize-prompt.js [--rounds 4] [--candidates 2]
// 產出：scripts/eval/local-prompt.optimized.txt、docs/research/prompt-optimization.json（每輪紀錄）
import { writeFile, mkdir } from 'node:fs/promises';
import { loadItems, localChat, localClassify, score, isHoldout, BASE_PROMPT, INTENTS, STATES } from './eval/lib.js';
import { loadEnv } from '../core/index.js';

await loadEnv();
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const ROUNDS = Number(args.rounds) || 4;
const CANDIDATES = Number(args.candidates) || 2;

const items = await loadItems('decision-set.json');
const opt = items.filter((x) => !isHoldout(x));
const hold = items.filter(isHoldout);

/** 跑一組題目；目標＝意圖＋狀態全對的比例（兼顧意圖與不亂加狀態） */
async function run(prompt, set) {
  const rows = [];
  for (const it of set) {
    try { rows.push({ it, r: await localClassify(it, prompt) }); } catch { rows.push({ it, r: { intent: 'ERROR', states: [] } }); }
  }
  return { rows, s: score(rows) };
}
const errorsOf = (rows) => rows.filter(({ it, r }) => r.intent !== it.intent || [...r.states].sort().join() !== [...it.states].sort().join())
  .map(({ it, r }) => `「${it.history ? `前文：${it.history.at(-1)}／` : ''}${it.text}」答 ${r.intent} [${r.states.join(',')}]，應為 ${it.intent} [${it.states.join(',')}]`);

const META = `你在改良一個「意圖與狀態判斷器」的系統提示詞。判斷器是一個小型地端模型，讀提示詞後對使用者的一句話回 JSON {"intent","states"}。
規則：
- 只能使用這些意圖：${Object.keys(INTENTS).join(', ')}；狀態：${Object.keys(STATES).join(', ')}。JSON 格式必須保留。
- 寫通用的判斷原則與易混淆的區分方式，不要逐字列出下面任何一題的原句，也不要針對單題寫例外。
- 提示詞要精簡（1500 字內），繁體中文。
- 只輸出新的完整系統提示詞本身，不要加說明。`;

async function propose(prompt, errs, i) {
  const { text } = await localChat([
    { role: 'system', content: META },
    { role: 'user', content: `目前的提示詞：\n<<<\n${prompt}\n>>>\n\n在優化集上答錯的例子（${errs.length} 題，列出前 18 題）：\n${errs.slice(0, 18).map((e) => `- ${e}`).join('\n')}\n\n請提出改良後的完整提示詞（第 ${i + 1} 個版本，可以嘗試不同的寫法）。` },
  ], { think: true, temperature: 0.7, timeoutMs: 300_000 });
  return text.replace(/^<<<|>>>$/g, '').replace(/^```\w*\n?|```$/g, '').trim();
}
const leaks = (p) => opt.some((it) => it.text.length >= 6 && p.includes(it.text));

const log = [];
const t0 = Date.now();
let best = { prompt: BASE_PROMPT, ...(await run(BASE_PROMPT, opt)) };
console.error(`基準（優化集 ${opt.length} 題）：全對 ${(best.s.exact * 100).toFixed(1)}%、意圖 ${(best.s.intentAcc * 100).toFixed(1)}%、狀態 F1 ${(best.s.f1 * 100).toFixed(1)}%`);
log.push({ round: 0, kind: 'baseline', ...best.s });
for (let round = 1; round <= ROUNDS; round++) {
  const errs = errorsOf(best.rows);
  if (!errs.length) break;
  let improved = false;
  for (let c = 0; c < CANDIDATES; c++) {
    const cand = await propose(best.prompt, errs, c);
    if (!cand || cand.length < 200 || !cand.includes('intent') || leaks(cand)) { log.push({ round, cand: c, rejected: !cand ? 'empty' : leaks(cand) ? 'leaks-opt-text' : 'too-short-or-no-json' }); console.error(`  第 ${round} 輪候選 ${c + 1}：不採用`); continue; }
    const r = await run(cand, opt);
    log.push({ round, cand: c, ...r.s, chars: cand.length });
    console.error(`  第 ${round} 輪候選 ${c + 1}：全對 ${(r.s.exact * 100).toFixed(1)}%、意圖 ${(r.s.intentAcc * 100).toFixed(1)}%、狀態 F1 ${(r.s.f1 * 100).toFixed(1)}%`);
    if (r.s.exact > best.s.exact) { best = { prompt: cand, ...r }; improved = true; }
  }
  log.push({ round, kept: improved });
}
// 驗收：基準 vs 最佳，在沒看過的驗收集上
const baseHold = await run(BASE_PROMPT, hold);
const bestHold = best.prompt === BASE_PROMPT ? baseHold : await run(best.prompt, hold);
const summary = { optimize: { n: opt.length, best: best.s }, holdout: { n: hold.length, baseline: baseHold.s, optimized: bestHold.s }, minutes: +((Date.now() - t0) / 60000).toFixed(1), rounds: ROUNDS, candidates: CANDIDATES, model: process.env.LOCAL_LLM_MODEL || 'qwen3:8b' };
await writeFile(new URL('./eval/local-prompt.optimized.txt', import.meta.url), `${best.prompt}\n`);
await mkdir(new URL('../docs/research/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/research/prompt-optimization.json', import.meta.url), `${JSON.stringify({ summary, log }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
