// 腦袋嚴格審查（2026-11-23 產品負責人：「要嚴格檢視阿幫腦袋，不要讓他變成一個腦袋不清楚的核心」）：8 項問題各一組
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJudge } from '../core/agent/judge.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { runDemo } from '../core/agent/run.js';
import { checkRewrite } from '../core/edge-write.js';
import { createServices } from '../core/index.js';

const dev = (intent, states = []) => ({ intent, states, engine: 'gemini-nano' });
const PRIOR = ['我快遲到了，帶著行李跟阿嬤，怎麼從西門町去台北101'];
const run = async (messages, extra = {}) => { const es = []; await runDemo(createServices({ forceMock: true }), { messages, ...extra }, (e) => es.push(e), {}); return es; };

test('#1 地名裡的捷運站、公車站不是指定交通方式', () => {
  for (const q of ['從西門捷運站到台北101', '從內湖捷運站到板橋', '從台北車站公車站到台北101', '從民權西路捷運站去松山機場']) assert.equal(parseIntent(q, {}).mode, undefined, q);
  assert.equal(parseIntent('從西門町坐捷運到台北101', {}).mode, 'metro');
  assert.equal(parseIntent('坐捷運到板橋站', {}).mode, 'metro');
  assert.equal(parseIntent('搭公車去市政府站', {}).mode, 'bus');
});

test('#2 手機寫的回答：不能拿掉「照您說的」、不能說使用者指定的低分方案比較好', () => {
  const draft = '照您說的選「捷運（文湖線轉板南線）」（分數 46；分數最高的是公車 939 89）。預估約 86 分，60 元，10:20 到。';
  const pixel = '選「捷運（文湖線轉板南線）」（分數 46；分數最高的是公車 939 89）比較好，建議搭捷運，預估約 86 分，60 元，10:20 到。'; // Pixel 實測
  assert.deepEqual(checkRewrite(pixel, { draft }), { ok: false, reason: 'keep', detail: 'userPick' });
  assert.equal(checkRewrite('照您說的選「捷運（文湖線轉板南線）」（分數 46，最好的選擇；分數最高的是公車 939 89），約 86 分、60 元，10:20 到。', { draft }).reason, 'claim');
  assert.equal(checkRewrite('照您說的選「捷運（文湖線轉板南線）」（分數 46；分數最高的是公車 939 89），約 86 分、60 元，10:20 到。', { draft }).ok, true);
});

test('#3 規則有明確關鍵字的生活查詢：手機看了前文判成行程（或把股票判成天氣）也照規則', async () => {
  const j = createJudge();
  for (const [q, want] of [['台中明天天氣如何', 'weather'], ['西門町附近藥局', 'pharmacy'], ['高雄空氣好嗎', 'aqi'], ['油價多少', 'fuel'], ['我有沒有中發票', 'invoice'], ['剛剛有地震嗎', 'quake'], ['捷運下一班', 'metro']]) {
    const r = await j.quick(q, PRIOR, { device: dev('trip', ['rush']) });
    assert.deepEqual([r.intent, r.source], [want, 'rules'], q);
  }
  assert.equal((await j.quick('2330 收盤多少', [], { device: dev('weather') })).intent, 'stock');
  // 規則聽不懂的仍照手機
  assert.deepEqual(Object.values(await j.quick('那班車還要等多久', [], { device: dev('bus_route') })).slice(0, 1), ['bus_route']);
  // 問阿幫：前文在排行程、手機判成行程，「台中明天天氣如何」查天氣、不排行程
  const es = await run([{ role: 'user', content: PRIOR[0] }, { role: 'assistant', content: '選捷運…' }, { role: 'user', content: '台中明天天氣如何' }], { deviceJudge: dev('trip', ['rush']) });
  const tools = es.filter((e) => e.type === 'tool_start').map((e) => e.name);
  assert.ok(tools.includes('weather_tomorrow') && !tools.includes('plan_trip'), tools.join());
});

test('#4 說了捷運站又要去別的地方＝排行程（捷運站是起點）；問下一班仍是捷運', () => {
  for (const q of ['從捷運內湖站到台北車站', '我在捷運西門站，要去台北101']) { const it = parseIntent(q, {}); assert.equal(it.intent, 'trip', q); assert.match(it.from, /捷運/, q); }
  for (const q of ['捷運西門站下一班', '捷運西門站到了嗎', '捷運西門站到站時間', '捷運西門站末班車']) assert.equal(parseIntent(q, {}).intent, 'metro', q);
});

test('#5 判斷層的結果跟實際查的一致（附近藥局不說「比較幾種走法」）', async () => {
  const es = await run([{ role: 'user', content: PRIOR[0] }, { role: 'assistant', content: '選捷運…' }, { role: 'user', content: '附近藥局' }], { deviceJudge: dev('trip', ['rush']) });
  assert.equal(es[0].judge.intent, 'pharmacy');
  assert.ok(!es.some((e) => e.type === 'agent_note' && /比較幾種走法/.test(e.text)));
});

test('#6 「快遲到了」是趕時間、「下大雨」是正在下雨；「會不會下大雨」是問天氣', () => {
  assert.deepEqual(parseIntent('我快遲到了，從西門町到台北101', {}).states, ['rush']);
  assert.deepEqual(parseIntent('外面下大雨，從西門町到台北101', {}).states, ['rain']);
  const q = parseIntent('明天會不會下大雨', {});
  assert.deepEqual([q.intent, q.states], ['weather', []]);
});

test('#7 補答起點（阿幫問「從哪裡出發」）：前一句的趕時間、帶行李都保留', async () => {
  const messages = [{ role: 'user', content: '我趕時間，帶著行李要去台北101' }, { role: 'assistant', content: '您從哪裡出發？' }, { role: 'user', content: '西門町' }];
  const es = await run(messages, { deviceJudge: dev('trip') });
  const trip = es.find((e) => e.type === 'tool_start' && e.name === 'plan_trip');
  assert.deepEqual([...trip.input.prefs.states].sort(), ['luggage', 'rush']);
});

test('#8 改出發時間或日期不沿用當下的狀態（趕時間、下雨）；回程不沿用趕時間', () => {
  const h = [{ role: 'user', content: '外面下大雨，我快遲到了，帶著行李，從西門町到台北101' }, { role: 'assistant', content: '…' }];
  const t = parseIntent('改成明天早上8點出發', { history: h });
  assert.deepEqual([t.followUp, [...t.states].sort()], [true, ['luggage']]);
  const back = parseIntent('那回程呢', { history: h });
  assert.deepEqual([...back.states].sort(), ['luggage', 'rain']);
  assert.deepEqual([...parseIntent('改坐公車', { history: h }).states].sort(), ['luggage', 'rain', 'rush'], '同一趟改方式照舊');
});

test('小項：「早安」「您好」回招呼並列出能查的，不被前文帶成行程；「好啦謝謝」是道謝', async () => {
  for (const [q, re] of [['早安', /^早安！我是阿幫。我可以幫[你您]查交通/], ['hello', /^Hello! I'm Abang\. I can help/]]) {
    const es = await run([{ role: 'user', content: PRIOR[0] }, { role: 'assistant', content: '…' }, { role: 'user', content: q }], { deviceJudge: dev('trip', ['rush']) });
    assert.equal(es.find((e) => e.type === 'tool_start'), undefined, q);
    assert.match(es.filter((e) => e.type === 'text').map((e) => e.delta).join(''), re, q);
  }
  assert.equal(parseIntent('好啦謝謝', {}).thanks, true);
});
