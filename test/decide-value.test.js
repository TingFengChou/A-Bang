// 花錢換時間要划算（2026-11-22，ADR-0010 調整紀錄）：預設大眾運輸，有理由（趕時間、帶行李、行動不便、下雨…）才推叫車。
// 真實 TDX 實測（西門町→台北101，晴、AQI 44、沒有任何狀況）：原本叫車 72 分勝過捷運 68 分——多付 260 元只快 5 分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, keyQuestion, feltMinutes, VALUE_OF_TIME, STATES, LONG_MIN } from '../core/decide.js';

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
  const noMetro = decide(XIMEN_101, { avoid: ['metro'] });
  assert.equal(noMetro.best.id, 'bus-307', '不要捷運：叫車跟公車比仍不划算、YouBike 43 分超過 30 分 → 推公車');
  assert.ok(noMetro.ranked.find((o) => o.id === 'bike').breakdown.tooLong < 0);
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

// ── PR #119 審查（1122 組起訖 × 5 狀態）：叫車不被壓到長途 YouBike／步行後面；走太久騎太久不排在大眾運輸前面；叫車讓位不推更貴的方案 ──
const O = (id, role, minutes, waitMin, walkMin, cost, exposure = 0.1, effort = 0.2, delayRisk = 0) => ({ id, role, name: id, minutes, waitMin, walkMin, cost, exposure, effort, delayRisk });

test('叫車只跟「不划算的大眾運輸」比：不會因為比走路、YouBike 貴就排到它們後面', () => {
  // 臺北車站→西門町（示範資料）：叫車對公車不划算 → 排到公車後面（不是排到步行後面）；步行 20 分在上限內照分數
  const near = [O('walk', 'walk', 20, 0, 20, 0, 1, 0.5), O('bike', 'bike', 18, 0, 10, 5, 1, 0.8), O('bus', 'bus', 16, 5, 6, 15, 0.2, 0.2, 0.2), O('ride', 'ridehail', 10, 6, 0, 110, 0, 0, 0.2)];
  const r = decide(near);
  const ride = r.ranked.find((o) => o.id === 'ride');
  assert.equal(ride.notWorth.vs, 'bus');
  assert.equal(ride.score, r.ranked.find((o) => o.id === 'bus').score - 1);
  assert.equal(r.best.id, 'walk');
  assert.doesNotMatch(r.reason, /省 110 元/, '理由不拿叫車對步行說嘴');
  // 叫車對大眾運輸划算（快很多）：就算比走路貴也不扣分
  const far = [O('walk', 'walk', 24, 0, 24, 0, 1, 0.6), O('bus', 'bus', 50, 10, 8, 15, 0.2, 0.2, 0.2), O('ride', 'ridehail', 12, 4, 0, 120, 0, 0, 0.2)];
  assert.equal(decide(far).ranked.find((o) => o.id === 'ride').breakdown.premium, undefined);
});

test('走太久、騎太久（步行 > 25 分、YouBike > 30 分）不排在最好的大眾運輸前面；上限內照分數', () => {
  assert.deepEqual(LONG_MIN, { walk: 25, bike: 30 });
  const bus = O('bus', 'bus', 30, 8, 6, 15, 0.2, 0.2, 0.2);
  const bike = (m) => O('bike', 'bike', m, 0, 6, 5, 1, 0.8);
  const walk = (m) => O('walk', 'walk', m, 0, m, 0, 1, 0.6);
  // 士林夜市→華山 YouBike 43 分、臺北車站→國父紀念館 YouBike 37 分（審查重現）
  for (const m of [31, 37]) { // 原本分數贏公車 → 壓到公車後面 1 分、理由照實說
    const r = decide([bike(m), bus]);
    assert.equal(r.best.id, 'bus', `YouBike ${m} 分`);
    assert.equal(r.reason, `選「bus」：bike要 ${m} 分（超過 30 分）。`);
    assert.ok(r.ranked[1].breakdown.tooLong < 0);
    assert.deepEqual(r.ranked[1].tooLong, { vs: 'bus', cap: 30 });
    assert.equal(r.ranked[1].score, r.ranked[0].score - 1);
  }
  assert.equal(decide([bike(43), bus]).best.id, 'bus', 'YouBike 43 分：本來就輸，不用扣分');
  assert.equal(decide([bike(30), bus]).best.id, 'bike', 'YouBike 30 分：上限內照分數');
  // 大安森林公園→華山 步行 30 分、→臺大 步行 26 分
  for (const m of [26, 30]) assert.equal(decide([walk(m), bus]).best.id, 'bus', `步行 ${m} 分`);
  assert.equal(decide([walk(25), O('bus', 'bus', 22, 10, 8, 15, 0.2, 0.2, 0.2)]).best.id, 'walk', '步行 25 分：上限內照分數');
  // 有理由狀態、沒有大眾運輸：照權重（趕時間騎 YouBike 不用等車；深夜只有 YouBike 與叫車）
  assert.equal(decide([bike(31), bus], { states: ['rush'] }).ranked.find((o) => o.id === 'bike').breakdown.tooLong, undefined);
  assert.equal(decide([bike(43), walk(90)]).best.id, 'bike');
  // 想省錢、塞車也一樣有上限（塞車時臺北松山機場→板橋車站 YouBike 74 分）
  assert.equal(decide([walk(70), bus], { states: ['budget'] }).best.id, 'bus');
  assert.equal(decide([bike(74), O('bus', 'bus', 59, 8, 6, 15, 0.2, 0.2, 1), O('ride', 'ridehail', 43, 6, 0, 455, 0, 0, 1)], { states: ['traffic'] }).best.id, 'bus');
});

test('叫車讓位不推更貴的方案：叫車 60 分 300 元、高鐵 45 分 400 元、台鐵 70 分 150 元 → 台鐵', () => {
  const opts = [O('ride', 'ridehail', 60, 6, 0, 300, 0, 0, 0.3), O('thsr', 'thsr', 45, 10, 15, 400), O('tra', 'tra', 70, 10, 8, 150)];
  const r = decide(opts);
  assert.equal(r.best.id, 'tra');
  assert.deepEqual(r.ranked.map((o) => o.id), ['tra', 'ride', 'thsr']);
  assert.equal(r.ranked[2].notWorth.vs, 'tra');
  assert.equal(r.reason, '選「tra」：省 150 元、只慢 10 分。');
  // 高鐵快很多、值得多付（跨城）：照分數推高鐵
  const far = [O('ride', 'ridehail', 260, 6, 0, 6000, 0, 0, 0.3), O('thsr', 'thsr', 120, 10, 10, 1490), O('tra', 'tra', 260, 10, 8, 840)];
  assert.equal(decide(far).best.id, 'thsr');
});
