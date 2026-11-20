// 行程規劃（M3-10）：車站座標對照、公車直達配對、候選方案、自動狀態、硬限制、來源失敗不中斷、tool
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, stationPoint, bikeFare } from '../core/services/trip.js';
import { matchDirect, commonRoutes } from '../core/services/bus-direct.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const TPE = { name: '臺北車站', lat: 25.0478, lon: 121.517 };
const T101 = { name: '台北101', lat: 25.033964, lon: 121.564468 };
const KHH = { name: '高雄車站', lat: 22.6394, lon: 120.3025 };
const NOW = Date.parse('2026-11-18T09:00:00+08:00');

test('stationPoint：高鐵對「高鐵○○站」或「○○車站」、台鐵對「○○車站」、臺／台不分', () => {
  assert.ok(stationPoint('THSR', '左營').lat < 22.8);
  assert.deepEqual(stationPoint('THSR', '台北'), { name: '台北', lat: 25.0478, lon: 121.517 });
  assert.equal(stationPoint('TRA', '臺北').lat, 25.0478);
  assert.notDeepEqual(stationPoint('TRA', '新竹'), stationPoint('THSR', '新竹')); // 台鐵新竹站 ≠ 高鐵新竹站
  assert.equal(stationPoint('TRA', '火星'), null);
});

test('bikeFare：前 30 分 5 元，之後每 30 分 10 元', () => {
  assert.deepEqual([bikeFare(10), bikeFare(30), bikeFare(31), bikeFare(65)], [5, 5, 15, 25]);
});

test('matchDirect：以座標找上下車站、驗證方向；commonRoutes 取共同路線', () => {
  const s = (seq, name, lat, lon, etaSec) => ({ seq, stopName: name, lat, lon, etaSec });
  const dirs = [
    { label: '往 東', stops: [s(1, 'A', 25.0479, 121.5171, 120), s(2, 'B', 25.04, 121.54), s(3, 'C', 25.034, 121.5644)] },
    { label: '往 西', stops: [s(1, 'C', 25.034, 121.5644), s(2, 'B', 25.04, 121.54), s(3, 'A', 25.0479, 121.5171)] },
  ];
  const m = matchDirect(dirs, TPE, T101);
  assert.deepEqual([m.label, m.board.name, m.alight.name, m.stops, m.board.etaSec], ['往 東', 'A', 'C', 2, 120]);
  assert.equal(matchDirect(dirs, TPE, KHH), null);
  assert.deepEqual(commonRoutes([{ routes: ['307', '601'] }, { routes: ['307'] }], [{ routes: ['307', '235'] }, { routes: ['601'] }]), ['307', '601']);
});

test('市區短程（示範）：步行、YouBike、公車、捷運、叫車都列出，排序與理由由 decide 產生', async () => {
  const r = await planTrip(createServices({ forceMock: true }), { from: TPE, to: T101, now: NOW });
  assert.deepEqual(r.options.map((o) => o.role).sort(), ['bike', 'bus', 'metro', 'ridehail', 'walk']);
  assert.equal(r.states.length, 0);
  assert.ok(r.best && r.ranking.ranked.length === 5 && /^選「/.test(r.ranking.reason));
  for (const o of r.options) {
    assert.ok(o.minutes > 0 && o.legs.length && /^\d{2}:\d{2}$/.test(o.arriveAt), o.id);
    assert.ok(o.legs.every((l) => l.nav === null || l.nav.google.startsWith('https://www.google.com/maps/')), o.id);
  }
  const ride = r.options.find((o) => o.role === 'ridehail');
  assert.ok(ride.estimated && ride.costRange[0] < ride.costRange[1] && ride.legs[0].url.startsWith('https://m.uber.com/'));
});

test('跨城（示範，下雨＋塞車）：自動狀態、軌道與客運、趕時間＋抵達時間排除遲到方案', async () => {
  const svc = createServices({ forceMock: true, demo: { traffic: 'jam', weather: 'rain' } });
  const r = await planTrip(svc, { from: TPE, to: KHH, departAt: '09:00', prefs: { states: ['rush'], arriveBy: '12:00' }, now: NOW });
  assert.deepEqual(r.states.map((s) => [s.key, s.source, s.from ?? null]), [['rain', 'auto', 'weather_now'], ['traffic', 'auto', 'traffic_status'], ['rush', 'user', null]]);
  assert.deepEqual(r.options.map((o) => o.role).sort(), ['intercity', 'ridehail', 'thsr', 'tra']);
  assert.deepEqual(r.ranking.excluded.map((e) => e.id).sort(), ['intercity', 'ridehail']);
  assert.equal(r.best, 'thsr');
  assert.match(r.ranking.reason, /正在下雨、路上正在塞車、你趕時間/);
  const thsr = r.options.find((o) => o.id === 'thsr');
  assert.deepEqual([thsr.train.from, thsr.train.to], ['台北', '左營']);
  // 出門時間＝發車 − 到站（臺北車站就在旁邊：走路 1 分）− 等車（最多 10 分）；抵達以實際班次計算
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  assert.equal(toMin(thsr.train.depart) - toMin(thsr.leaveAt), thsr.legs[0].minutes + thsr.waitMin);
  assert.ok(thsr.waitMin <= 10);
  assert.equal(thsr.arriveAt, (() => { const m = toMin(thsr.train.arrive) + thsr.legs[2].minutes; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })());
  assert.ok(thsr.cost > 1000);
});

test('跨午夜：22:00 出發、23:30 前到，隔天才到的方案要排除；arriveBy 早於出發視為隔天', async () => {
  const svc = createServices({ forceMock: true });
  const r = await planTrip(svc, { from: TPE, to: KHH, departAt: '22:00', prefs: { arriveBy: '23:30' }, now: NOW });
  const ride = r.options.find((o) => o.id === 'ridehail');
  assert.ok(ride.arriveMin > 24 * 60 && ride.arriveAt < '23:30');
  assert.ok(r.ranking.excluded.some((e) => e.id === 'ridehail'));
  const night = await planTrip(svc, { from: TPE, to: T101, departAt: '23:00', prefs: { arriveBy: '01:00' }, now: NOW });
  assert.ok(night.ranking.excluded.every((e) => e.id !== 'ridehail'), '23:00 出發 25 分叫車，01:00 前到得了');
});

test('客運帶入 ISO 出發日（不是今天的星期）', async () => {
  const svc = createServices({ forceMock: true });
  let got;
  svc.intercity = { trips: async (p) => { got = p.departAt; return { trains: [], delayRisk: 0.4 }; } };
  await planTrip(svc, { from: TPE, to: KHH, departAt: '2026-11-21T09:00', now: NOW });
  assert.equal(got, '2026-11-21T09:00');
});

test('來源失敗只略過：天氣、路況、公車壞掉仍回其他方案', async () => {
  const svc = createServices({ forceMock: true });
  const boom = async () => { throw new Error('boom'); };
  svc.weather = { now: boom };
  svc.traffic = { status: boom };
  svc.bus = { ...svc.bus, directTrips: boom };
  const r = await planTrip(svc, { from: TPE, to: T101, now: NOW });
  assert.deepEqual([r.weather, r.traffic, r.states], [null, null, []]);
  assert.deepEqual(r.unavailable, ['bus']);
  assert.ok(r.options.length >= 3 && r.best);
});

test('plan_trip tool：地名、card trip、speak、參數錯誤', async () => {
  const svc = createServices({ forceMock: true, demo: { traffic: 'jam' } });
  const r = await callTool(svc, 'plan_trip', { from: '台北車站', to: '高雄車站', departAt: '09:00' });
  assert.equal(r.card, 'trip');
  assert.match(r.speak, /^比了 \d 種方式，因為路上正在塞車，建議.+。$/);
  assert.match(r.text, /狀態：塞車中（自動：/);
  await assert.rejects(callTool(svc, 'plan_trip', { from: '台北車站', to: '台北101', prefs: { states: ['sleepy'] } }), /參數錯誤/);
  await assert.rejects(callTool(svc, 'plan_trip', { from: '台北車站', to: '台北101', prefs: { arriveBy: '25:00' } }), /參數錯誤/);
});

test('班次制：很早出發時不把長時間等車算進總時間，出門時間往後延', async () => {
  const svc = createServices({ forceMock: true });
  const r = await planTrip(svc, { from: TPE, to: KHH, departAt: '2026-11-19T05:00', now: NOW });
  const thsr = r.options.find((o) => o.id === 'thsr');
  assert.equal(thsr.waitMin, 10); // 05:01 就到站、06:07 才發車：只算 10 分
  assert.ok(thsr.minutes < 160, `${thsr.minutes} 分`);
  assert.ok(thsr.leaveAt > '05:30', thsr.leaveAt);
});

test('空品：起點 AQI > 100 自動加「空品不佳」（附測站與 AQI）；空品正常不加；查不到空品不影響規劃', async () => {
  const bad = await planTrip(createServices({ forceMock: true, demo: { air: 'bad' } }), { from: TPE, to: T101, now: NOW });
  const st = bad.states.find((s) => s.key === 'badAir');
  assert.ok(st && st.source === 'auto' && st.from === 'aqi_nearby' && /測站 AQI \d+（對敏感族群不健康）/.test(st.detail), JSON.stringify(st));
  assert.ok(bad.air.aqi > 100 && bad.air.site);
  const good = await planTrip(createServices({ forceMock: true }), { from: TPE, to: T101, now: NOW });
  assert.ok(!good.states.some((s) => s.key === 'badAir') && good.air.aqi <= 100);
  const svc = createServices({ forceMock: true });
  const noAir = await planTrip({ ...svc, life: { ...svc.life, aqiNearby: async () => { throw new Error('down'); } } }, { from: TPE, to: T101, now: NOW });
  assert.equal(noAir.air, null);
  assert.ok(noAir.best);
});

test('捷運方案（S7）：同線直達、轉乘站（在台北車站轉乘）、走到站太遠不列、機捷票價、台中代碼推線別、站表全失敗進 unavailable', async () => {
  const svc = createServices({ forceMock: true });
  const P = (name, lat, lon) => ({ name, lat, lon });
  const direct = await planTrip(svc, { from: P('台北車站', 25.0478, 121.517), to: P('南港展覽館', 25.0553, 121.6175), departAt: '2026-11-21T10:00' });
  const dm = direct.options.find((o) => o.role === 'metro');
  assert.equal(dm.name, '捷運 板南線');
  assert.ok(!dm.metro.transfer);
  const tr = await planTrip(svc, { from: P('西門町', 25.0421, 121.5081), to: P('台北101', 25.0339, 121.5645), departAt: '2026-11-21T10:00' });
  const tm = tr.options.find((o) => o.role === 'metro');
  assert.equal(tm.metro.via, '台北車站');
  assert.match(tm.legs[1].detail, /在台北車站轉乘/);
  assert.ok(!/站站|車轉乘/.test(JSON.stringify(tm)), '站名不重複「站」');
  const far = await planTrip(svc, { from: P('A', 25.0478, 121.5275), to: P('B', 25.0553, 121.6075), departAt: '2026-11-21T10:00' }); // 兩端各離站約 1 公里，直線約 8 公里
  assert.ok(far.options.every((o) => o.role !== 'metro' || o.walkMin < 30));
  const air = await planTrip(svc, { from: P('台北車站', 25.0478, 121.517), to: P('機場第一航廈', 25.0812, 121.2384), departAt: '2026-11-21T10:00' });
  const am = air.options.find((o) => o.role === 'metro');
  assert.ok(am && am.cost >= 120 && am.waitMin >= 10, `機捷票價與班距（${am?.cost} 元、等 ${am?.waitMin} 分）`);
  const { stationLines } = await import('../core/services/metro.js');
  assert.deepEqual(stationLines('TMRT', ['103a']), ['G']);
  assert.deepEqual(stationLines('KRTC', ['RK1']), ['R']);
  assert.deepEqual(stationLines('TRTC', ['BL12', 'R10']), ['BL', 'R']);
  const broken = { ...svc, metro: { ...svc.metro, stations: async () => { throw new Error('down'); } } };
  const b = await planTrip(broken, { from: P('台北車站', 25.0478, 121.517), to: P('南港展覽館', 25.0553, 121.6175), departAt: '2026-11-21T10:00' });
  assert.ok(b.unavailable.includes('metro'));
});
