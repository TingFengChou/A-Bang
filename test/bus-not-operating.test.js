// 推了今天不會來的公車（真實 TDX 2026-11-22 週日 12:40，三峽 → 台北 101）：
// plan_trip 建議「公車 三峽-臺北市信義區」，盯到站才發現「新興街口：今日未營運」，回答卻還說「選公車…要我在公車快到站時提醒你嗎？」。
// 根因：matchDirect 只把 etaSec 帶到上車站，沒帶 status，busOption 的「3／4 不列入」永遠比不到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchDirect } from '../core/services/bus-direct.js';
import { planTrip, BUS_OFF } from '../core/services/trip.js';
import { decide } from '../core/decide.js';
import { createServices } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { demoSummary, busOffSay } from '../core/agent/demo-intent.js';
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

test('總結保底：重排後推薦的仍是今天不會來的公車 → 改推排名下一個（中英文），不問到站提醒', () => {
  const bus = { id: 'bus-939', role: 'bus', name: '公車 939', minutes: 40, arriveAt: '13:20', follow: { city: 'NewTaipei', routeName: '939', stop: '三峽國小', direction: 0, walkMin: 4 } };
  const ride = { id: 'ridehail', role: 'ridehail', name: '叫車（Uber）', minutes: 38, arriveAt: '13:18', legs: [] };
  const data = { best: 'bus-939', options: [bus, ride], states: [], ranking: { ranked: [{ id: 'bus-939' }, { id: 'ridehail' }], excluded: [], reason: '選「公車 939」：省 895 元。' } };
  const eta = { routeName: '939', focus: { stopName: '三峽國小', status: 4, statusText: '今日未營運', etaSec: null } };
  const results = { plan_trip: [{ data }], bus_route_eta: [{ data: eta, speak: '939 在「三峽國小」：今日未營運。' }] };
  const zh = demoSummary({ intent: 'trip', from: '三峽', to: '台北101', places: [], states: [] }, results);
  assert.match(zh, /公車 939 在「三峽國小」今天沒有營運（站牌即時資訊），這班不會來。改推「叫車（Uber）」：約 38 分，13:18 到。/);
  assert.doesNotMatch(zh, /選「公車|提醒/);
  const en = demoSummary({ intent: 'trip', from: '三峽', to: '台北101', places: [], states: [], lang: 'en' }, results);
  assert.match(en, /Bus 939 at 三峽國小: not running today .*won't come\. Instead: .*about 38 min, arriving 13:18\./);
  assert.doesNotMatch(en, /Best: Bus/);
  assert.match(busOffSay({ ...data, ranking: { ranked: [{ id: 'bus-939' }] } }, eta), /這班不會來。可以叫車或騎 YouBike。$/, '沒有下一個方案');
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
