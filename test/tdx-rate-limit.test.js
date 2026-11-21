// TDX 免費方案的頻率限制：請求排隊、429 時等一下重試一次（2026-11-21 實機：行程比較連續呼叫被擋）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTdxClient, TdxError } from '../core/tdx-client.js';

const tokenRes = () => ({ ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) });
const ok = (data) => ({ ok: true, status: 200, json: async () => data, headers: { get: () => null } });
const tooMany = () => ({ ok: false, status: 429, text: async () => '', headers: { get: () => null } });
const limit = { concurrent: 2, gapMs: 0, retryMs: 5 };

test('429 時等一下重試一次，第二次成功就回資料', async () => {
  let n = 0;
  const fetchImpl = async (url) => (url.includes('/token') ? tokenRes() : (++n === 1 ? tooMany() : ok({ v: 1 })));
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit });
  assert.deepEqual(await c.get('/x'), { v: 1 });
  assert.equal(n, 2);
});

test('重試後仍 429：回 TdxError 429', async () => {
  const fetchImpl = async (url) => (url.includes('/token') ? tokenRes() : tooMany());
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit });
  await assert.rejects(c.get('/y'), (e) => e instanceof TdxError && e.status === 429);
});

test('同時最多 concurrent 個請求在飛（排隊）', async () => {
  let inFlight = 0, peak = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/token')) return tokenRes();
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 15));
    inFlight--;
    return ok({ url });
  };
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit });
  await Promise.all([1, 2, 3, 4, 5, 6].map((i) => c.get(`/z${i}`)));
  assert.ok(peak <= 2, `peak ${peak}`);
});

test('額度用完：錯誤訊息說每分鐘幾次、幾秒後再試', async () => {
  const headers = { get: (k) => ({ 'ratelimit-reset': '4', 'x-ratelimit-limit-minute': '5' })[k] ?? null };
  const fetchImpl = async (url) => (url.includes('/token') ? tokenRes() : { ok: false, status: 429, text: async () => '', headers });
  const c = createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl, limit });
  await assert.rejects(c.get('/w'), (e) => e.status === 429 && /每分鐘 5 次/.test(e.message) && /約 4 秒後/.test(e.message));
});

test('TDX 額度用完：這一次改用示範資料，結果標成示範（不讓整個查詢失敗）', async () => {
  const { withTdxFallback } = await import('../core/index.js');
  const { measure } = await import('../core/metrics.js');
  const live = { routeEta: async () => { throw new TdxError(429, 'x'); }, other: async () => { throw new TdxError(500, 'y'); }, sync: () => 1 };
  const mock = { routeEta: async () => ({ demo: true }), other: async () => ({}), sync: () => 2 };
  const svc = withTdxFallback(live, mock);
  const { result, metrics } = await measure(() => svc.routeEta());
  assert.deepEqual(result, { demo: true });
  assert.equal(metrics.fallback, true);
  await assert.rejects(svc.other(), (e) => e.status === 500, '其他錯誤照常拋出');
  assert.equal(svc.sync(), 1, '同步方法不變');
  const nested = withTdxFallback({ bus: { routeEta: async () => { throw new TdxError(429, 'x'); } } }, { bus: { routeEta: async () => ({ demo: 'bus' }) } });
  assert.deepEqual((await measure(() => nested.bus.routeEta())).result, { demo: 'bus' }, '分層的服務也會改用示範資料');
});
