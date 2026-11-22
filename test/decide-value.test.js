// 花錢換時間要划算（2026-11-22，ADR-0010 調整紀錄）：預設大眾運輸，有理由（趕時間、帶行李、行動不便、下雨…）才推叫車。
// 真實 TDX 實測（西門町→台北101，晴、AQI 44、沒有任何狀況）：原本叫車 72 分勝過捷運 68 分——多付 260 元只快 5 分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, keyQuestion, feltMinutes, VALUE_OF_TIME, STATES } from '../core/decide.js';

const XIMEN_101 = [
  { id: 'ridehail', role: 'ridehail', name: '叫車（Uber）', minutes: 27, waitMin: 6, walkMin: 0, cost: 285, exposure: 0, effort: 0, delayRisk: 0.2 },
  { id: 'metro', role: 'metro', name: '捷運 板南線', minutes: 32, waitMin: 7, walkMin: 6, cost: 25, exposure: 0.1, effort: 0.2, delayRisk: 0 },
  { id: 'bus-307', role: 'bus', name: '公車 307', minutes: 56, waitMin: 8, walkMin: 8, cost: 15, exposure: 0.2, effort: 0.2, delayRisk: 0.2 },
  { id: 'bike', role: 'bike', name: 'YouBike', minutes: 43, waitMin: 0, walkMin: 6, cost: 25, exposure: 1, effort: 0.8, delayRisk: 0 },
];
const ids = (r) => r.ranked.map((o) => o.id);

test('實測：西門町→台北101 沒有狀況推捷運；叫車多 260 元只快 5 分不划算，排第二、理由照實說', () => {
  const r = decide(XIMEN_101);
  assert.equal(r.best.id, 'metro');
  assert.equal(r.reason, '選「捷運 板南線」：省 260 元、只慢 5 分。');
  assert.deepEqual(ids(r).slice(0, 2), ['metro', 'ridehail']);
  const ride = r.ranked[1];
  assert.ok(ride.breakdown.premium < 0, '不划算的扣分放在 breakdown.premium（決策圖畫得出來）');
  assert.equal(ride.score, r.ranked[0].score - 1, '排在捷運後面 1 分');
  assert.deepEqual({ vs: ride.notWorth.vs, extra: ride.notWorth.extra }, { vs: 'metro', extra: 260 });
  // 分數＝breakdown 加總（決策圖逐項累加要對得上）
  for (const o of r.ranked) assert.equal(o.score, Math.round(Object.values(o.breakdown).reduce((a, b) => a + b, 0) * 100));
  // 會問：「叫車快 5 分但多 260 元，你趕時間嗎？」
  const q = keyQuestion(XIMEN_101, {});
  assert.equal(q.state, 'rush');
  assert.equal(q.text, '叫車（Uber）快 5 分但多 260 元，你趕時間嗎？');
});

test('有理由才推叫車：趕時間、帶行李、少走路、長輩、小孩、行動不便、下雨、空品不佳 → 叫車（照權重，與 2026-11-21 相同）', () => {
  for (const k of ['rush', 'luggage', 'lessWalk', 'elder', 'kids', 'mobility', 'rain', 'badAir']) {
    assert.ok(STATES[k].reason, k);
    const r = decide(XIMEN_101, { states: [k] });
    assert.equal(r.best.id, 'ridehail', k);
    assert.equal(r.ranked[0].breakdown.premium, undefined, `${k}：不扣分`);
    assert.match(r.reason, new RegExp(`因為${STATES[k].say}`), k);
  }
  assert.match(decide(XIMEN_101, { states: ['rush'] }).reason, /^選「叫車（Uber）」：因為你趕時間，比捷運 板南線快 5 分/);
});

test('不是叫車的理由：塞車中、想省錢、可能下雨、多人同行照樣檢查划不划算', () => {
  for (const k of ['traffic', 'budget', 'rainSoon', 'group']) {
    assert.ok(!STATES[k].reason, k);
    assert.notEqual(decide(XIMEN_101, { states: [k] }).best.id, 'ridehail', k);
  }
  assert.match(decide(XIMEN_101, { states: ['traffic'] }).reason, /^選「捷運 板南線」：因為路上正在塞車，省 260 元/);
});

test('邊界：叫車快 25 分以上、價差小時值得 → 推叫車；同樣快但貴很多 → 不推；剛好等於時間價值算值得', () => {
  const bus = { id: 'bus', role: 'bus', name: '公車', minutes: 50, waitMin: 8, walkMin: 8, cost: 15, exposure: 0.2, effort: 0.2, delayRisk: 0.2 };
  const ride = (cost) => ({ id: 'ride', role: 'ridehail', name: '叫車', minutes: 25, waitMin: 5, walkMin: 0, cost, exposure: 0, effort: 0, delayRisk: 0.2 });
  // 體感時間：公車 50＋走 8＋等 8＝66；叫車 25＋等 5＝30 → 省 36 分 × 5 元＝180 元
  assert.equal(feltMinutes(bus) - feltMinutes(ride(0)), 36);
  assert.equal(decide([bus, ride(150)]).best.id, 'ride', '多 135 元換 36 分：值得');
  assert.match(decide([bus, ride(150)]).reason, /^選「叫車」：比公車快 25 分/);
  assert.equal(decide([bus, ride(15 + 180)]).best.id, 'ride', '多 180 元＝剛好值得');
  assert.equal(decide([bus, ride(15 + 181)]).best.id, 'bus', '多 181 元：不划算');
  const r = decide([bus, ride(300)]);
  assert.equal(r.best.id, 'bus');
  assert.equal(r.reason, '選「公車」：省 285 元、只慢 25 分。');
});

test('沒有大眾運輸（深夜收班、附近沒有站）：不檢查，照權重——只剩走路、YouBike、叫車時照樣可以推叫車', () => {
  const night = [
    { id: 'walk', role: 'walk', name: '步行', minutes: 88, waitMin: 0, walkMin: 88, cost: 0, exposure: 1, effort: 1, delayRisk: 0 },
    { id: 'bike', role: 'bike', name: 'YouBike', minutes: 40, waitMin: 0, walkMin: 7, cost: 15, exposure: 1, effort: 0.8, delayRisk: 0 },
    { id: 'ridehail', role: 'ridehail', name: '叫車', minutes: 24, waitMin: 6, walkMin: 0, cost: 255, exposure: 0, effort: 0, delayRisk: 0.2 },
  ];
  const r = decide(night);
  assert.equal(r.best.id, 'ridehail');
  assert.ok(r.ranked.every((o) => o.breakdown.premium === undefined));
  // 只有叫車一種
  assert.equal(decide([night[2]]).best.id, 'ridehail');
});

test('指定方式、說不要、偏好：叫車照使用者的；使用者同意「優先叫車」時偏好加分照樣會翻盤', () => {
  assert.equal(decide(XIMEN_101, { mode: 'ridehail' }).best.id, 'ridehail');
  assert.equal(decide(XIMEN_101, { avoid: ['metro'] }).best.id, 'bike', '不要捷運：叫車跟公車比仍不划算，照分數推 YouBike');
  const liked = decide(XIMEN_101, { habit: { ridehail: 1 } });
  assert.equal(liked.best.id, 'ridehail');
  assert.match(liked.reason, /你想優先叫車/);
});

test('體感時間：走路、等車算 2 倍、每轉乘一次多 5 分（分段或捷運轉乘）', () => {
  assert.deepEqual(VALUE_OF_TIME, { perMin: 5, walk: 2, wait: 2, transferMin: 5 });
  assert.equal(feltMinutes({ minutes: 30, walkMin: 6, waitMin: 4 }), 40);
  assert.equal(feltMinutes({ minutes: 30, walkMin: 6, waitMin: 4, metro: { transfer: true } }), 45);
  assert.equal(feltMinutes({ minutes: 30, legs: [{ mode: 'walk' }, { mode: 'transit' }, { mode: 'thsr' }, { mode: 'transit' }] }), 40);
  assert.equal(feltMinutes({ minutes: 30, transfers: 1 }), 35);
});
