// Agent 執行器（M5-04）：示範模式事件流順序、tool_start 先於 tool_result、plan_trip 送 decision、白名單、錯誤、請求驗證
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDemo, execTools, validateRequest, MAX_CHARS } from '../core/agent/run.js';
import { getProfile } from '../core/agents/index.js';
import { createServices } from '../core/index.js';

const NOW = Date.parse('2026-11-18T08:00:00+08:00');
async function collect(q, opts = {}, svc = createServices({ forceMock: true, ...opts.svc })) {
  const events = [];
  await runDemo(svc, { messages: [{ role: 'user', content: q }], ...opts.body }, (e) => events.push(e), { now: NOW });
  return events;
}
const types = (es) => es.map((e) => e.type);

test('行程：status → agent_note → tool_start… → tool_result… → decision → discussion_end → text → done', async () => {
  const es = await collect('從西門町到台北 101 怎麼去？', { svc: { demo: { weather: 'rain' } } });
  const t = types(es);
  assert.equal(t[0], 'status');
  assert.deepEqual(t.slice(-3), ['discussion_end', 'text', 'done']);
  assert.equal(t.filter((x) => x === 'agent_note').length, 3);
  // 每段：該段所有 tool_start 都在任一 tool_result 之前
  const starts = es.filter((e) => e.type === 'tool_start');
  for (const s of starts) assert.ok(t.indexOf('tool_result', es.indexOf(s)) > es.indexOf(s));
  assert.deepEqual(starts.map((s) => s.name), ['find_place', 'find_place', 'weather_now', 'traffic_status', 'plan_trip']);
  const d = es.find((e) => e.type === 'decision');
  assert.ok(d && t.indexOf('decision') > t.lastIndexOf('tool_start'));
  assert.equal(d.states[0].key, 'rain');
  assert.equal(es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip').card, 'trip');
  assert.match(es.find((e) => e.type === 'text').delta, /^選「/);
  assert.ok(es.filter((e) => e.type === 'tool_result').every((e) => e.ok && e.speak && e.metrics));
});

test('其他意圖：公車、YouBike、高鐵、捷運都以卡片結尾；unknown 只有 text', async () => {
  for (const [q, card] of [['307 到哪了？我在臺北車站', 'bus-route'], ['台北車站附近還有 YouBike 嗎？', 'youbike'], ['高鐵台北到台中下一班幾點？', 'timetable'], ['捷運市政府站下一班', 'metro']]) {
    const es = await collect(q);
    assert.equal(es.filter((e) => e.type === 'tool_result').at(-1).card, card, q);
    assert.ok(!es.some((e) => e.type === 'decision'), q);
  }
  assert.deepEqual(types(await collect('今天天氣如何')), ['status', 'text', 'done']);
});

test('使用者點選的狀態：帶進 plan_trip 並在 decision 標為 picked', async () => {
  const es = await collect('從台北車站到台北101', { body: { userState: { picked: ['budget'] } } });
  const d = es.find((e) => e.type === 'decision');
  assert.deepEqual(d.states.map((s) => [s.key, s.source]), [['budget', 'picked']]);
  assert.equal(es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip').args.prefs.states[0], 'budget');
});

test('execTools：白名單外的 tool 與上游錯誤都回 ok=false，訊息可公開', async () => {
  const svc = createServices({ forceMock: true });
  svc.weather = { now: async () => { throw new Error('/Users/secret 上游爆炸'); } };
  const es = [];
  let n = 0;
  const out = await execTools(svc, [{ name: 'weather_now', args: { lat: 25.04, lon: 121.5 } }, { name: 'rail_stations', args: { system: 'THSR' } }], (e) => es.push(e),
    { profile: getProfile(), nextId: () => `x${++n}` });
  assert.deepEqual(out.map((o) => o.ok), [false, false]);
  assert.match(out[0].error, /暫時無法取得/);
  assert.ok(!JSON.stringify(es).includes('/Users/secret'));
  assert.match(out[1].error, /不能使用 rail_stations/);
  assert.deepEqual(types(es).slice(0, 2), ['tool_start', 'tool_start']);
});

test('validateRequest：長度、則數、最後一則必須是使用者', () => {
  assert.throws(() => validateRequest({ messages: [] }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ messages: [{ role: 'user', content: 'x'.repeat(MAX_CHARS + 1) }] }), /最多 500 字/);
  assert.throws(() => validateRequest({ messages: [{ role: 'assistant', content: 'hi' }] }), /最後一則/);
  assert.throws(() => validateRequest({ messages: [{ role: 'user', content: 'hi' }], userState: { picked: ['sleepy'] } }), /請求格式錯誤/);
  assert.ok(validateRequest({ messages: [{ role: 'user', content: 'hi' }] }));
});
