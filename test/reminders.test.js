// 出門提醒（T7）：多筆、可取消、過期清掉（重開機不補送）、網頁版重新整理後還原、權限被拒不設定
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const shown = [];
class FakeNotification { static permission = 'granted'; static async requestPermission() { return FakeNotification.permission; } constructor(title, o) { shown.push([title, o.body]); } }
globalThis.Notification = FakeNotification;
const { addReminder, cancelReminder, listReminders, restoreReminders, cancelAllReminders, notifyState, MAX_REMINDERS } = await import('../public/js/reminders.js');

const inMin = (m) => new Date(Date.now() + m * 60_000);
beforeEach(() => { cancelAllReminders(); store.clear(); shown.length = 0; FakeNotification.permission = 'granted'; });

test('多筆、同一筆不重複、可取消；上限', async () => {
  const a = await addReminder(inMin(30), '該出門了：捷運');
  const b = await addReminder(inMin(60), '該出門了：公車');
  assert.ok(a && b && a !== b);
  assert.equal(await addReminder(inMin(30), '該出門了：捷運'), a, '同時間同文字是同一筆');
  assert.deepEqual(listReminders().map((r) => r.text), ['該出門了：捷運', '該出門了：公車']);
  assert.equal(cancelReminder(a), true);
  assert.equal(cancelReminder(a), false);
  assert.deepEqual(listReminders().map((r) => r.id), [b]);
  for (let i = 0; i < MAX_REMINDERS; i++) await addReminder(inMin(90 + i), `第 ${i}`);
  assert.equal(listReminders().length, MAX_REMINDERS);
  assert.equal(await addReminder(inMin(200), '太多了'), false);
});

test('時間不對、權限被拒、不支援通知：不設定', async () => {
  assert.equal(await addReminder(inMin(-5), '過去'), false);
  assert.equal(await addReminder(inMin(13 * 60), '太久以後'), false);
  FakeNotification.permission = 'denied';
  assert.equal(await notifyState(), 'denied');
  assert.equal(await addReminder(inMin(30), 'x'), false);
  FakeNotification.permission = 'default';
  assert.equal(await notifyState(), 'prompt');
  assert.deepEqual(listReminders(), []);
});

test('打開時：過期的清掉；網頁版把還沒到的排回去', async () => {
  const past = { id: 'old', at: Date.now() - 3600e3, text: '昨天的', nid: 2001 };
  const soon = { id: 'soon', at: Date.now() + 50, text: '快到了', nid: 2002 };
  store.set('abang.reminders', JSON.stringify([past, soon, null, { id: 'bad' }]));
  const alive = restoreReminders();
  assert.deepEqual(alive.map((r) => r.id), ['soon']);
  assert.deepEqual(JSON.parse(store.get('abang.reminders')).map((r) => r.id), ['soon']);
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(shown, [['阿幫提醒', '快到了']], '重新整理後還是會響');
  assert.deepEqual(listReminders(), [], '響過就移除');
});
