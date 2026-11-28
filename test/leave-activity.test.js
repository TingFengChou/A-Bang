// 鎖定畫面的出發倒數（iOS 即時動態，第十四輪）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leavePayload, mountLeaveActivity } from '../public/js/leave-activity.js';

const tw = (h, m) => Date.UTC(2026, 11, 1, h - 8, m); // 2026-12-01 台灣時間

test('出門提醒 → 即時動態：車次、出門時間、開車時間、一句話（照時刻表）', () => {
  const p = leavePayload(tw(19, 0), { role: 'tra', trainNo: '2241', depart: '19:25', from: '臺北', to: '臺中', date: '2026-12-01' });
  assert.deepEqual(p, { title: '台鐵 2241', from: '臺北', leaveAt: tw(19, 0), depart: tw(19, 25), text: '19:00 出門，趕 19:25 從臺北開的車（往臺中）', lang: 'zh' });
  const en = leavePayload(tw(7, 40), { role: 'thsr', trainNo: '803', depart: '08:01', from: 'Taipei', lang: 'en' });
  assert.equal(en.title, 'HSR 803');
  assert.equal(en.text, 'Leave at 07:40 for the 08:01 departure from Taipei');
  assert.equal(en.depart, tw(8, 1), '沒有日期：用出門那天');
});

test('時間不對就不開（沒有開車時間、開車比出門早）', () => {
  assert.equal(leavePayload(tw(19, 0), { role: 'tra', trainNo: '1', depart: '18:30', date: '2026-12-01' }), null);
  assert.equal(leavePayload(tw(19, 0), { role: 'tra', trainNo: '1' }), null);
  assert.equal(leavePayload(NaN, { depart: '19:00' }), null);
  assert.equal(leavePayload(tw(19, 0), null), null);
});

test('網頁、Android：什麼都不做（不掛事件）', () => {
  assert.doesNotThrow(() => mountLeaveActivity());
});
