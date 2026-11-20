// S15 公車一直不來（2026-11-21）：預估抵達晚 10 分以上、末班已過／今日未營運、未發車超過 10 分鐘、交管不停靠 → 建議改其他方式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stuckReason, stuckAsk, LATE_SEC, NOT_DEPARTED_MS, createWebHost, pollWatch } from '../public/ui/cards/host-web.js';
import { parseIntent } from '../core/agent/demo-intent.js';

const T0 = Date.parse('2026-11-21T10:00:00+08:00');
const min = (n) => n * 60_000;

test('照預估倒數不算；預估抵達往後延 10 分以上：late（車已經該到了還在延也算）', () => {
  const w = {};
  assert.equal(stuckReason(w, { status: 0, etaSec: 600 }, T0), null, '第一次只記下基準');
  assert.equal(stuckReason(w, { status: 0, etaSec: 300 }, T0 + min(5)), null, '照預估在倒數');
  assert.equal(stuckReason(w, { status: 0, etaSec: 540 }, T0 + min(8)), null, '晚 7 分：還不算');
  assert.equal(stuckReason(w, { status: 0, etaSec: 120 + LATE_SEC }, T0 + min(8)), 'late');
  const v = { base: { etaSec: 300, at: T0 } };
  assert.equal(stuckReason(v, { status: 0, etaSec: 480 }, T0 + min(7)), 'late', '應該 2 分鐘前就到了，還要 8 分');
});

test('末班已過／今日未營運馬上說；交管不停靠另外說；未發車超過 10 分鐘才說、發車後重算', () => {
  assert.equal(stuckReason({}, { status: 3, etaSec: null }, T0), 'notRunning');
  assert.equal(stuckReason({}, { status: 4, etaSec: null }, T0), 'notRunning');
  assert.equal(stuckReason({}, { status: 2, etaSec: null }, T0), 'noStop');
  const w = {};
  assert.equal(stuckReason(w, { status: 1, etaSec: null }, T0), null);
  assert.equal(stuckReason(w, { status: 1, etaSec: null }, T0 + min(9)), null, '起站附近未發車幾分鐘很正常');
  assert.equal(stuckReason(w, { status: 0, etaSec: 600 }, T0 + min(9.5)), null, '發車了：重算');
  assert.equal(stuckReason(w, { status: 1, etaSec: null }, T0 + min(10)), null);
  assert.equal(stuckReason(w, { status: 1, etaSec: null }, T0 + min(10) + NOT_DEPARTED_MS), 'notDeparted');
});

test('盯到站：跳過趕不上的那班後，下一班延誤也會說；只說一次；記得行程目的地', async () => {
  const host = createWebHost({ ask: () => {}, tripContext: () => ({ to: '台北101' }) });
  const seq = [120, 100, 900, 880, 1500, 1500]; // 這班趕不上（跳過）→ 下一班 15 分 → 一直沒動
  let i = 0;
  host.callTool = async () => ({ data: { focus: { status: 0, etaSec: seq[Math.min(i++, seq.length - 1)], statusText: 'x' } } });
  const realNow = Date.now;
  let now = T0;
  Date.now = () => now;
  try {
    await host.watchArrival({ city: 'Taipei', routeName: '307', stop: '西門', minutes: 3 });
    const w = host.arrivalWatch();
    assert.ok(w.skip, '第一班趕不上：跳過');
    assert.deepEqual(w.trip, { to: '台北101' });
    const poll = () => pollWatch((n, a) => host.callTool(n, a));
    now = T0 + min(1); await poll(); // 100：還是那班
    now = T0 + min(2); await poll(); // 900：下一班，跳過結束、延誤重新算
    assert.equal(w.skip, null);
    assert.equal(w.stuck, undefined);
    now = T0 + min(3); await poll(); // 880：記下基準（應在 10:17:40 到）
    now = T0 + min(13); await poll(); // 1500：要 10:38 才到，晚了 20 分
    assert.equal(w.stuck, 'late');
    now = T0 + min(14); await poll();
    assert.equal(w.stuck, 'late', '只說一次（不重設）');
  } finally {
    Date.now = realNow;
    host.unwatchArrival();
  }
  assert.equal(stuckAsk({ trip: { to: '台北101' } }), '不要坐公車，改別的方式去台北101');
  assert.equal(stuckAsk({}), '不要坐公車了，改別的方式');
});

test('送出的話：有目的地＝新行程排除公車；沒有＝沿用上一段；「不要等公車」也算不要', () => {
  const a = parseIntent('不要坐公車，改別的方式去台北101');
  assert.deepEqual([a.intent, a.to, a.avoid], ['trip', '台北101', ['bus']]);
  const h = [{ role: 'user', content: '從臺北車站去台北101' }, { role: 'assistant', content: '建議公車。' }];
  const b = parseIntent('不要坐公車了，改別的方式', { history: h });
  assert.deepEqual([b.intent, b.from, b.to, b.avoid, b.mode], ['trip', '臺北車站', '台北101', ['bus'], undefined]);
  assert.deepEqual(parseIntent('公車一直沒來，不要坐公車了，改別的方式', { history: h }).avoid, ['bus']);
  const c = parseIntent('不要等公車，改坐捷運', { history: h });
  assert.deepEqual([c.mode, c.avoid], ['metro', ['bus']]);
  assert.deepEqual(parseIntent('不要叫車，改坐公車', { history: h }).mode, 'bus', '不同方式：照舊');
});
