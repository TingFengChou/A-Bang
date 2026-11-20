// 裝置端判斷＋伺服器判斷層的組合分數（ADR-0014 E6）：讀 scripts/eval-edge.js 存下的每題裝置判斷，
// 經 core/agent/judge.js 的 createJudge（A 嵌入分類器＋規則，裝置結果當 B）重算，與「A＋規則」、「裝置單獨」比較。
//   node scripts/eval-edge-combo.js gemini-nano
import { readFile } from 'node:fs/promises';
import { loadItems, score, isHoldout, createEmbedClassifier } from './eval/lib.js';
import { createJudge } from '../core/agent/judge.js';

const engine = process.argv[2] || 'gemini-nano';
const dev = JSON.parse(await readFile(new URL(`../docs/research/edge-eval-${engine}.json`, import.meta.url), 'utf8'));
const byId = new Map(dev.results.map((r) => [r.id, r]));
const items = (await loadItems('decision-set.json')).filter((it) => byId.has(it.id));
const embed = await createEmbedClassifier(await loadItems('decision-train.json'));
const withA = createJudge({ embed }), combo = createJudge({ embed });
const rows = { a: [], device: [], combo: [] };
for (const it of items) {
  const d = byId.get(it.id);
  rows.a.push({ it, r: await withA(it.text, it.history || []) });
  rows.device.push({ it, r: d });
  rows.combo.push({ it, r: await combo(it.text, it.history || [], { device: { ...d, engine } }) });
}
const f = (x) => `${(x * 100).toFixed(1)}%`;
for (const [k, label] of [['a', 'A＋規則（伺服器，無模型）'], ['device', `裝置單獨（${engine}）`], ['combo', `A＋規則＋裝置（${engine}）`]]) {
  const s = score(rows[k]), h = score(rows[k].filter((x) => isHoldout(x.it)));
  console.log(`| ${label} | ${f(s.intentAcc)} | ${f(s.f1)} | ${f(s.exact)} | ${f(h.intentAcc)}／${f(h.exact)} |`);
}
