// 台鐵換車走法（2026-11-23 產品負責人：「查火車都只給直達，這根本很難查到」）：純函式、示範資料、工具與行程規劃
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railJourneys, paretoJourneys, transferExtras, trainsOn, normGeneralTimetable, hhmmOf, railDepMin, MIN_TRANSFER_MIN } from '../core/rail-journeys.js';
import { traTrips, transferRow, fareTypeOf } from '../core/services/rail-trips.js';
import { planTrip } from '../core/services/trip.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const mock = () => createServices({ forceMock: true });
const ALL = [1, 1, 1, 1, 1, 1, 1];
// 小路網：A —(幹線)— J —(支線)— Z；幹線快車 F 在 J 停 08:30，支線車 B 08:33（來不及）、08:40
const NET = [
  { no: '100', type: '自強', days: ALL, stops: [['A', 480, 480], ['J', 510, 512], ['K', 560, 560]] },
  { no: '200', type: '區間', days: ALL, stops: [['J', 513, 513], ['Z', 540, 540]] },
  { no: '202', type: '區間', days: ALL, stops: [['J', 520, 520], ['Z', 547, 547]] },
  { no: '300', type: '區間', days: ALL, stops: [['A', 540, 540], ['J', 580, 581], ['Z', 610, 610]] }, // 直達但慢
];

test('railJourneys：在轉乘站換車，留足換車時間；直達車照列', () => {
  const js = railJourneys(NET, 'A', 'Z');
  assert.equal(js.length, 2);
  const [x, direct] = js;
  assert.deepEqual(x.legs.map((l) => l.no), ['100', '202'], '200 只隔 1 分，來不及換（至少 5 分）');
  assert.equal(x.transfers, 1);
  assert.equal(hhmmOf(x.dep), '08:00'); assert.equal(hhmmOf(x.arr), '09:07');
  assert.equal(direct.transfers, 0); assert.equal(direct.legs[0].no, '300');
  assert.equal(MIN_TRANSFER_MIN, 5);
});

test('railJourneys：起訖相同或站不存在回空；最多換 2 次', () => {
  assert.deepEqual(railJourneys(NET, 'A', 'A'), []);
  assert.deepEqual(railJourneys(NET, 'A', 'Q'), []);
  const chain = ['A', 'B', 'C', 'D', 'E'].map((s, i, a) => (i ? { no: `${i}`, days: ALL, stops: [[a[i - 1], 480 + i * 20, 480 + i * 20], [s, 490 + i * 20, 490 + i * 20]] } : null)).filter(Boolean);
  assert.equal(railJourneys(chain, 'A', 'D').length, 1, 'A→D 換 2 次可以');
  assert.equal(railJourneys(chain, 'A', 'E').length, 0, 'A→E 要換 3 次：不列');
});

test('paretoJourneys：更晚出發、更早到、換車不更多的走法把別的比下去', () => {
  const list = [{ dep: 480, arr: 600, transfers: 1 }, { dep: 490, arr: 590, transfers: 1 }, { dep: 470, arr: 620, transfers: 0 }];
  assert.deepEqual(paretoJourneys(list).map((j) => j.dep), [470, 490]);
});

test('transferExtras：直達車早開不到 10 分、晚到不到 10 分時，不另列換車走法', () => {
  const js = [{ dep: 480, arr: 600, transfers: 1 }, { dep: 600, arr: 700, transfers: 1 }, { dep: 700, arr: 800, transfers: 0 }];
  const direct = [{ depart: '07:55', minutes: 110 }]; // 07:55 開、09:45 到：比 08:00 換車走法早開 5 分、晚到 5 分
  assert.deepEqual(transferExtras(direct, js, railDepMin).map((j) => j.dep), [600]);
});

test('transferExtras：多換一次車要省 10 分以上才列（七堵、八堵換 2 次跟八堵換 1 次同時到：不列）', () => {
  const one = { dep: 658, arr: 769, transfers: 1 }, two = { dep: 663, arr: 769, transfers: 2 }, twoFast = { dep: 700, arr: 769, transfers: 2 };
  assert.deepEqual(transferExtras([], [one, two], railDepMin), [one]);
  assert.deepEqual(transferExtras([], [one, twoFast], railDepMin), [one, twoFast], '晚開 42 分還同時到：值得列');
});

test('normGeneralTimetable：車種名稱、星期、跨午夜往上加；03:00 前發車的算前一天的末班', () => {
  const raw = { TrainTimetables: [
    { TrainInfo: { TrainNo: '1', TrainTypeName: { Zh_tw: '自強(3000)(EMU3000 型電車)' } }, ServiceDay: { Monday: 1, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 1 },
      StopTimes: [{ StationID: '1000', ArrivalTime: '23:50', DepartureTime: '23:52' }, { StationID: '1020', ArrivalTime: '00:05', DepartureTime: '00:06' }] },
    { TrainInfo: { TrainNo: '2', TrainTypeName: { Zh_tw: '區間' } }, StopTimes: [{ StationID: '1000', ArrivalTime: '00:20', DepartureTime: '00:20' }, { StationID: '1020', ArrivalTime: '00:30', DepartureTime: '00:30' }] },
    { TrainInfo: { TrainNo: '3' }, StopTimes: [{ StationID: '1000', ArrivalTime: '08:00' }] }, // 只有一站：略過
  ] };
  const out = normGeneralTimetable(raw, (n) => n.Zh_tw.replace(/\(.*\)/, ''));
  assert.equal(out.length, 2);
  assert.equal(out[0].type, '自強');
  assert.deepEqual(out[0].days, [1, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(out[0].stops, [['1000', 1430, 1432], ['1020', 1445, 1446]]);
  assert.deepEqual(out[1].stops[0], ['1000', 1460, 1460], '00:20 開＝24:20（與 railDepMin 一致）');
  assert.equal(out[1].days, undefined);
  assert.equal(trainsOn(out, '2026-11-24').length, 1, '星期二：1 號車不開、2 號沒有星期資料照開');
  assert.equal(trainsOn(out, '2026-11-23').length, 2, '星期一');
});

test('transferRow、fareTypeOf：車次串起來、換車站、票價取最高等的那段', () => {
  const r = transferRow({ dep: 480, arr: 547, transfers: 1, legs: [{ no: '100', type: '自強', from: 'A', to: 'J', dep: 480, arr: 510 }, { no: '202', type: '區間', from: 'J', to: 'Z', dep: 520, arr: 547 }] }, (id) => ({ A: '臺北', J: '瑞芳', Z: '平溪' })[id]);
  assert.equal(r.trainNo, '100→202'); assert.deepEqual(r.via, ['瑞芳']); assert.equal(r.minutes, 67);
  assert.equal(r.legs[1].depart, '08:40'); assert.equal(r.fareType, '自強'); assert.equal(r.planned, true);
  assert.equal(fareTypeOf([{ type: '區間' }, { type: '普悠瑪' }, { type: '莒光' }]), '普悠瑪');
});

test('traTrips（示範）：臺北到平溪沒有直達車，列出在瑞芳換車的班次；幹線兩站不多列', async () => {
  const svc = mock();
  const p = await traTrips(svc, { from: '臺北', to: '平溪', date: '2026-11-24' });
  assert.ok(p.trains.length >= 10);
  assert.ok(p.trains.every((t) => t.via?.includes('瑞芳') && t.legs.length === 2));
  assert.equal(p.transferNote, '要換車的班次依台鐵定期時刻表推算，以當天公告為準');
  assert.deepEqual(p.trains.map((t) => t.depart), [...p.trains.map((t) => t.depart)].sort(), '依出發時間排序');
  const main = await traTrips(svc, { from: '臺北', to: '臺中', date: '2026-11-24' });
  assert.ok(main.trains.length && main.trains.every((t) => !t.legs), '幹線直達車就夠：不多列換車');
  assert.equal(main.transferNote, undefined);
  const j = await traTrips(svc, { from: '臺中', to: '集集', date: '2026-11-24' });
  assert.ok(j.trains.length && j.trains.every((t) => t.via?.includes('二水')));
});

test('traTrips：定期時刻表查不到時照舊只有直達車（不改用假的換車走法）', async () => {
  const svc = mock();
  const rail = { ...svc.rail, traGeneral: async () => null };
  const r = await traTrips({ ...svc, rail }, { from: '臺北', to: '平溪', date: '2026-11-24' });
  assert.deepEqual(r.trains, []);
  assert.equal(r.transfersUnavailable, true, '照實標示：換車走法這次查不到（不是沒有）');
  const { railSpeak } = await import('../core/tools/transit.js');
  assert.match(railSpeak({ system: 'TRA', ...r }), /換車的走法暫時查不到/);
  const failing = { ...svc.rail, traGeneral: () => Promise.reject(new Error('boom')) };
  assert.deepEqual((await traTrips({ ...svc, rail: failing }, { from: '臺北', to: '平溪', date: '2026-11-24' })).trains, []);
});

test('tra_timetable 工具：換車的班次在文字、發言與卡片資料裡都說在哪換車', async () => {
  const r = await callTool(mock(), 'tra_timetable', { from: '臺北', to: '平溪', date: '2026-12-01' });
  assert.ok(r.data.trains[0].legs);
  assert.match(r.text, /換車 1 次（瑞芳）/);
  assert.match(r.text, /定期時刻表推算/);
  assert.match(r.speak, /在瑞芳換車/);
});

test('plan_trip：去平溪（只有支線車）列出台鐵換車方案，分段是兩班車', async () => {
  const from = { name: '臺北車站', lat: 25.0478, lon: 121.517 }, to = { name: '平溪老街', lat: 25.0257, lon: 121.7395 };
  const r = await planTrip(mock(), { from, to, now: Date.parse('2026-11-24T08:00:00+08:00') });
  const tra = r.options.find((o) => o.role === 'tra');
  assert.ok(tra, `應有台鐵方案；沒列入：${JSON.stringify(r.missing)}`);
  assert.deepEqual(tra.rail.via, ['瑞芳']);
  assert.equal(tra.legs.filter((l) => l.mode === 'tra').length, 2);
  assert.match(tra.name, /瑞芳換車/);
  assert.ok(tra.notes.some((n) => /在瑞芳換車/.test(n)));
  assert.equal(tra.train.to, '瑞芳', '訂票：第一段');
});
