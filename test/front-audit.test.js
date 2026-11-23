// 前端審查（2026-11-23）：出門提醒 12 小時上限、提醒清單用台灣時間、英文行程卡不放只有中文的句子
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRemind, zhOnly } from '../public/ui/cards/cards/trip.js';
import { reminderItems } from '../public/js/reminder-items.js';

const at = (iso) => Date.parse(`${iso}+08:00`);

test('#3 「提醒我出門」只在 12 小時內才顯示（跟 addReminder 同一個上限）', () => {
  const now = at('2026-11-23T06:00:00');
  assert.equal(canRemind('07:30', '2026-11-23', now), true);
  assert.equal(canRemind('17:59', '2026-11-23', now), true);
  assert.equal(canRemind('19:00', '2026-11-23', now), false, '13 小時後');
  assert.equal(canRemind('06:01', '2026-11-23', now), false, '不到 2 分');
});

test('#5 提醒清單用台灣時間（手機設成別的時區也一樣）', () => {
  const now = at('2026-11-23T10:00:00');
  const [r] = reminderItems({ leave: [{ id: 'a', at: at('2026-11-23T19:30:00'), text: '該出門了：坐捷運' }], now });
  assert.equal(r.title, '今天 19:30 出門提醒');
  const [n] = reminderItems({ leave: [{ id: 'b', at: at('2026-11-24T07:00:00'), text: 'x' }], now });
  assert.equal(n.title, '明天 07:00 出門提醒');
});

test('#2 英文行程卡：只有中文的句子不放（引號裡的地名、路線名不算）', () => {
  assert.equal(zhOnly('選「捷運 淡水信義線」：省 230 元、不受塞車影響。', 'en'), true);
  assert.equal(zhOnly('Take 「捷運 淡水信義線」 to save NT$230.', 'en'), false);
  assert.equal(zhOnly('選「捷運」', 'zh'), false, '中文卡片照常');
});
