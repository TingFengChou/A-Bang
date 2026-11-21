// PM 第二批情境（P2）：相對時間、數字地名、時間詞不吃站名、問下雨不是正在下雨
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, relMinutes, placesInText } from '../core/agent/demo-intent.js';

const at = (h, m = 0) => Date.UTC(2026, 10, 21, h - 8, m);

test('相對時間：20 分鐘後、半小時內、in 30 minutes → 幾點前要到（用這一輪的現在時間）', () => {
  assert.equal(relMinutes('20 分鐘後開'), 20);
  assert.equal(relMinutes('半小時內要到'), 30);
  assert.equal(relMinutes('一小時後'), 60);
  assert.equal(relMinutes('I need to be there in 30 minutes'), 30);
  assert.equal(relMinutes('走 10 分鐘'), null, '沒有「後／內」不算');
  assert.equal(parseIntent('我的高鐵 20 分鐘後開，現在在西門町，來得及去台北車站嗎', { now: at(10) }).arriveBy, '10:20');
});

test('「101」是台北101，但「101 到哪了」是公車', () => {
  assert.deepEqual(placesInText('北車到101怎麼坐'), ['臺北車站', '台北101']);
  assert.deepEqual(placesInText('How do I get to 101 from Ximen?'), ['台北101', '西門町']);
  assert.equal(parseIntent('101 到哪了').intent, 'bus_route');
  assert.deepEqual(placesInText('Taipei 101'), ['台北101'], '英文全名不拆開');
});

test('時間詞不吃進站名；問下雨不是正在下雨；明天的行程看明天的預報', () => {
  const r = parseIntent('明天早上台北到台中的高鐵');
  assert.deepEqual([r.intent, r.from, r.to], ['rail', '台北', '台中']);
  assert.ok(!parseIntent('明早八點前要到台大，會下雨嗎').states.includes('rain'));
  assert.ok(parseIntent('下雨了，從西門町去台北101').states.includes('rain'));
});

test('審查：新規則不誤判平常的話', () => {
  const now = Date.UTC(2026, 10, 21, 6, 0);
  const h = (u) => [{ role: 'user', content: u }, { role: 'assistant', content: '好' }];
  const p = (q, history = []) => parseIntent(q, { history, now });
  assert.equal(p('那去板橋怎麼走', h('台北天氣')).intent, 'trip', '天氣之後問怎麼去是行程');
  assert.equal(p('板橋那邊有YouBike嗎', h('附近的藥局')).intent, 'youbike');
  assert.equal(p('那台中明天呢', h('台北天氣')).tomorrow, true, '換地點時明天帶過去');
  assert.equal(p('半小時後出發去台北車站').arriveBy, null, '出發時間不是抵達時間');
  assert.equal(p('三十分鐘內要到台北車站').from, null, '「三十分」不是十分老街');
  for (const q of ['幫我按照最省錢的方式', '幫我按電梯', '直接幫我按讚', '幫我預約掛號', '幫我訂位']) assert.notEqual(p(q).intent, 'limits', q);
  assert.equal(p('你直接幫我按叫車啦').intent, 'limits');
  assert.deepEqual([p('101 多久').intent, p('101 多久').places], ['bus_route', []], '「101 多久」是公車');
  assert.equal(p('我來得及坐到台中的末班高鐵嗎').intent, 'rail', '問末班高鐵不是去車站的行程');
  assert.equal(p('那 262 呢', [...h('307 到哪了'), ...h('那 299 咧')]).route, '262', '連續追問');
});
