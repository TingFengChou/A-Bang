// 趕不趕得上那班車（C，2026-11-28 Claude 與 Antigravity 第九輪）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldAsk, askText, verdictOf, resultText, nextTrain, noLocationText, CATCH_BUFFER } from '../core/catch-train.js';

const HSR = { role: 'thsr', trainNo: '116', depart: '10:35', from: '台北', to: '台中', date: '2026-11-30', st: { lat: 25.0478, lon: 121.517 } };
const at = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

test('只對台鐵、高鐵、末班車問（Antigravity：一般班次不打擾）；問句寫清楚「用一次位置」', () => {
  assert.equal(shouldAsk(HSR), true);
  assert.equal(shouldAsk({ ...HSR, role: 'tra' }), true);
  assert.equal(shouldAsk({ role: 'bus', depart: '10:35' }), false);
  assert.equal(shouldAsk({ role: 'bus', depart: '23:40', last: true }), true, '末班公車也問');
  assert.equal(shouldAsk(null), false);
  assert.equal(askText(HSR), '該出門囉！要我用一次位置幫你看還趕不趕得上10:35 的高鐵嗎？');
  assert.match(askText({ ...HSR, last: true }), /^注意！10:35 是末班車，現在該出門了。要我用一次位置/);
  assert.match(askText(HSR, 'en'), /use your location once/);
});

test(`留緩衝（高鐵 ${CATCH_BUFFER.thsr} 分、台鐵 ${CATCH_BUFFER.tra} 分）：緩衝內說很趕，不說來得及`, () => {
  assert.deepEqual(verdictOf(HSR, at('10:00'), 12), { kind: 'ok', spare: 23, buffer: 8 });
  assert.equal(verdictOf(HSR, at('10:15'), 15).kind, 'tight', '剩 5 分 < 高鐵緩衝 8 分');
  assert.equal(verdictOf(HSR, at('10:25'), 15).kind, 'miss');
  assert.equal(verdictOf({ ...HSR, role: 'tra' }, at('10:15'), 15).kind, 'ok', '台鐵緩衝 5 分');
  assert.equal(verdictOf({ ...HSR, depart: '00:10' }, at('23:55'), 10).spare, 5, '過午夜');
});

test('結果：來得及／很趕附「僅供參考」；趕不上給下一班；末班沒下一班給叫車預估（標預估）', () => {
  assert.equal(resultText(HSR, verdictOf(HSR, at('10:00'), 12), { toStationMin: 12 }), '來得及：到台北約 12 分，離發車還有 35 分（僅供參考，進站、買票多留幾分鐘）。');
  assert.match(resultText(HSR, verdictOf(HSR, at('10:15'), 15), { toStationMin: 15 }), /^很趕：到台北約 15 分，只剩 5 分緩衝，現在就出發/);
  const miss = verdictOf(HSR, at('10:25'), 15);
  assert.equal(resultText(HSR, miss, { toStationMin: 15, next: { depart: '11:05', arrive: '12:10' } }), '趕不上 10:35 那班（到台北約 15 分）。下一班 11:05 開、12:10 到。');
  assert.equal(resultText({ ...HSR, last: true }, miss, { toStationMin: 15, taxi: { low: 2100, high: 2700 } }), '趕不上 10:35 那班（到台北約 15 分）。那是今天的末班車。改叫車預估約 2100～2700 元，實際以叫車 App 報價為準。');
  assert.match(noLocationText(), /沒拿到你的位置，沒辦法幫你算/);
});

test('下一班：現在＋到站＋緩衝之後的第一班', () => {
  const trains = [{ depart: '10:35' }, { depart: '10:50' }, { depart: '11:05' }, { depart: 'x' }];
  assert.equal(nextTrain(trains, at('10:25'), 15, 'thsr').depart, '10:50', '10:25＋15＋8＝10:48 之後的第一班');
  assert.equal(nextTrain(trains, at('11:00'), 15, 'thsr'), null);
});

test('前端：按了才定位一次，算到車站、趕不上查下一班；沒拿到位置照實說（不用預設地區）', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.addEventListener ??= () => {}; // 模組載入時掛事件（abang-dock.js）
  const { runCheck } = await import('../public/js/catch-train.js');
  const calls = [];
  const host = { callTool: async (name) => {
    calls.push(name);
    if (name === 'plan_trip') return { data: { best: 'metro', options: [{ id: 'metro', minutes: 15 }] } };
    return { data: { trains: [{ depart: '10:35' }, { depart: '11:05', arrive: '12:10' }] } };
  } };
  const said = [];
  const now = Date.parse('2026-11-30T10:25:00+08:00');
  const r = await runCheck(HSR, { host, locate: async () => ({ lat: 25.03, lon: 121.56 }), now, say: (t) => said.push(t) });
  assert.equal(r, 'miss');
  assert.deepEqual(calls, ['plan_trip', 'thsr_timetable']);
  assert.equal(said[0], '趕不上 10:35 那班（到台北約 15 分）。下一班 11:05 開、12:10 到。');
  const r2 = await runCheck(HSR, { host, locate: async () => null, now, say: (t) => said.push(t) });
  assert.equal(r2, 'noLocation');
  assert.match(said.at(-1), /沒拿到你的位置/);
});
