// 卡片倒數（M4-07）：文字規則與伺服器一致；startCountdown 依經過時間遞減（以假 DOM 驗證，不需瀏覽器）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaLabel, startCountdown } from '../public/ui/cards/countdown.js';
import { busStatusText } from '../core/util.js';

test('etaLabel 與伺服器 busStatusText 規則一致', () => {
  for (const s of [0, 30, 59, 60, 120, 179, 180, 300, 3599]) assert.equal(etaLabel(s), busStatusText(0, s), String(s));
  assert.equal(etaLabel(null), null);
});

test('startCountdown：依 drawnAt 經過秒數遞減，跨過門檻時換文字與 soon', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = 1_000_000;
  const cls = new Set();
  const el = { dataset: { etaSec: '200' }, textContent: '3 分', classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), remove: () => {}, add: () => {} }, offsetWidth: 0 };
  const root = { dataset: { drawnAt: String(clock) }, querySelectorAll: () => [el] };
  const stop = startCountdown(root, () => clock);
  clock += 30_000; t.mock.timers.tick(1000);   // 剩 170 秒
  assert.deepEqual([el.textContent, cls.has('soon')], ['即將進站', true]);
  clock += 120_000; t.mock.timers.tick(1000);  // 剩 50 秒
  assert.equal(el.textContent, '進站中');
  clock += 600_000; t.mock.timers.tick(1000);  // 不會小於 0
  assert.equal(el.textContent, '進站中');
  stop();
});
