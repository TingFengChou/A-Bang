// 高鐵／台鐵沒說起站用最近的車站（S16，2026-11-21）：規則 railOD、工具 near、最近站沒直達時換下一站、迄站排除
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, needsLocation } from '../core/agent/demo-intent.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { callKey } from '../core/agent/model-loop.js';

test('規則：起訖站、只有迄站、句中地名、票價；「下一班」「我要坐」「明天」「家」不是站', () => {
  const cases = [
    ['下一班高鐵到台中', { from: null, to: '台中' }],
    ['高鐵台北到台中下一班幾點？', { from: '台北', to: '台中' }],
    ['從板橋到台中的高鐵下一班', { from: '板橋', to: '台中' }],
    ['台北車站到花蓮的火車幾點', { from: '台北', to: '花蓮' }],
    ['從台北搭高鐵到台中幾點', { from: '台北', to: '台中' }],
    ['明天高鐵到左營首班幾點', { from: null, to: '左營' }],
  ];
  for (const [q, want] of cases) {
    const it = parseIntent(q);
    assert.deepEqual([it.intent, it.from, it.to], ['rail', want.from, want.to], q);
  }
  assert.notEqual(parseIntent('火車回家幾點').intent, 'rail');
  const near = parseIntent('我在板橋，高鐵到台中幾點');
  assert.deepEqual([near.from, near.to, needsLocation(near)], [null, '台中', false]);
  assert.ok(near.near);
  const fare = parseIntent('高鐵票價台北到左營');
  assert.deepEqual([fare.fare, fare.from, fare.to], [true, '台北', '左營']);
  assert.equal(parseIntent('坐火車去花蓮').intent, 'trip', '沒問班次是行程');
});

test('工具 near：最近的站、就在附近、排除迄站、太遠說明（花東建議台鐵）、舊的 {from,to} 照常', async () => {
  const svc = createServices({ forceMock: true });
  const a = await callTool(svc, 'thsr_timetable', { to: '台中', near: { lat: 25.0418, lon: 121.5654 } });
  assert.match(a.speak, /^離你最近的高鐵站是南港（約 4\.4 公里）/);
  assert.match(a.text, /^（使用者沒說起站，用最近的車站）/);
  const b = await callTool(svc, 'tra_timetable', { to: '花蓮', near: '台北車站' });
  assert.match(b.speak, /^「台北車站」就在臺北站附近。/);
  const c = await callTool(svc, 'thsr_timetable', { to: '南港', near: { lat: 25.0533, lon: 121.6070 } });
  assert.equal(c.data.from, '台北', '最近的站就是迄站時換下一站');
  await assert.rejects(callTool(svc, 'thsr_timetable', { to: '台中', near: '花蓮車站' }), /沒有高鐵，要改查台鐵嗎/);
  await assert.rejects(callTool(svc, 'thsr_timetable', { to: '台中' }), /請告訴我從哪一個高鐵站出發/);
  const d = await callTool(svc, 'thsr_timetable', { from: '台北', to: '台中' });
  assert.equal(d.data.nearest, undefined);
});

test('最近的站沒有直達車：換下一站並說明', async () => {
  const svc = createServices({ forceMock: true });
  const real = svc.rail.traTimetable.bind(svc.rail);
  svc.rail.traTimetable = async (a) => (a.from === '臺北' ? { ...(await real(a)), trains: [] } : real(a));
  const r = await callTool(svc, 'tra_timetable', { to: '花蓮', near: { lat: 25.0478, lon: 121.517 } });
  assert.notEqual(r.data.from, '臺北');
  assert.match(r.speak, /^臺北站沒有直達車，改從.+站（約/);
});

test('callKey：時刻表以起訖站與日期比對；沒有起站不比對', () => {
  assert.equal(callKey('thsr_timetable', { from: '臺北', to: '台中' }), callKey('thsr_timetable', { from: '台北', to: '台中' }));
  assert.equal(callKey('thsr_timetable', { to: '台中', near: { lat: 25, lon: 121 } }), null);
});
