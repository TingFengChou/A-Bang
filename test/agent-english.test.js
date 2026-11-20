// 英文提問（觀光客，S12）：英文地名別名、英文意圖規則、英文總結；中文提問不受影響
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, isEnglish, placesInText } from '../core/agent/demo-intent.js';

test('英文地名別名（不分大小寫、空白）', () => {
  assert.deepEqual(placesInText('from ximending to TAIPEI 101'), ['西門町', '台北101']);
  assert.deepEqual(placesInText('Taoyuan Airport'), ['臺灣桃園國際機場']);
});

test('英文意圖：行程（含 from…to、by MRT）、天氣（現在／明天）、空品、YouBike、公車、看不懂', () => {
  const t = parseIntent('How do I get to Taipei 101?');
  assert.deepEqual([t.lang, t.intent, t.from, t.to], ['en', 'trip', null, '台北101']);
  const m = parseIntent('from Ximending to Taipei 101 by MRT');
  assert.deepEqual([m.from, m.to, m.mode], ['西門町', '台北101', 'metro']);
  assert.equal(parseIntent('Is it going to rain?').intent, 'weather', '「going to」的 to 不是去哪裡');
  assert.equal(parseIntent('Will it rain tomorrow?').tomorrow, true);
  assert.equal(parseIntent('How is the air quality?').intent, 'aqi');
  assert.equal(parseIntent('Where is the nearest YouBike?').intent, 'youbike');
  assert.deepEqual([parseIntent('Where is bus 307?').intent, parseIntent('Where is bus 307?').route], ['bus_route', '307']);
  assert.equal(parseIntent('hello').intent, 'unknown');
  assert.deepEqual(parseIntent('I have luggage, take me to Taipei 101').states, ['luggage']);
});

test('中文或中英混合不走英文規則', () => {
  assert.equal(isEnglish('去台北101'), false);
  assert.equal(isEnglish('坐 MRT 去台北101'), false);
  assert.equal(parseIntent('去 Taipei 101').lang, undefined);
  assert.equal(isEnglish('OK'), true);
});

test('審查修正：train 不是 rain、字的邊界、官方譯名、to X from Y、英文接上一輪、中文接英文時 lang 不沿用、謝謝、hot springs', async () => {
  const { parseIntent } = await import('../core/agent/demo-intent.js');
  const r = parseIntent('next train to Taichung');
  assert.deepEqual([r.intent, r.system, r.to], ['rail', 'TRA', '臺中']);
  assert.equal(parseIntent('Eventually I want to go to Taipei 101').to, '台北101');
  const f = parseIntent('to Shifen from Taipei Main Station');
  assert.deepEqual([f.from, f.to], ['臺北車站', '十分老街']);
  const H = [{ role: 'user', content: 'How do I get to Taipei 101?' }, { role: 'assistant', content: 'ok' }];
  const g = parseIntent("I'm with my grandma", { history: H });
  assert.deepEqual([g.intent, g.to, g.states, g.lang], ['trip', '台北101', ['elder'], 'en']);
  const z = parseIntent('那改坐捷運', { history: H });
  assert.deepEqual([z.intent, z.mode, z.lang], ['trip', 'metro', undefined], '這句是中文：用中文回答');
  assert.equal(parseIntent('Thank you!').thanks, true);
  assert.equal(parseIntent('Hot springs in Beitou').intent, 'trip', 'hot springs 不是天氣');
  assert.equal(parseIntent('I need to be at Taipei 101 before 9am').arriveBy, '09:00');
});

test('防詐英文輸入：不說「沒有發現」，請撥 165', async () => {
  const { parseAntifraud, antifraudSummary, antifraudSteps } = await import('../core/agent/demo-antifraud.js');
  const it = parseAntifraud('my bank account is frozen and I must transfer money');
  assert.equal(it.intent, 'english');
  assert.deepEqual(antifraudSteps(it), []);
  assert.match(antifraudSummary(it, {}), /only check Chinese.+165/);
  assert.notEqual(parseAntifraud('http://bit.ly/x is this safe').intent, 'english', '有網址仍比對 165 清單');
});
