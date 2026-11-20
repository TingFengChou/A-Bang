// 轉述受程式約束（A2）＋捷運最近站（T4／S16）：模型不能自加抵達時間與交通方式、回答不露出工具名稱、下一步依建議方式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundedPrefs, prefetchCalls, callKey, runModel } from '../core/agent/model-loop.js';
import { hideToolNames } from '../core/agent/run.js';
import { NEXT_STEP } from '../core/tools/trip.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

test('groundedPrefs：抵達時間、交通方式只採使用者說過的；其他偏好照留', () => {
  assert.deepEqual(groundedPrefs({ arriveBy: '09:00', mode: 'thsr', states: ['rush'] }, {}), { states: ['rush'] }, '模型自加的丟掉');
  assert.deepEqual(groundedPrefs({ arriveBy: '09:00' }, { arriveBy: '10:00' }), { arriveBy: '10:00' }, '用使用者說的時間');
  assert.deepEqual(groundedPrefs({}, { mode: 'bus' }), { mode: 'bus' }, '使用者說的方式要帶上（與預先查詢一致）');
  assert.deepEqual(groundedPrefs({ mode: 'walk' }, {}, { mode: 'ridehail' }), { mode: 'ridehail' }, '判斷層的方式');
});

test('hideToolNames：工具英文名稱換成中文名稱；不是工具的英文不動', () => {
  assert.equal(hideToolNames('您可以先用「metro_stations」查詢'), '您可以先用「捷運車站清單」查詢');
  assert.match(hideToolNames('我用 plan_trip 比較了'), /^我用 「[^」a-z_]+」 比較了$/);
  assert.equal(hideToolNames('snake_case_word 與 https://a.b/c_d'), 'snake_case_word 與 https://a.b/c_d');
});

test('plan_trip 給模型的文字有「下一步」：叫車不提到站提醒', async () => {
  const r = await callTool(createServices({ forceMock: true }), 'plan_trip', { from: '西門町', to: '台北101', prefs: { mode: 'ridehail' } });
  const best = r.data.options.find((o) => o.id === r.data.best);
  assert.equal(best.role, 'ridehail');
  assert.match(r.text, new RegExp(`下一步：${NEXT_STEP.ridehail.slice(0, 6)}`));
  assert.doesNotMatch(NEXT_STEP.ridehail, /到站/, '叫車的下一步不提到站（模型會照抄）');
  for (const k of ['bus', 'walk', 'bike', 'thsr', 'tra']) assert.ok(NEXT_STEP[k], k);
});

test('metro_live_board near：最近的站；3 公里外說明怎麼辦；沒有站也沒有位置要問站名', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'metro_live_board', { near: { lat: 25.0418, lon: 121.5654 } });
  assert.equal(r.data.station, '市政府');
  assert.match(r.speak, /^離你最近的是市政府（約 \d+ 公尺）/);
  const r2 = await callTool(svc, 'metro_live_board', { near: '臺北車站' });
  assert.match(r2.speak, /^離「臺北車站」最近的是/, '用預設地點時不說「離你」');
  await assert.rejects(callTool(svc, 'metro_live_board', { near: { lat: 23.0, lon: 120.2 } }), /3 公里內沒有捷運站.+站名/);
  await assert.rejects(callTool(svc, 'metro_live_board', {}), /哪一站/);
});

test('捷運沒說站：模型模式先用現在位置查最近的站；模型再查最近站沿用結果', async () => {
  const here = { lat: 25.0418, lon: 121.5654, name: '你的位置' };
  assert.deepEqual(prefetchCalls({ intent: 'metro', station: null, places: [] }, null, here), [{ name: 'metro_live_board', args: { near: here } }]);
  assert.deepEqual(prefetchCalls({ intent: 'metro', station: '市政府', places: [] }, null, here), []);
  assert.equal(callKey('metro_live_board', {}, here), callKey('metro_live_board', { near: { lat: 25.0418, lon: 121.5654 } }));
  assert.equal(callKey('metro_live_board', { station: '市政府' }, here), null);

  const es = [];
  const provider = { mode: 'local', model: 'fake', start() { let n = 0; return { next: async () => (n++ === 0 ? { text: '', calls: [{ id: 'c1', name: 'metro_live_board', input: { system: 'TRTC' } }], stop: 'tool', usage: { input: 1, output: 1 } } : { text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  await runModel(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '板南線下一班幾分' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: here }] }, (e) => es.push(e), { provider, judge: null });
  assert.equal(es.filter((e) => e.type === 'tool_result' && e.tool === 'metro_live_board').length, 1, '只有預先查的那一次');
});

test('模型自加抵達時間：丟掉後與預先查詢相同，沿用結果（不再出現第二張行程卡、「都趕不上」）', async () => {
  const here = { lat: 25.0478, lon: 121.517 };
  const es = [];
  const provider = { mode: 'local', model: 'fake', start() { let n = 0; return { next: async () => (n++ === 0 ? { text: '', calls: [{ id: 'c1', name: 'plan_trip', input: { from: '台北101', to: '台北101', prefs: { arriveBy: '00:30' } } }], stop: 'tool', usage: { input: 1, output: 1 } } : { text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  await runModel(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '去台北101' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: here }] }, (e) => es.push(e), { provider, judge: null });
  assert.equal(es.filter((e) => e.type === 'decision').length, 1);
  assert.ok(!es.some((e) => e.type === 'decision' && e.arriveBy === '00:30'));
});
