// 離線與弱網（2026-11-21）：成功的回應存在手機；連不上時用上次的資料並標出時間；附近查詢（含座標）不存；過期不用；上限
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const events = [];
globalThis.addEventListener ||= () => {};
const origDispatch = globalThis.dispatchEvent;
globalThis.dispatchEvent = (e) => { events.push([e.type, e.detail]); return origDispatch?.call(globalThis, e); };
let online = true;
let calls = 0;
globalThis.fetch = async (url) => {
  calls++;
  if (!online) throw new TypeError('Failed to fetch');
  return { ok: true, status: 200, json: async () => ({ mode: 'demo', data: { url: String(url), n: calls } }) };
};
const { api, state, CACHE_MAX, CACHE_TTL, clearOfflineCache } = await import('../public/js/api.js');

beforeEach(() => { store.clear(); events.length = 0; online = true; state.staleAt = null; });

test('連得上：照常回傳並存起來；連不上：用上次的資料、標出時間；再連上清掉標示', async () => {
  const a = await api.busEta('Taipei', '307');
  online = false;
  const b = await api.busEta('Taipei', '307');
  assert.deepEqual(b, a, '離線時拿到上次的資料');
  assert.ok(state.staleAt && Date.now() - state.staleAt < 5000);
  assert.equal(events.at(-1)[0], 'abang:stale');
  online = true;
  await api.busEta('Taipei', '307');
  assert.equal(state.staleAt, null);
  assert.equal(events.at(-1)[0], 'abang:fresh');
});

test('附近查詢（含座標）不存；沒存過的離線時說連不上', async () => {
  await api.busNearby(25.04, 121.51);
  assert.ok(!(store.get('abang.offline') || '').includes('25.04'), '不留位置紀錄');
  online = false;
  await assert.rejects(api.busNearby(25.04, 121.51), /連不上網路/);
  await assert.rejects(api.thsrTimetable('台北', '左營', '2026-11-22'), /連不上網路/);
});

test('超過 24 小時不用；最多存 30 筆（丟最舊的）；清除', async () => {
  await api.busEta('Taipei', '307');
  const all = JSON.parse(store.get('abang.offline'));
  for (const k of Object.keys(all)) all[k].at -= CACHE_TTL + 1000;
  store.set('abang.offline', JSON.stringify(all));
  online = false;
  await assert.rejects(api.busEta('Taipei', '307'), /連不上網路/);
  online = true;
  for (let i = 0; i < CACHE_MAX + 5; i++) await api.busEta('Taipei', String(100 + i));
  assert.equal(Object.keys(JSON.parse(store.get('abang.offline'))).length, CACHE_MAX);
  clearOfflineCache();
  assert.equal(store.get('abang.offline'), undefined);
});
