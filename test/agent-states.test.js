// 同行者與行動能力狀態（A1）、出門建議（S13）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, STATES } from '../core/decide.js';
import { outingAdvice, outingSay } from '../core/agent/outing.js';
import { parseIntent, needsLocation } from '../core/agent/demo-intent.js';

const OPTS = [
  { id: 'bike', role: 'bike', name: 'YouBike', minutes: 12, cost: 10, walkMin: 3, waitMin: 0, exposure: 1, effort: 0.8 },
  { id: 'walk', role: 'walk', name: '步行', minutes: 25, cost: 0, walkMin: 25, waitMin: 0, exposure: 1, effort: 0.6 },
  { id: 'bus', role: 'bus', name: '公車 601', minutes: 20, cost: 15, walkMin: 6, waitMin: 5, exposure: 0.3, effort: 0.2 },
  { id: 'taxi', role: 'ridehail', name: '叫車', minutes: 10, cost: 250, walkMin: 0, waitMin: 3, exposure: 0, effort: 0 },
];

test('elder／kids 排除 YouBike；mobility 排除 YouBike 與步行；原因寫明、決策圖標「不適合」', () => {
  for (const k of ['elder', 'kids']) {
    const r = decide(OPTS, { states: [k] });
    assert.deepEqual(r.excluded.map((e) => e.id), ['bike'], k);
    assert.match(r.excluded[0].why, new RegExp(`${STATES[k].say}，不適合YouBike`));
    assert.match(r.reason, /YouBike不適合，不列入/);
  }
  const m = decide(OPTS, { states: ['mobility'] });
  assert.deepEqual(m.excluded.map((e) => e.id).sort(), ['bike', 'walk']);
  assert.ok(['bus', 'taxi'].includes(m.best.id));
  assert.ok(STATES.mobility.boost.walkMin >= 3);
});

test('規則：長輩、小孩、輪椅的說法；「帶阿嬤」「推嬰兒車去…」是行程', () => {
  assert.deepEqual(parseIntent('帶阿嬤從西門町去台北101').states, ['elder']);
  assert.deepEqual(parseIntent('推嬰兒車去台北101').states, ['kids']);
  assert.deepEqual(parseIntent('我坐輪椅，要去台北101').states, ['mobility']);
  assert.equal(parseIntent('推嬰兒車去台北101').intent, 'trip');
  assert.ok(!parseIntent('我想少走一點去台北101').states.includes('elder'));
});

test('出門建議：下雨、降雨機率、冷熱、空品；資料正常時說安心出門；沒有資料不亂說', () => {
  assert.deepEqual(outingAdvice({ weather: { raining: true, pop3h: 90, tempC: 33 }, air: { aqi: 160, status: '不健康' } }), ['現在正在下雨，記得帶傘', '33°C 很熱，注意防曬、多喝水', '空氣品質不健康（AQI 160），盡量少待戶外、戴口罩']);
  assert.deepEqual(outingAdvice({ weather: { pop3h: 60, tempC: 14 } }), ['接下來 3 小時降雨機率 60%，帶把傘', '14°C 偏涼，帶件外套']);
  assert.match(outingSay({ weather: { pop3h: 10, tempC: 24 }, air: { aqi: 40, status: '良好' } }), /都還不錯，安心出門/);
  assert.equal(outingSay({}), '這次沒查到天氣和空品資料，晚點再試。');
});

test('出門建議的問法；需要位置；說了地名的不是出門建議', () => {
  for (const q of ['今天出門要注意什麼？', '出門要帶傘嗎', '今天要穿什麼']) {
    const it = parseIntent(q);
    assert.equal(it.intent, 'outing', q);
    assert.ok(needsLocation(it), q);
  }
  assert.notEqual(parseIntent('明天去台北101會下雨嗎').intent, 'outing');
});
