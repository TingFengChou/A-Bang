// 模型模式：模型漏講的重點由程式補上（模型模式情境評測 S10、S12-11）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mustSay } from '../core/agent/model-loop.js';

test('照你說的改交通方式：模型沒說就補在開頭', () => {
  const trip = { best: 'metro', ranking: { reason: '照你說的選「捷運」（分數 62；分數最高的是叫車 77）。' }, options: [{ id: 'metro', name: '捷運 淡水信義線' }] };
  assert.equal(mustSay('大概 23 分會到。', trip), '照你說的選「捷運 淡水信義線」。大概 23 分會到。', '只補一句、不帶分數');
  assert.equal(mustSay('照你所說，搭捷運約 23 分。', trip), '照你所說，搭捷運約 23 分。', '換句話說也不重複');
  assert.equal(mustSay('捷運 淡水信義線約 23 分。', trip), '照你說的，捷運 淡水信義線約 23 分。', '已經講到方案名稱：只加「照你說的，」');
  assert.equal(mustSay('照你說的改捷運，約 23 分。', trip), '照你說的改捷運，約 23 分。', '已經說了就不重複');
  assert.ok(!mustSay('很快。', { best: 'ridehail', ranking: { reason: '叫車 78 分最高。' }, options: [{ id: 'ridehail', name: '叫車' }] }).includes('照你說的'), '沒有指定方式不加');
});

test('深夜：公車收班或接近末班，模型沒說就補一句', () => {
  assert.match(mustSay('建議叫車，約 25 分', { ranking: {}, skipped: [{ role: 'bus', why: '公車已收班' }], options: [] }), /建議叫車，約 25 分。公車已收班。$/);
  assert.match(mustSay('建議坐公車。', { ranking: {}, options: [{ lastBus: true }] }), /末班快到了/);
  assert.equal(mustSay('公車末班已過，建議叫車。', { ranking: {}, skipped: [{ role: 'bus', why: '公車已收班' }], options: [] }), '公車末班已過，建議叫車。', '已經提到不重複');
  assert.equal(mustSay('白天坐公車就好。', { ranking: {}, options: [] }), '白天坐公車就好。');
  assert.equal(mustSay('沒有行程', null), '沒有行程');
});

test('預先比較的行程也帶判斷層聽懂的方式（與模型呼叫時一致，條件不同才算不同一趟）', async () => {
  const { prefetchCalls, tripKey, groundedPrefs } = await import('../core/agent/model-loop.js');
  const it = { intent: 'trip', to: '台北101' };
  const j = { mode: 'ridehail' };
  const [c] = prefetchCalls(it, j, { lat: 25.04, lon: 121.51, name: '你的位置' });
  assert.equal(c.args.prefs.mode, 'ridehail', '腳受傷想坐計程車：規則沒抓到、判斷層聽懂的也算');
  const f = { lat: 25.04, lon: 121.51 }, t = { lat: 25.034, lon: 121.5645 };
  assert.equal(tripKey(f, t, c.args.prefs), tripKey(f, t, groundedPrefs({}, it, j)), '模型再呼叫時同一趟（沿用、不出兩張卡）');
  assert.notEqual(tripKey(f, t, {}), tripKey(f, t, { mode: 'ridehail' }), '條件不同照常查');
});

test('叫車：付款在叫車 App（阿幫不代付）；訂票：只給官方連結', () => {
  assert.match(mustSay('叫車最快。', { best: 'ridehail', ranking: {}, options: [] }), /付款在叫車 App 完成（阿幫不代付）/);
  assert.equal(mustSay('叫車最快，付款在叫車 App。', { best: 'ridehail', ranking: {}, options: [] }), '叫車最快，付款在叫車 App。');
  assert.match(mustSay('明天 06:03 有一班。', null, { intent: 'rail', book: true, system: 'THSR' }), /官方訂票連結.*高鐵官網/);
});

test('說要叫車：卡片上有叫車才補付款句；叫車選不到不補（PR 審查）', () => {
  const ok = { best: 'bus', options: [{ id: 'bus', role: 'bus', name: '公車 307' }, { id: 'ridehail', role: 'ridehail', name: '叫車（Uber）' }], ranking: {} };
  assert.match(mustSay('搭公車比較快。', ok, { intent: 'trip', mode: 'ridehail' }), /付款在叫車 App 完成/);
  const none = { best: 'bus', modeUnavailable: 'ridehail', options: [{ id: 'bus', role: 'bus', name: '公車 307' }], ranking: {} };
  assert.doesNotMatch(mustSay('叫車這次沒有可行方案，建議搭公車。', none, { intent: 'trip', mode: 'ridehail' }), /付款在叫車/);
  const best = { best: 'ridehail', options: [{ id: 'ridehail', role: 'ridehail', name: '叫車（Uber）' }], ranking: {} };
  assert.equal(mustSay('用叫車 App 叫車，付款也在 App 裡。', best), '用叫車 App 叫車，付款也在 App 裡。', '已經說了就不重複');
});

test('問明天的天氣、模型沒說「明天」：開頭補上（S1-3 模型模式）', () => {
  assert.equal(mustSay('會下雨，降雨機率 70%。', null, { intent: 'weather', tomorrow: true }), '明天的天氣：會下雨，降雨機率 70%。');
  assert.equal(mustSay('明天會下雨，記得帶傘。', null, { intent: 'weather', tomorrow: true }), '明天會下雨，記得帶傘。');
  assert.equal(mustSay('現在沒下雨。', null, { intent: 'weather' }), '現在沒下雨。');
});

test('模型已經說了按「叫車」用官方 App：只補付款那句，不重複（2026-11-21 實機）', () => {
  const best = { best: 'ridehail', options: [{ id: 'ridehail', role: 'ridehail', name: '叫車（Uber）' }], ranking: {} };
  assert.equal(mustSay('建議叫車。要按卡片上的「叫車」用官方 App 叫車哦！', best), '建議叫車。要按卡片上的「叫車」用官方 App 叫車哦！付款在叫車 App 完成（阿幫不代付）。');
  assert.match(mustSay('建議叫車。', best), /按卡片上的「叫車」用官方 App 叫車，付款在叫車 App 完成/);
});
