// S16 藥局定位轉行政區（2026-11-21）：「附近的藥局」用位置判斷縣市＋鄉鎮區（真實：最近氣象站；示範：內建大約中心）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { districtOf } from '../core/services/district.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { prefetchCalls } from '../core/agent/model-loop.js';

const DAAN = { lat: 25.0265, lon: 121.5436 };

test('districtOf：真實用氣象站的縣市鄉鎮；示範用內建中心；真實查不到不拿示範充數', async () => {
  const live = { weatherMode: 'live', weather: { now: async () => ({ county: '臺北市', town: '大安區' }) } };
  assert.deepEqual(await districtOf(live, DAAN), { county: '臺北市', town: '大安區', area: '臺北市大安區', demo: false });
  const liveNone = { weatherMode: 'live', weather: { now: async () => ({ county: '', town: '' }) } };
  assert.equal(await districtOf(liveNone, DAAN), null);
  const demo = { weatherMode: 'demo', weather: { now: async () => ({ county: '', town: '' }) } };
  assert.equal((await districtOf(demo, DAAN)).area, '臺北市大安區');
  assert.equal(await districtOf(demo, { lat: 23.5, lon: 121.0 }), null, '示範表 6 公里內沒有');
});

test('pharmacy_search：給座標沒給地區 → 依位置查；查不到行政區請使用者說哪一區', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'pharmacy_search', DAAN);
  assert.equal(r.data.area, '臺北市大安區');
  assert.equal(r.data.areaFrom, 'location');
  assert.match(r.text, /^依你的位置查「臺北市大安區」/);
  await assert.rejects(callTool(svc, 'pharmacy_search', { lat: 23.5, lon: 121.0 }), /請說縣市和鄉鎮區/);
  const named = await callTool(svc, 'pharmacy_search', { area: '臺北市信義區', ...DAAN });
  assert.equal(named.data.area, '臺北市信義區', '說了地區就用說的');
});

test('示範模式「附近的藥局」先定位再依位置查；模型模式預先查', async () => {
  const svc = createServices({ forceMock: true });
  const es = [];
  await runDemo(svc, { messages: [{ role: 'user', content: '附近的藥局' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: DAAN }] }, (e) => es.push(e));
  const call = es.find((e) => e.type === 'tool_start' && e.name === 'pharmacy_search');
  assert.deepEqual(call.input, { lat: DAAN.lat, lon: DAAN.lon });
  assert.match(es.find((e) => e.type === 'text').delta, /依你的位置查「臺北市大安區」/);
  const first = [];
  await runDemo(svc, { messages: [{ role: 'user', content: '附近的藥局' }], clientTools: ['device_location'] }, (e) => first.push(e));
  assert.ok(first.some((e) => e.type === 'client_tool_call'), '先請 App 定位');
  assert.deepEqual(prefetchCalls({ intent: 'pharmacy', places: [], states: [] }, null, { ...DAAN, name: '你的位置' }), [{ name: 'pharmacy_search', args: DAAN }]);
  assert.deepEqual(prefetchCalls({ intent: 'pharmacy', area: '臺北市信義區', places: [], states: [] }, null, { ...DAAN, name: '你的位置' }), [{ name: 'pharmacy_search', args: { area: '臺北市信義區' } }], '說了哪一區就查那一區');
});
