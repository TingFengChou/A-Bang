// 交通健檢（2026-11-23）：行程規劃 plan_trip 的七個問題各一組回歸測試（示範資料＋替換的服務，不連 TDX）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, stationPoint, railPoint, carMinutes, traEstRunning, railDepMin, BUS_LIVE_AHEAD_MIN } from '../core/services/trip.js';
import { FARE_BASIS } from '../core/providers/ridehail/index.js';
import { tripText } from '../core/tools/trip.js';
import { createServices } from '../core/index.js';

const TPE = { name: '臺北車站', lat: 25.0478, lon: 121.517 };
const TC = { name: '臺中車站', lat: 24.1373, lon: 120.6865 };
const HSR_TC = { name: '高鐵臺中站', lat: 24.1121, lon: 120.6158 };
const SANXIA = { name: '三峽老街', lat: 24.9349, lon: 121.3695 };
const T101 = { name: '台北101', lat: 25.033964, lon: 121.564468 };
const HSINCHU = { name: '新竹車站', lat: 24.8016, lon: 120.9716 };
const KHH = { name: '高雄車站', lat: 22.6394, lon: 120.3025 };
const AIRPORT = { name: '桃園機場第一航廈', lat: 25.081, lon: 121.238 };
const ZHONGSHAN = { name: '中山站', lat: 25.0527, lon: 121.5203 };
const DAY = Date.parse('2026-11-18T09:00:00+08:00');
const at = (hhmm, date = '2026-11-18') => Date.parse(`${date}T${hhmm}:00+08:00`);
const mock = () => createServices({ forceMock: true });

// ── 1. 台鐵車站用車站清單的座標（地標沒收的站也能用） ──
test('1. railPoint：車站清單有座標就用，沒有才對地標；鶯歌、樹林、新烏日、新左營都用得到', async () => {
  assert.equal(stationPoint('TRA', '鶯歌'), null, '地標沒有鶯歌車站（原本整站不能用）');
  assert.deepEqual(railPoint('TRA', { name: '鶯歌', lat: 24.9543, lon: 121.3553 }), { name: '鶯歌', lat: 24.9543, lon: 121.3553 });
  assert.deepEqual(railPoint('TRA', { name: '臺北' }), stationPoint('TRA', '臺北'), '沒有座標：用地標');
  assert.equal(railPoint('TRA', { name: '火星', lat: null, lon: undefined }), null);
  const names = (await mock().rail.traStations()).map((s) => railPoint('TRA', s)).filter(Boolean).map((s) => s.name);
  for (const n of ['樹林', '鶯歌', '新烏日', '新左營']) assert.ok(names.includes(n), n);
});

test('1. 台中車站 → 高鐵台中站：列台鐵 臺中 → 新烏日（約 10 多分）', async () => {
  const r = await planTrip(mock(), { from: TC, to: HSR_TC, now: DAY });
  const tra = r.options.find((o) => o.role === 'tra');
  assert.ok(tra, '有台鐵');
  const ride = tra.legs.find((l) => l.mode === 'tra');
  assert.deepEqual([ride.from.name, ride.to.name], ['臺中', '新烏日']);
  assert.ok(ride.minutes <= 15, `車程 ${ride.minutes} 分`);
});

test('1. 三峽老街 → 台北101：台鐵從鶯歌上車，不往回繞到桃園', async () => {
  const r = await planTrip(mock(), { from: SANXIA, to: T101, now: DAY });
  const tra = r.options.find((o) => o.role === 'tra');
  assert.ok(tra);
  const ride = tra.legs.find((l) => l.mode === 'tra');
  assert.equal(ride.from.name, '鶯歌');
  assert.notEqual(ride.from.name, '桃園');
});

// ── 2. 深夜要等首班：不當成只等 10 分，叫車先到就推叫車 ──
test('2. 01:00 台北車站 → 新竹車站：鐵路、客運標 longWait（首班幾點），推 02 點多就到的叫車', async () => {
  const r = await planTrip(mock(), { from: TPE, to: HSINCHU, departAt: '01:00', now: at('01:00') });
  assert.equal(r.best, 'ridehail');
  for (const id of ['tra', 'thsr', 'intercity']) {
    const o = r.options.find((x) => x.id === id);
    assert.ok(o.longWait && o.longWait.min > 60 && o.longWait.extra === o.longWait.min - o.waitMin, id);
    assert.ok(o.notes.some((n) => n.startsWith(`首班 ${o.longWait.first} 才開，現在出發要等約 `)), id);
    assert.ok(o.arriveMin > r.options.find((x) => x.id === 'ridehail').arriveMin, '抵達比叫車晚');
  }
  assert.match(tripText(r), /才有車，現在出發要等約 \d+ 分/, '模型看得到要等多久');
  // 白天不標
  const day = await planTrip(mock(), { from: TPE, to: HSINCHU, now: DAY });
  assert.ok(day.options.every((o) => !o.longWait));
});

// ── 3. 晚一點才出發的公車：不套用現在的站牌狀態與到站時間 ──
const busTrip = (status, etaSec) => ({
  routeName: '939', city: 'NewTaipei', label: '往 臺北市', direction: 0,
  board: { name: '三峽站', seq: 2, lat: 24.936, lon: 121.370, etaSec, status },
  alight: { name: '市政府', lat: 25.041, lon: 121.565 }, stops: 20, walkFromM: 250, walkToM: 400,
});
const liveBus = (trips) => { const b = mock(); return { ...b, mode: 'live', bus: { ...b.bus, directTrips: async () => trips } }; };

test('3. 23:30 問明天 08:00：站牌現在「末班已過」不套用，公車照列、到站時間不明（不盯到站）', async () => {
  const svc = liveBus([busTrip(3, null)]);
  const now = await planTrip(svc, { from: SANXIA, to: T101, now: at('23:30') });
  assert.ok(!now.options.some((o) => o.role === 'bus'), '現在出發：末班已過不列入');
  assert.match(now.missing.find((m) => m.role === 'bus').why, /末班已過/);
  const r = await planTrip(svc, { from: SANXIA, to: T101, departAt: '2026-11-19T08:00', now: at('23:30') });
  const bus = r.options.find((o) => o.role === 'bus');
  assert.ok(bus, '明天 08:00：公車照列');
  assert.ok(bus.etaUnknown && bus.estimated && bus.waitMin === 10);
  assert.ok(!bus.follow, '晚一點出發不盯現在的到站');
  assert.match(bus.notes[0], /08:00 才出發：到站時間以那時的站牌資訊為準/);
  assert.ok(!(r.missing || []).some((m) => /末班已過/.test(m.why)));
});

test('3. 晚 15 分以上出發不用現在的到站時間；15 分內照用；同一天「今天沒有營運」照樣排除', async () => {
  const soon = await planTrip(liveBus([busTrip(0, 300)]), { from: SANXIA, to: T101, departAt: '09:10', now: DAY });
  assert.ok(BUS_LIVE_AHEAD_MIN === 15);
  assert.ok(!soon.options.find((o) => o.role === 'bus').etaUnknown, '10 分後出發：照即時到站');
  const later = await planTrip(liveBus([busTrip(0, 300)]), { from: SANXIA, to: T101, departAt: '11:00', now: DAY });
  assert.ok(later.options.find((o) => o.role === 'bus').etaUnknown, '2 小時後出發：到站時間不明');
  const off = await planTrip(liveBus([busTrip(4, null)]), { from: SANXIA, to: T101, departAt: '15:00', now: DAY });
  assert.ok(!off.options.some((o) => o.role === 'bus'), '今天沒有營運：今天晚一點也不會來');
  const tomorrow = await planTrip(liveBus([busTrip(4, null)]), { from: SANXIA, to: T101, departAt: '2026-11-19T15:00', now: DAY });
  assert.ok(tomorrow.options.some((o) => o.role === 'bus'), '明天：今天的「沒有營運」不套用');
});

// ── 4. 跨系統捷運：每一段各自找線與轉乘站 ──
test('4. 三峽老街 → 台北101：三鶯線到頂埔轉板南線，到台北車站再轉淡水信義線（轉乘時間算進去）', async () => {
  const r = await planTrip(mock(), { from: SANXIA, to: T101, now: DAY });
  const m = r.options.find((o) => o.role === 'metro');
  assert.equal(m.metro.lines, '三鶯線轉板南線轉淡水信義線');
  assert.deepEqual(m.metro.vias, ['頂埔', '台北車站']);
  const second = m.legs.filter((l) => l.mode === 'metro')[1];
  assert.match(second.detail, /^在頂埔站轉板南線，到台北車站再轉淡水信義線：頂埔 → 台北101/);
  assert.doesNotMatch(second.detail, /在頂埔站轉淡水信義線/);
  assert.ok(m.notes.some((n) => /共轉乘 2 次/.test(n)));
  assert.equal(m.transfers, 2);
});

// ── 5. 台鐵深夜：估算的營運時間放寬、過午夜的班次算隔天 ──
test('5. 估算的台鐵約 05:00～00:30 有車；班表上 03:00 前的班次算 24 小時以後', () => {
  assert.ok(traEstRunning(23 * 60 + 45) && traEstRunning(24 * 60 + 18) && traEstRunning(5 * 60));
  assert.ok(!traEstRunning(60) && !traEstRunning(4 * 60 + 59));
  assert.deepEqual([railDepMin('00:09'), railDepMin('02:59'), railDepMin('05:24'), railDepMin('23:55')], [1449, 1619, 324, 1435]);
});

test('5. 台鐵班表：23:58 出發坐得到 00:09 的車；01:00 出發等 05:24 首班', async () => {
  const b = mock();
  const trains = [['05:24', '06:30'], ['23:55', '01:01'], ['00:09', '01:15'], ['00:18', '01:24']].map(([d, a], i) => ({ trainNo: String(100 + i), type: '區間', depart: d, arrive: a, minutes: 66 }));
  const svc = { ...b, rail: { ...b.rail, traTimetable: async ({ from, to, date }) => ({ from, to, date, trains }) } };
  const late = await planTrip(svc, { from: TPE, to: HSINCHU, departAt: '23:58', now: at('23:58') });
  const tra = late.options.find((o) => o.role === 'tra');
  assert.equal(tra.train.depart, '00:09');
  assert.ok(!tra.longWait && tra.arriveMin > 24 * 60);
  assert.equal(tra.leaveAt, '23:58'); // 00:09 發車 − 走到站 1 分 − 等 10 分
  const night = await planTrip(svc, { from: TPE, to: HSINCHU, departAt: '01:00', now: at('01:00') });
  const first = night.options.find((o) => o.role === 'tra');
  assert.equal(first.train.depart, '05:24');
  assert.equal(first.longWait.first, '05:24');
});

// ── 6. 長途開車：超過 50 公里的部分用國道車速 ──
test('6. 叫車車程：台北→台中約 2 小時、台北→高雄約 4～4.5 小時', async () => {
  assert.equal(carMinutes(10), Math.round((10 / 22) * 60), '市區照舊');
  const ride = async (to) => (await planTrip(mock(), { from: TPE, to, now: DAY })).options.find((o) => o.role === 'ridehail').legs[0].minutes;
  const tc = await ride(TC), khh = await ride(KHH);
  assert.ok(tc >= 110 && tc <= 140, `台中 ${tc} 分`);
  assert.ok(khh >= 240 && khh <= 270, `高雄 ${khh} 分`);
});

// ── 7. 跨系統的機場捷運用公告票價；費率說法不冒充當地 ──
test('7. 機場 → 中山（機場線轉台北捷運）：機場捷運用公告的 160 元與時間，總票價是整數 5 元', async () => {
  const r = await planTrip(mock(), { from: AIRPORT, to: ZHONGSHAN, now: DAY });
  const m = r.options.find((o) => o.role === 'metro');
  assert.ok(m.metro.crossSystem);
  assert.equal(m.cost % 5, 0, `票價 ${m.cost}`);
  assert.ok(m.cost >= 160 + 20);
  assert.equal(m.legs.find((l) => l.mode === 'metro').minutes, 36);
  assert.ok(m.notes.some((n) => /機場捷運直達車約 36 分、160 元/.test(n)));
});

test('7. 叫車、YouBike 車資說「以臺北市費率估算」，不說成依當地費率', async () => {
  assert.match(FARE_BASIS, /^以臺北市計程車費率.*估算，各縣市費率不同/);
  const r = await planTrip(mock(), { from: TC, to: HSR_TC, now: DAY });
  const bike = r.options.find((o) => o.role === 'bike');
  assert.ok(bike.notes.includes('車資以 YouBike 2.0 臺北市費率估算（前 30 分 5 元；各縣市費率不同）'));
  assert.ok(r.options.find((o) => o.role === 'ridehail').notes[0].includes('以臺北市計程車費率'));
});
