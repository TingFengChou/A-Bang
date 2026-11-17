// 叫車（M3-09）：Uber 深層連結格式與編碼、距離估價、tool（L2、地名、確認文字）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uber } from '../core/providers/ridehail/uber.js';
import { estimateFare, createRidehailServices, FARE } from '../core/providers/ridehail/index.js';
import { callTool, getTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const TPE = { lat: 25.0478, lon: 121.517, name: '臺北車站' };
const T101 = { lat: 25.033964, lon: 121.564468, name: '台北101 & 信義' };

test('uber.link：沒有上車點用 my_location；座標 6 位小數；暱稱編碼', () => {
  const u = uber.link({ to: T101 });
  assert.ok(u.startsWith('https://m.uber.com/ul/?action=setPickup&pickup=my_location&'));
  assert.ok(u.includes('dropoff[latitude]=25.033964&dropoff[longitude]=121.564468'));
  assert.ok(u.includes(`dropoff[nickname]=${encodeURIComponent('台北101 & 信義')}`));
  assert.ok(!u.includes('& 信義'));
  const withFrom = new URL(uber.link({ from: TPE, to: T101 }));
  assert.equal(withFrom.searchParams.get('pickup[latitude]'), '25.047800');
  assert.equal(withFrom.searchParams.get('pickup'), null);
  assert.equal(withFrom.searchParams.get('dropoff[nickname]'), '台北101 & 信義');
});

test('estimateFare：起跳、續程、區間與標示', () => {
  assert.deepEqual(estimateFare(500), { low: FARE.baseTWD, high: 115, distanceKm: 0.7, currency: 'TWD', estimated: true, basis: estimateFare(0).basis });
  const e = estimateFare(10000); // 道路 13 km → 起跳後 59 跳 × 5 = 380 元
  assert.deepEqual([e.low, e.high, e.distanceKm], [380, 495, 13]);
  assert.match(e.basis, /估算/);
});

test('ridehail.link：未知 provider 錯誤；沒有上車點不估價', async () => {
  const { ridehail } = createRidehailServices();
  await assert.rejects(ridehail.link({ provider: 'taxi', to: T101 }), /不支援的叫車服務/);
  assert.equal((await ridehail.link({ to: T101 })).estimate, null);
});

test('ridehail_link tool：L2、pack ridehail、地名轉座標、估價、確認文字', async () => {
  const t = getTool('ridehail_link');
  assert.deepEqual([t.tier, t.pack, t.static], ['L2', 'ridehail', true]);
  assert.match(t.description, /必須先向使用者確認/);
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'ridehail_link', { from: '台北車站', to: '台北101' });
  assert.deepEqual([r.data.provider, r.data.from, r.data.to], ['uber', '臺北車站', '台北101']);
  assert.ok(r.data.url.startsWith('https://m.uber.com/ul/?action=setPickup&pickup[latitude]='));
  assert.ok(r.data.estimate.low > FARE.baseTWD && r.data.estimate.estimated);
  assert.match(r.data.confirmText, /要開啟 Uber 叫車到「台北101」嗎/);
  assert.match(r.speak, /^Uber叫車連結準備好了，到台北101，估計 \d+～\d+ 元（估算）/);
  const noFrom = await callTool(svc, 'ridehail_link', { to: { lat: 25.033964, lon: 121.564468 } });
  assert.equal(noFrom.data.estimate, null);
  assert.match(noFrom.data.url, /pickup=my_location/);
  await assert.rejects(callTool(svc, 'ridehail_link', { to: '不存在的地方xyz' }), /找不到/);
  await assert.rejects(callTool(svc, 'ridehail_link', { to: '台北101', provider: 'lyft' }), /參數錯誤/);
});
