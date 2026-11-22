// 真實資料健檢（2026-11-22）：TDX 額度用完改用示範資料時，示範的班次不參加排名、不推薦（ADR-0010 2026-11-22）；
// 估算值保守看（UNCERTAIN、客運與鐵路票價估算）；機場捷運直達車用公告參數；捷運沒列入的原因照實說；尚未發車的說法一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, limitSkip, intercityFareEst, railFareEst, airportExpress, AIRPORT_EXPRESS, EST } from '../core/services/trip.js';
import { limitedOf } from '../core/services/trip-considered.js';
import { decide, UNCERTAIN } from '../core/decide.js';
import { createServices, withTdxFallback } from '../core/index.js';
import { TdxError } from '../core/tdx-client.js';
import { measure } from '../core/metrics.js';
import { runDemo } from '../core/agent/run.js';
import { busStatusText } from '../core/util.js';
import { callTool } from '../core/tools/index.js';
import { SPEAK_EN, impactEn } from '../core/tools/speak-en.js';
import { nextSteps } from '../public/js/agent/next-steps.js';

const at = (hhmm) => Date.parse(`2026-11-22T${hhmm}:00+08:00`);
const MAIN = { name: '台北車站', lat: 25.0478, lon: 121.517 };
const TPE = { name: '臺灣桃園國際機場', lat: 25.0797, lon: 121.2342 };
const KHH = { name: '高雄車站', lat: 22.6394, lon: 120.3025 };
const T101 = { name: '台北101', lat: 25.0339, lon: 121.5645 };
const THSR_TY = { name: '高鐵桃園站', lat: 25.0128, lon: 121.2147 };

const limit = async () => { throw new TdxError(429, 'rate limit'); };
/** 跟 mock 同形狀、每個方法都回 429 的「真實」服務 */
const deny = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'function' ? limit : v && typeof v === 'object' ? deny(v) : v]));
/**
 * 真實模式，指定的服務（例 { intercity: ['trips'] }、{ bus: true }）額度用完、改用示範資料；其餘照示範服務（當作真實資料）
 * @param {Record<string, true|string[]>} which
 */
function liveWith(which, demo = {}) {
  const base = createServices({ forceMock: true, demo });
  const live = {}, mock = {};
  for (const [k, ms] of Object.entries(which)) {
    mock[k] = base[k];
    live[k] = ms === true ? deny(base[k]) : { ...base[k], ...Object.fromEntries(ms.map((m) => [m, limit])) };
  }
  return { ...base, mode: 'live', ...withTdxFallback(live, mock) };
}
const plan = (svc, from, to, hhmm = '14:00') => measure(() => planTrip(svc, { from, to, departAt: `2026-11-22T${hhmm}`, now: at(hhmm) }));

test('客運額度用完：「國道客運示範 A」不參加排名，原因照實說（t02）', async () => {
  const { result: r, metrics } = await plan(liveWith({ intercity: ['trips'] }), MAIN, TPE);
  assert.equal(metrics.fallback, true);
  assert.ok(!r.options.some((o) => o.role === 'intercity' || /示範/.test(o.name)), r.options.map((o) => o.name).join('、'));
  assert.ok(!r.ranking.ranked.some((o) => /示範/.test(o.name)));
  // 客運：多數起訖本來就沒有客運資料，沒有就不列、不說原因（產品負責人 2026-11-22）
  assert.ok(!(r.skipped || []).some((x) => x.role === 'intercity'), '客運不列在「沒列入」');
  assert.ok(!(r.missing || []).some((m) => m.role === 'intercity'));
  assert.equal(r.best, 'metro', '機場捷運照常（站表是真的）');
  assert.equal(r.limited, undefined, '只有客運額度用完：不說 limited');
});

test('公車額度用完（白天）：假的「公車 綠1」不推、不盯到站；照實說（t04）', async () => {
  const { result: r } = await plan(liveWith({ bus: ['directTrips'] }), MAIN, T101);
  assert.ok(!r.options.some((o) => o.role === 'bus'));
  assert.ok(!r.options.some((o) => o.follow), '沒有公車可盯（回答不會問到站提醒）');
  assert.deepEqual(r.skipped.find((s) => s.role === 'bus'), limitSkip('bus'));
  assert.equal(limitSkip('bus').why, 'TDX 額度用完，這次查不到公車到站（稍後再問一次）');
  assert.ok(r.options.some((o) => o.role === 'metro'), '其他大眾運輸照常比');
});

test('高鐵、台鐵時刻表額度用完：示範的「台鐵自強 只要等 1 分」不推（x03、z11）', async () => {
  const { result: r } = await plan(liveWith({ rail: ['thsrTimetable', 'traTimetable'] }), MAIN, KHH);
  assert.ok(!r.options.some((o) => ['thsr', 'tra'].includes(o.role)), r.options.map((o) => o.name).join('、'));
  for (const role of ['thsr', 'tra']) assert.equal(r.skipped.find((s) => s.role === role)?.fallback, 'tdx-limit', role);
  assert.match(r.skipped.find((s) => s.role === 'tra').why, /^TDX 額度用完，這次查不到台鐵班次/);
  assert.match(r.skipped.find((s) => s.role === 'thsr').why, /^TDX 額度用完，這次查不到高鐵班次/);
});

test('大眾運輸全部額度用完：照實說、給可行的（叫車照估算）、建議稍後再問；不推假班次', async () => {
  const svc = liveWith({ bus: true, rail: true, intercity: true, metro: true, bike: true });
  const { result: r } = await plan(svc, MAIN, KHH);
  assert.deepEqual(r.options.map((o) => o.role), ['ridehail']);
  assert.deepEqual(r.limited.roles, ['thsr', 'tra']);
  assert.equal(r.limited.noTransit, true);
  assert.match(r.limited.text, /^TDX 額度用完，這次查不到高鐵、台鐵的即時資料，大眾運輸都沒列入（不推示範的班次）；先比叫車（叫車的時間與車資是估算），約 1 分鐘後再問一次就查得到$/);
  assert.match(r.limited.textEn, /public transport is left out/);
  assert.match(r.single.text, /^只找到叫車一種方式：.*；高鐵、台鐵：TDX 額度用完，這次查不到（約 1 分鐘後再問一次）$/, r.single.text);
  assert.match(r.single.textEn, /^Only a taxi works for this trip: [\d.]+ km is too far for walking, YouBike, bus and MRT; TDX quota used up, no live High Speed Rail and train data this time/, '英文不把高鐵台鐵說成太遠（PR #126 審查）');
  assert.ok(r.single.suggest.some((s) => s.label === '過一分鐘再問一次' && s.ask === '從台北車站到高雄車站怎麼去'));
  // 市區短程：公車、捷運、YouBike 都額度用完 → 走路、叫車
  const city = (await plan(svc, MAIN, T101)).result;
  assert.deepEqual(city.options.map((o) => o.role).sort(), ['ridehail', 'walk']);
  assert.deepEqual(city.limited.roles, ['bike', 'bus', 'metro']);
  assert.match(city.limited.text, /大眾運輸都沒列入.*先比走路、叫車/);
  assert.ok(!city.options.some((o) => o.follow));
});

test('示範對話（真實模式＋全部額度用完）：回答不提示範班次、不問到站提醒', async () => {
  const svc = liveWith({ bus: true, rail: true, intercity: true, metro: true, bike: true });
  const es = [];
  await runDemo(svc, { messages: [{ role: 'user', content: '從台北車站到台北101怎麼去' }] }, (e) => es.push(e), { now: at('14:00') });
  const trip = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.ok(trip, es.map((e) => e.type).join(','));
  assert.ok(!trip.data.options.some((o) => /示範/.test(o.name)));
  const said = es.filter((e) => ['text', 'answer_draft', 'ask'].includes(e.type)).map((e) => JSON.stringify(e)).join('\n');
  assert.doesNotMatch(said, /示範 ?[AB]|綠1|到站提醒|提醒你上車/, said);
});

test('只有票價額度用完：鐵路照列，票價不當 0 元，依距離保守估（est.cost）', async () => {
  const { result: r } = await plan(liveWith({ rail: ['thsrFare', 'traFare'] }), MAIN, KHH);
  const tra = r.options.find((o) => o.role === 'tra');
  assert.ok(tra, '時刻表是真的：照列');
  assert.ok(tra.cost >= 700, `台北→高雄台鐵票價保守估（${tra.cost} 元）`);
  assert.equal(tra.est.cost, true);
  assert.match(tra.notes[0], /^票價暫時查不到，約 \d+ 元（依距離估，以台鐵公告為準）$/);
  assert.equal(railFareEst('THSR', 290000), 1450);
  assert.equal(railFareEst('TRA', 300000), 840);
  assert.equal(railFareEst('TRA', 1000), 15, '起碼一段票');
});

test('YouBike、捷運站表額度用完：不列入，不說成「附近沒有捷運站」', async () => {
  const { result: r } = await plan(liveWith({ bike: ['nearby'], metro: ['stations'] }), MAIN, T101);
  assert.equal(r.skipped.find((s) => s.role === 'bike')?.fallback, 'tdx-limit');
  assert.equal(r.skipped.find((s) => s.role === 'metro')?.why, 'TDX 額度用完，這次查不到捷運車站（稍後再問一次）');
  assert.ok(!r.options.some((o) => ['bike', 'metro'].includes(o.role)));
});

test('路況額度用完：示範的塞車不加狀態、不加客運延誤、叫車不加時間', async () => {
  const jam = liveWith({ traffic: ['status'] }, { traffic: 'jam' });
  const { result: r } = await plan(jam, MAIN, { name: '新竹車站', lat: 24.8016, lon: 120.9716 });
  assert.ok(!r.states.some((s) => s.key === 'traffic'), JSON.stringify(r.states));
  assert.equal(r.traffic, null);
  const ic = r.options.find((o) => o.role === 'intercity');
  assert.ok(ic && !/路上多/.test(ic.legs[1].detail), ic?.legs[1].detail);
  // 真的塞車（沒有額度問題）：照舊
  const b = createServices({ forceMock: true, demo: { traffic: 'jam' } });
  const realRoad = { status: async (a) => { const { demo: _d, ...t } = await b.traffic.status(a); return t; } }; // 真實資料沒有 demo 標記
  const real = (await plan({ ...b, mode: 'live', traffic: realRoad }, MAIN, { name: '新竹車站', lat: 24.8016, lon: 120.9716 })).result;
  assert.ok(real.states.some((s) => s.key === 'traffic'));
});

test('沒有額度問題的真實模式、示範模式：不受影響（沒有 limited）', async () => {
  const { result: r } = await plan({ ...createServices({ forceMock: true }), mode: 'live' }, MAIN, TPE);
  assert.equal(r.limited, undefined);
  assert.ok(r.options.some((o) => o.role === 'intercity'), '沒用完額度：客運照列');
  const demo = (await plan(createServices({ forceMock: true }), MAIN, TPE)).result;
  assert.ok(demo.options.some((o) => /示範/.test(o.name)), '示範模式本來就是示範資料（照列、畫面有標示）');
  assert.equal(limitedOf({ roles: [], options: [] }), null);
});

test('機場捷運直達車：台北車站 ↔ 機場航廈用公告參數（約 35～38 分、160 元），不再輸給票價估太低的客運（z01）', () => {
  assert.deepEqual(airportExpress('TYMC', '臺北車站', '機場第一航廈'), { ride: 35, fare: 160, wait: AIRPORT_EXPRESS.waitMin });
  assert.deepEqual(airportExpress('TYMC', '機場第二航廈', '台北車站'), { ride: 38, fare: 160, wait: AIRPORT_EXPRESS.waitMin }, '回程也是');
  assert.equal(airportExpress('TYMC', '臺北車站', '高鐵桃園站'), null, '不是直達車的停靠站：照距離估');
  assert.equal(airportExpress('TRTC', '台北車站', '機場第一航廈'), null);
  // z01：客運 1819 票價缺資料，原本道路公里 × 1.3 估成 50 元（實際約 140）
  const straight = 30500;
  assert.ok(intercityFareEst(straight) >= 110 && intercityFareEst(straight) <= 140, `${intercityFareEst(straight)} 元`);
  assert.ok(intercityFareEst(130000) >= 250 && intercityFareEst(130000) <= 300, '台北→台中約 260～300');
  assert.equal(EST.intercityBaseTwd, 70);
  const opts = [
    { id: 'metro', role: 'metro', name: '捷運 機場線', minutes: 53, waitMin: 8, walkMin: 7, cost: 160, exposure: 0.1, effort: 0.2, delayRisk: 0 },
    { id: 'intercity', role: 'intercity', name: '國道客運 1819', minutes: 64, waitMin: 10, walkMin: 7, cost: intercityFareEst(straight), exposure: 0.2, effort: 0.3, delayRisk: 0.2, estimated: true, est: { cost: true } },
    { id: 'ridehail', role: 'ridehail', name: '叫車', minutes: 47, waitMin: 6, walkMin: 0, cost: 1140, exposure: 0, effort: 0, delayRisk: 0.2, estimated: true },
  ];
  assert.equal(decide(opts).best.id, 'metro');
});

test('估算值保守看（UNCERTAIN）：只扣估的那一部分、只扣自己；扣分記在 breakdown.uncertain', () => {
  const a = { id: 'a', role: 'intercity', name: '客運', minutes: 60, waitMin: 5, walkMin: 5, cost: 100, exposure: 0.2, effort: 0.3, delayRisk: 0.2 };
  const b = { id: 'b', role: 'tra', name: '台鐵', minutes: 62, waitMin: 5, walkMin: 5, cost: 110, exposure: 0.1, effort: 0.3, delayRisk: 0 };
  const plain = decide([a, b]);
  const est = decide([{ ...a, est: { cost: true } }, b]);
  const pa = plain.ranked.find((o) => o.id === 'a'), ea = est.ranked.find((o) => o.id === 'a');
  assert.ok(ea.breakdown.uncertain < 0 && ea.score < pa.score, '估的票價少算分');
  assert.equal(ea.breakdown.cost, pa.breakdown.cost, '原本的費用項不變（扣分另外記）');
  assert.equal(est.ranked.find((o) => o.id === 'b').score, plain.ranked.find((o) => o.id === 'b').score, '別人的分數不變');
  assert.equal(plain.ranked.find((o) => o.id === 'a').breakdown.uncertain, undefined);
  // 數字＝只有那幾分是估的：扣得比整個時間都估的少
  const part = decide([{ ...a, est: { minutes: 10 } }, b]).ranked.find((o) => o.id === 'a');
  const all = decide([{ ...a, est: { minutes: true } }, b]).ranked.find((o) => o.id === 'a');
  assert.ok(part.breakdown.uncertain > all.breakdown.uncertain && part.breakdown.uncertain < 0);
  assert.deepEqual(UNCERTAIN, { minutes: 0.15, cost: 0.3 });
});

test('尚未發車但站牌有預估：說法跟公車卡片一致「尚未發車，預估約 N 分後到站」，等車時間保守看（x07）', async () => {
  const base = createServices({ forceMock: true });
  const svc = { ...base, mode: 'live', bus: { ...base.bus, directTrips: async (a) => (await base.bus.directTrips(a)).map((t) => ({ ...t, board: { ...t.board, status: 1, etaSec: 1286 } })) } };
  const { result: r } = await plan(svc, MAIN, T101);
  const bus = r.options.find((o) => o.role === 'bus');
  assert.match(bus.notes[0], /：尚未發車，預估約 22 分後到站（發車後以即時資料為準）$/);
  assert.equal(bus.estimated, true);
  assert.equal(bus.est.minutes, bus.waitMin);
  assert.equal(bus.etaUnknown, undefined, '有預估：不算時間不明');
  // 公車卡片（bus_route_eta、bus_station_eta 的 statusText）同一個說法
  assert.equal(busStatusText(1, 1286), '尚未發車（預估約 22 分後到）');
  assert.equal(busStatusText(1, undefined), '尚未發車');
});

test('捷運沒列入的原因照實說：哪一端沒有站、最近的站多遠；跨系統說還沒列入比較', async () => {
  const svc = createServices({ forceMock: true });
  const sanxia = (await plan(svc, { name: '三峽老街', lat: 24.9349, lon: 121.3695 }, T101)).result;
  const m = sanxia.missing.find((x) => x.role === 'metro');
  assert.match(m.why, /^起點 1\.2 公里內沒有捷運站（最近的是.+站，約 \d+\.\d 公里）$/, m.why);
  assert.match(m.whyEn, /^No MRT station within 1\.2 km of the start \(nearest: .+, about \d+\.\d km\)$/);
  const ty = (await plan(svc, THSR_TY, T101)).result;
  const t = ty.missing.find((x) => x.role === 'metro');
  assert.equal(t.why, '起點附近是桃園機場捷運、目的地附近是台北捷運，跨系統轉乘還沒列入比較');
  assert.match(t.whyEn, /Taoyuan Airport MRT.*Taipei Metro/);
});

// ── PR #126 審查：limited 要被用到（工具文字、中英 speak、示範中英回答、建議）；工具結果不再整段標示範 ──
const ALL = { bus: true, rail: true, intercity: true, metro: true, bike: true };
const answerOf = (es) => es.filter((e) => ['text', 'answer_draft'].includes(e.type)).map((e) => e.text ?? e.delta ?? JSON.stringify(e)).join('');

test('callTool：plan_trip 額度用完時 mode 照真實、speak 說 limited、不說「這次先用示範資料」；模型看得到 limited', async () => {
  const svc = { ...liveWith({ bike: ['nearby'] }), now: at('14:00') };
  const r = await callTool(svc, 'plan_trip', { from: '台北車站', to: '台北101', departAt: '14:00' });
  assert.equal(r.mode, 'live', '示範方案已排除：卡片不掛示範徽章');
  assert.equal(r.fallback, 'tdx-limit', '額度用完這件事照記');
  assert.match(r.speak, /^TDX 額度用完，YouBike ?這次查不到、沒列入。比了 \d 種方式，建議/);
  assert.doesNotMatch(r.speak, /示範資料/);
  assert.match(r.text, /TDX 額度用完（回答要照實說，不可提示範班次）：TDX 額度用完，這次查不到 ?YouBike/);
  assert.match(SPEAK_EN.plan_trip(r.data), /^TDX quota used up: .*YouBike.*Compared \d options; best is/);
  // 其他工具照舊：真的用了示範資料就標示範
  const b = await callTool(liveWith({ bus: ['routeEta'] }), 'bus_route_eta', { city: 'Taipei', routeName: '307' });
  assert.equal(b.mode, 'demo');
  assert.match(b.speak, /這次先用示範資料/);
});

test('示範回答（中文、多種方式）：先說 limited；建議「過一分鐘再問一次」', async () => {
  const es = [];
  await runDemo(liveWith({ bike: ['nearby'] }), { messages: [{ role: 'user', content: '從台北車站到台北101怎麼去' }] }, (e) => es.push(e), { now: at('14:00') });
  const said = answerOf(es);
  assert.match(said, /TDX 額度用完，這次查不到 ?YouBike.*沒列入比較（約 1 分鐘後再問一次）。/, said);
  assert.doesNotMatch(said, /示範 ?[AB]/);
  const trip = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  const steps = nextSteps([{ tool: 'plan_trip', data: trip.data }], null);
  assert.equal(steps[0].label, '過一分鐘再問一次');
  assert.equal(steps[0].pin, true);
});

test('示範回答（英文、全部額度用完）：先說 limited.textEn，單數 option（PR #126 審查必修 1）', async () => {
  const es = [];
  await runDemo(liveWith(ALL), { messages: [{ role: 'user', content: 'From Taipei Main Station to Kaohsiung Station' }] }, (e) => es.push(e), { now: at('14:00') });
  const said = answerOf(es);
  assert.match(said, /TDX quota used up: no live High Speed Rail and train data this time, so public transport is left out/, said);
  assert.match(said, /I compared 1 option\. Best: /);
  assert.doesNotMatch(said, /too far for the others|1 options/);
});

test('英文影響：YouBike 因額度用完沒列入，不說成「一端沒車位」（PR #126 審查必修 2）', async () => {
  const { result: r } = await plan(liveWith({ bike: ['nearby'] }), MAIN, T101);
  assert.equal(impactEn('plan_trip', r).text, "YouBike: TDX quota used up; couldn't get YouBike availability this time (try again shortly)");
  assert.match(r.limited.text, /查不到 YouBike/, '中英文之間空一格');
  assert.equal(limitSkip('bike').why, 'TDX 額度用完，這次查不到 YouBike 車輛與空位（稍後再問一次）');
});
