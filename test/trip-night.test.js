// 深夜與沒列入的原因（產品負責人實機：00:10 問「去台北101」沒有公車和捷運，以為是 bug）：
// 捷運營運時間、任何時候都說主要方式為什麼沒列入（missing）、深夜第一句就說（night）、TDX 額度用完時照實說公車收班是依時間估的
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, metroHours, METRO_HOURS } from '../core/services/trip.js';
import { nightOf } from '../core/services/trip-considered.js';
import { createServices, withTdxFallback } from '../core/index.js';
import { TdxError } from '../core/tdx-client.js';
import { measure } from '../core/metrics.js';
import { runDemo } from '../core/agent/run.js';
import { callTool } from '../core/tools/index.js';
import { speakEn } from '../core/tools/speak-en.js';
import { impactOf } from '../core/agent/impact.js';
import { mustSay } from '../core/agent/model-loop.js';
import { nightNote, demoSummary, parseIntent, tripDepartAt } from '../core/agent/demo-intent.js';

const MAIN = { name: '台北車站', lat: 25.0478, lon: 121.517 };
const T101 = { name: '台北101', lat: 25.033964, lon: 121.564468 };
const at = (hhmm) => Date.parse(`2026-11-22T${hhmm}:00+08:00`);
const plan = (svc, hhmm, now = at(hhmm)) => planTrip(svc, { from: MAIN, to: T101, departAt: `2026-11-22T${hhmm}`, now });
const roles = (r) => r.options.map((o) => o.role);

test('metroHours：各系統約 06:00 首班、24:00 前後收班（⚠️ 大約值）；收班前 30 分提醒末班', () => {
  assert.deepEqual(metroHours('TRTC', 10), { closed: true, first: '06:00' });
  assert.deepEqual(metroHours('TRTC', 5 * 60 + 59), { closed: true, first: '06:00', notYet: true }, '首班前 1 小時內：還沒發車');
  assert.deepEqual(metroHours('TRTC', 6 * 60), {});
  assert.deepEqual(metroHours('TRTC', 23 * 60 + 29), {});
  assert.deepEqual(metroHours('TRTC', 23 * 60 + 40), { late: true, last: '24:00' });
  assert.deepEqual(metroHours('TRTC', 24 * 60 + 10), { closed: true, first: '06:00' }, '跨午夜的分鐘數（25:10）也算');
  assert.deepEqual(metroHours('TYMC', 23 * 60 + 59), { closed: true, first: '06:00' }, '機場捷運約 23:59 收班');
  assert.deepEqual(metroHours('TYMC', 23 * 60 + 30), { late: true, last: '23:59' });
  assert.deepEqual(metroHours('NOPE', 10), { closed: true, first: '06:00' }, '不認得的系統照台北捷運');
  assert.deepEqual(Object.keys(METRO_HOURS), ['TRTC', 'TYMC', 'TMRT', 'KRTC', 'NTMC', 'NTDLRT', 'NTALRT', 'KLRT'], '全台捷運與輕軌（2026-11-22）');
});

test('00:10 台北車站→台北101：公車、捷運都不列入且有原因；第一句「現在 00:10，公車和捷運都收班了…」', async () => {
  const r = await plan(createServices({ forceMock: true }), '00:10');
  assert.deepEqual(roles(r), ['walk', 'bike', 'ridehail']);
  const metro = r.missing.find((m) => m.role === 'metro');
  assert.deepEqual([metro.kind, metro.closed, metro.why, metro.whyEn], ['skipped', true, '捷運已收班（約 06:00 首班）', 'The MRT has stopped for the night (first train around 06:00)']);
  assert.match(r.missing.find((m) => m.role === 'bus').why, /深夜多數公車已收班/);
  assert.ok(r.skipped.some((s) => s.role === 'metro'), '決策圖舊欄位 skipped 也有捷運');
  assert.equal(r.night.text, '現在 00:10，公車和捷運都收班了（捷運約 06:00 首班），先比走路、YouBike、叫車');
  assert.equal(r.night.textEn, "It's 00:10 now: buses and the MRT have stopped for the night (MRT starts around 06:00); comparing walking, YouBike and taxi.");
  assert.deepEqual([r.night.closed, r.night.late], [['bus', 'metro'], []]);
  assert.ok(!r.missing.some((m) => ['near', 'far'].includes(m.kind)), '太近（高鐵、台鐵、客運）不列');
  // 不是現在出發：說「00:10 出發」
  assert.match((await plan(createServices({ forceMock: true }), '00:10', at('20:00'))).night.text, /^00:10 出發，公車和捷運都收班了/);
});

test('23:40：捷運列入但提醒末班；06:10：正常、沒有深夜說明', async () => {
  const svc = createServices({ forceMock: true });
  const late = await plan(svc, '23:40');
  const metro = late.options.find((o) => o.role === 'metro');
  assert.ok(metro?.lastTrain);
  assert.ok(metro.notes.some((n) => /^末班快到了（約 24:00 前後，各站不同）/.test(n)));
  assert.equal(late.night.text, '現在 23:40，公車和捷運末班快到了，早點出門；錯過可以叫車');
  assert.match(late.night.textEn, /last bus and MRT soon/);
  const day = await plan(svc, '06:10');
  assert.ok(day.options.some((o) => o.role === 'metro' && !o.lastTrain));
  assert.ok(day.options.some((o) => o.role === 'bus'));
  assert.equal(day.night, undefined);
  assert.equal(day.missing, undefined, '公車、捷運都在：沒有沒列入的');
});

test('真實資料也套用捷運營運時間（捷運沒有收班即時狀態）；公車照站牌狀態', async () => {
  const r = await plan({ ...createServices({ forceMock: true }), mode: 'live' }, '00:10');
  assert.ok(!roles(r).includes('metro'));
  assert.ok(roles(r).includes('bus'), '真實資料公車看站牌狀態，不只看時間');
  assert.deepEqual(r.night.closed, ['metro']);
  assert.match(r.night.text, /^現在 00:10，捷運已收班（約 06:00 首班），先比走路、YouBike、公車、叫車$/);
});

test('有好幾種方式時 missing 仍帶原因（白天沒有捷運站：卡片、討論串、回答都說）', async () => {
  const r = await planTrip(createServices({ forceMock: true }), { from: MAIN, to: { name: '萬華一帶', lat: 25.0278, lon: 121.497 }, now: at('10:00') });
  assert.ok(r.options.length > 1 && !r.single);
  // 只有 2.8 公里、目的地離捷運站 1.9 公里：接駁比坐捷運還遠，不列入，照實說原因
  assert.deepEqual(r.missing.find((m) => m.role === 'metro'), { role: 'metro', kind: 'none', why: '到捷運站太遠（兩端加起來約 17 分）', whyEn: 'Too far to reach the MRT stations (about 17 min in total)' });
  assert.equal(r.night, undefined);
  const tool = await callTool(createServices({ forceMock: true }), 'plan_trip', { from: '台北車站', to: '台北101', departAt: '00:10' });
  assert.match(tool.text, /深夜（回答第一句先說）：.*公車和捷運都收班了/, '模型看得到深夜的一句');
  assert.match(tool.text, /沒列入：公車（深夜多數公車已收班.*）、捷運（捷運已收班（約 06:00 首班））/);
});

test('TDX 額度用完、公車改用示範資料：深夜照時間估，說明句照實說', async () => {
  const base = createServices({ forceMock: true });
  const live = { bus: { directTrips: async () => { throw new TdxError(429, 'rate limit'); } } };
  const svc = { ...base, mode: 'live', ...withTdxFallback(live, { bus: base.bus }) };
  const { result: r, metrics } = await measure(() => plan(svc, '00:10'));
  assert.equal(metrics.fallback, true);
  assert.equal(metrics.fallbackOn, undefined, '方法清單不進計量');
  const bus = r.skipped.find((s) => s.role === 'bus');
  assert.deepEqual([bus.fallback, bus.estimated], ['tdx-limit', true]);
  assert.match(bus.why, /TDX 額度用完，這次依時間估/);
  assert.equal(r.night.fallback, 'tdx-limit');
  assert.match(r.night.text, /^現在 00:10，公車和捷運都收班了（捷運約 06:00 首班；TDX 額度用完，公車收班是依時間估的，以站牌即時資訊為準）/);
  assert.match(r.night.textEn, /bus hours estimated from the time: TDX quota used up/);
  // 沒有用完額度的真實資料：不套時間規則（站牌狀態說了算）
  const ok = await measure(() => plan({ ...base, mode: 'live' }, '00:10'));
  assert.ok(roles(ok.result).includes('bus'));
});

test('nightOf：只有公車收班、末班與收班混合、沒有其他方式', () => {
  assert.equal(nightOf({ skipped: [], options: [{ role: 'walk' }], departMin: 600 }), null);
  const bus = nightOf({ skipped: [{ role: 'bus', closed: true }], options: [{ role: 'ridehail' }], departMin: 30, isNow: true });
  assert.equal(bus.text, '現在 00:30，公車已收班，先比叫車');
  assert.equal(bus.textEn, "It's 00:30 now: buses have stopped for the night; comparing taxi.");
  const mix = nightOf({ skipped: [{ role: 'bus', closed: true }], options: [{ role: 'metro', lastTrain: true }, { role: 'ridehail' }], departMin: 23 * 60 + 45, isNow: true });
  assert.equal(mix.text, '現在 23:45，公車已收班，捷運末班快到了，早點出門；錯過可以叫車，先比捷運、叫車');
  assert.match(nightOf({ skipped: [{ role: 'bus', closed: true }, { role: 'metro', closed: true, first: '06:00' }], options: [], departMin: 60 }).text, /目前查不到其他方式$/);
  assert.equal(nightOf({ skipped: [{ role: 'bike', closed: true }], options: [], departMin: 60 }), null, '只看公車與捷運');
});

test('示範回答與英文：深夜第一句就說；模型模式漏講時程式補在最前面', async () => {
  const svc = createServices({ forceMock: true });
  const run = async (q, hhmm) => { const es = []; await runDemo(svc, { messages: [{ role: 'user', content: q }] }, (e) => es.push(e), { now: at(hhmm) }); return es; };
  const zh = await run('從台北車站去台北101', '00:10');
  assert.match(zh.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /^現在 00:10，公車和捷運都收班了（捷運約 06:00 首班），先比走路、YouBike、叫車。/);
  const tr = zh.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip');
  assert.match(tr.speak, /^現在 00:10，公車和捷運都收班了.*；建議叫車/);
  const d = zh.find((e) => e.type === 'decision');
  assert.deepEqual(d.missing.map((m) => m.role), ['bus', 'metro'], '決策圖拿得到沒列入的方式與原因');
  assert.ok(d.night?.text);
  const en = await run('How do I get from Taipei Main Station to Taipei 101?', '00:10');
  assert.match(en.filter((e) => e.type === 'text').map((e) => e.delta).join(''), /^It's 00:10 now: buses and the MRT have stopped for the night \(MRT starts around 06:00\)/);
  assert.match(en.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip').speak, /^It's 00:10 now/);
  assert.match(speakEn('plan_trip', tr.result?.data ?? (await plan(svc, '00:10'))), /^It's 00:10 now/);
  // 白天沒有捷運站：回答說捷運沒列入的原因
  const dayTrip = { data: { options: [{ id: 'walk', role: 'walk', name: '步行' }], best: 'walk', ranking: { reason: '選「步行」。' }, missing: [{ role: 'metro', kind: 'none', why: '起點或目的地附近沒有捷運站' }, { role: 'intercity', kind: 'none', why: 'x' }], tips: [] } };
  const said = demoSummary(parseIntent('從西門町去台北101'), { plan_trip: [dayTrip] });
  assert.match(said, /選「步行」。 捷運沒列入：起點或目的地附近沒有捷運站。/);
  assert.doesNotMatch(said, /客運沒列入/, '回答只說公車、捷運（其他在卡片與決策圖）');
  // 模型模式（mustSay）：沒講收班 → 補在最前面
  const trip = await plan(svc, '00:10');
  assert.equal(nightNote(trip), `${trip.night.text}。`);
  assert.match(mustSay('建議叫車，約 24 分。', trip), /^現在 00:10，公車和捷運都收班了.*。建議叫車，約 24 分。/);
});

// ───────── PR #110 獨立審查修正 ─────────
const text = (es) => es.filter((e) => e.type === 'text').map((e) => e.delta).join('');
const demo = async (q, hhmm) => { const es = []; await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: q }] }, (e) => es.push(e), { now: at(hhmm) }); return es; };

test('審查 1：「明天早上9點前…」合成的出發時間不早於捷運首班，回答不講合成的「05:00 出發」、照樣推捷運', async () => {
  const it = parseIntent('明天早上9點前從台北車站到台北101');
  assert.equal(tripDepartAt(it, at('20:00')), '2026-11-23T06:00');
  assert.equal(tripDepartAt(parseIntent('明天早上6點半前從台北車站到台北101'), at('20:00')), '2026-11-23T05:00', '抵達時間本身在 07:00 前：至少提早 1 小時');
  assert.equal(tripDepartAt(parseIntent('明天下午3點前從台北車站到台北101'), at('20:00')), '2026-11-23T11:00', '抵達前 4 小時照舊');
  const es = await demo('明天早上9點前從台北車站到台北101', '20:00');
  const said = text(es);
  assert.doesNotMatch(said, /0[56]:00 出發|收班|還沒發車/, said);
  assert.ok(es.find((e) => e.type === 'decision').options.some((o) => o.role === 'metro'), '捷運在比較裡');
  // 使用者沒說出發時間、深夜一句也不帶合成的時間（bare）
  const trip = { night: { text: '05:00 出發，捷運還沒發車（約 06:00 首班）', body: '捷運還沒發車（約 06:00 首班）' } };
  assert.equal(nightNote(trip, { bare: true }), '捷運還沒發車（約 06:00 首班）。');
  assert.match(mustSay('建議叫車。', trip, { intent: 'trip', tomorrow: true }), /^明天 出發：捷運還沒發車（約 06:00 首班）。建議叫車/);
});

test('審查 2：營運判斷看走到捷運站的時刻（05:55 出發走 7 分＝06:02 到站可搭；23:55 出發走到站已過 24:00）', async () => {
  const svc = createServices({ forceMock: true });
  const from = { name: '承德路一帶', lat: 25.0508, lon: 121.517 };
  const go = (hhmm) => planTrip(svc, { from, to: T101, departAt: `2026-11-22T${hhmm}`, now: at(hhmm) });
  const early = await go('05:55');
  const m = early.options.find((o) => o.role === 'metro');
  assert.ok(m && m.legs[0].minutes >= 5, '走到站時已過 06:00');
  assert.ok(!early.night?.closed.includes('metro'));
  const late = await go('23:55');
  assert.equal(late.missing.find((x) => x.role === 'metro').why, '捷運已收班（約 06:00 首班）');
  assert.match((await go('05:50')).missing.find((x) => x.role === 'metro').why, /還沒發車/, '05:50＋7 分＝05:57 還沒發車');
});

test('審查 3：05:00～05:59 說「還沒發車（約 06:00 首班）」，英文不說 stopped for the night', async () => {
  const r = await plan(createServices({ forceMock: true }), '05:30');
  const metro = r.missing.find((x) => x.role === 'metro');
  assert.deepEqual([metro.notYet, metro.why, metro.whyEn], [true, '捷運還沒發車（約 06:00 首班）', "The MRT hasn't started yet (first train around 06:00)"]);
  assert.match(r.night.text, /^現在 05:30，捷運還沒發車（約 06:00 首班），先比/);
  assert.match(r.night.textEn, /^It's 05:30 now: the MRT hasn't started yet \(first train around 06:00\)/);
  assert.doesNotMatch(r.night.textEn, /stopped/);
  assert.doesNotMatch(r.night.text, /收班/);
  assert.equal(r.night.notYet, true);
  const mix = nightOf({ skipped: [{ role: 'bus', closed: true }, { role: 'metro', closed: true, notYet: true, first: '06:00' }], options: [{ role: 'ridehail' }], departMin: 290, isNow: true });
  assert.equal(mix.text, '現在 04:50，公車已收班，捷運還沒發車（約 06:00 首班），先比叫車', '兩個都不能說「都收班了」');
});

test('審查 4：只有一種方式＋深夜不重複；「明天 00:10 出發：00:10 出發…」去重', async () => {
  const svc = createServices({ forceMock: true });
  const noCoach = { ...svc, intercity: { ...svc.intercity, trips: async () => ({ trains: [] }) } }; // 客運也沒班次：只剩叫車
  const r = await planTrip(noCoach, { from: { name: '淡水', lat: 25.1677, lon: 121.4456 }, to: T101, departAt: '2026-11-22T00:10', now: at('00:10') });
  assert.deepEqual([r.options.map((o) => o.role), Boolean(r.single), r.night?.closed], [['ridehail'], true, ['bus', 'metro']]);
  assert.equal(r.night.text, '現在 00:10，公車和捷運都收班了（捷運約 06:00 首班）');
  assert.doesNotMatch(r.single.text, /收班/, '收班已由 night 說，single 不再列');
  const { planTripTool } = await import('../core/tools/trip.js');
  assert.match(planTripTool.speak(r), /^現在 00:10，公車和捷運都收班了（捷運約 06:00 首班）。只找到叫車（Uber）一種方式。$/);
  const sum = demoSummary(parseIntent('從淡水去台北101'), { plan_trip: [{ data: r }] });
  assert.equal((sum.match(/收班/g) || []).length, 1, sum);
  const n = nightOf({ skipped: [{ role: 'bus', closed: true }, { role: 'metro', closed: true, first: '06:00' }], options: [{ role: 'ridehail' }], departMin: 10, isNow: true, single: true });
  assert.equal(n.text, '現在 00:10，公車和捷運都收班了（捷運約 06:00 首班）', '只有一種方式時不說「先比叫車」');
  // 只有一種方式的 single 說明：收班的方式不重複
  const { singleNote, missingModes } = await import('../core/services/trip-considered.js');
  const { LIMITS } = await import('../core/services/trip.js');
  const ml = missingModes({ straight: 9000, roles: { ridehail: { id: 'ridehail' } }, skipped: [{ role: 'bus', closed: true, why: '深夜多數公車已收班' }, { role: 'metro', closed: true, why: '捷運已收班（約 06:00 首班）' }], limits: LIMITS });
  const s = singleNote({ options: [{ role: 'ridehail', name: '叫車' }], missingList: ml.filter((x) => !x.closed), straight: 9000, departMin: 10, demo: false, toName: 'X' });
  assert.doesNotMatch(s.text, /收班/);
  const es = await demo('明天凌晨12點10分從台北車站去台北101', '20:00');
  const said = text(es);
  assert.match(said, /^明天 00:10 出發：公車和捷運都收班了（捷運約 06:00 首班）/);
  assert.equal((said.match(/00:10 出發/g) || []).length, 1, said);
  const trip = es.find((e) => e.type === 'decision');
  assert.match(mustSay('建議叫車。', { ...trip, ranking: {} }, { intent: 'trip', tomorrow: true, departTime: '00:10' }), /^明天 00:10 出發：公車和捷運都收班了.*。建議叫車/);
});

test('審查 5：directTrips 內部 routeEta 429 記下來，公車原因照實說額度用完（不說查不到直達公車）', async () => {
  const { createTransitServices } = await import('../core/services/transit.js');
  // 真實服務的 directTrips：站牌查得到、routeEta 429 → 該路線略過並記下
  const stops = (lat, lon) => [{ name: 'A', city: 'Taipei', lat, lon, routes: ['307'] }];
  const tdx = { get: async () => { throw new TdxError(429, 'rate limit'); } };
  const live = createTransitServices(tdx);
  live.bus.nearbyStations = async ({ lat, lon }) => stops(lat, lon);
  live.bus.routeEta = async () => { throw new TdxError(429, 'rate limit'); };
  const out = await live.bus.directTrips({ from: MAIN, to: T101 });
  assert.deepEqual(out, []);
  assert.equal(out.limited, true, '429 記在結果上（不可列舉）');
  assert.deepEqual(Object.keys(out), [], '不改資料形狀');
  live.bus.routeEta = async () => { throw new Error('other'); };
  assert.equal((await live.bus.directTrips({ from: MAIN, to: T101 })).limited, undefined, '其他錯誤不算額度用完');
  // plan_trip：沒有可用路線又有 429 → 照實說
  const svc = { ...createServices({ forceMock: true }), mode: 'live' };
  svc.bus = { ...svc.bus, directTrips: async () => Object.defineProperty([], 'limited', { value: true }) };
  const r = await plan(svc, '10:00');
  const bus = r.missing.find((x) => x.role === 'bus');
  assert.deepEqual([bus.why, bus.fallback, bus.kind], ['TDX 額度用完，這次查不到公車到站（稍後再問一次）', 'tdx-limit', 'skipped']);
  assert.match(bus.whyEn, /TDX quota used up/);
});

test('審查 6：站牌狀態 4（今日未營運）不當收班、不觸發深夜第一句；只有 3 算收班', async () => {
  const base = createServices({ forceMock: true });
  const withStatus = (s) => ({ ...base, mode: 'live', bus: { ...base.bus, directTrips: async (a) => (await base.bus.directTrips(a)).map((t) => ({ ...t, board: { ...t.board, status: s } })) } });
  const r4 = await plan(withStatus(4), '14:00');
  const b4 = r4.skipped.find((x) => x.role === 'bus');
  assert.match(b4.why, /^附近直達的公車（.+）今天沒有營運（站牌即時資訊）$/); // 說是哪幾條
  assert.ok(!b4.closed);
  assert.equal(r4.night, undefined, '不說「公車已收班」');
  const r3 = await plan(withStatus(3), '23:10');
  assert.ok(r3.skipped.find((x) => x.role === 'bus').closed);
  assert.deepEqual(r3.night.closed, ['bus']);
});

test('審查 7：沒有捷運的地方（起訖 10 公里內沒有捷運站）不說「捷運沒列入」', async () => {
  const r = await planTrip(createServices({ forceMock: true }), { from: { name: '墾丁', lat: 21.95, lon: 120.79 }, to: { name: '恆春', lat: 22.0, lon: 120.75 }, now: at('10:00') });
  assert.deepEqual((r.missing || []).map((m) => m.role), ['tra'], '只說台鐵附近沒有車站（台鐵不限距離，沒列出會以為沒查）；捷運不提');
  assert.ok(![impactOf('plan_trip', r)].flat().some((l) => /捷運/.test(l.text)));
  const said = demoSummary(parseIntent('從墾丁去恆春'), { plan_trip: [{ data: r }] });
  assert.doesNotMatch(said, /捷運沒列入/);
});

test('審查 9、10：深夜＋TDX 額度用完時 speak 只說一次額度；HH:mm 早於現在＝明天（火車查隔天）', async () => {
  const base = createServices({ forceMock: true });
  const live = { bus: { directTrips: async () => { throw new TdxError(429, 'rate limit'); } } };
  const svc = { ...base, mode: 'live', now: at('00:05'), ...withTdxFallback(live, { bus: base.bus }) };
  const r = await callTool(svc, 'plan_trip', { from: '台北車站', to: '台北101', departAt: '00:10' });
  assert.equal(r.fallback, 'tdx-limit');
  assert.equal((r.speak.match(/TDX/g) || []).length, 1, r.speak);
  const { departOf } = await import('../core/services/intercity.js');
  assert.deepEqual(departOf('00:10', at('23:50')), { date: '2026-11-23', weekday: 1, minute: 10 });
  assert.equal(departOf('23:20', at('23:50')).date, '2026-11-22', '剛過半小時仍算今天');
  const far = await planTrip(base, { from: MAIN, to: { name: '高雄車站', lat: 22.6394, lon: 120.3025 }, departAt: '06:30', now: at('23:50') });
  assert.equal(far.date, '2026-11-23');
  const rail = far.options.find((o) => o.train);
  if (rail) assert.equal(rail.train.date, '2026-11-23', '火車時刻表查隔天');
});
