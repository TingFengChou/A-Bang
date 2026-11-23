// M1-02 錄 TDX 真實回應當測試 fixture：每個端點取前 5 筆（或 scripts/tdx/endpoints.js 的 pick），存到 test/fixtures/tdx-<id>.json。
// 只存回應內容（不含標頭、token、金鑰）；交通資料本身沒有個資，查詢地點都是公開的車站與地標。
//   node --env-file=.env scripts/record-fixtures.js [--delay 13] [--only id1,id2]
import { writeFile } from 'node:fs/promises';
import { keysFromEnv, noKeysExit, runEndpoints } from './tdx/run.js';
import { firstN, fixtureName, rowsOf } from './tdx/endpoints.js';

const keys = keysFromEnv();
if (!keys) noKeysExit('record-fixtures.js');

/** 保險：移除看起來像 token、金鑰的欄位（TDX 交通資料不該有，有就丟掉） */
const SECRET = /token|secret|password|authorization|apikey/i;
const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, scrub(x)])) : v);

let saved = 0, failed = 0;
await runEndpoints(keys, async ({ ep, status, data, error, ctx }) => {
  if (status !== 200) { failed++; console.log(`❌ ${ep.id} ${status}：${error}`); return; }
  let picked;
  try {
    for (const line of ep.check?.(rowsOf(data), data, ctx) || []) console.log(`  · ${line}`); // 有些 pick 要用 check 記下的東西
    picked = ep.pick ? ep.pick(data, ctx) : firstN(data);
  } catch (e) { failed++; console.log(`❌ ${ep.id} 整理失敗：${e.message}`); return; }
  if (picked == null) { failed++; console.log(`⚪ ${ep.id} 沒存：要跟前面的端點一起錄（${ep.needs}）`); return; } // 例：國道三份要對齊同一批路段
  const out = scrub(picked);
  const file = new URL(`../test/fixtures/${fixtureName(ep.id)}`, import.meta.url);
  await writeFile(file, `${JSON.stringify(out, null, 1)}\n`);
  saved++;
  console.log(`✅ ${ep.id} → test/fixtures/${fixtureName(ep.id)}`);
}, { filter: (ep) => ep.record !== false });

console.log(`\n存了 ${saved} 個、失敗 ${failed} 個`);
process.exit(failed ? 2 : 0);
