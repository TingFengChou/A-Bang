// P0-2：靜態資料下載失敗後退避（上游壞了別每一題都重打，把每分鐘 5 次額度吃光）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTdxClient, TdxError, TdxYield } from '../core/tdx-client.js';

const T0 = Date.parse('2026-11-23T02:00:10Z');
const MIN = 60_000;
function setup() {
  let t = T0;
  const tdx = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl: async () => new Response('[]'), now: () => t });
  return { tdx, at: (ms) => { t = T0 + ms; } };
}
const broken = () => {
  const s = { n: 0, ok: false };
  s.loader = async () => { s.n++; if (s.ok) return [{ id: 1 }]; const e = new Error('TDX 回了空的捷運站'); e.status = 502; throw e; };
  return s;
};

test('失敗後 1、2、4 分鐘內不再下載，退避期間立刻丟同樣的錯', async () => {
  const { tdx, at } = setup();
  const s = broken();
  const get = () => tdx.cached('metro-stations-TRTC', 86400, s.loader);
  await assert.rejects(get(), (e) => e.status === 502 && !e.backoff);
  await assert.rejects(get(), (e) => e.status === 502 && e.backoff && /空的捷運站/.test(e.message));
  assert.equal(s.n, 1, '退避中不下載');
  at(MIN + 1);
  await assert.rejects(get());
  assert.equal(s.n, 2, '1 分鐘後再試一次');
  at(2 * MIN + 1);
  await assert.rejects(get(), (e) => e.backoff);
  assert.equal(s.n, 2, '第二次失敗退避 2 分鐘');
  at(3 * MIN + 2);
  s.ok = true;
  assert.deepEqual(await get(), [{ id: 1 }]);
  assert.equal(s.n, 3);
});

test('成功後重新計算：下一次失敗又從 1 分鐘開始', async () => {
  const { tdx, at } = setup();
  const s = broken();
  const get = (key) => tdx.cached(key, 86400, s.loader);
  await assert.rejects(get('k'));
  at(MIN + 1);
  s.ok = true;
  await get('k');
  s.ok = false;
  await assert.rejects(get('k2'));
  at(2 * MIN + 2);
  await assert.rejects(get('k2'), (e) => !e.backoff);
  assert.equal(s.n, 4, '不同的 key 各自計算');
});

test('預熱（force）不受退避影響，照排程重試', async () => {
  const { tdx } = setup();
  const s = broken();
  await assert.rejects(tdx.cached('k', 86400, s.loader));
  await assert.rejects(tdx.cached('k', 86400, s.loader, { background: true, force: true }), (e) => !e.backoff);
  assert.equal(s.n, 2);
});

test('有舊資料時照用舊的，退避期間背景也不更新', async () => {
  const { tdx, at } = setup();
  const s = broken();
  s.ok = true;
  await tdx.cached('k', 60, s.loader, { persist: false });
  s.ok = false;
  at(2 * MIN); // 過期：先用舊的、背景更新（失敗 → 退避）
  assert.deepEqual(await tdx.cached('k', 60, s.loader, { persist: false }), [{ id: 1 }]);
  await new Promise((r) => setImmediate(r));
  assert.equal(s.n, 2);
  assert.deepEqual(await tdx.cached('k', 60, s.loader, { persist: false }), [{ id: 1 }]);
  await new Promise((r) => setImmediate(r));
  assert.equal(s.n, 2, '退避中背景也不打');
});

test('額度用完（429）與背景讓位不退避：那由全站的額度閘門管', async () => {
  const { tdx } = setup();
  let n = 0;
  const quota = async () => { n++; throw new TdxError(429, 'TDX 呼叫次數已達方案上限'); };
  await assert.rejects(tdx.cached('q', 86400, quota));
  await assert.rejects(tdx.cached('q', 86400, quota), (e) => !e.backoff);
  assert.equal(n, 2);
  let m = 0;
  const yieldy = async () => { m++; throw new TdxYield(); };
  await assert.rejects(tdx.cached('y', 86400, yieldy, { background: true }));
  await assert.rejects(tdx.cached('y', 86400, yieldy, { background: true }));
  assert.equal(m, 2);
});

test('TDX 錯誤退避時仍是 TdxError（上層照原本的方式分類）', async () => {
  const { tdx } = setup();
  const l = async () => { throw new TdxError(503, 'TDX API 錯誤 503'); };
  await assert.rejects(tdx.cached('t', 86400, l));
  await assert.rejects(tdx.cached('t', 86400, l), (e) => e instanceof TdxError && e.status === 503 && e.backoff);
});

test('退避中丟的錯照帶給使用者看的那句（publicMessage）', async () => {
  const { shown, publicMessage } = await import('../core/util.js');
  const { tdx } = setup();
  const l = async () => { throw shown(new TdxError(503, 'TDX API 錯誤 503：內部細節'), '交通資料（TDX）暫時無法取得'); };
  await assert.rejects(tdx.cached('p', 86400, l));
  await assert.rejects(tdx.cached('p', 86400, l), (e) => e.backoff && publicMessage(e) === '交通資料（TDX）暫時無法取得');
});

test('部署檢查：存檔目錄寫得進去回 null；沒設或寫不進去說清楚（示範模式不檢查）', async () => {
  const { mkdtemp, writeFile: wf, rm, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServices } = await import('../core/index.js');
  const dir = await mkdtemp(join(tmpdir(), 'abang-store-'));
  try {
    const ok = createServices({ clientId: 'a', clientSecret: 'b', tdx: { cacheDir: join(dir, 'tdx') } });
    assert.equal(await ok.tdxStoreCheck(), null);
    assert.deepEqual(await readdir(join(dir, 'tdx')), [], '探測檔有清掉');
    const off = createServices({ clientId: 'a', clientSecret: 'b', tdx: { cacheDir: null } });
    assert.match(await off.tdxStoreCheck(), /TDX_CACHE_DIR=off/);
    await wf(join(dir, 'file'), 'x'); // 目錄位置是一個檔案：建不起來
    const bad = createServices({ clientId: 'a', clientSecret: 'b', tdx: { cacheDir: join(dir, 'file', 'tdx') } });
    assert.match(await bad.tdxStoreCheck(), /寫不進去/);
    assert.equal(createServices({}).tdxStoreCheck, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('使用者輸入錯誤不退避；連線失敗退避', async () => {
  const { UserError } = await import('../core/util.js');
  const { tdx } = setup();
  let n = 0;
  const bad = async () => { n++; throw new UserError('台北市找不到路線「999」'); };
  await assert.rejects(tdx.cached('u', 86400, bad), UserError);
  await assert.rejects(tdx.cached('u', 86400, bad), UserError);
  assert.equal(n, 2);
  const net = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(tdx.cached('n', 86400, net));
  await assert.rejects(tdx.cached('n', 86400, net), (e) => e.backoff && e.name === 'TypeError');
});
