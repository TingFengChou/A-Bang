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
  assert.match(r.speak, new RegExp(`^307 (約 \\d+ 分後到|即將到|進站中)「${stop.replace(/[()]/g, '\\$&')}」`));
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
  assert.match(es.find((e) => e.type === 'text').delta, /走過去約 \d+ 分。要我在公車快到站時提醒你嗎？/);
});

test('網頁 host 到站提醒：剩下時間已到就馬上通知一次並結束；快到時以計時器準時提醒', async () => {
  const notes = [], events = [];
  globalThis.window = { dispatchEvent: (e) => events.push([e.type, e.detail]) };
  globalThis.Notification = class { static permission = 'granted'; constructor(title, o) { notes.push([title, o.body]); } };
  let eta = 100;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { focus: { etaSec: eta, status: 0, statusText: '1 分' } } }));
  const { createWebHost } = await import('../public/ui/cards/host-web.js');
  const host = createWebHost();
  await host.watchArrival({ city: 'Taipei', routeName: '601', stop: '西門', direction: 0, minutes: 3 });
  assert.deepEqual(notes, [['阿幫：公車快到站', '601 約 2 分後到「西門」，該出門了！']]);
  assert.equal(host.arrivalWatch(), null, '只提醒一次');
  assert.ok(events.some(([t, d]) => t === 'abang:arrival' && /該出門了/.test(d.text)));

  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  try {
    eta = 190; // 剩 10 秒才到 3 分
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
