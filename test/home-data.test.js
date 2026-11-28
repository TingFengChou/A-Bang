// 首頁「夜色與光」的資料整理與天空（ADR-0023；public/js/home-data.js、public/js/home-sky.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { commuteOf, snapshotOf, lastAsk, tilePlan, capsFor, svcOrder, MAX_LIVE_CALLS } from '../public/js/home-data.js';
import { threads, starsHtml, skylineSvg, fullIntroToday } from '../public/js/home-sky.js';
import { homeSuggest } from '../core/home-suggest.js';

const C = { from: '家', to: '公司', legs: [{ mode: 'bus', route: '307', stop: '和平復興', city: 'Taipei', direction: 0 }, { mode: 'metro', line: 'BR', name: '文湖線', station: '大安' }] };

test('commuteOf：只收完整的固定通勤方式，欄位截短、怪東西丟掉', () => {
  assert.deepEqual(commuteOf(JSON.stringify(C)), C);
  assert.equal(commuteOf('{bad'), null);
  assert.equal(commuteOf({ from: '家', to: '公司', legs: [] }), null);
  assert.equal(commuteOf({ from: '家', to: '公司', legs: [{ mode: 'taxi' }] }), null, '不認得的交通方式：整個不用');
  assert.equal(commuteOf({ ...C, legs: [{ mode: 'bus', route: 'x'.repeat(50) }] }).legs[0].route.length, 20);
  assert.equal(commuteOf(null), null);
});

test('snapshotOf：位置只在有定位時放；常用地點的名稱當區名；交給 homeSuggest 跑得動', () => {
  const now = Date.UTC(2026, 11, 1, 7 - 8, 40);
  const s = snapshotOf({ now, nowData: { pos: { lat: 25.0263, lon: 121.5436 }, day: { workday: true, known: true } }, places: { 家: { name: '大安區', lat: 25.0263, lon: 121.5436 }, 公司: { name: '公司', lat: 25.0797, lon: 121.5752 } }, commute: C });
  assert.deepEqual(s.location.auto, { lat: 25.0263, lon: 121.5436 });
  assert.equal(s.places['家'].area, '大安區');
  assert.equal(s.places['公司'].area, undefined, '名字就是「公司」：不當區名');
  const d = homeSuggest(s);
  assert.equal(d.kind, 'commute');
  assert.equal(snapshotOf({ now, nowData: null }).location.auto, null);
  assert.equal(snapshotOf({ now, nowData: { offline: true } }).source.offline, true);
});

test('lastAsk：上次最後一句使用者的話', () => {
  assert.deepEqual(lastAsk({ at: 5, messages: [{ role: 'user', content: '307 到了嗎' }, { role: 'assistant', content: '…' }] }), { q: '307 到了嗎', at: 5 });
  assert.equal(lastAsk(null), null);
});

test('tilePlan：打開首頁最多查 2 個交通即時資料；通勤第一段優先', () => {
  const fav = { type: 'station', city: 'Taipei', stationId: '123', title: '和平復興' };
  const p = tilePlan({ commute: C, pos: { lat: 1, lon: 2 }, fav });
  assert.equal(p.length, MAX_LIVE_CALLS);
  assert.deepEqual(p.map((x) => x.kind), ['leg', 'bike']);
  assert.deepEqual(tilePlan({ fav }).map((x) => x.kind), ['fav']);
  assert.deepEqual(tilePlan({ commute: C, legIndex: 1 }), [], '捷運段不查（依時刻表）');
});

test('capsFor：只列這支手機做得到的', () => {
  const ids = (p) => capsFor(p).map((c) => c.id);
  assert.deepEqual(ids('web'), ['cam', 'cal']);
  assert.ok(ids('ios').includes('siri') && !ids('ios').includes('widget'));
  assert.ok(ids('android').includes('widget') && !ids('android').includes('siri'));
  assert.ok(capsFor('ios').find((c) => c.id === 'lock').text.includes('動態島'));
  assert.ok(capsFor('android').find((c) => c.id === 'lock').text.includes('通知列'));
});

test('svcOrder：每個時段都列出全部服務（只是順序不同）', () => {
  for (const m of [6 * 60, 12 * 60, 18 * 60, 23 * 60]) assert.equal(new Set(svcOrder(m).map((a) => a.id)).size, svcOrder(m).length);
  assert.equal(svcOrder(7 * 60)[0].id, 'bus');
});

test('home-sky：固定亂數（每次一樣）、101 在天際線、連線角度', () => {
  assert.equal(starsHtml(), starsHtml());
  assert.equal((starsHtml().match(/<i /g) || []).length, 46);
  assert.match(skylineSvg(), /hs-101/);
  const [t] = threads([{ x: 0, y: 0 }], { x: 10, y: 0 });
  assert.deepEqual(t, { left: 0, top: 0, len: 10, deg: 0 });
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(fullIntroToday('2026-12-1', store), true);
  assert.equal(fullIntroToday('2026-12-1', store), false, '同一天第二次只淡入');
  assert.equal(fullIntroToday('2026-12-2', store), true);
});

test('commuteFromTrip：查完住家↔公司的公車或捷運 → 固定通勤方式＋回程＋預設時段（共同決議 B）', async () => {
  const { commuteFromTrip } = await import('../public/js/home-data.js');
  const places = { 家: { lat: 25.0263, lon: 121.5436 }, 公司: { lat: 25.0797, lon: 121.5752 } };
  const data = { from: { name: '家', lat: 25.0264, lon: 121.5437 }, to: { name: '公司', lat: 25.0796, lon: 121.5751 },
    options: [{ id: 'bus', role: 'bus', follow: { city: 'Taipei', routeName: '307', stop: '和平復興', direction: 0 } }, { id: 'metro', role: 'metro', metro: { from: '大安', lines: '文湖線轉板南線', via: '忠孝復興' } }, { id: 'walk', role: 'walk' }] };
  const bus = commuteFromTrip(data, 'bus', places);
  assert.deepEqual(bus.commute.legs, [{ mode: 'bus', route: '307', stop: '和平復興', city: 'Taipei', direction: 0 }]);
  assert.deepEqual(bus.commute.backLegs, [{ mode: 'bus', route: '307', city: 'Taipei' }], '回程的上車站不知道：不猜');
  assert.equal(bus.out, '住家 → 307 → 公司（上班日 06:00–10:00）');
  assert.equal(bus.back, '公司 → 307 → 住家（上班日 16:30–21:00）');
  assert.ok(commuteOf(bus.commute), '存得進去');
  const m = commuteFromTrip(data, 'metro', places);
  assert.deepEqual(m.commute.legs.map((l) => [l.line, l.station]), [['BR', '大安'], ['BL', '忠孝復興']]);
  assert.equal(commuteFromTrip(data, 'walk', places), null, '走路不算固定通勤方式');
  // 從公司查回家：回程就是查到的那條
  const back = commuteFromTrip({ ...data, from: data.to, to: data.from }, 'bus', places);
  assert.equal(back.commute.to, '公司');
  assert.equal(back.commute.backLegs[0].stop, '和平復興');
  assert.equal(commuteFromTrip({ ...data, to: { lat: 25.1, lon: 121.6 } }, 'bus', places), null, '終點不是常用地點');
});
