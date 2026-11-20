// 決策感與動畫背後的資料：資料對決策的影響、行程前阿幫的一句、公車還有幾站、發票對中幾碼（都來自真實資料，不編造）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impactOf, judgeNote, moreStatesNote } from '../core/agent/impact.js';
import { railOf } from '../public/ui/cards/cards/bus-route.js';
import { hitDigits } from '../public/ui/cards/cards/invoice.js';
import { runDemo } from '../core/agent/run.js';
import { createJudge } from '../core/agent/judge.js';
import { createServices } from '../core/index.js';

test('impactOf：下雨／空品／路況／比較結果對決策的影響（不利、有利、不影響）', () => {
  assert.equal(impactOf('weather_now', { raining: true }).tone, 'bad');
  assert.equal(impactOf('weather_now', { raining: false, pop3h: 10 }).tone, 'good');
  assert.match(impactOf('weather_now', { raining: false, pop3h: 70 }).text, /降雨機率 70%/);
  assert.deepEqual(impactOf('aqi_nearby', { nearest: { aqi: 130 } }), { tone: 'bad', text: 'AQI 130：空品不佳，戶外方式扣分' });
  assert.equal(impactOf('aqi_nearby', { nearest: { aqi: 58 } }).tone, 'neutral');
  assert.match(impactOf('traffic_status', { covered: true, level: 'jam', delayMin: 49 }).text, /塞車約 49 分/);
  assert.equal(impactOf('traffic_status', { covered: false }).tone, 'neutral');
  assert.match([impactOf('plan_trip', { best: 'bus-601', options: [{ id: 'bus-601', name: '公車 601' }, { id: 'walk' }], ranking: { ranked: [{ id: 'bus-601', score: 69 }] } })].flat()[0].text, /比了 2 種走法：公車 601 69 分最高/);
  assert.equal(impactOf('find_place', {}), null);
});

test('judgeNote：行程前說一句有資訊的話；接著改交通方式說照你說的重算；其他查詢不說', () => {
  assert.equal(judgeNote({ intent: 'trip', states: ['rush', 'budget'] }), '你趕時間、想省錢，我先看天氣、空品、路況，再比較幾種走法');
  assert.equal(judgeNote({ intent: 'trip', states: [], followUp: true, mode: 'bus' }), '照你說的改成坐公車，用剛才的起點和目的地重算');
  assert.equal(judgeNote({ intent: 'weather', states: [] }), null, '不是行程不說（不再每次都說「我聽懂了」）');
  assert.equal(judgeNote({ intent: 'unknown', states: [] }), null);
});

test('示範模式＋判斷層：第一句說你的狀況與要查什麼，資料回報帶 impact', async () => {
  const judge = createJudge({ embed: async () => ({ intent: 'trip', confidence: 0.95, states: [] }) });
  const es = [];
  await runDemo(createServices({ forceMock: true, demo: { weather: 'rain' } }), { messages: [{ role: 'user', content: '想省錢，從西門町到台北101' }] }, (e) => es.push(e), { judge });
  assert.match(es.find((e) => e.type === 'agent_note').text, /^你想省錢，我先看天氣/);
  const w = es.find((e) => e.type === 'tool_result' && e.tool === 'weather_now');
  assert.deepEqual(w.impact, { tone: 'bad', text: '下雨：走路、YouBike 在「戶外」會扣分' });
});

test('railOf：上車站之前到站時間比較早的連續站＝公車還要經過的站；不能推估就回 null', () => {
  const st = (seq, etaSec, status = 0) => ({ seq, stopName: `站${seq}`, etaSec, status });
  const dir = { stops: [st(1, 900), st(2, 60), st(3, 150), st(4, 240), st(5, 330), st(6, 700)] };
  const r = railOf(dir, { seq: 5, etaSec: 330, status: 0 });
  assert.equal(r.away, 3, '站 2、3、4 比站 5 早到');
  assert.deepEqual(r.window.map((s) => s.seq), [1, 2, 3, 4, 5]);
  assert.equal(r.busAt, 0.5, '車在站 1 與站 2 之間');
  assert.equal(railOf(dir, { seq: 2, etaSec: 60, status: 0 }).away, 0);
  const near = railOf({ stops: [st(1, 30), st(2, 180), st(3, 300)] }, { seq: 3, etaSec: 300, status: 0 });
  assert.deepEqual([near.away, near.busAt], [2, 0], '車在視窗第一站：停在軌道起點，不是負的');
  assert.equal(railOf(dir, { seq: 5, etaSec: null, status: 1 }), null);
});

test('hitDigits：對中幾碼（特別獎到頭獎 8 碼、二～六獎 7～3 碼、只給末 3 碼 3 碼、沒中 0）', () => {
  assert.deepEqual(['特別獎', '頭獎', '二獎', '六獎'].map((prize) => hitDigits({ prize })), [8, 8, 7, 3]);
  assert.equal(hitDigits({ prize: '可能中獎（末 3 碼與頭獎相同）', partial: true }), 3);
  assert.equal(hitDigits({ prize: null }), 0);
});

test('快速判斷先說聽懂了（不等模型），完整判斷多找到的狀態再補一句', async () => {
  let llmCalls = 0;
  const judge = createJudge({
    embed: async () => ({ intent: 'trip', confidence: 0.95, states: ['luggage'] }),
    llm: async () => { llmCalls++; return { intent: 'trip', states: ['luggage'] }; },
  });
  const q = await judge.quick('帶行李從台北車站到松山機場');
  assert.equal(llmCalls, 0, '快速版不問模型');
  assert.equal(q.intent, 'trip');
  assert.equal(moreStatesNote({ states: [] }, { states: ['luggage', 'rush'] }), '我還注意到你帶行李、趕時間，會一起算進去');
  assert.equal(moreStatesNote({ states: ['rush'] }, { states: ['rush'] }), null);
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '帶行李從台北車站到松山機場' }] }, (e) => es.push(e), { judge });
  assert.equal(llmCalls, 1, '完整版仍會問一次模型');
  assert.match(es.find((e) => e.type === 'agent_note').text, /^你帶行李，我先看天氣/);
});

test('YouBike 兩端：優先選車夠、空位夠的站；很緊時警告並給備用站；起點沒車或終點沒空位寫出原因', async () => {
  const { pickBikeStation, BIKE_SAFE } = await import('../core/services/trip.js');
  const st = (name, distance, rent, returnSlots) => ({ uid: name, name, distance, rent, returnSlots });
  // 最近的只剩 1 個空位、多走 200 公尺有 8 個 → 選空位多的
  assert.equal(pickBikeStation([st('近', 80, 5, 1), st('遠一點', 280, 5, 8)], 'returnSlots', BIKE_SAFE.slots).pick.name, '遠一點');
  // 夠的站太遠（多 600 公尺）→ 選近的，但標為很緊、備用是遠的
  const r = pickBikeStation([st('近', 80, 5, 1), st('很遠', 680, 5, 8)], 'returnSlots', BIKE_SAFE.slots);
  assert.deepEqual([r.pick.name, r.tight, r.backup.name], ['近', true, '很遠']);
  assert.equal(pickBikeStation([st('滿', 50, 5, 0)], 'returnSlots', 3), null, '都沒空位');

  const base = { options: [{ id: 'walk', role: 'walk', name: '步行' }], best: 'walk', ranking: { ranked: [{ id: 'walk', score: 80 }] } };
  const [, tight] = impactOf('plan_trip', { ...base, options: [...base.options, { id: 'bike', role: 'bike', bike: { rent: { name: 'A', count: 9, tight: false }, ret: { name: '市府站', count: 1, tight: true, backup: { name: '松壽廣場', count: 12 } } } }] });
  assert.deepEqual(tight, { tone: 'bad', text: 'YouBike：「市府站」只剩 1 個空位，停滿就改還「松壽廣場」' }, '給下一步（審查建議）');
  const [, skip] = impactOf('plan_trip', { ...base, skipped: [{ role: 'bike', why: '目的地 800 公尺內的 YouBike 站都沒有空位可還' }] });
  assert.match(skip.text, /^YouBike：目的地 800 公尺內.*沒有空位可還，不列入$/);
  assert.equal(impactOf('plan_trip', base).tone, 'good', '沒有 YouBike 方案就只有一行');

  // 實際行程（示範資料）：YouBike 方案帶兩端資訊，或寫出不列入的原因
  const { callTool } = await import('../core/tools/index.js');
  const r2 = await callTool(createServices({ forceMock: true }), 'plan_trip', { from: '西門町', to: '台北101' });
  const bike = r2.data.options.find((o) => o.role === 'bike');
  assert.ok(bike ? bike.bike.rent.name && bike.bike.ret.name : r2.data.skipped?.some((x) => x.role === 'bike'), 'YouBike 兩端都要知道');
});

test('指定交通方式沒有可行方案：照分數建議並明說；最近站與縣市推估的邊界；沒有縣市也沒有位置回錯誤', async () => {
  const { decide } = await import('../core/decide.js');
  const opts = [{ id: 'walk', role: 'walk', name: '步行', minutes: 30, waitMin: 0, walkMin: 30, cost: 0, exposure: 1, effort: 1 }, { id: 'bus', role: 'bus', name: '公車 1', minutes: 20, waitMin: 5, walkMin: 5, cost: 15, exposure: 0.2, effort: 0.2 }];
  const plain = decide(opts, {});
  const r = decide(opts, { mode: 'ridehail' });
  assert.equal(r.best.id, plain.best.id, '照分數');
  assert.equal(r.modeUnavailable, 'ridehail');
  assert.match(r.reason, /^叫車這次沒有可行的方案；/);
  assert.equal(decide(opts, { mode: 'walk' }).best.id, 'walk', '有的話照指定');
  const [main] = [impactOf('plan_trip', { options: opts, best: 'bus', modeUnavailable: 'ridehail', ranking: { ranked: [{ id: 'bus', score: 70 }] } })].flat();
  assert.match(main.text, /^沒有可行的叫車方案：改建議公車 1/);

  const { cityNear } = await import('../core/services/places.js');
  assert.equal(cityNear({ lat: 25.0339, lon: 121.5645 }), 'Taipei', '台北 101 附近');
  assert.equal(cityNear({ lat: 22.3, lon: 122.6 }), null, '外海：40 公里內沒有地標');
  const { nearestStop } = await import('../core/tools/transit.js');
  const st = (seq, name, lat, etaSec) => ({ seq, stopName: name, lat, lon: 121.5, etaSec, status: 0, statusText: '' });
  const dirs = [{ direction: 0, label: '去', stops: [st(1, 'A', 25.0, 600), st(2, 'B', 25.01, 300)] }, { direction: 1, label: '返', stops: [st(1, 'B', 25.01, 120)] }];
  const f = nearestStop(dirs, { lat: 25.0101, lon: 121.5 });
  assert.deepEqual([f.stopName, f.direction], ['B', 1], '兩個方向都有 B：挑車比較快到的');
  assert.equal(nearestStop([], { lat: 25, lon: 121.5 }), null);
  assert.equal(nearestStop(dirs, { lat: 25.2, lon: 121.5 }), null, '超過 3 公里不說離你最近');

  const { callTool } = await import('../core/tools/index.js');
  await assert.rejects(callTool(createServices({ forceMock: true }), 'bus_route_eta', { routeName: '307' }), /哪個縣市/, '說明下一步');
});
