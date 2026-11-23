// 離線與弱網（2026-11-21）：只存明確允許的查詢（到站 10 分鐘、路線與時刻表 24 小時）；連不上、逾時、閘道錯誤、
// 公共 Wi-Fi 登入頁都用上次的資料並標出時間；有座標的不存；過期的刪掉；整份有大小上限
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { if (String(v).length > 500_000) throw new Error('QuotaExceeded'); store.set(k, String(v)); }, removeItem: (k) => store.delete(k) };
const events = [];
const origDispatch = globalThis.dispatchEvent;
globalThis.dispatchEvent = (e) => { events.push([e.type, e.detail]); return origDispatch?.call(globalThis, e); };
let mode = 'ok';
let calls = 0;
globalThis.fetch = async (url) => {
  calls++;
  if (mode === 'offline') throw new TypeError('Failed to fetch');
  if (mode === 'portal') return { ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } };
  if (mode === '502') return { ok: false, status: 502, json: async () => ({}) };
  if (mode === '400') return { ok: false, status: 400, json: async () => ({ error: '參數錯誤' }) };
  if (mode === 'fallback') return { ok: true, status: 200, json: async () => ({ mode: 'demo', fallback: 'tdx-limit', data: { url: String(url), n: calls, fallback: true } }) };
  return { ok: true, status: 200, json: async () => ({ mode: 'demo', data: { url: String(url), n: calls, pad: mode === 'big' ? 'x'.repeat(40_000) : '' } }) };
};
const { api, state, CACHE_MAX, CACHE_BYTES, TTL, clearOfflineCache } = await import('../public/js/api.js');

beforeEach(() => { store.clear(); events.length = 0; mode = 'ok'; state.staleAt = null; });

test('連不上、逾時（TypeError）、閘道錯誤、Wi-Fi 登入頁：用上次的資料並標時間；連回來清掉標示', async () => {
  const a = await api.busEta('Taipei', '307');
  for (const m of ['offline', '502', 'portal']) {
    mode = m;
    state.staleAt = null;
    assert.deepEqual(await api.busEta('Taipei', '307'), a, m);
    assert.ok(state.staleAt, m);
  }
  assert.equal(events.at(-1)[0], 'abang:stale');
  assert.equal(JSON.parse(store.get('abang.offline'))['/api/v1/bus/eta?city=Taipei&route=307'].data.n, a.n, '登入頁不覆蓋好的資料');
  mode = '400';
  await assert.rejects(api.busEta('Taipei', '307'), /參數錯誤/, '4xx 照實回錯誤，不用舊資料');
  mode = 'ok';
  await api.busEta('Taipei', '307');
  assert.equal(state.staleAt, null);
  assert.equal(events.at(-1)[0], 'abang:fresh');
});

test('附近查詢（含座標）不存；沒存過的離線時說連不上', async () => {
  await api.busNearby(25.04, 121.51);
  assert.ok(!(store.get('abang.offline') || '').includes('25.04'), '不留位置紀錄');
  mode = 'offline';
  await assert.rejects(api.busNearby(25.04, 121.51), /連不上網路/);
  await assert.rejects(api.thsrTimetable('台北', '左營', '2026-11-22'), /連不上網路/);
});

test('到站時間只留 10 分鐘、時刻表 24 小時；過期的刪掉；最多 30 筆；整份有大小上限；清除', async () => {
  await api.busEta('Taipei', '307');
  await api.thsrTimetable('台北', '左營', '2026-11-22');
  const all = JSON.parse(store.get('abang.offline'));
  for (const k of Object.keys(all)) all[k].at -= TTL.eta + 1000; // 11 分鐘前
  store.set('abang.offline', JSON.stringify(all));
  mode = 'offline';
  await assert.rejects(api.busEta('Taipei', '307'), /連不上網路/, '到站時間過期不用');
  assert.ok(await api.thsrTimetable('台北', '左營', '2026-11-22'), '時刻表還能用');
  mode = 'ok';
  await api.busRoutes('Taipei', '1');
  assert.deepEqual(Object.keys(JSON.parse(store.get('abang.offline'))).sort(), ['/api/v1/bus/routes?city=Taipei&keyword=1', '/api/v1/thsr/timetable?from=台北&to=左營&date=2026-11-22'].map((k) => k.replace(/台北|左營/g, (x) => encodeURIComponent(x))).sort(), '過期的刪掉');
  for (let i = 0; i < CACHE_MAX + 5; i++) await api.busEta('Taipei', String(100 + i));
  assert.ok(Object.keys(JSON.parse(store.get('abang.offline'))).length <= CACHE_MAX);
  mode = 'big';
  for (let i = 0; i < 12; i++) await api.busEta('Taipei', String(500 + i));
  assert.ok(store.get('abang.offline').length <= CACHE_BYTES, '不擠掉收藏、我的發票的空間');
  clearOfflineCache();
  assert.equal(store.get('abang.offline'), undefined);
});

test('TDX 額度用完、伺服器這次改用示範資料（fallback）：照常顯示但不存成上次的資料', async () => {
  const good = await api.busEta('Taipei', '307');
  mode = 'fallback';
  const fb = await api.busEta('Taipei', '307');
  assert.equal(fb.fallback, true);
  assert.equal(state.mode, 'demo');
  assert.equal(JSON.parse(store.get('abang.offline'))['/api/v1/bus/eta?city=Taipei&route=307'].data.n, good.n, '示範資料不覆蓋好的資料');
  store.clear();
  await api.busEta('Taipei', '307');
  assert.equal(store.get('abang.offline'), undefined, '只有示範資料時不存');
});
