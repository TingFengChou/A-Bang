// Service worker 預先快取（離線可開啟）：從 app.js 出發的所有靜態 import 都要在 SHELL 清單裡（漏一個，離線時整個 App 開不起來）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));

async function graph(entry) {
  const seen = new Set();
  const walk = async (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = await readFile(file, 'utf8');
    for (const m of src.matchAll(/^\s*import\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) await walk(resolve(dirname(file), m[1]));
  };
  await walk(entry);
  return [...seen];
}

test('app.js 的所有靜態 import 都在 sw.js 的 SHELL 裡', async () => {
  const sw = await readFile(`${PUBLIC}sw.js`, 'utf8');
  const shell = new Set([...sw.matchAll(/'(\/[^']+)'/g)].map((m) => m[1]));
  const missing = (await graph(`${PUBLIC}js/app.js`))
    .map((f) => (f.startsWith(PUBLIC) ? `/${relative(PUBLIC, f)}` : `/${relative(ROOT, f)}`))
    .filter((p) => !shell.has(p));
  assert.deepEqual(missing, []);
});
