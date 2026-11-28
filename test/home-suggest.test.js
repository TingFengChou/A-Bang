// 首頁「現在的建議」規則（ADR-0023、docs/HOME_REDESIGN.md §3、§4、§6、§7、§9）
import test from 'node:test';
import assert from 'node:assert/strict';
import { homeSuggest, homeAsks, resolveOrigin, legStatus, snapshot, commuteTrip, skyOf, NEAR_M } from '../core/home-suggest.js';

// 2026-12-01 是週二；台灣時間 = UTC+8
const tw = (m, d, h, min = 0) => Date.UTC(2026, m - 1, d, h - 8, min);
// 示範用的區中心座標（不是任何人的位置）
const HOME = { lat: 25.0263, lon: 121.5436, area: '大安區' };
const OFFICE = { lat: 25.0797, lon: 121.5752, area: '內湖區' };
const XINYI = { lat: 25.0330, lon: 121.5654, area: '信義區', near: '松仁路' };
const COMMUTE = { from: '家', to: '公司', legs: [{ mode: 'bus', route: '307', stop: '和平復興' }, { mode: 'metro', line: 'BR', name: '文湖線', station: '大安' }] };
const base = (o = {}) => ({
  now: tw(12, 1, 7, 40), day: { workday: true, known: true }, places: { 家: HOME, 公司: OFFICE }, commute: COMMUTE,
  transit: { bus: [{ route: '307', mins: 3, next: 14, headway: 12 }], metro: [{ line: 'BR', name: '文湖線', mins: 2 }] },
  location: { auto: HOME, override: null }, user: { onboarded: true }, ...o,
});

test('上班日早上、在家、有固定通勤方式 → 今日通勤（固定方式、班次正常）', () => {
  const r = homeSuggest(base());
  assert.equal(r.kind, 'commute');
  assert.equal(r.title, '今日通勤');
  assert.deepEqual(r.route, ['住家', '307', '文湖線', '公司']);
  assert.equal(r.origin.mode, 'fixed');
  assert.equal(r.origin.sub, '出發地・大安區');
  assert.equal(r.status, 'ok');
  assert.equal(r.statusText, '班次正常');
  assert.equal(r.readout.big, 3);
  assert.equal(r.readout.note, '下一班 14 分');
  assert.equal(r.cta.label, '開始出門倒數');
  assert.equal(r.eyebrow, '上班日早上');
  assert.equal(r.sky, 'day');
  assert.deepEqual(r.signals.map((x) => x.key), ['now', 'home', 'office', 'line']);
  assert.equal(r.signals[3].value, '即時班次');
});

test('下一班比班距 × 1.5 還久 → 「班次間隔較長」，不寫延誤分鐘，並給「仍搭」', () => {
  const r = homeSuggest(base({ transit: { bus: [{ route: '307', mins: 22, headway: 10 }], metro: [] } }));
  assert.equal(r.status, 'warn');
  assert.equal(r.statusText, '307 班次間隔較長');
  assert.equal(r.cta.alt.label, '仍搭 307');
  const line = r.signals.find((x) => x.key === 'line');
  assert.equal(line.value, '下一班 22 分');
  assert.equal(line.tone, 'warn');
  assert.ok(!JSON.stringify(r).includes('延誤'));
});

test('班距拿不到 → 不猜「班次間隔較長」，只寫下一班', () => {
  const r = homeSuggest(base({ transit: { bus: [{ route: '307', mins: 22 }], metro: [{ line: 'BR', mins: 4 }] } }));
  assert.equal(r.status, 'ok');
  assert.equal(r.readout.note, '22 分');
});

test('捷運一律「依時刻表」；查不到就說查不到', () => {
  assert.equal(legStatus({ mode: 'metro', line: 'BR', name: '文湖線' }, { metro: [{ line: 'BR', mins: 2 }] }).text, '依時刻表');
  assert.equal(legStatus({ mode: 'metro', line: 'BR' }, {}, true).text, '這次查不到班次');
  assert.equal(legStatus({ mode: 'bus', route: '307' }, { bus: [] }).text, '這次查不到班次');
  const r = homeSuggest(base({ transit: {} }));
  assert.equal(r.status, 'unknown', '公車查不到');
  assert.equal(r.statusText, '這次查不到部分班次');
  const m = legStatus({ mode: 'metro', line: 'BR' }, {});
  assert.equal(m.kind, 'timetable', '捷運沒查也照時刻表走：不是查不到');
});

test('傍晚返家：回程用去程反過來；第一段是捷運就標依時刻表', () => {
  const r = homeSuggest(base({ now: tw(12, 1, 18, 20), location: { auto: OFFICE, override: null } }));
  assert.equal(r.kind, 'home');
  assert.deepEqual(r.route, ['公司', '文湖線', '307', '住家']);
  assert.equal(r.readout.note, '依時刻表');
  const r2 = homeSuggest(base({ now: tw(12, 1, 18, 20), location: { auto: OFFICE, override: null }, transit: { metro: [] } }));
  assert.equal(r2.status, 'ok', '第二段公車沒查（按了再查）不算查不到');
  assert.equal(r2.legs[1].status.text, '按了再查');
  assert.equal(r.signals.find((x) => x.key === 'line').value, '依時刻表');
  assert.equal(r.cta.label, '開始返家導引');
  assert.equal(r.sky, 'dusk');
});

test('傍晚不在公司 → 自動改用目前位置，眉標說明已調整', () => {
  const r = homeSuggest(base({ now: tw(12, 1, 18, 20), location: { auto: XINYI, override: null } }));
  assert.equal(r.origin.mode, 'here');
  assert.equal(r.origin.auto, true);
  assert.equal(r.origin.sub, '信義區松仁路附近');
  assert.equal(r.route[0], '目前位置');
  assert.equal(r.eyebrow, '已依目前位置調整');
  assert.ok(r.reasons.some((x) => x.includes('不在公司附近')));
  assert.equal(r.signals[1].key, 'here');
});

test('手動切換永遠比自動位置優先', () => {
  const s = snapshot(base({ now: tw(12, 1, 18, 20), location: { auto: XINYI, override: 'fixed' } }));
  assert.equal(resolveOrigin(s, '公司').mode, 'fixed');
  const r = homeSuggest(base({ location: { auto: null, override: 'here' } }));
  assert.equal(r.origin.mode, 'here');
  assert.equal(r.origin.needAsk, true);
  assert.equal(r.origin.sub, '按下後才取得');
  assert.equal(r.cta.label, '開始通勤導引');
});

test('離固定地點不到 NEAR_M 公尺仍算在那裡', () => {
  const near = { lat: HOME.lat + 0.004, lon: HOME.lon };
  const s = snapshot(base({ location: { auto: near } }));
  assert.ok(resolveOrigin(s, '家').distM < NEAR_M);
  assert.equal(resolveOrigin(s, '家').mode, 'fixed');
});

test('早上已經在公司附近 → 不再建議通勤', () => {
  const r = homeSuggest(base({ location: { auto: OFFICE, override: null } }));
  assert.notEqual(r.kind, 'commute');
});

test('辦公日曆是別天的答案（快取跨過午夜）：不用，照星期推', () => {
  const r = homeSuggest(base({ day: { workday: false, known: true, dow: 0 } })); // 週二拿到週日的答案
  assert.equal(r.kind, 'commute');
  assert.equal(r.day.label, '上班日');
  assert.equal(r.day.known, false);
});

test('週末早上、補班日早上', () => {
  assert.notEqual(homeSuggest(base({ now: tw(11, 28, 7, 40), day: null })).kind, 'commute');
  const r = homeSuggest(base({ now: tw(11, 28, 7, 40), day: { workday: true, known: true } }));
  assert.equal(r.kind, 'commute');
  assert.equal(r.eyebrow, '補班日早上');
});

test('週末晚上不在家 → 返家路線；深夜 → 末班車', () => {
  const out = homeSuggest(base({ now: tw(11, 28, 22, 0), day: null, location: { auto: XINYI } }));
  assert.equal(out.kind, 'out');
  assert.equal(out.origin.mode, 'here');
  assert.equal(out.cta.steps[0], '以目前位置為起點');
  const late = homeSuggest(base({ now: tw(11, 28, 23, 40), day: null, location: { auto: null } }));
  assert.equal(late.kind, 'late');
  assert.equal(late.cta.steps[0], '取得目前位置，僅用於本次查詢');
  assert.equal(late.sky, 'night');
  const office = homeSuggest(base({ now: tw(11, 28, 23, 40), day: null, location: { auto: null, override: 'fixed' } }));
  assert.equal(office.cta.steps[0], '不需定位，以公司為起點');
  assert.ok(office.cta.href.includes(encodeURIComponent('從公司回家')));
  assert.equal(late.origin.fixedKey, '公司', '深夜也能切到公司');
  assert.equal(homeSuggest(base({ now: tw(11, 28, 23, 40), day: null, location: { auto: HOME } })).kind !== 'late', true);
});

test('優先序：安全 > 進行中 > 新手 > 通勤', () => {
  assert.equal(homeSuggest(base({ env: { aqi: { nearest: { aqi: 180 } } } })).kind, 'safety');
  assert.equal(homeSuggest(base({ user: { onboarded: true, trip: { href: '#/agent' } } })).kind, 'trip');
  assert.equal(homeSuggest(base({ places: {}, commute: null })).kind, 'new', '看過引導但沒設住家：開始使用');
  const walkFirst = homeSuggest(base({ now: tw(11, 28, 15, 0), day: null, places: {}, commute: null, user: { onboarded: true, walk: { kind: 'go', text: '天氣好' } } }));
  assert.equal(walkFirst.kind, 'walk', '有散步建議時排在「設定住家」前面');
  assert.ok(walkFirst.alt.some((a) => a.kind === 'new'));
  assert.equal(homeSuggest(base({ user: { onboarded: false } })).kind, 'new');
  const r = homeSuggest(base({ env: { aqi: { nearest: { aqi: 180 } } } }));
  assert.ok(r.alt.some((a) => a.kind === 'commute'));
  assert.ok(r.alt.length <= 5);
});

test('散步建議、明日提醒、一般', () => {
  const walk = homeSuggest(base({ now: tw(11, 28, 15, 0), day: null, user: { onboarded: true, walk: { kind: 'go', text: '天氣好', spot: { name: '大安森林公園', href: '#/x' } } } }));
  assert.equal(walk.kind, 'walk');
  assert.equal(walk.cta.label, '前往大安森林公園');
  assert.equal(homeSuggest(base({ now: tw(12, 1, 21, 30), location: { auto: HOME }, env: { tomorrow: { pop: 60 } } })).kind, 'tomorrow');
  const g = homeSuggest(base({ now: tw(12, 1, 13, 0) }));
  assert.equal(g.kind, 'general');
});

test('其他建議點了：prefer 換成那一個（要是成立的規則），原本的進到其他建議', () => {
  const s = base({ env: { aqi: { nearest: { aqi: 180 } } } });
  const r = homeSuggest({ ...s, prefer: 'commute' });
  assert.equal(r.kind, 'commute');
  assert.ok(r.alt.some((a) => a.kind === 'safety'));
  assert.equal(homeSuggest({ ...base(), prefer: 'walk' }).kind, 'commute', '不成立的不換');
  assert.equal(resolveOrigin(snapshot(base({ location: { auto: { lat: 25.04, lon: 121.56 }, override: 'here' } })), '家').sub, '依目前位置');
});

test('沒給 now 就丟錯（不讀時鐘）', () => {
  assert.throws(() => homeSuggest({}), TypeError);
});

test('commuteTrip：自設時段與回程路線', () => {
  const c = { ...COMMUTE, out: ['07:00', '09:30'], backLegs: [{ mode: 'bus', route: '綠 1' }] };
  assert.deepEqual(commuteTrip(c, 'out').win, [420, 570]);
  assert.equal(commuteTrip(c, 'back').legs[0].route, '綠 1');
  assert.equal(commuteTrip(c, 'back').from, '公司');
});

test('skyOf 五個時段', () => {
  assert.deepEqual([60, 6 * 60, 12 * 60, 17 * 60, 20 * 60].map(skyOf), ['night', 'dawn', 'day', 'dusk', 'night']);
});

test('您可能想問：接續上次在最前、跟著建議追問、去重、最多 5 個', () => {
  const s = base({ now: tw(12, 1, 7, 40), user: { onboarded: true, last: { q: '台北車站到台中怎麼去最快', at: tw(12, 1, 0, 0) }, antifraud: true }, env: { weather: { pop3h: 70 } } });
  const d = homeSuggest(s);
  const a = homeAsks(s, d);
  assert.equal(a[0].resume, true);
  assert.equal(a[0].q, '接續上次：台北車站到台中怎麼去最快');
  assert.ok(a[0].href.includes(encodeURIComponent('台北車站到台中怎麼去最快')));
  assert.equal(a[1].q, '307 下一班還要多久？');
  assert.equal(a.filter((x) => x.q === '今天需要帶傘嗎？').length, 1);
  assert.ok(a.length <= 5);
  // 超過 24 小時的上次不接續
  const old = homeAsks(base({ user: { onboarded: true, last: { q: 'x', at: tw(11, 29, 0) } } }), null);
  assert.ok(!old.some((x) => x.resume));
});
