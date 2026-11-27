// 示範模式意圖（M5-03）：地點擷取、抵達時間、狀態關鍵字、意圖分類；每個建議問題的計畫都能用示範資料完整執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, needsLocation, placesInText, arriveByOf, demoSteps, demoSummary, DEFAULT_FROM, NO_ADVICE } from '../core/agent/demo-intent.js';
import { getProfile } from '../core/agents/index.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const NOW = Date.parse('2026-11-18T08:00:00+08:00');

test('placesInText：依出現順序、長的優先、車站短名', () => {
  assert.deepEqual(placesInText('從西門町到台北 101'), ['西門町', '台北101']);
  assert.deepEqual(placesInText('明天要到左營'), ['高鐵左營站']);
  assert.deepEqual(placesInText('今天天氣如何'), []);
});

test('arriveByOf：點、點半、冒號、下午', () => {
  const early = Date.parse('2026-11-28T07:00:00+08:00'); // 時間還沒過（PM 第二輪：已經過了的會推到下午／晚上）
  assert.deepEqual(['8 點前', '10點半前要到', '9:15 之前', '下午 3 點前', '25 點前', '沒有時間'].map((x) => arriveByOf(x, early)), ['08:00', '10:30', '09:15', '15:00', null, null]);
});

test('parseIntent：意圖、起訖、路線、狀態', () => {
  const c = (q) => parseIntent(q, NOW);
  assert.deepEqual(['intent', 'from', 'to'].map((k) => c('從西門町到台北 101 怎麼去？')[k]), ['trip', '西門町', '台北101']);
  assert.deepEqual(['intent', 'from', 'to', 'arriveBy', 'tomorrow'].map((k) => c('明天 8 點前要到左營')[k]), ['trip', null, '高鐵左營站', '08:00', true]);
  assert.deepEqual(['intent', 'route', 'places'].map((k) => c('307 到哪了？我在臺北車站')[k]), ['bus_route', '307', ['臺北車站']]);
  assert.deepEqual(['intent', 'system', 'from', 'to'].map((k) => c('高鐵台北到台中下一班幾點？')[k]), ['rail', 'THSR', '台北', '台中']);
  assert.equal(c('台北車站附近還有 YouBike 嗎？').intent, 'youbike');
  assert.equal(c('台北車站附近的公車站牌').intent, 'nearby_bus');
  assert.deepEqual(['intent', 'station'].map((k) => c('捷運市政府站下一班')[k]), ['metro', '市政府']);
  assert.deepEqual(c('帶著行李從板橋車站到桃園機場，很趕').states, ['rush', 'luggage']);
  assert.deepEqual(c('下雨了，從台北車站去松山車站怎麼走？').states, ['rain']);
  assert.deepEqual(c('今天空氣很差，從台北車站到台北101').states, ['badAir']);
  assert.equal(c('今天天氣如何').intent, 'weather');
  assert.equal(c('你好').intent, 'unknown');
});

test('parseIntent：生活服務（天氣、空品、地震、藥局、垃圾車、油價、發票）', () => {
  const c = (q) => parseIntent(q, NOW);
  assert.deepEqual(['intent', 'places'].map((k) => c('台中天氣如何？')[k]), ['weather', ['臺中車站']]);
  assert.equal(c('下雨了，從台北車站去松山車站怎麼走？').intent, 'trip', '有起訖時仍是行程');
  assert.equal(c('外面 PM2.5 高嗎').intent, 'aqi');
  assert.equal(c('空氣品質如何').intent, 'aqi');
  assert.deepEqual(['intent', 'county'].map((k) => c('剛剛花蓮縣地震嗎？')[k]), ['quake', '花蓮縣']);
  assert.equal(c('最近有地震嗎').county, undefined);
  assert.equal(c('剛剛地震各縣市震度').county, undefined, '泛稱不是縣市');
  assert.equal(c('花蓮地震了嗎').county, '花蓮');
  assert.deepEqual(['intent', 'area'].map((k) => c('大安區有哪些健保藥局？')[k]), ['pharmacy', '大安區']);
  assert.equal(c('我要找新北市板橋區的藥局').area, '新北市板橋區');
  assert.equal(c('高雄市的藥局').area, '高雄市');
  assert.equal(c('附近藥局').area, undefined);
  assert.equal(c('垃圾車幾點來？').intent, 'garbage');
  assert.equal(c('今天油價多少').intent, 'fuel');
  assert.deepEqual(['intent', 'number'].map((k) => c('發票 12345678 有沒有中？')[k]), ['invoice', '12345678']);
  assert.deepEqual(['intent', 'number'].map((k) => c('這期發票號碼是多少？')[k]), ['invoice', undefined]);
  assert.equal(c('發票末三碼 678 對獎').number, '678');
});

test('parseIntent：股市（名稱、代號、多檔、大盤、問買賣、追問）', () => {
  const c = (q, ...prev) => parseIntent(q, { history: prev.map((content) => ({ role: 'user', content })) });
  assert.deepEqual(['intent', 'query', 'advice'].map((k) => c('台積電股價多少')[k]), ['stock', '台積電', false]);
  assert.equal(c('台積電和0050今天收盤多少？').query, '台積電、0050');
  assert.equal(c('聯發科、鴻海的股價').query, '聯發科、鴻海');
  assert.equal(c('2330 漲了嗎').query, '2330');
  assert.equal(c('台積電漲 5 塊嗎？股價').query, '台積電', '零散的數字不是代號');
  assert.deepEqual(['intent', 'query'].map((k) => c('大盤今天怎麼樣')[k]), ['stock', undefined]);
  assert.deepEqual(['query', 'advice'].map((k) => c('我該買台積電嗎？股票')[k]), ['台積電', true]);
  assert.equal(c('今天油價多少').intent, 'fuel', '油價不是股價');
  assert.equal(c('307 到哪了？我在臺北車站').intent, 'bus_route');
  // 追問：上一題問股市，短句「那 X 呢」「X 呢」或代號接著查；「謝謝」不算；上一題不是股市也不算
  assert.deepEqual(['intent', 'query', 'followUp'].map((k) => c('那聯發科呢？', '台積電股價多少')[k]), ['stock', '聯發科', true]);
  assert.equal(c('0056 呢', '台積電股價多少', '那聯發科呢？').query, '0056', '連續追問');
  assert.equal(c('2454', '台積電股價多少').query, '2454');
  assert.deepEqual(['intent', 'query', 'advice'].map((k) => c('我該買台積電嗎？', '台積電股價多少')[k]), ['stock', '台積電', true]);
  assert.equal(c('我該買傘嗎？').intent, 'unknown', '沒有股市脈絡的「該買」不算');
  assert.equal(c('謝謝', '台積電股價多少').intent, 'unknown');
  assert.equal(c('那聯發科呢？', '今天油價多少').intent, 'unknown');
  assert.equal(c('那聯發科呢？').intent, 'unknown');
});

test('股市計畫與總結：問買賣時先說不提供投資建議；只問大盤回指數', async () => {
  const svc = createServices({ forceMock: true });
  const run = async (q) => { const it = parseIntent(q, NOW); const { results, notes } = await runPlan(svc, demoSteps(it, NOW)); return { it, results, notes, sum: demoSummary(it, results) }; };
  const a = await run('我該買台積電嗎？股票');
  assert.deepEqual(a.notes, ['@股市 查「台積電」的收盤行情']);
  assert.ok(a.sum.startsWith(NO_ADVICE), a.sum);
  assert.match(a.sum, /台積電 11\/18 收 2175/);
  const b = await run('大盤今天怎麼樣');
  assert.deepEqual(b.notes, ['@股市 看一下大盤收盤']);
  assert.match(b.sum, /^加權指數/);
});

/** 依計畫逐段執行（同段平行），回傳依 tool 名稱分組的結果 */
async function runPlan(svc, steps) {
  const results = {};
  const notes = [];
  for (const step of steps) {
    const s = step(results);
    if (!s) break;
    notes.push(s.note);
    const out = await Promise.all(s.calls.map((c) => callTool(svc, c.name, c.args)));
    s.calls.forEach((c, i) => { (results[c.name] ||= []).push(out[i]); });
  }
  return { results, notes };
}

test('每個建議問題的計畫都能用示範資料完整執行，最後有卡片', async () => {
  const svc = createServices({ forceMock: true });
  const want = { trip: 'trip', bus_route: 'bus-route', youbike: 'youbike', rail: 'timetable', nearby_bus: 'nearby', metro: 'metro', pharmacy: 'pharmacy', invoice: 'invoice', weather: 'weather', aqi: 'aqi' };
  for (const q of getProfile().suggestions) {
    const it = parseIntent(q, NOW);
    assert.notEqual(it.intent, 'unknown', q);
    const { results, notes } = await runPlan(svc, demoSteps(it, NOW));
    const last = Object.values(results).flat().at(-1);
    assert.equal(last.card, want[it.intent], q);
    assert.ok(notes.every((n) => n.length <= 30 && n.startsWith('@')), `${q}：${notes}`);
    assert.ok(demoSummary(it, results).length > 5, q);
  }
});

test('行程：使用者狀態與抵達時間帶進 plan_trip；明天用隔天日期；沒起點用預設', async () => {
  const svc = createServices({ forceMock: true });
  const it = parseIntent('明天 8 點前要到左營，帶著行李', NOW);
  const { results } = await runPlan(svc, demoSteps(it, NOW));
  const trip = results.plan_trip[0];
  assert.deepEqual(trip.args.prefs, { states: ['luggage'], arriveBy: '08:00' });
  assert.equal(trip.data.date, '2026-11-19');
  assert.equal(trip.data.from.name, '臺北車站');
  assert.match(demoSummary(it, results), new RegExp(`沒說從哪出發.+${DEFAULT_FROM}`));
});

test('生活服務的計畫都能用示範資料執行；沒說地點時用示範預設並說明', async () => {
  const svc = createServices({ forceMock: true });
  const want = { weather: 'weather', aqi: 'aqi', quake: 'quake', pharmacy: 'pharmacy', garbage: 'garbage', fuel: 'fuel', invoice: 'invoice' };
  for (const q of ['今天天氣如何', '台北101附近的空氣品質', '最近有地震嗎', '大安區有哪些健保藥局？', '附近的藥局', '垃圾車幾點來？', '今天油價多少', '發票 12345678 有沒有中？']) {
    const it = parseIntent(q, NOW);
    const { results, notes } = await runPlan(svc, demoSteps(it, NOW));
    const last = Object.values(results).flat().at(-1);
    assert.equal(last.card, want[it.intent], q);
    assert.ok(notes.every((n) => n.length <= 30 && n.startsWith('@')), `${q}：${notes}`);
    assert.ok(demoSummary(it, results).length > 5, q);
  }
  const w = parseIntent('今天天氣如何', NOW);
  assert.match(demoSummary(w, (await runPlan(svc, demoSteps(w, NOW))).results), new RegExp(`沒說在哪.+${DEFAULT_FROM}`));
  const ph = parseIntent('附近的藥局', NOW);
  const r = (await runPlan(svc, demoSteps(ph, NOW))).results;
  assert.ok(r.pharmacy_search[0].data.pharmacies.length > 0, '預設地區有示範藥局');
  assert.match(demoSummary(ph, r), /沒說哪一區.+臺北市中正區/);
  const near = { ...parseIntent('空氣品質如何', NOW), fromPoint: { name: '你的位置', lat: 25.04, lon: 121.56 } };
  assert.equal(demoSteps(near, NOW).length, 1, '有裝置定位就不查地點');
  assert.doesNotMatch(demoSummary(near, (await runPlan(svc, demoSteps(near, NOW))).results), /沒說在哪/);
});

test('unknown：回覆可以問的範例', () => {
  const s = demoSummary(parseIntent('你好'), {}, getProfile().suggestions);
  assert.match(s, /可以幫你查.+試試看：「/);
});

test('以現在位置為起點：只說目的地或地名就是行程；「會下雨嗎」「空氣好嗎」查現在位置；公車沒說站就找離你最近的站', async () => {
  for (const q of ['去台北101', '想省錢，去台北101', '台北101', '帶行李，松山機場', '到松山機場']) {
    const it = parseIntent(q, NOW);
    assert.equal(it.intent, 'trip', q);
    assert.equal(it.from, null, `${q}：起點用現在位置`);
    assert.ok(needsLocation(it), q);
  }
  assert.deepEqual(['會下雨嗎', '空氣好嗎', '307 到哪了？'].map((q) => { const it = parseIntent(q, NOW); return [it.intent, needsLocation(it)]; }), [['weather', true], ['aqi', true], ['bus_route', true]]);
  assert.equal(parseIntent('我在台北車站', NOW).intent, 'unknown', '只說自己在哪不是行程');

  const svc = createServices({ forceMock: true });
  const it = { ...parseIntent('307 到哪了？', NOW), fromPoint: { lat: 25.0478, lon: 121.517 } };
  const { results } = await runPlan(svc, demoSteps(it, NOW));
  const r = results.bus_route_eta[0];
  assert.equal(r.args.near.lat, 25.0478, '帶現在位置');
  assert.ok(r.data.focus?.nearest, '聚焦最近的站');
  assert.match(r.speak, /^離你最近的是「.+」（約 \d+ 公尺）：307/);
});

test('接著上一輪改交通方式（「改成公車」「我很趕」）：沿用起訖點與狀態，plan_trip 照指定方式選；「不要叫車，改公車」選公車', async () => {
  const history = [{ role: 'user', content: '想省錢，從西門町到台北101' }, { role: 'assistant', content: '選「叫車（Uber）」…' }];
  const it = parseIntent('我想改公車', { ...NOW, history });
  assert.deepEqual([it.intent, it.from, it.to, it.mode, it.followUp], ['trip', '西門町', '台北101', 'bus', true]);
  assert.deepEqual(it.states, ['budget'], '上一輪的狀態沿用');
  assert.equal(parseIntent('不要叫車，改公車', { ...NOW, history }).mode, 'bus');
  assert.deepEqual(parseIntent('我很趕', { ...NOW, history }).states.sort(), ['budget', 'rush']);
  assert.equal(parseIntent('坐公車去台北101', NOW).mode, 'bus', '第一句就指定也算');
  assert.equal(parseIntent('改成公車 601', { ...NOW, history }).intent, 'trip', '點決策圖的公車＝「改成公車 601」，不是查 601 路線');

  const svc = createServices({ forceMock: true });
  const { results } = await runPlan(svc, demoSteps(it, NOW));
  const trip = results.plan_trip[0];
  assert.equal(trip.args.prefs.mode, 'bus');
  const best = trip.data.options.find((o) => o.id === trip.data.best);
  assert.equal(best.role, 'bus', '照你說的選公車');
  assert.match(trip.data.ranking.reason, /^照你說的選「公車/);
  assert.equal(trip.data.mode, 'bus', '前端重算決策圖也照指定方式');
});

test('剛查完行程後問「會下雨嗎」「附近還有 YouBike 嗎」不是改行程', () => {
  const history = [{ role: 'user', content: '從西門町到台北101' }];
  assert.equal(parseIntent('會下雨嗎？', { ...NOW, history }).intent, 'weather');
  assert.equal(parseIntent('附近還有 YouBike 嗎？', { ...NOW, history }).intent, 'youbike');
  assert.equal(parseIntent('那改騎 YouBike 呢', { ...NOW, history }).intent, 'trip');
});

test('規則負面案例：查高鐵、查公車路線、否定、「改天」都不是改行程；沒有前文時不會憑空產生起訖點', () => {
  const history = [{ role: 'user', content: '從西門町到台北101' }, { role: 'assistant', content: '選「叫車」…' }];
  const at = (q, h = history) => parseIntent(q, { ...NOW, history: h });
  assert.equal(at('搭 307 到哪了？').intent, 'bus_route', '「搭」單獨出現不算改交通方式');
  assert.equal(at('趕時間，高鐵台北到台中下一班幾點？').intent, 'rail');
  const no = at('我不想坐公車'); // A3（2026-11-21）：「不想坐 X」＝排除 X（以前不處理），不是改成坐 X
  assert.deepEqual([no.followUp, no.mode, no.avoid], [true, undefined, ['bus']]);
  assert.notEqual(at('改天再說').intent, 'trip');
  assert.notEqual(at('改成明天').mode, 'bus');
  assert.equal(at('不叫車，改走路').mode, 'walk');
  assert.notEqual(at('我很趕', []).followUp, true, '沒有前文');
  assert.notEqual(at('改公車', []).intent, 'trip');
});

test('上下文：多輪疊加交通方式與狀態；阿幫問起點後只回地名＝起點；明講的起點（地標庫沒有）不會被定位蓋掉', () => {
  const h = [
    { role: 'user', content: '從西門町到台北101' }, { role: 'assistant', content: '選「叫車」' },
    { role: 'user', content: '改坐公車' }, { role: 'assistant', content: '照你說的選公車' },
  ];
  const it = parseIntent('我很趕', { ...NOW, history: h });
  assert.deepEqual([it.intent, it.from, it.to, it.mode, it.states.includes('rush')], ['trip', '西門町', '台北101', 'bus', true], '第 2 輪的公車沿用');

  const asked = [{ role: 'user', content: '去台北101' }, { role: 'assistant', content: '請問您要從哪裡出發到台北101呢？' }];
  const o = parseIntent('台北車站', { ...NOW, history: asked });
  assert.deepEqual([o.intent, o.from, o.to], ['trip', '臺北車站', '台北101'], '回答起點');

  const e = parseIntent('從我家巷口到台北101怎麼去', NOW);
  assert.deepEqual([e.intent, e.from, e.to], ['trip', '我家巷口', '台北101']);
  assert.equal(needsLocation(e), false, '明講起點：不用定位');
});
