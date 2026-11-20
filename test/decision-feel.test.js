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
  assert.match(impactOf('plan_trip', { best: 'bus-601', options: [{ id: 'bus-601', name: '公車 601' }, { id: 'walk' }], ranking: { ranked: [{ id: 'bus-601', score: 69 }] } }).text, /比了 2 種走法：公車 601 69 分最高/);
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
