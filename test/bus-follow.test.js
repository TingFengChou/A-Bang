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
  assert.match(busFollowUp({ best: 'bus-601', options: [opt] }).note, /^@公車 你選了公車，我幫你盯 601 在「西門」/);
  assert.equal(busFollowUp({ best: 'ride', options: [opt, { id: 'ride', role: 'ride' }] }), null);
  assert.equal(busFollowUp(null), null);
});

test('問阿幫（示範）：想省錢選公車 → decision 後自動查上車站，卡片聚焦，總結問要不要到站提醒', async () => {
  const es = [];
  await runDemo(createServices({ forceMock: true }), { messages: [{ role: 'user', content: '我想省錢，從西門町到台北101怎麼去？' }] }, (e) => es.push(e));
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
  assert.match(es.find((e) => e.type === 'text').delta, /走過去約 \d+ 分(。要我在公車快到站時提醒你嗎？|，這班可能趕不上。要我在下一班快到時提醒你嗎？)/);
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

test('手機 App 到站提醒（M11-02）：排本機通知到預估時間、差不到 20 秒不重排、車提早到就馬上送、取消會一起取消', async () => {
  const calls = [], events = [];
  globalThis.window = { dispatchEvent: (e) => events.push([e.type, e.detail]) };
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: async (plugin, method, o) => { calls.push([plugin, method, o]); return method.endsWith('Permissions') ? { display: 'granted' } : {}; } };
  let eta = 600;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { focus: { etaSec: eta, status: 0, statusText: '10 分' } } }));
  const { createWebHost } = await import('../public/ui/cards/host-web.js');
  const host = createWebHost();
  assert.equal(host.background, true, 'App 關著也會提醒');
  const flush = () => new Promise((r) => setImmediate(r));
  const scheduled = () => calls.filter(([, m]) => m === 'schedule').map(([, , o]) => o.notifications[0]);
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  try {
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 3 });
    await flush();
    assert.equal(scheduled().length, 1);
    const n0 = scheduled()[0];
    assert.equal(n0.id, 1001);
    assert.equal(n0.schedule.at.getTime(), 1_000_000 + 420_000, '10 分後到、提前 3 分 → 7 分後通知');
    assert.match(n0.body, /601 約 3 分後到「西門」，該出門了！（依 \d\d:\d\d 的到站時間估計）/);

    eta = 590; mock.timers.tick(20_000); await flush();
    assert.equal(scheduled().length, 1, '預估沒變（差不到 20 秒）不重排');
    eta = 300; mock.timers.tick(20_000); await flush();
    assert.equal(scheduled().length, 2, '車變快：重排');
    assert.equal(scheduled()[1].schedule.at.getTime(), 1_040_000 + 120_000);
    eta = 150; mock.timers.tick(20_000); await flush(); // 比預估更早進入 3 分內
    assert.equal(scheduled().length, 3, '比排好的時間早到 → 馬上送');
    assert.ok(scheduled()[2].schedule.at.getTime() <= Date.now() + 1000);
    assert.equal(host.arrivalWatch(), null);

    eta = 600;
    await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', minutes: 5 });
    await flush();
    host.unwatchArrival(); await flush();
    assert.deepEqual(calls.at(-1), ['LocalNotifications', 'cancel', { notifications: [{ id: 1001 }] }], '取消提醒＝取消排好的通知');

    const t = new Date(Date.now() + 3_600_000);
    const at = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    assert.equal(await host.remind(at, '該出發了'), true);
    assert.equal(scheduled().at(-1).id, 1002, '出發提醒也用本機通知');
  } finally {
    mock.timers.reset();
    delete globalThis.window; delete globalThis.Capacitor;
  }
});
