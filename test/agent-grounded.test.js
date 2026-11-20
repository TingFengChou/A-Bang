// 轉述受程式約束（A2）＋捷運最近站（T4／S16）：模型不能自加抵達時間與交通方式、回答不露出工具名稱、下一步依建議方式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundedPrefs, prefetchCalls, callKey, runModel } from '../core/agent/model-loop.js';
import { hideToolNames } from '../core/agent/run.js';
import { NEXT_STEP } from '../core/tools/trip.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

test('groundedPrefs：抵達時間、交通方式、不要的方式、狀態只採使用者說過的（規則或判斷層）', () => {
  assert.deepEqual(groundedPrefs({ arriveBy: '09:00', mode: 'thsr', states: ['rush'], avoid: ['walk'] }, {}), {}, '模型自加的時間、方式、狀態、不要的方式都丟掉');
  assert.deepEqual(groundedPrefs({}, { avoid: ['ridehail'] }), { avoid: ['ridehail'] }, '使用者說不要的方式要帶上');
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

test('使用者前文說過起點：模型把起點換成現在位置也會改回來（不出現第二張行程卡）', async () => {
  const here = { lat: 25.0478, lon: 121.517 };
  const es = [];
  const provider = { mode: 'local', model: 'fake', start() { let n = 0; return { next: async () => (n++ === 0 ? { text: '', calls: [{ id: 'c1', name: 'plan_trip', input: { from: { ...here, name: '你的位置' }, to: '台北101', prefs: { mode: 'bus' } } }], stop: 'tool', usage: { input: 1, output: 1 } } : { text: '好', calls: [], stop: 'end', usage: { input: 1, output: 1 } }), addResults() {} }; } };
  const messages = [{ role: 'user', content: '從西門町去台北101' }, { role: 'assistant', content: '建議叫車。' }, { role: 'user', content: '改坐公車' }];
  await runModel(createServices({ forceMock: true }), { messages, clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: here }] }, (e) => es.push(e), { provider, judge: null });
  const trips = es.filter((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.equal(trips.length, 1);
  assert.equal(trips[0].data.from.name, '西門町');
});

test('decide avoid：使用者說不要的方式直接排除並說明；全部排除時說清楚', async () => {
  const { decide } = await import('../core/decide.js');
  const opts = [{ id: 'r', role: 'ridehail', name: '叫車', minutes: 10, cost: 300, walkMin: 0, waitMin: 3 }, { id: 'b', role: 'bus', name: '公車 601', minutes: 25, cost: 15, walkMin: 5, waitMin: 5 }];
  const r = decide(opts, { avoid: ['ridehail'] });
  assert.equal(r.best.id, 'b');
  assert.deepEqual(r.excluded.map((e) => [e.id, e.why]), [['r', '你說不要叫車']]);
  const none = decide(opts, { avoid: ['ridehail', 'bus'] });
  assert.equal(none.best, null);
  assert.match(none.reason, /排除不適合或你說不要的方式後，沒有其他可行的方案/);
});

test('contextNote：接著改的那一輪說沿用什麼、改了什麼；理由不把「不要」說成遲到', async () => {
  const { parseIntent, contextNote } = await import('../core/agent/demo-intent.js');
  const H = (...t) => t.flatMap((x) => [{ role: 'user', content: x }, { role: 'assistant', content: '好' }]);
  assert.equal(contextNote(parseIntent('不要叫車', { history: H('從西門町叫車去台北101') })), '沿用：西門町 → 台北101｜改：不要叫車');
  assert.equal(contextNote(parseIntent('改坐公車', { history: H('從西門町去台北101') })), '沿用：西門町 → 台北101｜改：坐公車');
  assert.equal(contextNote(parseIntent('九點要到', { history: H('去台北101') })), '沿用：你的位置 → 台北101｜改：09:00 前到');
  assert.equal(contextNote(parseIntent('去台北101')), null, '不是接著改');
  const { decide } = await import('../core/decide.js');
  const opts = [{ id: 'r', role: 'ridehail', name: '叫車', minutes: 10, cost: 300, walkMin: 0, waitMin: 3 }, { id: 'b', role: 'bus', name: '公車 601', minutes: 25, cost: 15, walkMin: 5, waitMin: 5 }];
  const r = decide(opts, { avoid: ['ridehail'] });
  assert.match(r.reason, /叫車照你說的不列入/);
  assert.doesNotMatch(r.reason, /會遲到/);
});

test('A3 負面案例：「從明天開始」「從頭開始」「我從來不坐公車」不是起點；中文一到五點；前文 10 則很快', async () => {
  const { parseIntent, zhNum } = await import('../core/agent/demo-intent.js');
  const H = (...t) => t.flatMap((x) => [{ role: 'user', content: x }, { role: 'assistant', content: '好' }]);
  const h = H('從西門町去台北101');
  assert.notEqual(parseIntent('從明天開始', { history: h }).intent, 'trip');
  assert.equal(parseIntent('從頭開始吧', { history: h }).reset, true);
  const never = parseIntent('我從來不坐公車', { history: h });
  assert.deepEqual([never.from, never.avoid], ['西門町', ['bus']]);
  const bike = parseIntent('我不想騎單車', { history: h });
  assert.deepEqual([bike.mode, bike.avoid], [undefined, ['bike']], '「不想騎」是排除，不是要騎');
  assert.equal(parseIntent('從這裡出發', { history: h }).from, null, '從這裡＝現在位置');
  for (const [z, n] of [['一', 1], ['三', 3], ['五', 5], ['九', 9], ['十', 10], ['十二', 12], ['二十五', 25]]) assert.equal(zhNum(z), n, z);
  const long = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: i % 2 ? '改坐公車' : '從西門町去台北101' }));
  const t0 = performance.now();
  parseIntent('我很趕', { history: long });
  assert.ok(performance.now() - t0 < 50, '單趟累積，不再指數成長');
});

test('常用地點（S1）：回家、去公司、從公司回家、從台北101回家；沒設定不當地點；請求驗證只收台灣座標', async () => {
  const { savedTrip, parseIntent } = await import('../core/agent/demo-intent.js');
  const { validateRequest } = await import('../core/agent/run.js');
  const saved = { 家: { name: '家', lat: 25.0143, lon: 121.4635 }, 公司: { name: '公司', lat: 25.0791, lon: 121.576 } };
  const a = savedTrip('回家', [], saved);
  assert.deepEqual([a.from, a.to, a.toSaved.lat], [null, '家', 25.0143]);
  const b = savedTrip('從公司回家', [], saved);
  assert.deepEqual([b.from, b.to, Boolean(b.fromSaved && b.toSaved)], ['公司', '家', true]);
  const c = parseIntent('從台北101回家', { saved });
  assert.deepEqual([c.intent, c.from, c.to], ['trip', '台北101', '家']);
  assert.deepEqual(savedTrip('回家', [], {}), { intent: 'savedMissing', missing: '家' }, '沒設定：提示去設定');
  assert.equal(savedTrip('回家路上會下雨嗎', [], {}), null, '不是要規劃回家');
  assert.equal(savedTrip('公司附近的藥局', [], {}), null);
  assert.equal(savedTrip('上班', [], {}).missing, '公司');
  assert.equal(parseIntent('去公司', { saved }).to, '公司');
  assert.throws(() => validateRequest({ messages: [{ role: 'user', content: '回家' }], savedPlaces: { 家: { name: '家', lat: 35.6, lon: 139.7 } } }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ messages: [{ role: 'user', content: '回家' }], savedPlaces: { 宿舍: { name: 'x', lat: 25, lon: 121 } } }), /請求格式錯誤/);
});
