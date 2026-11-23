// 自行開車（2026-11-22 產品負責人「交通方式還有應該是自行開車」「要搭配停車場資訊更好」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../core/index.js';
import { planTrip, EST } from '../core/services/trip.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { withHabit, runDemo } from '../core/agent/run.js';

const NOW = Date.parse('2026-11-18T10:00:00+08:00');
const MAIN = { name: '台北車站', lat: 25.0478, lon: 121.517 };
const T101 = { name: '台北101', lat: 25.0336, lon: 121.5645 };

test('我有車才列「自己開車」；指定開車也列；時間含找車位、花費含油錢與停車（估算）', async () => {
  const svc = createServices({ forceMock: true });
  const none = await planTrip(svc, { from: MAIN, to: T101, now: NOW });
  assert.ok(!none.options.some((o) => o.role === 'drive'), '沒有車：不列');
  const car = await planTrip(svc, { from: MAIN, to: T101, prefs: { car: true }, now: NOW });
  const d = car.options.find((o) => o.role === 'drive');
  assert.ok(d, '我有車：列入比較');
  assert.equal(d.name, '自己開車');
  assert.equal(d.est.minutes, true);
  assert.equal(d.est.cost, true);
  assert.ok(d.minutes > EST.driveParkFindMin + EST.driveParkWalkMin);
  assert.ok(d.cost >= EST.driveParkTwdPerHour + 5, '油錢＋停車');
  assert.match(d.notes[0], /^油錢約 \d+ 元（道路約 \d+ 公里）＋停車約 40 元/);
  assert.equal(d.legs[0].nav.google.includes('travelmode=driving'), true, '導航用開車');
  const said = await planTrip(svc, { from: MAIN, to: T101, prefs: { mode: 'drive' }, now: NOW });
  assert.ok(said.options.some((o) => o.role === 'drive'), '說開車去：也列');
});

test('「開車去」是自己開車、不是叫車；「叫車」照舊；英文 drive', () => {
  assert.equal(parseIntent('開車去台北101').mode, 'drive');
  assert.equal(parseIntent('我想自己開車到台北101').mode, 'drive');
  assert.equal(parseIntent('叫車去台北101').mode, 'ridehail');
  assert.equal(parseIntent('I want to drive to Taipei 101').mode, 'drive');
});

test('我有車只採用手機的設定（模型帶的 car 拿掉）', () => {
  assert.deepEqual(withHabit({ from: 'a', prefs: { car: true } }, null, false), { from: 'a' });
  assert.deepEqual(withHabit({ from: 'a' }, null, true), { from: 'a', prefs: { car: true } });
});

test('問阿幫：userState.car 帶進 plan_trip', async () => {
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '從台北車站到台北101怎麼去' }], userState: { car: true } }, (e) => es.push(e), { now: NOW });
  const trip = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.ok(trip.data.options.some((o) => o.role === 'drive'));
});

test('停車場：開到有空位的那一個（沒空位的跳過）、走過去照距離算；卡片列出停車場；查不到照實說', async () => {
  const svc = createServices({ forceMock: true });
  const d = (await planTrip(svc, { from: MAIN, to: T101, prefs: { car: true }, now: NOW })).options.find((o) => o.role === 'drive');
  assert.match(d.legs[0].detail, /^開車到「示範停車場 A」約 \d+ 分/);
  assert.match(d.legs[1].detail, /^停車（剩 42 位），走過去約 \d+ 分$/);
  assert.equal(d.parking[0].name, '示範停車場 A');
  assert.ok(d.notes.some((n) => /^停車場：示範停車場 A（離目的地約 \d+ 公尺，剩 42 位；30 元／小時（示範））$/.test(n)));
  const noLot = { ...svc, parking: { nearby: async () => ({ city: 'Taipei', lots: [], noData: true }) } };
  const n = (await planTrip(noLot, { from: MAIN, to: T101, prefs: { car: true }, now: NOW })).options.find((o) => o.role === 'drive');
  assert.match(n.legs[1].detail, /^找車位、停好走過去約 8 分（估算）$/);
  assert.ok(n.notes.some((x) => /查不到停車場資料/.test(x)));
  const broken = { ...svc, parking: { nearby: async () => { throw new Error('x'); } } };
  assert.ok((await planTrip(broken, { from: MAIN, to: T101, prefs: { car: true }, now: NOW })).options.some((o) => o.role === 'drive'), '停車場壞了：開車照列');
});

test('parking：正規化、有空位的優先、600 公尺外不列', async () => {
  const { normCarPark, normAvail, rankLots } = await import('../core/services/parking.js');
  assert.equal(normCarPark({ CarParkID: 'A', CarParkName: { Zh_tw: 'x' } }), null, '沒有座標不收');
  assert.deepEqual(normCarPark({ CarParkID: 'A', CarParkName: { Zh_tw: '南園停車場' }, CarParkPosition: { PositionLat: 24.97, PositionLon: 121.22 }, FareDescription: '30/h', LiveOccuppancyAvailable: 0 }), { id: 'A', name: '南園停車場', lat: 24.97, lon: 121.22, fare: '30/h', live: false });
  const av = normAvail([{ CarParkID: 'A', AvailableSpaces: 5, TotalSpaces: 20, FullStatus: 0 }, { CarParkID: 'B', AvailableSpaces: -9 }]);
  assert.deepEqual([av.get('A').available, av.get('B').available], [5, null]);
  const to = { lat: 25, lon: 121.5 };
  const r = rankLots([{ id: 'full', lat: 25.0005, lon: 121.5, available: 0 }, { id: 'ok', lat: 25.002, lon: 121.5, available: 3 }, { id: 'far', lat: 25.02, lon: 121.5, available: 9 }], to);
  assert.deepEqual(r.map((x) => x.id), ['ok', 'full']);
});

test('估算的台鐵（短程、不查時刻表）只在約 05:00～00:30 列出；半夜說沒有車', async () => {
  const { TRA_EST } = await import('../core/services/trip.js');
  const svc = createServices({ forceMock: true });
  const BQ = { name: '板橋車站', lat: 25.0143, lon: 121.4637 }; // 板橋 → 臺北：6 公里多，台鐵用估算
  const day = await planTrip(svc, { from: BQ, to: MAIN, now: NOW });
  assert.equal(day.options.find((o) => o.role === 'tra')?.name, '台鐵（估算）', '白天：列估算的台鐵');
  const night = await planTrip(svc, { from: BQ, to: MAIN, departAt: '01:00', now: Date.parse('2026-11-23T01:00:00+08:00') });
  assert.ok(!night.options.some((o) => o.role === 'tra'), '01:00：不列台鐵');
  assert.match(night.missing.find((x) => x.role === 'tra').why, /這個時間台鐵沒有車（約 05:00～00:30 有車）/);
  // 23:45 還有車（23:55、00:09、00:18 都有班次；2026-11-23 交通健檢）
  const late = await planTrip(svc, { from: BQ, to: MAIN, departAt: '23:45', now: Date.parse('2026-11-23T23:45:00+08:00') });
  assert.equal(late.options.find((o) => o.role === 'tra')?.name, '台鐵（估算）', '23:45：列估算的台鐵');
  assert.deepEqual([TRA_EST.open, TRA_EST.close], [300, 30]);
});
