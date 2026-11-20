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
    // 去掉註解（JSDoc 的 import('./host.js').Host 是型別，不是載入）
    const src = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // import … from、export … from、import './x.js'（副作用）、import('…')（動態，字串常數）；相對路徑或站內絕對路徑
    const specs = [
      ...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([./][^'"]+)['"]/gm),
      ...src.matchAll(/^\s*import\s*['"]([./][^'"]+)['"]/gm),
      ...src.matchAll(/\bimport\(\s*['"]([./][^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specs) await walk(spec.startsWith('/') ? resolve(spec.startsWith('/core/') ? ROOT : PUBLIC, `.${spec}`) : resolve(dirname(file), spec));
  };
  await walk(entry);
  return [...seen];
}

test('app.js 的所有 import（靜態、副作用、export from、動態字串）都在 sw.js 的 SHELL 裡', async () => {
  const sw = await readFile(`${PUBLIC}sw.js`, 'utf8');
  const shell = new Set([...sw.matchAll(/'(\/[^']+)'/g)].map((m) => m[1]));
  const missing = (await graph(`${PUBLIC}js/app.js`))
    .map((f) => (f.startsWith(PUBLIC) ? `/${relative(PUBLIC, f)}` : `/${relative(ROOT, f)}`))
    .filter((p) => !shell.has(p));
  assert.deepEqual(missing, []);
});
