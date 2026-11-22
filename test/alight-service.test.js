// 下車提醒常駐服務（2026-11-23）：判斷只在 core/alight.js；伺服器 /api/v1/bus/alight 給 Android 服務問；
// 前端有外掛時開服務、不再預排本機通知；服務響過或使用者在通知按「停止」，畫面跟著結束；App 重開時服務還在跑就不重開。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__ABANG_API_BASE__ = 'https://api.example.test'; // App 打包時注入的 API 位址（服務要絕對網址）
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const { alightCheck, alightOngoingText, ALIGHT_MAX_MS } = await import('../core/alight.js');
const { watchAlight, pollAlight, alightWatch, stopAlight, resumeAlight } = await import('../public/js/alight.js');
const { restRoutes } = await import('../server/rest.js');
const { createServices } = await import('../core/index.js');
const { callTool } = await import('../core/tools/index.js');
const { UserError } = await import('../core/util.js');

const T0 = Date.parse('2026-11-23T10:00:00+08:00');
const route = (etas) => etas.map((e, i) => ({ seq: i + 1, stopName: `S${i + 1}`, etaSec: e, status: e == null ? 1 : 0, plate: null }));
const W = { routeName: '307', boardSeq: 2, destSeq: 5, board: 'S2', dest: 'S5', boardAt: T0, rideSec: 900 };

/** 假的 Capacitor：AbangWatch（下車提醒服務）＋ LocalNotifications；記下每個呼叫 */
function bridge({ status = { active: true, firedAt: 0, endedAt: 0 }, failStart = false } = {}) {
  const calls = [];
  const st = { ...status };
  globalThis.Capacitor = {
    isNativePlatform: () => true, isPluginAvailable: (p) => p === 'AbangWatch',
    nativePromise: async (p, m, o) => {
      calls.push([p, m, o]);
      if (p === 'LocalNotifications' && /Permissions/.test(m)) return { display: 'granted' };
      if (m === 'startAlight' && failStart) throw new Error('舊版 App');
      if (m === 'alightStatus') return st;
      return {};
    },
  };
  return { calls, st, called: (m) => calls.filter((c) => c[1] === m) };
}
beforeEach(() => { stopAlight(); store.clear(); delete globalThis.Capacitor; });

test('alightCheck：常駐文字、響鈴文字、seen 帶回下一次、3 小時結束', () => {
  const r = alightCheck(W, route([500, 600, 60, 180, 300]), T0);
  assert.equal(r.due, false);
  assert.equal(r.etaSec, 300);
  assert.equal(r.seen, true, '看過我這台在路上：服務要帶回下一次');
  assert.equal(r.ongoing, '307 坐車中・約 5 分到「S5」・快到時提醒你下車');
  assert.equal(r.alert, '約 2 分後到「S5」，準備下車', '還沒到點：給兩次更新之間到點時用的那一句');
  assert.equal(W.seen, undefined, '不改呼叫端的物件');
  const passed = alightCheck({ ...W, seen: true }, route([500, 600, 700, 800, 900, 20]), T0 + 400_000);
  assert.deepEqual([passed.due, passed.by, passed.alert], [true, 'passed', '快到「S5」了，準備下車！']);
  assert.equal(alightCheck(W, route([500, 600, 700, 800, 900, 20]), T0 + 400_000).by, null, '沒看過就不當作已經過站');
  assert.equal(alightCheck(W, [], T0 + ALIGHT_MAX_MS + 1).ended, true);
  assert.equal(alightCheck({ ...W, boardAt: T0 + 60_000 }, route([500, 60, 30, 180, 300]), T0).ongoing, '307 等車中・約 16 分到「S5」・快到時提醒你下車');
  assert.equal(alightOngoingText({ ...W, lang: 'en' }, 300), "Bus 307 · about 5 min to S5 · I'll tell you when to get off");
  assert.equal(alightOngoingText(W, 30), '307 坐車中・快到「S5」了・快到時提醒你下車');
  assert.equal(alightOngoingText(W, null), '307 坐車中・往「S5」・快到時提醒你下車');
});

test('/api/v1/bus/alight：用同一個 bus_route_eta 判斷；參數不對回 UserError', async () => {
  const svc = createServices({ forceMock: true });
  const h = restRoutes(svc)['/api/v1/bus/alight'].handler;
  const now = Date.now();
  const stops = (await callTool(svc, 'bus_route_eta', { city: 'Taipei', routeName: '307', direction: 0 })).data.directions.find((d) => d.direction === 0).stops;
  const [b, d] = [stops[1], stops[5]];
  const p = { city: 'Taipei', route: '307', direction: '0', board: b.stopName, boardSeq: String(b.seq), dest: d.stopName, destSeq: String(d.seq), boardAt: String(now), rideSec: '600', now: String(now) };
  const got = await h(p);
  const want = alightCheck({ city: 'Taipei', routeName: '307', direction: 0, board: b.stopName, boardSeq: b.seq, dest: d.stopName, destSeq: d.seq, plate: null, boardAt: now, rideSec: 600, seen: false, lang: null }, stops, now);
  assert.deepEqual(got, want);
  assert.match(got.ongoing, /^307 坐車中・/);
  assert.match((await h({ ...p, lang: 'en' })).alert, /get off/);
  await assert.rejects(h({ ...p, dest: '' }), UserError);
  await assert.rejects(h({ ...p, direction: '3' }), UserError);
  await assert.rejects(h({ ...p, boardAt: 'x' }), UserError);
  await assert.rejects(h({ ...p, rideSec: '-1' }), UserError);
});

test('有外掛：開常駐服務（不送位置）、不預排本機通知；取消時一起停', async () => {
  const b = bridge();
  let etas = [500, 600, 60, 180, 300];
  const tool = async () => ({ data: { directions: [{ direction: 0, stops: route(etas) }] } });
  assert.equal(await watchAlight({ city: 'Taipei', routeName: '307', direction: 0, board: 'S2', boardSeq: 2, dest: 'S5', destSeq: 5, rideSec: 300 }, tool), true);
  const [start] = b.called('startAlight');
  assert.ok(start, '開了服務');
  const o = start[2];
  assert.equal(o.apiBase, 'https://api.example.test');
  assert.deepEqual([o.routeName, o.board, o.dest, o.boardSeq, o.destSeq, o.direction, o.lang], ['307', 'S2', 'S5', 2, 5, 0, 'zh']);
  assert.equal(o.until - o.boardAt, ALIGHT_MAX_MS, '最多 3 小時');
  assert.ok(!('lat' in o) && !('lon' in o), '不送位置');
  assert.equal(b.called('schedule').length, 0, '服務在跑：不預排本機通知');
  assert.equal(alightWatch().service, true);
  etas = [500, 600, 700, 120, 240];
  await pollAlight(tool);
  assert.equal(b.called('schedule').length, 0);
  stopAlight();
  assert.equal(b.called('stopAlight').length, 1, '取消：服務一起停');
});

test('沒有通知權限：不開服務（畫面照實說 App 關著不會提醒）', async () => {
  const b = bridge();
  const np = globalThis.Capacitor.nativePromise;
  globalThis.Capacitor.nativePromise = async (p, m, o) => (p === 'LocalNotifications' && /Permissions/.test(m) ? { display: 'denied' } : np(p, m, o));
  const tool = async () => ({ data: { directions: [{ direction: 0, stops: route([500, 600, 60, 180, 600]) }] } });
  assert.equal(await watchAlight({ city: 'Taipei', routeName: '307', direction: 0, board: 'S2', boardSeq: 2, dest: 'S5', destSeq: 5, rideSec: 600 }, tool), true);
  assert.equal(b.called('startAlight').length, 0);
  assert.equal(alightWatch().service, false);
});

test('太近當下就提醒：不開服務', async () => {
  const b = bridge();
  const tool = async () => ({ data: { directions: [{ direction: 0, stops: route([500, 600, 700, 800, 30]) }] } });
  assert.equal(await watchAlight({ city: 'Taipei', routeName: '307', direction: 0, board: 'S2', boardSeq: 2, dest: 'S5', destSeq: 5, rideSec: 300 }, tool), false);
  assert.equal(b.called('startAlight').length, 0);
});

test('服務響過、或使用者在通知按「停止」：畫面跟著結束；被系統收掉：改回預排本機通知', async () => {
  const tool = async () => ({ data: { directions: [{ direction: 0, stops: route([500, 600, 60, 180, 600]) }] } });
  const w = { city: 'Taipei', routeName: '307', direction: 0, board: 'S2', boardSeq: 2, dest: 'S5', destSeq: 5, rideSec: 600 };
  for (const end of [{ firedAt: 1 }, { endedAt: 1 }]) {
    const b = bridge();
    await watchAlight(w, tool);
    Object.assign(b.st, { active: false, ...end });
    await pollAlight(tool);
    assert.equal(alightWatch(), null);
    assert.equal(b.called('cancel').length, 0, '沒有排本機通知可取消');
  }
  const b = bridge();
  await watchAlight(w, tool);
  b.st.active = false;
  await pollAlight(tool);
  assert.equal(alightWatch().service, false);
  assert.equal(b.called('schedule').length, 1, '改回預排');
});

test('舊版 App（沒有 startAlight）：照原本方式預排本機通知', async () => {
  const b = bridge({ failStart: true });
  const tool = async () => ({ data: { directions: [{ direction: 0, stops: route([500, 600, 60, 180, 600]) }] } });
  assert.equal(await watchAlight({ city: 'Taipei', routeName: '307', direction: 0, board: 'S2', boardSeq: 2, dest: 'S5', destSeq: 5, rideSec: 600 }, tool), true);
  assert.equal(alightWatch().service, false);
  assert.equal(b.called('schedule').length, 1);
});

test('App 重開：服務還在跑就接著看（不重開）；響過就清掉', async () => {
  const tool = async () => ({ data: { directions: [{ direction: 0, stops: route([500, 600, 60, 180, 600]) }] } });
  const now = Date.now();
  const saved = { city: 'Taipei', routeName: '307', direction: 0, board: 'S2', boardSeq: 2, dest: 'S5', destSeq: 5, rideSec: 600, boardAt: now, service: true };
  let b = bridge();
  store.set('abang.alightWatch', JSON.stringify(saved));
  await resumeAlight(tool, now);
  assert.equal(b.called('startAlight').length, 0, '不重開');
  assert.equal(alightWatch().dest, 'S5');
  stopAlight();
  b = bridge({ status: { active: false, firedAt: now - 1000, endedAt: 0 } });
  store.set('abang.alightWatch', JSON.stringify(saved));
  await resumeAlight(tool, now);
  assert.equal(alightWatch(), null);
  assert.equal(store.get('abang.alightWatch'), undefined);
  assert.equal(b.called('startAlight').length, 0);
});

test('原生：下車提醒是前景服務（dataSync）、常駐通知有「停止」、問 /api/v1/bus/alight、不送位置、響鈴走 alert 頻道', () => {
  const src = (f) => readFileSync(new URL(`../android/app/src/main/java/tw/abang/app/${f}`, import.meta.url), 'utf8');
  const svc = src('AbangAlightService.java');
  const mf = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(mf, /AbangAlightService[^>]+foregroundServiceType="dataSync"/);
  assert.match(svc, /setOngoing\(true\)/);
  assert.match(svc, /"停止"/);
  assert.match(svc, /\/api\/v1\/bus\/alight/);
  assert.match(svc, /POLL_MS = 20_000/);
  assert.match(svc, /AbangWatchService\.CH_ALERT/);
  assert.match(svc, /AbangWatchService\.CH_ONGOING/);
  assert.doesNotMatch(svc, /q\("(lat|lon|near)"/, '不送位置');
  assert.match(src('AbangWatchPlugin.java'), /public void startAlight[\s\S]+public void alightStatus/);
});
