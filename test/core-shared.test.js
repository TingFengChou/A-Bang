// 前端引用的 core/ 檔：伺服器要開放（server/http.js SHARED_CORE）、App 要打包（scripts/build-app.js CORE）、離線要快取（public/sw.js）
// 2026-11-23：新增 core/topic.js 時漏了伺服器的清單，首頁整個載不起來（E2E 140 項失敗）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
async function* jsFiles(dir) {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) yield* jsFiles(p); else if (d.name.endsWith('.js')) yield p;
  }
}

test('前端 import 的 core/*.js 都有開放、打包、快取', async () => {
  const used = new Set();
  for await (const f of jsFiles(join(root, 'public'))) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/from\s+'(?:\.\.\/)+core\/([a-z0-9-]+\.js)'/g)) used.add(m[1]);
  }
  assert.ok(used.has('topic.js') && used.has('edge-ask.js'), [...used].join(','));
  const http = await readFile(join(root, 'server/http.js'), 'utf8');
  const app = await readFile(join(root, 'scripts/build-app.js'), 'utf8');
  const sw = await readFile(join(root, 'public/sw.js'), 'utf8');
  for (const f of used) {
    assert.ok(http.includes(`'${f}': fileURLToPath`), `server/http.js SHARED_CORE 有 ${f}`);
    assert.ok(app.includes(`'${f}'`), `scripts/build-app.js CORE 有 ${f}`);
    assert.ok(sw.includes(`'/core/${f}'`), `public/sw.js 有 /core/${f}`);
  }
});
