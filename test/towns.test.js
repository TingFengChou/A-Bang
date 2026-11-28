// 行政區（2026-11-28 Claude 與 Antigravity 第十一輪）：「去新莊」「汐止會下雨嗎」以前查不到
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from '../core/agent/demo-intent.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { TOWN_ITEMS } from '../core/services/places.js';

const svc = createServices({ forceMock: true });
const find = async (q) => (await callTool(svc, 'find_place', { query: q })).data;

test('find_place：地標找不到才查區；「區」結尾區名優先；同名的區全列；名稱是縣市＋區、標概略位置', async () => {
  assert.equal(TOWN_ITEMS.length, 365);
  const [x] = await find('新莊');
  assert.deepEqual([x.name, x.kind, x.source, x.approx, x.city], ['新北市新莊區', 'district', 'district', true, 'NewTaipei']);
  assert.equal((await find('新北新莊'))[0].name, '新北市新莊區');
  assert.deepEqual((await find('大安區')).map((p) => p.name), ['臺北市大安區', '臺中市大安區'], '「大安區」不被大安站搶走');
  assert.deepEqual((await find('中正區')).map((p) => p.name), ['臺北市中正區', '基隆市中正區']);
  assert.notEqual((await find('台北101'))[0].kind, 'district', '地標照舊');
});

test('規則模式：區名當地點；問路時地標優先（中山＝捷運中山站、士林＝士林夜市、北門＝臺北北門）；常見路名、日常用語要有詞尾', () => {
  const to = (q) => parseIntent(q).to;
  assert.equal(to('去新莊'), '新北市新莊區');
  assert.deepEqual(parseIntent('三重到新莊').places, ['新北市三重區', '新北市新莊區']);
  assert.deepEqual(parseIntent('汐止會下雨嗎').places, ['新北市汐止區']);
  assert.equal(to('基隆中正區'), '基隆市中正區');
  assert.equal(to('去中山'), '捷運中山站');
  assert.equal(to('去士林'), '士林夜市');
  assert.equal(to('從台北車站去北門'), '北門（承恩門）');
  assert.equal(to('去成功鎮'), '臺東縣成功');
  assert.notEqual(parseIntent('成功嶺').places?.[0], '臺東縣成功', '「成功」是日常用語：要說成功鎮');
  assert.equal(parseIntent('和平東路怎麼去').places?.length || 0, 0, '路名不是區');
  assert.equal(to('從捷運內湖站到台北車站') === '臺北市內湖區', false, '「捷運內湖站」是車站不是區');
});

test('同名的區（「去中正區」）：先用最近的算，同時問是哪一個', async () => {
  const es = [];
  await runDemo(svc, { messages: [{ role: 'user', content: '去中正區' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0423, lon: 121.5079 } }] }, (e) => es.push(e), { now: Date.parse('2026-11-28T10:00:00+08:00') });
  const trip = es.find((e) => e.type === 'tool_result' && (e.tool || e.name) === 'plan_trip');
  assert.equal(trip?.data?.to?.name, '臺北市中正區（概略位置）', '區的代表點是戶政事務所：照實說概略位置');
  const ask = es.find((e) => e.type === 'ask');
  assert.match(ask?.question || '', /哪個「中正區」/);
  assert.deepEqual(ask.options.map((o) => [o.label, !!o.guess]), [['台北市中正區', true], ['基隆市中正區', false]]);
});

test('生活圈（不是行政區，Antigravity 第十一輪）：景美、大坪林是地標；「大坪林」裡的「坪林」不是坪林區；區短名要像一個詞', () => {
  const to = (q) => parseIntent(q).to;
  assert.equal(to('去景美'), '景美');
  assert.equal(to('去民生社區'), '民生社區');
  assert.equal(to('去大坪林'), '大坪林');
  assert.equal(to('去坪林'), '新北市坪林區');
  assert.deepEqual(parseIntent('新莊會下雨嗎').places, ['新北市新莊區'], '句首也算');
  assert.deepEqual(parseIntent('汐止的藥局').places, ['新北市汐止區']);
});
