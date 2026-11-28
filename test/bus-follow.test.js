// 選公車就盯到站＋到站提醒（L-14）：聚焦上車站、決策選公車後自動查、示範總結主動問提醒、網頁 host 的到站提醒
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { focusStop } from '../core/tools/transit.js';
import { busFollowUp, runDemo } from '../core/agent/run.js';
import { matchDirect } from '../core/services/bus-direct.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const DIRS = [
  { direction: 0, label: '往 松山機場', stops: [{ seq: 1, stopName: '臺北車站', etaSec: 400, status: 0, statusText: '6 分' }, { seq: 2, stopName: '西門', etaSec: 520, status: 0, statusText: '8 分' }] },
  { direction: 1, label: '往 萬華', stops: [{ seq: 1, stopName: '西門', etaSec: 90, status: 0, statusText: '即將進站' }, { seq: 2, stopName: '台北車站', etaSec: null, status: 1, statusText: '尚未發車' }] },
];

test('focusStop：依站名（臺／台相同）找站，給方向時先找那個方向；沒有回 null', () => {
  assert.deepEqual(focusStop(DIRS, '西門'), { direction: 0, label: '往 松山機場', seq: 2, stopName: '西門', etaSec: 520, status: 0, statusText: '8 分' });
  assert.equal(focusStop(DIRS, '西門', 1).direction, 1);
  assert.equal(focusStop(DIRS, '台北車站').seq, 1, '臺／台');
  assert.equal(focusStop(DIRS, '火星'), null);
  assert.equal(focusStop(DIRS), null);
});

test('matchDirect：上車站帶站序與方向（盯到站用）', () => {
  const dirs = [{ direction: 1, label: 'x', stops: [{ seq: 3, stopName: 'A', lat: 25.04, lon: 121.5, etaSec: 60 }, { seq: 9, stopName: 'B', lat: 25.03, lon: 121.56 }] }];
  const m = matchDirect(dirs, { lat: 25.04, lon: 121.5 }, { lat: 25.03, lon: 121.56 });
  assert.deepEqual([m.direction, m.board.seq, m.board.name], [1, 3, 'A']);
});

test('bus_route_eta 給 stop：回 focus、speak 講多久到；站名不對時文字說明', async () => {
  const svc = createServices({ forceMock: true });
  const all = await callTool(svc, 'bus_route_eta', { city: 'Taipei', routeName: '307' });
  const stop = all.data.directions[0].stops[3].stopName;
  const r = await callTool(svc, 'bus_route_eta', { city: 'Taipei', routeName: '307', stop, direction: 0 });
  assert.equal(r.data.focus.stopName, stop);
  const q = stop.replace(/[()]/g, '\\$&');
  assert.match(r.speak, new RegExp(`^307 (約 \\d+ 分後到「${q}」|即將到「${q}」|在「${q}」進站中)`));
  assert.match(r.text, /^307 /);
  const miss = await callTool(svc, 'bus_route_eta', { city: 'Taipei', routeName: '307', stop: '火星站' });
  assert.equal(miss.data.focus, undefined);
  assert.match(miss.text, /沒有「火星站」這一站/);
});

test('busFollowUp：決策選公車才盯；其他方式不盯', () => {
  const opt = { id: 'bus-601', role: 'bus', follow: { city: 'Taipei', routeName: '601', stop: '西門', direction: 0, walkMin: 3 } };
  assert.deepEqual(busFollowUp({ best: 'bus-601', options: [opt] }).args, { city: 'Taipei', routeName: '601', stop: '西門', direction: 0 });
  assert.match(busFollowUp({ best: 'bus-601', options: [opt] }).note, /^@公車 [你您]選了公車，我幫[你您]盯 601 在「西門」/);
  assert.equal(busFollowUp({ best: 'ride', options: [opt, { id: 'ride', role: 'ride' }] }), null);
  assert.equal(busFollowUp(null), null);
});

test('問阿幫（示範）：想省錢選公車 → decision 後自動查上車站，卡片聚焦，總結問要不要到站提醒', async () => {
  const es = [];
  const day = Date.parse(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T10:00:00+08:00`); // 白天（深夜公車收班，結果不受跑測試的時間影響）
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '我想省錢，從西門町到台北101怎麼去？' }] }, (e) => es.push(e), { now: day });
  const types = es.map((e) => e.type);
  const d = types.indexOf('decision');
  assert.deepEqual(types.slice(d, d + 4), ['decision', 'agent_note', 'tool_start', 'tool_result']);
  const bus = es[d + 3];
  assert.equal(bus.card, 'bus-route');
  const trip = es.find((e) => e.type === 'tool_result' && e.tool === 'plan_trip').data;
  const best = trip.options.find((o) => o.id === trip.best);
  assert.equal(best.role, 'bus');
  assert.equal(bus.data.focus.stopName, best.follow.stop, '盯的是規劃的上車站');
  // 示範到站時間隨時間變化：趕得上 → 問要不要提醒；走過去比車到還久 → 說這班可能趕不上、提醒下一班
  assert.match(es.find((e) => e.type === 'text').delta, /走過去約 \d+ 分(。要我在公車快到站時提醒[你您]嗎？|，這班可能趕不上。要我在下一班快到時提醒[你您]嗎？)/);
});

test('網頁 host 到站提醒：設定時這班已趕不上就跳過、下一班到點通知一次；快到時以計時器準時提醒', async () => {
  const notes = [], events = [];
  globalThis.window = { dispatchEvent: (e) => events.push([e.type, e.detail]) };
  globalThis.Notification = class { static permission = 'granted'; constructor(title, o) { notes.push([title, o.body]); } };
  let eta = 100;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { focus: { etaSec: eta, status: 0, statusText: '1 分' } } }));
  const { createWebHost } = await import('../public/ui/cards/host-web.js');
  const host = createWebHost();
  const flush = () => new Promise((r) => setImmediate(r));
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  try {
    // 設定時這班 100 秒就到（≤ 3 分）→ 趕不上，跳過這班
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', direction: 0, minutes: 3 });
    assert.equal(notes.length, 0);
    assert.equal(host.arrivalWatch().skip, 100);
    eta = 30; mock.timers.tick(20_000); await flush();
    assert.equal(notes.length, 0, '同一班越來越近也不提醒');
    eta = 600; mock.timers.tick(20_000); await flush(); // 這班開走，下一班 10 分
    assert.equal(host.arrivalWatch().skip, null);
    eta = 170; mock.timers.tick(20_000); await flush(); // 下一班進入 3 分內
    assert.deepEqual(notes, [['阿幫：公車快到站', '601 約 3 分後到「西門」，該出門了！']]);
    assert.equal(host.arrivalWatch(), null, '只提醒一次');
    assert.ok(events.some(([t, d]) => t === 'abang:arrival' && /該出門了/.test(d.text)));

    eta = 190; // 剩 10 秒才到 3 分：兩次更新之間用計時器準時提醒
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 });
    assert.equal(notes.length, 1);
    assert.equal(host.arrivalWatch().minutes, 3);
    mock.timers.tick(10_000);
    assert.equal(notes.length, 2);
    assert.match(notes[1][1], /約 3 分後到「西門」/);
    host.unwatchArrival();
  } finally {
    mock.timers.reset();
    delete globalThis.window; delete globalThis.Notification;
  }
});

// ── 手機 App 本機通知（M11-02；PR #28 審查後）：假的 Capacitor 橋接 ──
function fakeNative({ grant = 'granted', failSchedule = false } = {}) {
  const calls = [];
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: async (plugin, method, o) => {
    calls.push([method, o]);
    if (method.endsWith('Permissions')) return { display: grant };
    if (method === 'schedule' && failSchedule) throw new Error('denied');
    return {};
  } };
  return calls;
}
const scheduled = (calls) => calls.filter(([m]) => m === 'schedule').map(([, o]) => o.notifications[0]);
const etaServer = (get) => { globalThis.fetch = async () => new Response(JSON.stringify({ data: { focus: { etaSec: get(), status: 0, statusText: '10 分' } } })); };
async function withNativeHost(opts, fn) {
  const events = [];
  globalThis.window = { dispatchEvent: (e) => events.push([e.type, e.detail]) };
  const calls = fakeNative(opts);
  const { createWebHost } = await import('../public/ui/cards/host-web.js');
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  const host = createWebHost();
  try { await fn({ host, calls, events, flush: () => new Promise((r) => setImmediate(r)) }); } finally {
    host.unwatchArrival();
    mock.timers.reset();
    delete globalThis.window; delete globalThis.Capacitor; delete globalThis.document;
  }
}

test('手機 App 到站提醒：排到預估時間（提早 30 秒、一般排程、高重要性頻道）、差不到 20 秒不重排、車變快重排；前景到點只出 toast', async () => {
  let eta = 600;
  etaServer(() => eta);
  await withNativeHost({}, async ({ host, calls, events, flush }) => {
    assert.equal(host.background, true);
    assert.equal(host.arrivalNote(), 'whenAlways');
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 });
    await flush();
    const [n0] = scheduled(calls);
    assert.equal(n0.id, 1001);
    assert.equal(n0.schedule.at.getTime(), 1_000_000 + 420_000 - 30_000, '10 分後到、提前 3 分、再提早 30 秒');
    assert.equal(n0.title, '阿幫：該出門了');
    assert.match(n0.body, /^601 約 3 分後到「西門」（\d\d:\d\d 的預估）$/);
    assert.deepEqual([n0.channelId, n0.isExactNotification], ['arrival', false], 'Android 不用精準鬧鐘、走高重要性頻道');
    assert.ok(calls.some(([m, o]) => m === 'createChannel' && o.importance === 4));

    eta = 590; mock.timers.tick(20_000); await flush();
    assert.equal(scheduled(calls).length, 1, '預估沒變（差不到 20 秒）不重排');
    eta = 300; mock.timers.tick(20_000); await flush();
    assert.equal(scheduled(calls).length, 2, '車變快：重排');
    eta = 150; mock.timers.tick(20_000); await flush(); // App 在前景時進入 3 分內
    assert.equal(scheduled(calls).length, 2, '前景：不再送系統通知（toast 就夠，不重複）');
    assert.deepEqual(calls.at(-1), ['cancel', { notifications: [{ id: 1001 }] }], '排好的通知也取消');
    assert.ok(events.some(([t, d]) => t === 'abang:arrival' && /該出門了/.test(d.text)));
  });
});

test('手機 App 到站提醒：背景時到點（車比預估早到）馬上送；取消提醒＝取消排好的通知；逾時也取消', async () => {
  let eta = 600;
  etaServer(() => eta);
  await withNativeHost({}, async ({ host, calls, flush }) => {
    globalThis.document = { visibilityState: 'hidden' };
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 });
    await flush();
    eta = 100; mock.timers.tick(20_000); await flush();
    assert.equal(scheduled(calls).length, 2);
    assert.ok(scheduled(calls)[1].schedule.at.getTime() <= Date.now() + 1000, '背景：比預估早到就馬上送');

    eta = 600;
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 5 });
    await flush();
    host.unwatchArrival(); await flush();
    assert.deepEqual(calls.at(-1), ['cancel', { notifications: [{ id: 1001 }] }]);

    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 5 });
    await flush();
    const n = calls.length;
    mock.timers.tick(91 * 60_000); await flush();
    assert.ok(calls.slice(n).some(([m]) => m === 'cancel'), '90 分鐘還沒到：放棄並取消');
    assert.equal(host.arrivalWatch(), null);
  });
});

test('手機 App 到站提醒：權限被拒 → 畫面說「App 開著時才會提醒」、仍照常盯；出發提醒回 false 不排程', async () => {
  etaServer(() => 600);
  await withNativeHost({ grant: 'denied' }, async ({ host, calls, flush }) => {
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 });
    await flush();
    assert.equal(host.background, false);
    assert.equal(host.arrivalNote(), 'whenNoPermission');
    assert.ok(host.arrivalWatch(), '仍照常盯（App 開著時 toast 提醒）');
    const t = new Date(Date.now() + 3_600_000);
    assert.equal(await host.remind(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`, '出發'), false);
    assert.ok(!scheduled(calls).some((x) => x.id === 1002));
  });
});

test('手機 App 到站提醒：排程失敗（外掛錯誤）→ 畫面不說 App 關著也會提醒、下次輪詢重試；這班趕不上時不排、下一班才排', async () => {
  let eta = 600;
  etaServer(() => eta);
  await withNativeHost({ failSchedule: true }, async ({ host, calls, flush }) => {
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 });
    await flush();
    assert.equal(host.background, false, '排程失敗');
    const tried = calls.filter(([m]) => m === 'schedule').length;
    mock.timers.tick(20_000); await flush();
    assert.ok(calls.filter(([m]) => m === 'schedule').length > tried, '下次輪詢重試（不被 20 秒門檻擋住）');
  });
  eta = 100; // 設定時這班已在 3 分內
  await withNativeHost({}, async ({ host, calls, flush }) => {
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 });
    await flush();
    assert.equal(scheduled(calls).length, 0, '這班趕不上：不排');
    eta = 600; mock.timers.tick(20_000); await flush();
    assert.equal(scheduled(calls).length, 1, '下一班：排');
  });
});

test('網頁版（沒有 Capacitor）：不呼叫原生、background 為 false、說明「頁面開著時」', async () => {
  globalThis.window = { dispatchEvent: () => {} };
  const { createWebHost } = await import('../public/ui/cards/host-web.js');
  const host = createWebHost();
  assert.equal(host.background, false);
  assert.equal(host.arrivalNote(), 'whenOpenPage');
  delete globalThis.window;
});

test('App 被關掉重開：恢復上次的到站提醒（沒過期才恢復；過期清掉並取消排好的通知）', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  globalThis.window = { dispatchEvent: () => {} };
  etaServer(() => 600);
  try {
    mem.set('abang.arrivalWatch', JSON.stringify({ w: { city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 }, until: Date.now() + 600_000 }));
    fakeNative();
    const a = await import('../public/ui/cards/host-web.js?resume-1');
    const host = a.createWebHost();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(host.arrivalWatch()?.routeName, '601', '恢復提醒');
    host.unwatchArrival();
    assert.equal(mem.has('abang.arrivalWatch'), false, '取消後清掉');

    mem.set('abang.arrivalWatch', JSON.stringify({ w: { city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 }, until: Date.now() - 1 }));
    const calls = fakeNative();
    const b = await import('../public/ui/cards/host-web.js?resume-2');
    const h2 = b.createWebHost();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h2.arrivalWatch(), null, '過期不恢復');
    assert.ok(calls.some(([m, o]) => m === 'cancel' && o.notifications[0].id === 1001), '過期：取消排好的通知');
  } finally {
    delete globalThis.localStorage; delete globalThis.window; delete globalThis.Capacitor;
  }
});
