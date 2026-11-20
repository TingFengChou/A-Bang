// 下車提醒（2026-11-21）：從到站時間的順序找「我這台」；站用站序；設定前後上車都估得準；資料看不出來才照時間；App 重開不重響
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { alightDue, busToDest, rideEstimate, alightText, watchAlight, pollAlight, alightWatch, stopAlight, resumeAlight, ALIGHT_SEC, SEC_PER_STOP } = await import('../public/js/alight.js');

const T0 = Date.parse('2026-11-21T10:00:00+08:00');
/** 一條路線：etas 依站序；名字可重複（環狀） */
const route = (etas, names = etas.map((_, i) => `S${i + 1}`)) => etas.map((e, i) => ({ seq: i + 1, stopName: names[i], etaSec: e, status: e == null ? 1 : 0, plate: null }));
beforeEach(() => { stopAlight(); store.clear(); });

test('從到站時間找我這台：上車站之後第一個變小的站在我這台前方', () => {
  // S2 上車；我這台剛離開 S2，在 S3 前（S3 起是我這台：60、180、300）；S2 顯示下一台 600
  const st = route([500, 600, 60, 180, 300, 420]);
  assert.deepEqual(busToDest(st, 1, 4), { etaSec: 300, where: 'ahead' });
  // 目的站前還有別台（S5 又變小）：目的站的下一班不是我
  assert.equal(busToDest(route([500, 600, 60, 180, 30, 150]), 1, 5).where, 'unknown');
  // 我這台已經過了目的站（第一個變小的站在目的站之後）
  assert.equal(busToDest(route([500, 600, 700, 800, 30, 150]), 1, 3).where, 'passed');
  assert.equal(busToDest(route([500, 600, 700]), 1, 2).where, 'unknown', '看不出來');
});

test('設定時：車正要進站 → 上這台（從車到上車站起算）；已上車 → 從到站時間順序；看不出來 → 站數 × 90 秒', () => {
  const coming = rideEstimate(route([500, 60, 300, 420]), 2, 4, T0);
  assert.deepEqual([coming.rideSec, coming.boardAt], [360, T0 + 60_000]);
  const onBus = rideEstimate(route([500, 600, 60, 180, 300]), 2, 5, T0);
  assert.deepEqual([onBus.rideSec, onBus.boardAt], [300, T0]);
  assert.equal(rideEstimate(route([500, 600, 700, 800]), 2, 4, T0).rideSec, 2 * SEC_PER_STOP);
  assert.equal(rideEstimate(route([500, 600]), 2, 1, T0), null, '下車站要在上車站之後');
});

test('環狀路線同名站：用站序，不會找到上車站之前的同名站', () => {
  const st = route([100, 600, 60, 180, 300], ['市府', '西門', '台北車站', '中山', '市府']);
  const w = { board: '西門', boardSeq: 2, dest: '市府', destSeq: 5, boardAt: T0, rideSec: 900 };
  assert.deepEqual(alightDue(w, st, T0), { due: false, etaSec: 300, by: 'bus' });
});

test('alightDue：我這台 ≤ 2 分提醒；看過在路上又過了目的站就馬上提醒；別台在中間不誤報；看不出來照時間', () => {
  const w = { boardSeq: 2, destSeq: 5, board: 'S2', dest: 'S5', boardAt: T0, rideSec: 900 };
  assert.equal(alightDue(w, route([500, 600, 60, 180, 300]), T0).due, false);
  assert.equal(alightDue(w, route([500, 600, 700, 30, 100]), T0 + 200_000).due, true, '≤ 2 分');
  const v = { ...w };
  alightDue(v, route([500, 600, 60, 180, 300]), T0);
  assert.deepEqual(alightDue(v, route([500, 600, 700, 800, 900, 20]), T0 + 400_000), { due: true, etaSec: 0, by: 'passed' }, '錯過一次更新也不漏');
  const u = { ...w };
  assert.equal(alightDue(u, route([500, 600, 60, 180, 30]), T0 + 60_000).due, false, '前一台快到目的站：不是我');
  assert.equal(alightDue({ ...w }, route([500, 600, 700, 800, 900]), T0 + (900 - ALIGHT_SEC) * 1000).by, 'time');
  assert.equal(alightText('市政府', 120), '約 2 分後到「市政府」，準備下車');
  assert.equal(alightText('市政府', 30), '快到「市政府」了，準備下車！');
});

test('watchAlight：記在手機、提醒後結束；太近當下就提醒（回 false）；方向對不上不猜', async () => {
  let etas = [500, 600, 60, 180, 300];
  const callTool = async () => ({ data: { directions: [{ direction: 0, stops: route(etas) }] } });
  const w = { city: 'Taipei', routeName: '307', direction: 0, board: 'S2', boardSeq: 2, dest: 'S5', destSeq: 5, rideSec: 300 };
  assert.equal(await watchAlight(w, callTool), true);
  assert.ok(store.get('abang.alightWatch'));
  etas = [500, 600, 700, 800, 90];
  await pollAlight(callTool);
  assert.equal(alightWatch(), null, '提醒後結束');
  etas = [500, 600, 700, 800, 30];
  assert.equal(await watchAlight(w, callTool), false, '太近：設定當下就提醒');
  assert.equal(await watchAlight({ ...w, direction: 1 }, callTool), true, '方向對不上：不拿另一個方向的資料判斷');
  assert.equal(alightWatch().last, undefined);
  stopAlight();
});

test('App 重開：通知已經響過（排定時間已過）或逾時就清掉，不再重響', () => {
  store.set('abang.alightWatch', JSON.stringify({ dest: 'S5', boardAt: T0, nativeAt: T0 + 60_000, rideSec: 300 }));
  resumeAlight(async () => ({}), T0 + 120_000);
  assert.equal(store.get('abang.alightWatch'), undefined);
  assert.equal(alightWatch(), null);
});
