// 首頁「今天」卡（主動助手第一版，Claude 與 Antigravity 第十三輪）與「阿幫記得你」的純函式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayPlan, dayKind, weatherTips, dayPart } from '../public/js/today.js';
import { memoryRows } from '../public/js/memory-sheet.js';

// 台灣時間 → 毫秒（月份 1 起算）
const tw = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h - 8, min);
const TUE_8 = tw(2026, 12, 1, 8); // 週二早上
const TUE_18 = tw(2026, 12, 1, 18);
const SAT_10 = tw(2026, 11, 28, 10);
const NIGHT = tw(2026, 12, 1, 23, 30);
const HOME_WORK = { 家: { name: '家' }, 公司: { name: '台北101' } };
const sunny = { tempC: 24, pop3h: 10, raining: false, rainMm1h: 0 };
const okAir = { nearest: { aqi: 40, status: '良好' } };

test('還沒看完使用說明：不顯示（不跟引導搶）', () => {
  assert.deepEqual(todayPlan({ onboarded: false }), { show: false });
});

test('上班日早上、設了家和公司：通勤版，第一個按鈕是「今天怎麼去公司」', () => {
  const p = todayPlan({ now: TUE_8, day: { workday: true, known: true }, weather: sunny, aqi: okAir, places: HOME_WORK });
  assert.equal(p.tier, 'commute');
  assert.equal(p.date, '12/1（二）');
  assert.equal(p.kind.label, '上班日');
  assert.match(p.say, /^早安！上班日。出門前看一下怎麼去公司最快。$/);
  assert.equal(p.acts[0].label, '今天怎麼去公司');
  assert.equal(decodeURIComponent(p.acts[0].href), '#/agent?q=去公司怎麼走最快？');
  assert.equal(p.acts[0].primary, true);
  assert.equal(p.basis, '依據：台北車站附近・家、公司・辦公日曆');
});

test('只設了學校：通勤去學校', () => {
  const p = todayPlan({ now: TUE_8, weather: sunny, places: { 家: {}, 學校: {} } });
  assert.equal(p.tier, 'commute');
  assert.equal(p.acts[0].label, '今天怎麼去學校');
});

test('補班日（週六但日曆說上班）、連假（週二但日曆說放假）', () => {
  const sat = todayPlan({ now: SAT_10 - 3 * 3600e3, day: { workday: true, known: true }, weather: sunny, places: HOME_WORK });
  assert.equal(sat.kind.label, '補班日');
  assert.match(sat.say, /今天要補班/);
  const off = todayPlan({ now: TUE_8, day: { workday: false, known: true, note: '行憲紀念日' }, weather: sunny, places: HOME_WORK });
  assert.equal(off.kind.label, '放假・行憲紀念日');
  assert.match(off.say, /今天放假（行憲紀念日）。台北車站附近天氣不錯，出去走走吧。/);
  assert.doesNotMatch(off.acts.map((a) => a.label).join(), /公司/, '放假不叫人去上班');
});

test('日曆查不到：照星期推，不說補班', () => {
  assert.deepEqual(dayKind(null, 6), { work: false, weekend: true, label: '週末', known: false });
  assert.deepEqual(dayKind(null, 2), { work: true, weekend: false, label: '上班日', known: false });
  assert.equal(dayKind({ workday: true, known: false }, 6).label, '上班日', '不確定就不說補班');
  assert.equal(todayPlan({ now: TUE_8, weather: sunny }).basis.includes('辦公日曆'), false);
});

test('週末：好天氣建議出去走走；下雨或空品不好說待在室內也不錯', () => {
  const nice = todayPlan({ now: SAT_10, weather: sunny, aqi: okAir, area: { county: '臺北市', town: '大安區' } });
  assert.equal(nice.say, '早安！週末。臺北市大安區天氣不錯，出去走走吧。');
  assert.equal(nice.acts[0].label, '今天適合出門嗎');
  const wet = todayPlan({ now: SAT_10, weather: { ...sunny, raining: true, pop3h: 80 } });
  assert.match(wet.say, /待在室內也不錯/);
  assert.equal(wet.tips[0].icon, 'umbrella');
});

test('上班日傍晚：回家；深夜：末班車', () => {
  const eve = todayPlan({ now: TUE_18, weather: sunny, places: HOME_WORK });
  assert.equal(eve.acts[0].label, '回家怎麼走');
  assert.match(eve.say, /^晚安！辛苦了。回家前看一下車。$/);
  const late = todayPlan({ now: NIGHT, weather: sunny, places: HOME_WORK });
  assert.deepEqual(late.acts.map((a) => a.label), ['捷運幾點收班', '回家怎麼走最快']);
  assert.match(late.say, /^晚安！晚了，留意末班車。$/);
});

test('沒設常用地點：輕量版照樣有建議，另外邀請設定家和公司（新手不會看到空卡）', () => {
  const p = todayPlan({ now: TUE_8, weather: sunny });
  assert.equal(p.tier, 'light');
  assert.equal(p.acts[0].label, '捷運下一班幾分');
  assert.equal(p.acts[1].href, '#/settings');
  assert.match(p.acts[1].label, /設家和公司/);
});

test('天氣提醒：下雨帶傘也照顧騎車的人；查不到不說成沒下雨', () => {
  assert.match(weatherTips({ rainMm1h: 2 }).tips[0].text, /正在下雨.*雨衣/);
  assert.match(weatherTips({ raining: true, pop3h: 70 }).tips[0].text, /可能會下雨（70%）.*雨衣/);
  assert.deepEqual(weatherTips({ pop3h: 40 }).tips[0], { icon: 'umbrella', text: '降雨 40%：包包放把折傘' });
  assert.match(weatherTips({ rainKnown: false }).tips[0].text, /下不下雨這次查不到/);
  assert.equal(weatherTips({ pop3h: 10 }).tips.length, 0, '好天氣不硬塞提醒');
  assert.match(weatherTips({ tempC: 33.4 }).tips[0].text, /33°C 很熱/);
  assert.match(weatherTips({ tempC: 12 }).tips[0].text, /偏冷/);
  const air = weatherTips({ tempC: 20 }, { nearest: { aqi: 135 } });
  assert.equal(air.bad, true);
  assert.match(air.tips[0].text, /AQI 135.*口罩/);
  assert.match(weatherTips(null).tips[0].text, /這次查不到（不是沒有/);
  assert.match(weatherTips(null, null, { offline: true }).tips[0].text, /離線中/);
  assert.equal(weatherTips({ rainMm1h: 1, tempC: 35 }, { nearest: { aqi: 150 } }).tips.length, 3);
});

test('還在查天氣：不先下結論', () => {
  const p = todayPlan({ now: SAT_10, loading: true });
  assert.equal(p.say, '早安！週末。我在看天氣…');
  assert.equal(p.tips.length, 0);
});

test('依據：有定位說「你的位置」、有預設地區說那一區', () => {
  assert.match(todayPlan({ now: TUE_8, weather: sunny, located: true }).basis, /^依據：你的位置/);
  assert.match(todayPlan({ now: TUE_8, weather: sunny, area: { county: '新北市', town: '板橋區' } }).basis, /^依據：新北市板橋區/);
});

test('時段切法', () => {
  assert.deepEqual([4, 5, 9, 10, 15, 16, 20, 21, 0].map(dayPart), ['late', 'morning', 'morning', 'day', 'day', 'evening', 'evening', 'late', 'late']);
});

test('阿幫記得你：列出記得的每一項，可以一項一項忘掉；什麼都沒記就是空的', () => {
  assert.deepEqual(memoryRows({}), []);
  const rows = memoryRows({
    places: { 家: { name: '家' }, 公司: { name: '台北101' } },
    area: { county: '臺北市', town: '大安區' },
    habits: { total: 7, confirmed: ['metro'], usual: ['rush'] },
    chat: [{}, {}],
    reminders: 2,
  });
  assert.deepEqual(rows.map((r) => r.id), ['place:家', 'place:公司', 'area', 'habit:metro', 'usual:rush', 'picks', 'chat', 'reminders']);
  assert.equal(rows[1].sub, '台北101');
  assert.equal(rows[3].title, '優先推捷運');
  assert.equal(rows[4].title, '常趕時間');
  assert.match(rows[5].sub, /沒有地點/);
  assert.equal(rows[7].forget, undefined, '提醒在提醒頁管理');
});

test('主畫面小工具「阿幫・今天」：只送文字（日子、一句話、兩個提醒、時間），不送依據與地點', async () => {
  const { widgetPayload, pushTodayWidget } = await import('../public/js/today-widget.js');
  const p = todayPlan({ now: TUE_8, day: { workday: true, known: true }, weather: { ...sunny, raining: true, pop3h: 80, tempC: 33 }, aqi: { nearest: { aqi: 120 } }, places: HOME_WORK, area: { county: '臺北市', town: '大安區' } });
  const w = widgetPayload(p, TUE_8 + 5 * 60e3);
  assert.deepEqual(Object.keys(w), ['title', 'kind', 'say', 'tip1', 'tip2', 'updated']);
  assert.equal(w.title, '阿幫・今天 12/1（二）');
  assert.equal(w.kind, '上班日');
  assert.match(w.tip1, /可能會下雨/);
  assert.match(w.tip2, /33°C 很熱/);
  assert.equal(w.updated, '08:05');
  assert.doesNotMatch(JSON.stringify(w), /大安區|依據|台北101|25\.|121\./, '不送地點與依據');
  assert.equal(widgetPayload({ show: false }), null);
  assert.equal(await pushTodayWidget(p), false, '網頁版、node：什麼都不做');
});
