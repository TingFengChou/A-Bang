// 先下載判斷層的嵌入模型（multilingual-e5-small，約 120 MB）到 JUDGE_MODEL_DIR（預設 node_modules/.cache/transformers）。
// Docker 建置時執行，讓容器啟動不必連網下載；本機第一次啟動伺服器也會自動下載，不一定要跑這支。
import { readFile } from 'node:fs/promises';
import { createEmbedClassifier } from '../core/agent/judge.js';

const train = JSON.parse(await readFile(new URL('../core/data/judge-train.json', import.meta.url), 'utf8')).items;
await createEmbedClassifier(train.slice(0, 4), { ...(process.env.JUDGE_MODEL_DIR && { cacheDir: process.env.JUDGE_MODEL_DIR }) });
console.log(`判斷層模型已下載到 ${process.env.JUDGE_MODEL_DIR || 'node_modules/.cache/transformers'}`);
