// 轉述受程式約束（A2）＋捷運最近站（T4／S16）：模型不能自加抵達時間與交通方式、回答不露出工具名稱、下一步依建議方式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundedPrefs, prefetchCalls, callKey, runModel } from '../core/agent/model-loop.js';
import { hideToolNames } from '../core/agent/run.js';
import { NEXT_STEP } from '../core/tools/trip.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

test('groundedPrefs：抵達時間、交通方式、狀態只採使用者說過的（規則或判斷層）；其他偏好照留', () => {
  assert.deepEqual(groundedPrefs({ arriveBy: '09:00', mode: 'thsr', states: ['rush'], avoid: ['walk'] }, {}), { avoid: ['walk'] }, '模型自加的時間、方式、狀態都丟掉');
  assert.deepEqual(groundedPrefs({ arriveBy: '09:00' }, { arriveBy: '10:00' }), { arriveBy: '10:00' }, '用使用者說的時間');
  assert.deepEqual(groundedPrefs({}, { mode: 'bus' }), { mode: 'bus' }, '使用者說的方式要帶上（與預先查詢一致）');
  assert.deepEqual(groundedPrefs({ mode: 'walk' }, {}, { mode: 'ridehail', states: [] }), { mode: 'ridehail' }, '判斷層的方式');
  assert.deepEqual(groundedPrefs({ states: ['budget'] }, { states: ['rush'] }), { states: ['rush'] }, '沒有判斷層：用規則的狀態');
  assert.deepEqual(groundedPrefs({ states: ['budget'] }, { states: ['rush'] }, { states: ['luggage'] }), { states: ['luggage'] }, '有判斷層：用判斷層的狀態');
});

test('中文時間也抽得到（「九點半前」「下午兩點前到」「早上10點到」）；「10點出發」不是抵達時間', async () => {
  const { arriveByOf, parseIntent } = await import('../core/agent/demo-intent.js');
  assert.equal(arriveByOf('九點半前到台北101'), '09:30');
  assert.equal(arriveByOf('下午兩點前到西門町'), '14:00');
  assert.equal(arriveByOf('早上10點到台北101'), '10:00');
  assert.equal(arriveByOf('十二點前'), '12:00');
  assert.equal(arriveByOf('10點出發去台北101'), null);
  assert.equal(groundedPrefs({ arriveBy: '09:30' }, parseIntent('九點半前到台北101')).arriveBy, '09:30', '模型填對的時間不會被刪');
});

test('起訖點依提示詞判斷：「去台北101，從西門町出發」起點是西門町', async () => {
  const { parseIntent } = await import('../core/agent/demo-intent.js');
  for (const [q, from, to] of [['去台北101，從西門町出發', '西門町', '台北101'], ['西門町出發去台北101', '西門町', '台北101'], ['台北101到西門町怎麼去', '台北101', '西門町'], ['從西門町到台北101', '西門町', '台北101']]) {
    const it = parseIntent(q);
    assert.deepEqual([it.intent, it.from, it.to], ['trip', from, to], q);
  }
});

test('hideToolNames：工具英文名稱換成口語名稱；網址與不是工具的英文不動', () => {
  assert.equal(hideToolNames('您可以先用「metro_stations」查詢'), '您可以先用「捷運車站清單」查詢');
  assert.equal(hideToolNames('我用 plan_trip 比較了'), '我用「行程比較」比較了');
  assert.equal(hideToolNames('呼叫 weather_now() 後'), '呼叫「現在天氣」後');
  assert.equal(hideToolNames('看 https://x.tw/plan_trip?a=1 這裡'), '看 https://x.tw/plan_trip?a=1 這裡');
  assert.equal(hideToolNames('snake_case_word 不動'), 'snake_case_word 不動');
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
  assert.match(r2.speak, /^台北車站：/, '用預設地點時不說「離你」；地點就是那一站時不重複');
  const r3 = await callTool(svc, 'metro_live_board', { near: '西門町' });
  assert.match(r3.speak, /^離「西門町」最近的是西門（約 \d+ 公尺）/);
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
