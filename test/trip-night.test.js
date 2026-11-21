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
import { nightNote, demoSummary, parseIntent } from '../core/agent/demo-intent.js';

const MAIN = { name: '台北車站', lat: 25.0478, lon: 121.517 };
const T101 = { name: '台北101', lat: 25.033964, lon: 121.564468 };
const at = (hhmm) => Date.parse(`2026-11-22T${hhmm}:00+08:00`);
const plan = (svc, hhmm, now = at(hhmm)) => planTrip(svc, { from: MAIN, to: T101, departAt: `2026-11-22T${hhmm}`, now });
const roles = (r) => r.options.map((o) => o.role);

test('metroHours：各系統約 06:00 首班、24:00 前後收班（⚠️ 大約值）；收班前 30 分提醒末班', () => {
  assert.deepEqual(metroHours('TRTC', 10), { closed: true, first: '06:00' });
  assert.deepEqual(metroHours('TRTC', 5 * 60 + 59), { closed: true, first: '06:00' });
  assert.deepEqual(metroHours('TRTC', 6 * 60), {});
  assert.deepEqual(metroHours('TRTC', 23 * 60 + 29), {});
  assert.deepEqual(metroHours('TRTC', 23 * 60 + 40), { late: true, last: '24:00' });
  assert.deepEqual(metroHours('TRTC', 24 * 60 + 10), { closed: true, first: '06:00' }, '跨午夜的分鐘數（25:10）也算');
  assert.deepEqual(metroHours('TYMC', 23 * 60 + 59), { closed: true, first: '06:00' }, '機場捷運約 23:59 收班');
  assert.deepEqual(metroHours('TYMC', 23 * 60 + 30), { late: true, last: '23:59' });
  assert.deepEqual(metroHours('NOPE', 10), { closed: true, first: '06:00' }, '不認得的系統照台北捷運');
  assert.deepEqual(Object.keys(METRO_HOURS), ['TRTC', 'TYMC', 'TMRT', 'KRTC']);
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
  assert.match(r.night.text, /^現在 00:10，捷運已收班（捷運約 06:00 首班），先比走路、YouBike、公車、叫車$/);
});

test('有好幾種方式時 missing 仍帶原因（白天沒有捷運站：卡片、討論串、回答都說）', async () => {
  const r = await planTrip(createServices({ forceMock: true }), { from: { name: '墾丁', lat: 21.95, lon: 120.79 }, to: { name: '恆春', lat: 22.0, lon: 120.75 }, now: at('10:00') });
  assert.ok(r.options.length > 1 && !r.single);
  assert.deepEqual(r.missing, [{ role: 'metro', kind: 'none', why: '起點或目的地附近沒有捷運站', whyEn: 'No MRT station near the start or destination' }]);
  assert.equal(r.night, undefined);
  const lines = [impactOf('plan_trip', r)].flat();
  assert.ok(lines.some((l) => l.text === '沒列入：捷運（起點或目的地附近沒有捷運站）'), '討論串「→ 影響」說沒列入的原因');
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
