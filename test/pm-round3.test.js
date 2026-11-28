// PM 第三輪審查（2026-11-28）：火車車種與時間不混進起站、起點補在句尾、從現在位置出發的回程
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, normalizeAsk } from '../core/agent/demo-intent.js';
import { runDemo } from '../core/agent/run.js';
import { createServices } from '../core/index.js';

const p = (q, history = []) => parseIntent(q, { history });
const od = (q) => { const it = p(q); return [it.intent, it.from, it.to]; };

test('#1 車種、時間數字不會混進起站（原本「號台北」「車板橋」「點台北」）', () => {
  assert.deepEqual(od('台鐵自強號台北到花蓮還有票嗎'), ['rail', '台北', '花蓮']);
  assert.deepEqual(od('區間車板橋到桃園下一班'), ['rail', '板橋', '桃園']);
  assert.deepEqual(od('明天早上8點台北到台中的高鐵'), ['rail', '台北', '台中']);
  assert.deepEqual(od('自強號 8:30 台北到台中'), ['rail', '台北', '台中']);
  assert.deepEqual(od('普悠瑪台北到台東'), ['rail', '台北', '台東']);
  assert.deepEqual(od('太魯閣號台北到花蓮幾點'), ['rail', '台北', '花蓮']);
});

test('#1 只說車種和目的地是坐火車的行程；車名「太魯閣號」不是太魯閣', () => {
  for (const [q, to, mode] of [['太魯閣號到花蓮', '花蓮車站', 'tra'], ['自強號到花蓮', '花蓮車站', 'tra'], ['台鐵到花蓮', '花蓮車站', 'tra'], ['高鐵到台中', '高鐵臺中站', 'thsr']]) {
    const it = p(q);
    assert.deepEqual([it.intent, it.from, it.to, it.mode], ['trip', null, to, mode], q);
  }
  assert.equal(p('去太魯閣').to, '太魯閣國家公園遊客中心', '地名照舊');
  assert.equal(p('高鐵到台中幾點').intent, 'rail', '問班次照舊查時刻表');
});

test('#2 起點補在句尾（「我要去板橋 從台中」）：照「從」「去」判斷，不照出現順序', () => {
  for (const [q, from, to] of [
    ['我要去板橋 從台中', '臺中車站', '板橋車站'],
    ['我要去板橋，從台中出發', '臺中車站', '板橋車站'],
    ['去101 從板橋', '板橋車站', '台北101'],
    ['到台中 從台北', '臺北車站', '臺中車站'],
    ['從台北車站到台北101', '臺北車站', '台北101'],
    ['板橋到台中', '板橋車站', '臺中車站'],
  ]) assert.deepEqual(od(q).slice(1), [from, to], q);
});

test('#3 從現在位置出發的行程，問回程：從目的地回到你的位置', async () => {
  const h = [{ role: 'user', content: '去台北101' }, { role: 'assistant', content: '…' }];
  for (const q of ['那回程呢', '回來呢', '回來怎麼坐']) {
    const it = p(q, h);
    assert.deepEqual([it.intent, it.from, it.toHere, it.followUp], ['trip', '台北101', true, true], q);
  }
  const here = { lat: 25.0143, lon: 121.4635 };
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [...h, { role: 'user', content: '那回程呢' }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: here }] }, (e) => es.push(e), {});
  const trip = es.find((e) => e.type === 'tool_start' && e.name === 'plan_trip');
  assert.ok(trip, '有排回程');
  assert.equal(trip.input.from, '台北101');
  assert.deepEqual([trip.input.to.lat, trip.input.to.lon, trip.input.to.name], [here.lat, here.lon, '你的位置']);
});

test('#3 說了起點的回程照舊對調；從家出發的回程回到家（家的座標不留在起點）', () => {
  const back = p('那回程呢', [{ role: 'user', content: '從西門町到台北101' }, { role: 'assistant', content: '…' }]);
  assert.deepEqual([back.from, back.to, back.toHere], ['台北101', '西門町', undefined]);
  const home = { name: '家', lat: 25.0418, lon: 121.5076 };
  const h = [{ role: 'user', content: '從家去台北101' }, { role: 'assistant', content: '…' }];
  const out = parseIntent('那回程呢', { history: h, saved: { 家: home } });
  assert.equal(out.from, '台北101');
  assert.equal(out.fromSaved, undefined, '起點是台北101，不是家');
  assert.deepEqual([out.toSaved?.lat, out.toSaved?.lon], [home.lat, home.lon]);
});

test('#5 台語：擱／閣、偌久、最尾班、猶有…無、會…袂、阮、病院、轉去厝', () => {
  const n = (q) => normalizeAsk(q);
  assert.equal(n('公車擱偌久才會來'), '公車還多久才會來');
  assert.equal(n('307 閣愛等偌久'), '307 還要等多久');
  assert.equal(n('307 欲閣等偌久'), '307 還要等多久');
  assert.equal(n('捷運最尾班幾點'), '捷運末班幾點');
  assert.equal(n('高鐵猶有位無'), '高鐵還有位嗎');
  assert.equal(n('今仔日會落雨袂'), '今天會下雨嗎');
  assert.equal(n('阮欲去病院'), '我要去醫院');
  assert.equal(n('我欲轉去厝'), '我要回家');
  assert.equal(n('阮兜附近有藥局無'), '我家附近有藥局嗎');
  for (const [q, intent, extra] of [
    ['公車擱偌久才會來', 'bus_route', {}], ['307 閣愛等偌久', 'bus_route', { route: '307' }], ['捷運最尾班幾點', 'metro', { last: true }],
    ['明仔載愛去高雄', 'trip', { tomorrow: true }], ['阮兜附近有藥局無', 'pharmacy', {}], ['今仔日會落雨袂', 'weather', {}],
  ]) {
    const it = p(q);
    assert.equal(it.intent, intent, q);
    for (const [k, v] of Object.entries(extra)) assert.equal(it[k], v, `${q} ${k}`);
  }
});

test('#5 口語：「307還多久」、醫院、帶外套、迷路、高鐵站怎麼去', () => {
  for (const q of ['307還多久', '307還多久才會到', '307公車還要多久']) assert.deepEqual([p(q).intent, p(q).route], ['bus_route', '307'], q);
  assert.deepEqual([p('我要去醫院').intent, p('我要去醫院').needs], ['trip', 'to'], '沒說哪家：問要去哪');
  assert.equal(p('我要去台大醫院').to, '臺大醫院', '說了哪家照舊');
  for (const q of ['附近有醫院嗎', '最近的醫院在哪']) assert.deepEqual([p(q).intent, p(q).clinic], ['pharmacy', true], q);
  for (const q of ['今天要不要帶外套', '明天要穿多少']) assert.equal(p(q).intent, 'weather', q);
  assert.deepEqual([p('我迷路了').intent, p('我迷路了').lost], ['nearby_bus', true]);
  for (const [q, rail] of [['高鐵站怎麼去', 'THSR'], ['最近的高鐵站怎麼去', 'THSR'], ['火車站怎麼走', 'TRA']]) assert.deepEqual([p(q).intent, p(q).nearRail], ['trip', rail], q);
  assert.equal(p('台北火車站怎麼走').to, '臺北車站', '說了哪一站照舊');
});

test('#5 問醫院：照實說資料只有診所，急症打 119；問診所不加', async () => {
  const say = async (q) => { const es = []; await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: q }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: { lat: 25.0423, lon: 121.5079 } }] }, (e) => es.push(e), {}); return es.filter((e) => e.type === 'text').map((e) => e.delta).join(''); };
  assert.match(await say('附近有醫院嗎'), /醫院的看診資料這裡沒有.+119/);
  assert.doesNotMatch(await say('附近有診所嗎'), /醫院的看診資料/);
  assert.match(await say('我迷路了'), /^別擔心，先看你附近最近的站牌/);
});

test('示範模式找不到藥局、診所、垃圾車：說是示範資料只收了少數地區（V3 走查 F6）；找得到、真實資料不加', async () => {
  const say = async (q, here) => { const es = []; await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: q }], clientTools: ['device_location'], clientToolResults: [{ id: 'loc1', ok: true, result: here }] }, (e) => es.push(e), {}); return es.filter((e) => e.type === 'text').map((e) => e.delta).join(''); };
  const WANHUA = { lat: 25.0423, lon: 121.5079 };
  for (const q of ['附近有開的藥局', '垃圾車幾點來']) assert.match(await say(q, WANHUA), /現在用的是示範資料，只收了少數地區/, q);
  assert.doesNotMatch(await say('大安區的藥局', WANHUA), /現在用的是示範資料/, '示範資料裡有：不加');
});
