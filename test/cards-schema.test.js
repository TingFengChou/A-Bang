// 卡片資料契約（M4-01，CARDS.md §4、ADR-0008）：每個有卡片的 tool，示範模式輸出都通過對應 JSON Schema
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validate } from '../public/ui/cards/schema/validate.js';
import { callTool, listTools } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const DIR = new URL('../public/ui/cards/schema/', import.meta.url);
const load = async (card) => JSON.parse(await readFile(new URL(`${card}.v1.json`, DIR), 'utf8'));
const P = { lat: 25.0478, lon: 121.517 };

/** [tool, args, demo 情境] —— 每種卡片至少一組，時刻表與行程各涵蓋多種輸出 */
const CASES = [
  ['bus_route_eta', { city: 'Taipei', routeName: '307' }],
  ['bus_station_eta', { city: 'Taipei', stationId: 'M1000' }],
  ['bus_nearby_stations', P],
  ['youbike_nearby', P],
  ['metro_live_board', { system: 'TRTC', station: '台北車站' }],
  ['thsr_timetable', { from: '台北', to: '左營' }],
  ['tra_timetable', { from: '臺北', to: '高雄' }],
  ['intercity_bus', { from: '台北轉運站', to: '新竹車站', departAt: '09:00' }, { traffic: 'jam' }],
  ['intercity_bus', { from: '台北車站', to: '台北101' }],
  ['plan_trip', { from: '台北車站', to: '台北101', departAt: '09:00' }],
  ['plan_trip', { from: '台北車站', to: '高雄車站', departAt: '09:00', prefs: { states: ['rush'], arriveBy: '12:00' } }, { traffic: 'jam', weather: 'rain' }],
  ['scam_check_message', { text: '【台電】電費逾期未繳，今日內未處理將停電，請點擊 https://eincioiice-tw-nat-gov.com/pay' }],
  ['scam_check_message', { text: '明天中午一起吃飯嗎？' }],
  ['weather_now', P],
  ['weather_now', P, { weather: 'rain' }],
  ['aqi_nearby', P],
  ['outing_advice', { ...P, name: '臺北車站' }],
  ['outing_advice', { ...P, with: 'kids' }, { weather: 'rain' }],
  ['earthquake_recent', { county: '臺南市' }],
  ['pharmacy_search', { area: '臺北市大安區' }],
  ['garbage_truck_nearby', P],
  ['garbage_truck_nearby', { lat: 25.0183, lon: 121.4717 }],
  ['fuel_price', {}],
  ['invoice_lottery', { number: '54348835' }],
  ['stock_quote', { query: '台積電、環球晶、國泰、火星' }],
  ['stock_quote', {}],
  ['drama_picks', {}],
  ['drama_picks', { list: 'taiwan', limit: 3 }],
  ['drama_search', { query: '甜寵' }],
  ['drama_search', { query: '殭屍' }],
  ['drama_series', { id: 'demo-last-train' }],
];

test('validate：型別、必要欄位、enum、$ref、additionalProperties', () => {
  const s = { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { $ref: '#/$defs/n' }, b: { enum: ['x'] } }, $defs: { n: { type: ['integer', 'null'], minimum: 0 } } };
  assert.deepEqual(validate(s, { a: 1 }), []);
  assert.deepEqual(validate(s, { a: null }), []);
  assert.equal(validate(s, {}).length, 1);
  assert.match(validate(s, { a: 1.5 })[0], /應為 integer\|null/);
  assert.match(validate(s, { a: -1 })[0], /小於 0/);
  assert.match(validate(s, { a: 1, b: 'y' })[0], /不在/);
  assert.match(validate(s, { a: 1, c: 1 })[0], /契約沒有這個欄位/);
});

test('每個有卡片的 tool 都有契約，契約檔都對得到 tool', async () => {
  const cards = new Set(listTools().filter((t) => t.card).map((t) => t.card));
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.v1.json')).map((f) => f.replace('.v1.json', ''));
  assert.deepEqual([...cards].sort(), files.sort());
  assert.ok(files.length >= 9); // 每種卡片一份契約（集合相等已在上一行檢查）
  for (const f of files) assert.equal((await load(f)).$schema, 'https://json-schema.org/draft/2020-12/schema', f);
});

for (const [name, args, demo = {}] of CASES) {
  test(`契約：${name} ${JSON.stringify(args).slice(0, 60)}`, async () => {
    const r = await callTool(createServices({ forceMock: true, demo }), name, args);
    const errors = validate(await load(r.card), r.data);
    assert.deepEqual(errors, [], errors.join('\n'));
  });
}

test('CardPayload：有卡片時帶 v、tool 與驗證後的 args（刷新用）', async () => {
  const r = await callTool(createServices({ forceMock: true }), 'bus_route_eta', { city: 'Taipei', routeName: '307' });
  assert.deepEqual([r.card, r.v, r.name, r.args], ['bus-route', 1, 'bus_route_eta', { city: 'Taipei', routeName: '307' }]);
  const f = await callTool(createServices({ forceMock: true }), 'find_place', { query: '北車' });
  assert.equal(f.v, undefined);
});

test('timetable 卡：高鐵／台鐵查今天時預設隱藏已開出的班次，可展開；其他日期與客運不隱藏', async () => {
  const { visibleTrains } = await import('../public/ui/cards/cards/timetable.js');
  const NOW = Date.parse('2026-11-18T09:12:00+08:00');
  const trains = ['06:03', '09:15', '10:31'].map((depart, i) => ({ trainNo: String(i), depart, arrive: '11:00', minutes: 50 }));
  const d = { system: 'THSR', from: '台北', to: '台中', date: '2026-11-18', trains };
  const v = visibleTrains(d, false, NOW);
  assert.deepEqual([v.list.map((x) => x.depart), v.gone], [['09:15', '10:31'], 1]);
  assert.equal(visibleTrains(d, true, NOW).list.length, 3);
  assert.equal(visibleTrains({ ...d, date: '2026-11-19' }, false, NOW).gone, 0);
  assert.equal(visibleTrains({ ...d, system: 'BUS' }, false, NOW).gone, 0);
});
