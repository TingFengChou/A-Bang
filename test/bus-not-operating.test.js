// 推了今天不會來的公車（真實 TDX 2026-11-22 週日 12:40，三峽 → 台北 101）：
// plan_trip 建議「公車 三峽-臺北市信義區」，盯到站才發現「新興街口：今日未營運」，回答卻還說「選公車…要我在公車快到站時提醒你嗎？」。
// 根因：matchDirect 只把 etaSec 帶到上車站，沒帶 status，busOption 的「3／4 不列入」永遠比不到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDirect } from '../core/services/bus-direct.js';
import { etaOf, nextBusAt } from '../core/services/transit.js';
import { answerFacts } from '../core/agent/answer-facts.js';
import { resolvePoint } from '../core/services/places.js';
import { planTrip, BUS_OFF, withoutBus } from '../core/services/trip.js';
import { decide } from '../core/decide.js';
import { createServices } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { demoSummary, busOffSay } from '../core/agent/demo-summary.js';
import { followUpText } from '../core/agent/model-loop.js';
import { enNote } from '../core/agent/en-notes.js';

const SANXIA = { name: '三峽', lat: 24.934, lon: 121.369 };
const T101 = { name: '台北101', lat: 25.033964, lon: 121.564468 };
const DAY = Date.parse('2026-11-22T12:40:00+08:00');
const today10 = () => Date.parse(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T10:00:00+08:00`); // 白天（深夜公車收班，結果不受跑測試的時間影響）

/** 真實資料的樣子：939（正常）＋三峽-臺北市信義區（上車站今日未營運） */
const trip = (routeName, status, etaSec, stops) => ({
  routeName, city: 'NewTaipei', label: '往 臺北市', direction: 0,
  board: { name: `${routeName}上車站`, seq: 2, lat: 24.936, lon: 121.370, etaSec, status },
  alight: { name: '市政府', lat: 25.041, lon: 121.565 }, stops, walkFromM: 250, walkToM: 400,
});
/** 真實模式的服務（直達公車換成指定的資料，其他用示範） */
function liveWith(trips, extra = {}) {
  const base = createServices({ forceMock: true });
  return { ...base, mode: 'live', bus: { ...base.bus, directTrips: async () => trips }, ...extra };
}
const plan = (svc) => planTrip(svc, { from: SANXIA, to: T101, departAt: '2026-11-22T12:40', now: DAY });

test('根因：matchDirect 的上車站帶到站狀態（今日未營運的路線 plan_trip 才排除得掉）', () => {
  const dirs = [{ direction: 0, label: '往 臺北市信義區', stops: [
    { seq: 1, stopName: '三峽一站', lat: 24.93, lon: 121.37, etaSec: null, status: 4 },
    { seq: 2, stopName: '新興街口', lat: 24.936067, lon: 121.372124, etaSec: null, status: 4 },
    { seq: 11, stopName: '市政府(松高)', lat: 25.0352, lon: 121.5641, etaSec: null, status: 4 },
  ] }];
  const m = matchDirect(dirs, SANXIA, T101);
  assert.equal(m.board.name, '新興街口');
  assert.equal(m.board.status, 4, '修正前這裡是 undefined');
  assert.equal(matchDirect([{ direction: 0, label: 'x', stops: [{ seq: 1, stopName: 'A', lat: 24.934, lon: 121.369 }, { seq: 2, stopName: 'B', lat: 25.034, lon: 121.564 }] }], SANXIA, T101).board.status, 0, '沒有狀態當 0');
});

test('busOption：上車站今日未營運（4）、末班已過（3）、交管不停靠（2）的路線不列入，另一條照常；卡片「沒列入」說是哪一條、為什麼', async () => {
  for (const s of [4, 3, 2]) {
    const r = await plan(liveWith([trip('三峽-臺北市信義區', s, null, 10), trip('939', 0, 300, 36)]));
    const bus = r.options.find((o) => o.role === 'bus');
    assert.equal(bus.id, 'bus-939', `狀態 ${s}`);
    assert.equal(bus.busOff, undefined, '內部欄位不外漏');
    const m = r.missing.find((x) => x.kind === 'route');
    assert.deepEqual([m.role, m.route, m.status, m.why, m.whyEn], ['bus', '三峽-臺北市信義區', s, BUS_OFF[s].why, BUS_OFF[s].whyEn]);
  }
  // 唯一的直達路線今日未營運：整個公車不列入（說是哪一條）
  const one = await plan(liveWith([trip('三峽-臺北市信義區', 4, null, 10)]));
  assert.ok(!one.options.some((o) => o.role === 'bus'));
  assert.match(one.missing.find((x) => x.role === 'bus').why, /附近直達的公車（三峽-臺北市信義區）今天沒有營運/);
});

test('busOption：到站時間不明（沒有任何預估、尚未發車）標 etaUnknown、照實說；有時間確定的路線時優先它', async () => {
  const r1 = await plan(liveWith([trip('939', 1, null, 36)]));
  const b1 = r1.options.find((o) => o.role === 'bus');
  assert.equal(b1.etaUnknown, true);
  assert.match(b1.notes[0], /尚未發車，到站時間不明（等車以 10 分估）/);
  const r0 = await plan(liveWith([trip('939', 0, null, 36)]));
  assert.match(r0.options.find((o) => o.role === 'bus').notes[0], /到站時間不明（站牌沒有預估/);
  // 兩條：時間不明的比較快也不選它
  const r2 = await plan(liveWith([trip('快線', 0, null, 4), trip('939', 0, 300, 36)]));
  assert.equal(r2.options.find((o) => o.role === 'bus').id, 'bus-939');
});

test('decide：到站時間不明的公車不排在時間確定的大眾運輸前面（unsure）；沒有別的大眾運輸時照分數', () => {
  const bus = { id: 'bus-939', role: 'bus', name: '公車 939', minutes: 40, waitMin: 10, walkMin: 4, cost: 15, exposure: 0.2, effort: 0.2, delayRisk: 0.1, etaUnknown: true };
  const metro = { id: 'metro', role: 'metro', name: '捷運 板南線', minutes: 55, waitMin: 5, walkMin: 15, cost: 40, exposure: 0.1, effort: 0.2, delayRisk: 0 };
  const ride = { id: 'ridehail', role: 'ridehail', name: '叫車（Uber）', minutes: 38, waitMin: 6, walkMin: 0, cost: 910, exposure: 0, effort: 0, delayRisk: 0.3 };
  const known = decide([bus, { ...bus, etaUnknown: undefined }, ride].slice(1)); // 對照：時間確定時公車會贏
  assert.equal(known.best.role, 'bus');
  const r = decide([bus, metro, ride]);
  assert.equal(r.best.id, 'metro');
  assert.deepEqual(r.ranked.map((o) => o.id), ['metro', 'bus-939', 'ridehail'], '讓位後跟叫車同分：公車在前（審查 2）');
  assert.match(r.reason, /^選「捷運 板南線」：公車 939 到站時間不明。$/, '理由說公車時間不明，不是跟叫車比價');
  const b = r.ranked.find((o) => o.id === 'bus-939');
  assert.deepEqual(b.unsure, { vs: 'metro' });
  assert.ok(b.breakdown.unsure < 0, '扣的分畫得出來');
  assert.match(decide([bus, metro]).reason, /^選「捷運 板南線」：公車 939 到站時間不明。$/, '理由照實說');
  // 帶行李（理由狀態）也照樣：這是資料可不可靠，不是偏好
  assert.notEqual(decide([bus, metro, ride], { states: ['luggage'] }).best.id, 'bus-939');
  // 只有這班公車是大眾運輸：仍列入、照分數
  const only = decide([bus, ride]);
  assert.equal(only.best.id, 'bus-939');
  assert.equal(only.ranked.find((o) => o.id === 'bus-939').unsure, undefined);
});

test('svc.busOff（盯到站後重排）：照盯到的狀態排除那條路線', async () => {
  const r = await plan(liveWith([trip('三峽-臺北市信義區', 0, 300, 10), trip('939', 0, 400, 36)], { busOff: [{ routeName: '三峽-臺北市信義區', status: 4 }] }));
  assert.equal(r.options.find((o) => o.role === 'bus').id, 'bus-939');
  assert.equal(r.missing.find((x) => x.kind === 'route').route, '三峽-臺北市信義區');
});

/** 跑一輪示範 agent，回傳事件 */
async function ask(say, demo) {
  const es = [];
  await runDemo(createServices({ forceMock: true, demo }), { messages: [{ role: 'user', content: say }] }, (e) => es.push(e), { now: today10() });
  return es;
}
const textOf = (es) => es.filter((e) => e.type === 'text').map((e) => e.delta).join('');

test('保底（示範 offLive：兩條直達，比較快的那條規劃時看起來正常、盯到站才發現今日未營運）：排除它重排、改推另一條，不推不會來的那班', async () => {
  const es = await ask('我想省錢，從西門町到台北101怎麼去？', { bus: 'offLive' });
  const etas = es.filter((e) => e.type === 'tool_result' && e.tool === 'bus_route_eta');
  const [off, ok] = etas;
  assert.equal(off.data.focus.status, 4, '盯到的證據照樣出現在討論串');
  const offRoute = off.data.routeName;
  assert.ok(es.some((e) => e.type === 'agent_note' && e.text === `@公車 先看 ${offRoute} 在「${off.data.focus.stopName}」今天有沒有車`));
  assert.ok(es.some((e) => e.type === 'agent_note' && e.text === `@行程 ${offRoute} 今天沒有營運，不列入，重新比較`));
  const planAt = es.findIndex((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.ok(es.indexOf(off) < planAt, '先盯、再出行程結果（卡片是重排後的）');
  const d = es.find((e) => e.type === 'decision');
  const best = d.options.find((o) => o.id === d.best);
  assert.notEqual(best.id, `bus-${offRoute}`);
  assert.ok(!d.options.some((o) => o.id === `bus-${offRoute}`), '不會來的那條不在方案裡');
  assert.deepEqual(d.missing.filter((m) => m.kind === 'route').map((m) => [m.route, m.status]), [[offRoute, 4]], '決策圖、卡片說這條為什麼不在');
  assert.equal(ok.data.routeName, best.follow.routeName, '接著盯的是改推的那一條');
  const text = textOf(es);
  assert.match(text, new RegExp(`^公車 ${offRoute} 今天沒有營運（站牌即時資訊），這次不推。選「公車 ${best.follow.routeName}」`));
  assert.doesNotMatch(text, new RegExp(`選「公車 ${offRoute}」|${offRoute} 約|${offRoute} 即將`));
  assert.ok(es.find((e) => e.type === 'discussion_end').tools.includes('bus_route_eta'));
});

test('保底（英文）：先說那條公車今天沒有營運，Best 是另一條', async () => {
  const es = await ask('I want to save money. How do I get from Ximending to Taipei 101?', { bus: 'offLive' });
  const off = es.find((e) => e.type === 'tool_result' && e.tool === 'bus_route_eta').data.routeName;
  const text = textOf(es);
  assert.match(text, new RegExp(`^Bus ${off}: not running today \\(live stop info\\), so I left it out\\.`));
  assert.doesNotMatch(text, new RegExp(`Best: Bus ${off},`));
  assert.ok(es.some((e) => e.type === 'agent_note' && e.text === `@公車 checking if bus ${off} is running at ${es.find((x) => x.tool === 'bus_route_eta').data.focus.stopName}`));
});

test('示範 off（規劃時就看得到今日未營運）：那條不列入、不盯它，回答先說；只有一條直達時整個公車不列入', async () => {
  const es = await ask('我想省錢，從西門町到台北101怎麼去？', { bus: 'off' });
  const d = es.find((e) => e.type === 'decision');
  const off = d.missing.find((m) => m.kind === 'route');
  assert.equal(off.status, 4);
  assert.ok(!es.some((e) => e.type === 'agent_note' && /先看/.test(e.text)), '規劃時已排除，不用重排');
  assert.match(textOf(es), new RegExp(`^公車 ${off.route} 今天沒有營運（站牌即時資訊），這次不推。`));
});

test('總結保底：推薦的仍是今天不會來的公車 → 排除它重新比較（不拿 ranking 第二名：被「太久」壓到公車後面的步行），改推捷運；中英文、不問到站提醒', () => {
  const o = (id, role, name, minutes, cost, more = {}) => ({ id, role, name, minutes, waitMin: 5, walkMin: 5, cost, exposure: 0.2, effort: 0.2, delayRisk: 0, arriveAt: '13:00', legs: [], ...more });
  const bus = o('bus-939', 'bus', '公車 939', 38, 15, { follow: { city: 'NewTaipei', routeName: '939', stop: '三峽國小', direction: 0, walkMin: 4 } });
  const walk = o('walk', 'walk', '步行', 102, 0, { walkMin: 102, waitMin: 0, effort: 0.8, exposure: 1 });
  const metro = o('metro', 'metro', '捷運（板南線轉淡水信義線）', 32, 25, { arriveAt: '13:12' });
  const ride = o('ridehail', 'ridehail', '叫車（Uber）', 25, 260, { walkMin: 0 });
  // 盯到站之前的排名：公車第一、被「太久」壓到公車後 1 分的步行第二（審查重現的情況）
  const data = { best: 'bus-939', options: [bus, walk, metro, ride], states: [{ key: 'budget', source: 'user' }], ranking: { ranked: [{ id: 'bus-939' }, { id: 'walk' }, { id: 'metro' }, { id: 'ridehail' }], excluded: [], reason: '選「公車 939」' } };
  const eta = { routeName: '939', focus: { stopName: '三峽國小', status: 4, statusText: '今日未營運', etaSec: null } };
  const results = { plan_trip: [{ data }], bus_route_eta: [{ data: eta, speak: '939 在「三峽國小」：今日未營運。' }] };
  const zh = demoSummary({ intent: 'trip', from: '三峽', to: '台北101', places: [], states: [] }, results);
  assert.match(zh, /公車 939 在「三峽國小」今天沒有營運（站牌即時資訊），這班不會來。改推「捷運（板南線轉淡水信義線）」：約 32 分，13:12 到。/);
  assert.doesNotMatch(zh, /選「公車|提醒|步行/);
  const en = demoSummary({ intent: 'trip', from: '三峽', to: '台北101', places: [], states: [], lang: 'en' }, results);
  assert.match(en, /Bus 939 at 三峽國小: not running today .*won't come\. Instead: MRT.*about 32 min, arriving 13:12\./);
  assert.doesNotMatch(en, /Best: Bus/);
  assert.match(busOffSay({ ...data, options: [bus] }, eta), /這班不會來。可以叫車或騎 YouBike。$/, '沒有其他方案');
});

test('withoutBus：排除不會來的公車後用同一套 decide() 重排，卡片、決策圖、回答一份資料；missing 補那一條', async () => {
  const svc = createServices({ forceMock: true });
  const [from, to] = await Promise.all([resolvePoint(svc.places, '西門町'), resolvePoint(svc.places, '台北101')]);
  const trip = await planTrip(svc, { from, to, departAt: '10:00', prefs: { states: ['budget'] }, now: today10() });
  assert.equal(trip.options.find((o) => o.id === trip.best).role, 'bus', '前提：示範資料想省錢推公車');
  const route = trip.options.find((o) => o.id === trip.best).follow.routeName;
  const r = withoutBus(trip, [{ role: 'bus', kind: 'route', route, status: 4, why: BUS_OFF[4].why, whyEn: BUS_OFF[4].whyEn }]);
  assert.equal(r.options.find((o) => o.id === r.best).role, 'metro', '大眾運輸優先，不推步行 100 分鐘');
  assert.ok(!r.options.some((o) => o.role === 'bus'));
  assert.ok(!r.ranking.ranked.some((x) => x.id === `bus-${route}`));
  assert.deepEqual(r.missing.filter((m) => m.kind === 'route').map((m) => m.route), [route]);
  assert.equal(withoutBus(r, [{ role: 'bus', kind: 'route', route, status: 4, why: 'x' }]).missing.filter((m) => m.kind === 'route').length, 1, '不重複');
});

/** 審查重現：四條直達都盯到今日未營運（directTrips 每次都回四條、到站查詢全部 4）；replanFails：重排時公車資料查不到 */
async function allOff({ replanFails = false } = {}) {
  const svc = createServices({ forceMock: true });
  const bus = svc.bus, rawEta = bus.routeEta.bind(bus), rawDirect = bus.directTrips.bind(bus);
  let base = null, calls = 0;
  svc.bus = { ...bus,
    directTrips: async (a) => { calls++; if (replanFails && calls > 1) throw new Error('boom'); base ||= (await rawDirect(a))[0]; return ['R1', 'R2', 'R3', 'R4'].map((r, i) => ({ ...base, routeName: r, board: { ...base.board, etaSec: 300 + i * 30, status: 0 } })); },
    routeEta: async (a) => { const r0 = await rawEta({ ...a, routeName: base.routeName }); return { ...r0, routeName: a.routeName, directions: r0.directions.map((d) => ({ ...d, stops: d.stops.map((s) => ({ ...s, status: 4, etaSec: null, statusText: '今日未營運' })) })) }; },
  };
  const es = [];
  await runDemo(svc, { messages: [{ role: 'user', content: '我想省錢，從西門町到台北101怎麼去？' }] }, (e) => es.push(e), { now: today10() });
  return es;
}

test('保底：幾條直達連續盯到不會來 → 重排到上限後排除全部、改推捷運；決策與行程結果只出一次，不說「幫您盯」', async () => {
  const es = await allOff();
  assert.equal(es.filter((e) => e.type === 'decision').length, 1);
  assert.equal(es.filter((e) => e.type === 'tool_result' && e.tool === 'plan_trip').length, 1);
  const etas = es.filter((e) => e.type === 'tool_result' && e.tool === 'bus_route_eta');
  assert.equal(etas.length, 3, '最多盯 MAX_ROUTES 條');
  assert.ok(etas.every((e) => e.data.focus.status === 4));
  const d = es.find((e) => e.type === 'decision');
  assert.equal(d.options.find((o) => o.id === d.best).role, 'metro');
  assert.ok(!d.options.some((o) => o.role === 'bus'), '卡片、決策圖也沒有不會來的公車');
  const offs = d.missing.filter((m) => m.kind === 'route').map((m) => m.route);
  assert.equal(offs.length, 3);
  const trip = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.equal(trip.data.best, d.best, '卡片與決策圖同一份');
  assert.doesNotMatch(trip.speak, /公車/);
  const text = textOf(es);
  assert.match(text, new RegExp(`^公車 ${offs.join('、')} 今天沒有營運（站牌即時資訊），這次不推。選「捷運`));
  assert.doesNotMatch(text, /步行要|選「公車|提醒/);
  assert.ok(!es.some((e) => e.type === 'agent_note' && /幫[你您]盯/.test(e.text)));
});

test('保底：重排時公車資料查不到 → 照樣說盯到的那條今天沒有營運，推捷運', async () => {
  const es = await allOff({ replanFails: true });
  const d = es.find((e) => e.type === 'decision');
  assert.equal(es.filter((e) => e.type === 'decision').length, 1);
  assert.equal(d.options.find((o) => o.id === d.best).role, 'metro');
  const off = d.missing.find((m) => m.kind === 'route');
  assert.equal(off.status, 4);
  assert.match(textOf(es), new RegExp(`^公車 ${off.route} 今天沒有營運（站牌即時資訊），這次不推。選「捷運`));
});

test('手機寫回答的事實清單：重排後的建議與沒列入的那條公車', async () => {
  const es = await ask('我想省錢，從西門町到台北101怎麼去？', { bus: 'offLive' });
  const data = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip').data;
  const facts = answerFacts({ intent: 'trip' }, { plan_trip: [{ data }] });
  assert.equal(facts.trip.best.name, data.options.find((o) => o.id === data.best).name);
  assert.ok(facts.trip.notIncluded.some((x) => /^公車 601：今天沒有營運/.test(x)), facts.trip.notIncluded.join('|'));
  assert.ok(answerFacts({ intent: 'trip' }, { plan_trip: [{ data }] }, { lang: 'en' }).trip.notIncluded.some((x) => /^Bus 601: not running today/.test(x)));
});

test('matchDirect：上車站不會停（2／3／4）改用同路線下一個候選站、下車站交管不停靠也跳過；整條都不會停才回那一站', () => {
  const stop = (seq, stopName, lat, lon, status = 0, etaSec = 120) => ({ seq, stopName, lat, lon, status, etaSec });
  const near = (st) => [{ direction: 0, label: 'x', stops: [stop(1, '最近', 24.9341, 121.3691, st, null), stop(2, '次近', 24.9352, 121.3700), stop(9, '下車A', 25.0340, 121.5645), stop(10, '下車B', 25.0345, 121.5650)] }];
  for (const st of [2, 3, 4]) assert.equal(matchDirect(near(st), SANXIA, T101).board.name, '次近', `狀態 ${st}`);
  assert.equal(matchDirect(near(1), SANXIA, T101).board.name, '最近', '尚未發車照常');
  const alight = [{ direction: 0, label: 'x', stops: [stop(1, '上車', 24.9341, 121.3691), stop(9, '下車A', 25.0340, 121.5645, 2), stop(10, '下車B', 25.0352, 121.5641)] }];
  assert.equal(matchDirect(alight, SANXIA, T101).alight.name, '下車B');
  const allOff4 = [{ direction: 0, label: 'x', stops: [stop(1, '最近', 24.9341, 121.3691, 4, null), stop(9, '下車A', 25.0340, 121.5645, 4, null)] }];
  assert.equal(matchDirect(allOff4, SANXIA, T101).board.status, 4, '整條都不會停：帶狀態，plan_trip 照實說不列入');
});

test('尚未發車有下一班時間（NextBusTime）：換算等車時間、不算時間不明；沒時區當台灣時間；解析不出來照舊', () => {
  const now = Date.parse('2026-11-22T13:00:00+08:00');
  assert.deepEqual(etaOf({ StopStatus: 1, NextBusTime: '2026-11-22T13:12:00+08:00' }, 0, now), { etaSec: 720, status: 1, statusText: '尚未發車（下一班約 13:12）', nextBusTime: '13:12' });
  assert.equal(etaOf({ StopStatus: 1, NextBusTime: '2026-11-22T13:12:00' }, 0, now).etaSec, 720, '沒寫時區＝+08:00');
  assert.deepEqual(etaOf({ StopStatus: 1 }, 0, now), { etaSec: null, status: 1, statusText: '尚未發車' });
  assert.equal(etaOf({ StopStatus: 1, NextBusTime: 'x' }, 0, now).etaSec, null);
  assert.equal(etaOf({ StopStatus: 1, NextBusTime: '2026-11-22T11:00:00+08:00' }, 0, now).etaSec, null, '已經過了');
  assert.equal(etaOf({ StopStatus: 4, NextBusTime: '2026-11-22T13:12:00+08:00' }, 0, now).etaSec, null, '只看尚未發車');
  assert.equal(nextBusAt('2026-11-23T03:00:00+08:00', now), null, '超過 12 小時');
});

test('示範 DEMO_BUS：不會來的路線由路線本身決定（不共用可變狀態；先查到站也一樣）', async () => {
  const a = createServices({ forceMock: true, demo: { bus: 'offLive' } });
  const first = await a.bus.routeEta({ city: 'Taipei', routeName: '601' }); // 還沒規劃行程就查
  assert.ok(first.directions[0].stops.every((s) => s.status === 4));
  assert.ok((await a.bus.routeEta({ city: 'Taipei', routeName: '212' })).directions[0].stops.every((s) => s.status === 0));
  const b = createServices({ forceMock: true, demo: { bus: 'offLive' } });
  const from = { lat: 25.0421, lon: 121.5081 }, to = { lat: 25.033964, lon: 121.564468 };
  assert.deepEqual((await a.bus.directTrips({ from, to })).map((t) => t.routeName), (await b.bus.directTrips({ from, to })).map((t) => t.routeName));
});

test('模型模式：盯到今天不會來 → 內部備註叫模型不要推這班、不要問提醒', () => {
  const t = followUpText({ speak: '939 在「三峽國小」：今日未營運。', data: { routeName: '939', focus: { status: 4 } } }, 4);
  assert.match(t, /不要建議坐這班、不要問到站提醒/);
  assert.doesNotMatch(followUpText({ speak: '939 約 5 分後到「三峽國小」。', data: { routeName: '939', focus: { status: 0, etaSec: 300 } } }, 4), /不要問到站提醒/);
});

test('英文討論串說明：盯到站與重新比較', () => {
  assert.equal(enNote('@公車 先看 939 在「三峽國小」今天有沒有車'), '@公車 checking if bus 939 is running at 三峽國小');
  assert.equal(enNote('@行程 三峽-臺北市信義區 今天沒有營運，不列入，重新比較'), '@行程 bus 三峽-臺北市信義區 is not running today; comparing again without it');
});
