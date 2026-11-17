// 內建地標與 find_place（M3-03）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceServices, LANDMARKS, normPlace, MAX_RESULTS } from '../core/services/places.js';
import { resolveCity } from '../core/cities.js';
import { distanceM } from '../core/util.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const places = createPlaceServices();
const KINDS = ['station', 'airport', 'landmark', 'market', 'school', 'hospital', 'government'];

test('landmarks.json：≥ 150 筆、欄位完整、縣市可辨識、座標在台灣', () => {
  const items = LANDMARKS.items;
  assert.ok(items.length >= 150, String(items.length));
  for (const x of items) {
    assert.ok(x.name && Array.isArray(x.aliases), x.name);
    assert.ok(resolveCity(x.city)?.city === x.city, `${x.name}: ${x.city}`);
    assert.ok(x.lat >= 21 && x.lat <= 27 && x.lon >= 118 && x.lon <= 123, x.name);
    assert.ok(KINDS.includes(x.kind), `${x.name}: ${x.kind}`);
  }
});

test('landmarks.json：名稱與別名正規化後不重複（避免同一說法對到兩個地方）', () => {
  const seen = new Map();
  for (const x of LANDMARKS.items) {
    for (const k of new Set([x.name, ...x.aliases].map(normPlace))) {
      assert.ok(!seen.has(k), `「${k}」同時屬於 ${seen.get(k)} 與 ${x.name}`);
      seen.set(k, x.name);
    }
  }
});

test('landmarks.json：同縣市地標彼此距離合理（抓經緯度寫反或縣市標錯）', () => {
  const byCity = new Map();
  for (const x of LANDMARKS.items) byCity.set(x.city, [...(byCity.get(x.city) || []), x]);
  for (const [city, list] of byCity) {
    const lat = list.map((x) => x.lat).sort((a, b) => a - b)[list.length >> 1];
    const lon = list.map((x) => x.lon).sort((a, b) => a - b)[list.length >> 1];
    for (const x of list) assert.ok(distanceM(lat, lon, x.lat, x.lon) < 130000, `${city} ${x.name}`);
  }
});

test('完全相符：名稱、別名、臺／台、大小寫與空白', async () => {
  assert.equal((await places.find({ query: '台北101' }))[0].name, '台北101');
  assert.equal((await places.find({ query: '北車' }))[0].name, '臺北車站');
  assert.equal((await places.find({ query: '台南車站' }))[0].name, '臺南車站');
  assert.equal((await places.find({ query: ' taipei 101 ' }))[0].name, '台北101');
  const [p] = await places.find({ query: '小港機場' });
  assert.deepEqual([p.name, p.city, p.source, p.kind], ['高雄國際機場', 'Kaohsiung', 'landmark', 'airport']);
});

test('「站」不被省略：西門站是捷運站、西門是西門町', async () => {
  assert.equal((await places.find({ query: '西門站' }))[0].name, '捷運西門站');
  assert.equal((await places.find({ query: '西門' }))[0].name, '西門町');
});

test('部分相符：開頭優先、同分車站優先、最多 5 筆', async () => {
  const r = await places.find({ query: '台北' });
  assert.equal(r.length, MAX_RESULTS);
  assert.equal(r[0].name, '臺北車站');
  assert.equal(r[0].source, 'station');
  // 句子裡含地名也找得到
  assert.equal((await places.find({ query: '我要去逢甲夜市' }))[0].name, '逢甲夜市');
});

test('縣市篩選與錯誤', async () => {
  const r = await places.find({ query: '車站', city: '台中市' });
  assert.ok(r.length > 0 && r.every((x) => x.city === 'Taichung'));
  assert.deepEqual(await places.find({ query: '不存在的地方xyz' }), []);
  await assert.rejects(places.find({ query: '台北101', city: '火星' }), /無法辨識縣市/);
  await assert.rejects(places.find({ query: '  ' }), /請提供要找的地點/);
});

test('find_place tool：附 nav、speak、找不到的文字', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'find_place', { query: '逢甲夜市' });
  assert.equal(r.data[0].name, '逢甲夜市');
  assert.ok(r.data[0].nav.google.includes('maps/dir'));
  assert.match(r.speak, /最符合的是逢甲夜市（臺中市）/);
  assert.match(r.text, /lat=24\.\d+, lon=120\.\d+/);
  const none = await callTool(svc, 'find_place', { query: '不存在的地方xyz' });
  assert.deepEqual(none.data, []);
  assert.match(none.speak, /找不到/);
  await assert.rejects(callTool(svc, 'find_place', { query: '' }), /參數錯誤/);
});
