// 行程中模式：進行中列（tripOf）、到下車站還要多久（rideLeftSec）、街景坐車中說法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rideLeftSec, rideLeftText } from '../public/js/alight.js';
import { sceneSay } from '../public/ui/cards/bus-scene.js';

const { tripOf, onBusPage, hideTripBar } = await import('../public/js/trip-bar.js');

const now = 1_800_000_000_000;
const alight = { city: 'Taipei', routeName: '307', direction: 0, board: '敦化市場', dest: '西門', destSeq: 20, rideSec: 900, boardAt: now - 300_000 };

test('rideLeftSec：有查到用查到的（扣掉經過的時間）；沒查到用設定時的估計；還沒上車要加上等車時間', () => {
  assert.equal(rideLeftSec(alight, now), 600, '900 秒 − 已坐 300 秒');
  assert.equal(rideLeftSec({ ...alight, last: { etaSec: 400, at: now - 100_000 } }, now), 300);
  assert.equal(rideLeftSec({ ...alight, last: { etaSec: 30, at: now - 100_000 } }, now), 0, '不會變負的');
  assert.equal(rideLeftSec({ ...alight, boardAt: now + 60_000 }, now), 960, '車還沒進站：等 60 秒＋坐 900 秒');
  assert.equal(rideLeftSec(null, now), null);
  assert.equal(rideLeftText(alight, now), '約 10 分到「西門」');
  assert.equal(rideLeftText({ ...alight, last: { etaSec: 40, at: now } }, now), '快到「西門」了');
});

test('tripOf：坐車中優先；等車中說提醒；連結回公車頁（帶上車站與方向）', () => {
  assert.equal(tripOf({}), null);
  const arrival = { city: 'Taipei', routeName: '307', stop: '和平體育館', direction: 1, minutes: 3 };
  const w = tripOf({ arrival, now });
  assert.equal(w.kind, 'waiting');
  assert.equal(w.text, '307 在「和平體育館」上車・到站前 3 分提醒你', '說上車站，不像目的地');
  assert.equal(tripOf({ arrival: { ...arrival, last: { etaSec: 400, at: now - 100_000 } }, now }).text, '307 在「和平體育館」上車・約 5 分到站');
  assert.equal(tripOf({ arrival: { ...arrival, last: { etaSec: 50, at: now } }, now }).text, '307 在「和平體育館」上車・車快到了');
  assert.equal(w.href, `#/bus/Taipei/307?stop=${encodeURIComponent('和平體育館')}&dir=1`);
  const r = tripOf({ alight, arrival, now });
  assert.equal(r.kind, 'riding');
  assert.equal(r.text, '307 坐車中・約 10 分到「西門」');
  assert.match(r.href, /^#\/bus\/Taipei\/307\?stop=.+&dir=0$/);
});

test('街景：坐車中快到時說「準備下車」，不說「就在你這站」', () => {
  assert.match(sceneSay({ routeName: '307', away: 0, etaSec: 40, etaText: '快到了', riding: true }).head, /快到了，準備下車/);
  assert.match(sceneSay({ routeName: '307', away: 0, etaSec: 40, etaText: '進站中' }).head, /就在你這站/);
});

test('onBusPage：同路線、同上車站與方向才不顯示；別站或別方向照樣顯示（編碼與否都算）', () => {
  const t = tripOf({ alight: { ...alight, routeName: '紅30' }, now });
  const enc = `#/bus/Taipei/${encodeURIComponent('紅30')}`;
  assert.equal(onBusPage(t, `${enc}?stop=${encodeURIComponent('敦化市場')}&dir=0`), true);
  assert.equal(onBusPage(t, `#/bus/Taipei/紅30?stop=敦化市場&dir=0`), true);
  assert.equal(onBusPage(t, `${enc}?stop=${encodeURIComponent('別站')}&dir=0`), false);
  assert.equal(onBusPage(t, `${enc}?stop=${encodeURIComponent('敦化市場')}&dir=1`), false);
  assert.equal(onBusPage(t, '#/'), false);
});

test('hideTripBar：提醒頁不顯示（列表第一筆就是同一個提醒，設計第三輪 #6）；其他頁照樣顯示', () => {
  const t = { city: 'Taipei', route: '307', stop: '捷運西門站', direction: 0 };
  assert.equal(hideTripBar(t, '#/reminders'), true);
  assert.equal(hideTripBar(t, '#/reminders?x=1'), true);
  assert.equal(hideTripBar(t, '#/'), false);
  assert.equal(hideTripBar(t, '#/agent'), false);
  assert.equal(hideTripBar(t, '#/bus/Taipei/307?stop=捷運西門站&dir=0'), true, '這條路線的公車頁照舊不顯示');
});
