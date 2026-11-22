// 每個服務問要不要提醒（2026-11-22 產品負責人「查過垃圾車，也可以問需不需要設定提醒」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { garbageRemindAt, GARBAGE_LEAD_MIN } from '../public/ui/cards/cards/garbage.js';

const at = (hhmm) => Date.parse(`2026-11-23T${hhmm}:00+08:00`);

test('垃圾車：今天還沒到、離現在超過 11 分才給「前 10 分提醒我」；時間是開始前 10 分（台灣時間）', () => {
  assert.equal(GARBAGE_LEAD_MIN, 10);
  assert.equal(garbageRemindAt({ collectToday: true, time: '19:30–19:40' }, at('18:00')), '19:20');
  assert.equal(garbageRemindAt({ collectToday: true, time: '19:30' }, at('19:18')), '19:20', '還有 12 分：可以');
  assert.equal(garbageRemindAt({ collectToday: true, time: '19:30' }, at('19:20')), null, '不到 11 分：來不及提醒');
  assert.equal(garbageRemindAt({ collectToday: true, time: '19:30' }, at('20:00')), null, '過了');
  assert.equal(garbageRemindAt({ collectToday: false, time: '19:30' }, at('18:00')), null, '今天不收');
  assert.equal(garbageRemindAt({ collectToday: true, time: '' }, at('18:00')), null);
});

test('明天會下雨：晚上 19 點後、白天降雨機率 ≥ 50% 才給「明早 7 點提醒我帶傘」（指定日期的提醒）', async () => {
  const { umbrellaStep, nextSteps } = await import('../public/js/agent/next-steps.js');
  const wt = (pop, date = '2026-11-24') => ({ tool: 'weather_tomorrow', data: { date, dayPop: pop, pop } });
  const s = umbrellaStep(wt(70), at('21:00'));
  assert.deepEqual([s.kind, s.label, s.payload.at, s.payload.date, s.payload.key], ['alarm', '明早 7 點提醒我帶傘', '07:00', '2026-11-24', 'umbrella|2026-11-24']);
  assert.equal(s.payload.text, '今天降雨機率 70%，出門記得帶傘');
  assert.equal(umbrellaStep(wt(40), at('21:00')), null, '降雨機率不高');
  assert.equal(umbrellaStep(wt(70), at('15:00')), null, '下午問：離明早超過 12 小時');
  assert.equal(umbrellaStep(wt(70, '2026-11-25'), at('21:00')), null, '不是明天');
  assert.match(umbrellaStep(wt(80), at('22:00'), true).label, /umbrella/);
  assert.ok(nextSteps([wt(70)], null, { now: at('21:00') }).some((x) => x.kind === 'alarm'));
});
