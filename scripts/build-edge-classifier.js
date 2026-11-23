// 手機上的小模型（E3，ADR-0014）用的分類器參數：從 core/data/judge-train.json 算出 core/data/judge-classifier.json。
// 與伺服器啟動時算的相同（core/judge-classify.js trainClassifier），手機只下載模型、不必自己訓練。
// 改了 judge-train.json 就要重跑（test/judge-classify.test.js 會提醒）：npm run build:edge-classifier
// 需要嵌入模型（第一次會下載約 135 MB 到 JUDGE_MODEL_DIR，預設 node_modules/.cache/transformers）。
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createEmbedder, JUDGE_STATES } from '../core/agent/judge.js';
import { EMBED_MODEL, EMBED_DTYPE, embedText, trainClassifier, classifyVector, roundParams } from '../core/judge-classify.js';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
/** judge-train.json 的指紋（前 16 碼）：測試用它確認參數檔是同一份訓練範例算的 */
export const trainHash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

async function main() {
  const raw = await readFile(root('core/data/judge-train.json'));
  const items = JSON.parse(raw).items;
  const embed = await createEmbedder(process.env.JUDGE_MODEL_DIR ? { cacheDir: process.env.JUDGE_MODEL_DIR } : {});
  const X = await embed(items.map(embedText));
  const params = trainClassifier(X, items, { states: JUDGE_STATES });
  const rounded = roundParams(params);
  // 取整後判斷結果要與未取整相同
  const diff = X.filter((x) => { const a = classifyVector(x, params), b = classifyVector(x, rounded); return a.intent !== b.intent || a.states.join() !== b.states.join(); }).length;
  if (diff) throw new Error(`取整後有 ${diff} 筆判斷不同`);
  const out = { v: 1, model: EMBED_MODEL, dtype: EMBED_DTYPE, dim: X[0].length, train: trainHash(raw), ...rounded };
  await writeFile(root('core/data/judge-classifier.json'), `${JSON.stringify(out)}\n`);
  console.log(`core/data/judge-classifier.json：${items.length} 筆訓練範例、${Object.keys(out.intents).length} 種意圖、${Object.keys(out.states).length} 種狀態`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
