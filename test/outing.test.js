// 出門建議小卡（outing_advice，2026-11-21）：天氣＋空品一張卡、建議帶種類與等級、一邊查不到也能用
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outingItems } from '../core/agent/outing.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { prefetchCalls, callKey } from '../core/agent/model-loop.js';

const P = { lat: 25.0478, lon: 121.517 };

test('建議的種類與等級：帶傘、防曬、保暖、口罩、安心出門', () => {
  assert.deepEqual(outingItems({ weather: { raining: true, rainMm1h: 2, pop3h: 90, tempC: 33 }, air: { aqi: 160, status: '不健康' } }).map((x) => [x.kind, x.level]),
    [['umbrella', 'warn'], ['hot', 'warn'], ['mask', 'warn']]);
  assert.match(outingItems({ weather: { raining: true, rainMm1h: 0, pop3h: 80 } })[0].text, /降雨機率 80%，很可能下雨/, '雨量站沒量到雨：說很可能下雨，不說正在下');
  assert.deepEqual(outingItems({ weather: { pop3h: 35, tempC: 14 } }).map((x) => [x.kind, x.level]), [['umbrella', 'info'], ['cold', 'info']]);
  assert.deepEqual(outingItems({ weather: { pop3h: 10, tempC: 24 }, air: { aqi: 40, status: '良好' } }).map((x) => [x.kind, x.level]), [['ok', 'ok']]);
  assert.deepEqual(outingItems({}), []);
});

test('outing_advice：一張卡、帶地點名稱與同行者；天氣查不到時只用空品', async () => {
  const svc = createServices({ forceMock: true, demo: { weather: 'rain' } });
  const r = await callTool(svc, 'outing_advice', { ...P, name: '臺北車站', with: 'kids' });
  assert.equal(r.card, 'outing');
  assert.equal(r.data.name, '臺北車站');
  assert.equal(r.data.items[0].kind, 'umbrella');
  assert.match(r.text, /出門建議（程式依上面資料整理/);
  assert.match(r.speak, /^出門前看了一下：/);
  svc.weather.now = async () => { throw new Error('CWA 掛了'); };
  const onlyAir = await callTool(svc, 'outing_advice', P);
  assert.equal(onlyAir.data.weather, null);
  assert.ok(onlyAir.data.items.length >= 1);
  assert.match(onlyAir.text, /天氣：這次查不到/);
});

test('示範模式：出門建議只出一張卡；模型模式預先查同一個工具、再查同一點沿用', async () => {
  const svc = createServices({ forceMock: true });
  const es = [];
  await runDemo(svc, { messages: [{ role: 'user', content: '帶小孩出門要注意什麼' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: P }] }, (e) => es.push(e));
  const cards = es.filter((e) => e.type === 'tool_result' && e.card);
  assert.deepEqual(cards.map((e) => e.card), ['outing']);
  assert.equal(cards[0].args.with, 'kids');
  assert.match(es.find((e) => e.type === 'text').delta, /出門前看了一下/);
  const [pre] = prefetchCalls({ intent: 'outing', places: [], states: ['elder'] }, null, { ...P, name: '你的位置' });
  assert.deepEqual(pre, { name: 'outing_advice', args: { ...P, with: 'elder' } });
  assert.equal(callKey('outing_advice', { lat: 25.04781, lon: 121.51702 }), callKey('outing_advice', P));
});
