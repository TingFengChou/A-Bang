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
