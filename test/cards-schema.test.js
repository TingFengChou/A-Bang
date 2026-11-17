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
  assert.equal(files.length, 7);
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
