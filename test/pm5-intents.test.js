// PM 第五批（P5-1～P5-8）探查到的錯：更正地點與出發時間、台語、口語、錯字、英文指代與 YouBike、一句多件事、禮貌話（回歸測試＋誤判反例）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, departTimeOf, normalizeAsk, tripDepartAt, nearestRail, demoSteps, demoSummary } from '../core/agent/demo-intent.js';

const h = (...said) => said.flatMap((t) => [{ role: 'user', content: t }, { role: 'assistant', content: '好' }]);
const NOW = Date.parse('2026-11-21T10:00:00+08:00'); // 台灣時間上午 10 點
const at = (t, ctx = {}) => parseIntent(t, { now: NOW, ...ctx });

test('P5-1：「欸不是啦，我是要去松山機場」改目的地、起點保留；起點更正不受影響', () => {
  const it = at('欸不是啦，我是要去松山機場', { history: h('從西門町去台北101', '不對，我是說從板橋出發') });
  assert.deepEqual([it.intent, it.from, it.to, it.followUp], ['trip', '板橋車站', '臺北松山機場', true]);
  assert.deepEqual(it.changed, ['to']);
  assert.equal(at('不對，我是說從板橋出發', { history: h('從西門町去台北101') }).from, '板橋車站', '說「從」仍是改起點');
  // 反例：沒有前一趟就是新行程（起點用現在位置）；「我是要去哪裡」不是地名
  assert.equal(at('我是要去松山機場').from, null);
  assert.equal(at('我是要去哪裡').intent, 'unknown');
});

test('P5-2：出發時間（今天／明天＋早上／晚上＋幾點、HH:mm）不和抵達時間、相對時間衝突', () => {
  const d = (t) => { const x = departTimeOf(t, null, NOW); return x && { hhmm: x.hhmm, tomorrow: x.tomorrow }; };
  assert.deepEqual(d('明天早上8點從西門町去台北101'), { hhmm: '08:00', tomorrow: true });
  assert.deepEqual(d('晚上8點從西門町去台北101'), { hhmm: '20:00', tomorrow: false });
  assert.deepEqual(d('明天早上八點半出發'), { hhmm: '08:30', tomorrow: true });
  assert.deepEqual(d('今天下午兩點出門'), { hhmm: '14:00', tomorrow: false });
  assert.deepEqual(d('明晚7點出發'), { hhmm: '19:00', tomorrow: true });
  // 沒說哪天：已過的時間往後推（10:00 說「8點出發」＝20:00；「早上8點」已過＝明天；「08:30」是 24 小時制＝明天）
  assert.deepEqual(parseIntent('8點出發去台北101', { now: NOW }).departTime, '20:00');
  assert.deepEqual([at('早上8點出發去台北101').departTime, at('早上8點出發去台北101').tomorrow], ['08:00', true]);
  assert.deepEqual([at('08:30 從板橋出發去台北101').departTime, at('08:30 從板橋出發去台北101').tomorrow], ['08:30', true]);
  // 反例：抵達時間、相對時間、公車「幾點來」、高鐵站名都不是出發時間
  for (const t of ['10點前到台北101', '明天早上8點前要到台大', '下午兩點前到台北101', '10點要到101', '20分鐘後出發去101', '307 幾點來', '明天早上台北到台中的高鐵']) assert.equal(d(t), null, t);
  assert.equal(at('10點前到台北101').arriveBy, '10:00', '抵達時間照舊');
  assert.equal(at('20分鐘內要到台北101').arriveBy, '10:20', '相對時間照舊');
});

test('P5-2：「改成明天早上8點出發」沿用起訖與方式；出發時間進 plan_trip、總結說明天', () => {
  const it = at('改成明天早上8點出發', { history: h('從西門町坐公車去台北101', '不要公車，坐捷運') });
  assert.deepEqual([it.intent, it.from, it.to, it.mode, it.departTime, it.tomorrow], ['trip', '西門町', '台北101', 'metro', '08:00', true]);
  assert.ok(it.changed.includes('departAt'));
  assert.equal(tripDepartAt(it, NOW), '2026-11-22T08:00');
  assert.equal(tripDepartAt(at('晚上8點從西門町去台北101'), NOW), '2026-11-21T20:00');
  assert.equal(tripDepartAt(at('從西門町去台北101'), NOW), '2026-11-21T10:00', '沒說時間＝現在');
  assert.equal(tripDepartAt(at('明天早上8點前要到台大'), NOW), '2026-11-22T06:00', '明天＋抵達時間：抵達前 4 小時，但不早於捷運首班 06:00（PR #110 審查：合成 05:00 會把捷運當收班）');
  const trip = { data: { options: [{ id: 'a', role: 'metro' }], best: 'a', ranking: { reason: '選「捷運」。' }, skipped: [], tips: [] } };
  assert.match(demoSummary(it, { plan_trip: [trip] }), /^明天 08:00 出發：/);
  // 反例：前面沒有行程，「改成明天早上8點出發」不會亂猜目的地
  assert.notEqual(at('改成明天早上8點出發').intent, 'trip');
});

test('P5-3：台語口語先換成華語；不動「足球」「欲望」「揣測」「華佗」', () => {
  assert.equal(normalizeAsk('今仔日足熱，敢會落雨'), '今天很熱，會不會下雨');
  assert.equal(normalizeAsk('307 啥物時陣會來'), '307 什麼時候會來');
  assert.equal(normalizeAsk('歹勢，欲去火車頭按怎坐'), '歹勢，要去火車站怎麼坐');
  for (const t of ['足球場', '欲望', '揣測', '華佗', '滿足']) assert.equal(normalizeAsk(t), t, t);
  assert.equal(at('今仔日足熱，敢會落雨').intent, 'weather');
  assert.deepEqual([at('307 啥物時陣會來').intent, at('307 啥物時陣會來').route], ['bus_route', '307']);
  const it = at('歹勢，欲去火車頭按怎坐');
  assert.deepEqual([it.intent, it.nearRail, it.from], ['trip', 'TRA', null]);
});

test('P5-4：「去火車站怎麼坐」去最近的台鐵站；「今天會很熱嗎」天氣；「307 幾點來」公車', () => {
  const it = at('去火車站怎麼坐');
  assert.deepEqual([it.intent, it.nearRail], ['trip', 'TRA']);
  assert.equal(nearestRail({ lat: 25.0478, lon: 121.517 }).name, '臺北車站');
  assert.equal(nearestRail({ lat: 25.0143, lon: 121.4635 }).name, '板橋車站');
  assert.equal(nearestRail({ lat: 22.6394, lon: 120.3025 }, 'THSR').name, '高鐵左營站');
  assert.equal(at('去高鐵站怎麼坐').nearRail, 'THSR');
  assert.equal(at('從西門町去火車站').from, '西門町');
  // 行程步驟：最近的站當目的地（不查「火車站」這個地名）
  const steps = demoSteps({ ...it, fromPoint: { lat: 25.0143, lon: 121.4635, name: '你的位置' } }, NOW);
  const r = {};
  const calls = steps.map((s) => s(r)).filter(Boolean).flatMap((s) => s.calls);
  assert.ok(!calls.some((c) => c.name === 'find_place'));
  assert.equal(calls.find((c) => c.name === 'plan_trip').args.to, '板橋車站');
  // 反例：說了哪一站照那一站；問班次照查時刻表
  assert.equal(at('去板橋火車站怎麼坐').to, '板橋車站');
  assert.equal(at('去板橋火車站怎麼坐').nearRail, undefined);
  assert.equal(at('台北車站到花蓮的火車幾點').intent, 'rail');
  assert.equal(at('今天會很熱嗎').intent, 'weather');
  assert.deepEqual([at('307 幾點來').intent, at('307 幾點來').route], ['bus_route', '307']);
  assert.notEqual(at('我很熱').intent, 'weather', '只說很熱不是問天氣');
  assert.equal(at('101 幾點來').intent, 'bus_route', '101 幾點來是公車');
  assert.equal(at('去101怎麼走').to, '台北101');
});

test('P5-5：錯字先更正再判斷行程；「松山機常」是松山機場不是松山車站', () => {
  const it = at('台北車戰到西門町');
  assert.deepEqual([it.intent, it.from, it.to], ['trip', '臺北車站', '西門町']);
  const c = at('改去松山機常', { history: h('台北車戰到西門町') });
  assert.deepEqual([c.intent, c.from, c.to], ['trip', '臺北車站', '臺北松山機場']);
  assert.equal(normalizeAsk('捷運西門站下一般'), '捷運西門站下一班');
  assert.equal(at('捷運西門站下一般').intent, 'metro');
  // 「X 到 Y」沒有「怎麼去」也是行程；反例：高鐵、公車問句照舊
  assert.deepEqual([at('台北車站到西門町要多久').from, at('台北車站到西門町要多久').to], ['臺北車站', '西門町']);
  assert.equal(at('台北到台中的高鐵幾點').intent, 'rail', '有高鐵字還是查高鐵');
  assert.equal(at('307 還要多久到台北車站').intent, 'bus_route', '公車問句不是兩地行程');
  assert.equal(normalizeAsk('一般來說'), '一般來說');
});

test('P5-6、P5-7：英文 there＝上一趟目的地；YouBike near X 查那裡附近，不是行程', () => {
  const w = at('Is it raining there?', { history: h('How do I get to Jiufen?') });
  assert.deepEqual([w.intent, w.places], ['weather', ['九份老街']]);
  assert.deepEqual(at('Is it raining there?').places, [], '沒有前一趟：用現在位置');
  for (const [t, p] of [["Any YouBike near Tamsui Fisherman's Wharf?", '淡水漁人碼頭'], ['Is there YouBike near Pier-2?', '駁二藝術特區'], ['YouBike near Taipei 101', '台北101']]) {
    const it = at(t);
    assert.deepEqual([it.intent, it.places[0]], ['youbike', p], t);
  }
  // 反例：騎 YouBike 去那裡是行程；沒說地點是附近查詢
  assert.equal(at('Can I ride a YouBike to Taipei 101?').intent, 'trip');
  assert.equal(at('Any YouBike nearby?').intent, 'youbike');
  assert.equal(at('How do I get to Taipei 101 by YouBike?').intent, 'trip');
});

test('P5-8：一句問好幾件事都查；行程、只有一件事、長抱怨不拆', () => {
  const it = at('307還要多久、會不會下雨、油價多少');
  assert.deepEqual([it.intent, it.route, it.alsoWeather, it.also.map((x) => x.intent)], ['bus_route', '307', true, ['fuel']]);
  const w = at('油價多少、會不會下雨');
  assert.deepEqual([w.intent, w.also.map((x) => x.intent)], ['weather', ['fuel']], '要位置的天氣當主要意圖（先請定位）');
  const s = at('台積電收盤多少？明天會下雨嗎');
  assert.deepEqual([s.intent, s.tomorrow, s.also.map((x) => x.intent), s.also[0].query], ['weather', true, ['stock'], '台積電']);
  // 步驟：公車、油價、天氣三個工具都會叫到
  const steps = demoSteps({ ...it, fromPoint: { lat: 25.0478, lon: 121.517 } }, NOW);
  const names = steps.map((f) => f({})).filter(Boolean).flatMap((x) => x.calls.map((c) => c.name));
  assert.deepEqual(names.sort(), ['bus_route_eta', 'fuel_price', 'weather_now']);
  // 反例：仍是原本的意圖
  assert.equal(at('下雨了，從西門町到台北101').intent, 'trip', '有行程不拆');
  assert.equal(at('等等會不會下雨？順便看 307 還要多久').also, undefined, '公車＋天氣照舊用 alsoWeather');
  assert.equal(at('等等會不會下雨？順便看 307 還要多久').alsoWeather, true);
  assert.equal(at('台積電和 0050 今天收盤多少').intent, 'stock');
  assert.equal(at('台積電和 0050 今天收盤多少').also, undefined);
  assert.equal(at('今天好累喔，早上被老闆罵，我想問一下等一下會不會下雨').also, undefined);
  assert.equal(at('油價多少？').also, undefined);
});

test('P5-8：謝謝、歹勢、👍、🙏 回禮貌話；有其他要求的不算', () => {
  for (const t of ['謝謝阿幫', '謝謝', '感恩', '👍', '🙏', '謝啦～']) {
    const it = at(t);
    assert.deepEqual([it.intent, it.thanks], ['unknown', true], t);
    assert.doesNotMatch(demoSummary(it, {}), /我可以幫你查/, t);
  }
  for (const t of ['歹勢', '不好意思', '拍謝啦']) assert.equal(at(t).sorry, true, t);
  assert.doesNotMatch(demoSummary(at('歹勢'), {}), /我可以幫你查/);
  // 反例：道謝後接著問、道歉後接著問
  assert.equal(at('謝謝你，我要去101').intent, 'trip');
  assert.equal(at('不好意思，請問去101怎麼走').intent, 'trip');
  assert.equal(at('  ？？？ ').thanks, undefined, '只有標點照舊回功能說明');
  assert.equal(at('Thank you!').lang, 'en', '英文道謝照舊用英文');
});

test('審查 1：晚上／今晚／午夜 12 點＝隔天 00:00；明天晚上 12 點＝後天 00:00；中午 12 點不變', () => {
  for (const t of ['晚上12點出發去台北101', '今晚12點從西門町去台北101', '午夜12點出發去101', '半夜十二點出門去101']) {
    const it = at(t);
    assert.deepEqual([it.departTime, it.departDays, tripDepartAt(it, NOW)], ['00:00', 1, '2026-11-22T00:00'], t);
  }
  const d2 = at('明天晚上12點出發去101');
  assert.deepEqual([d2.departTime, tripDepartAt(d2, NOW)], ['00:00', '2026-11-23T00:00']);
  assert.match(demoSummary(d2, { plan_trip: [{ data: { options: [{ id: 'a', role: 'metro' }], best: 'a', ranking: { reason: '選「捷運」。' }, skipped: [], tips: [] } }] }), /^後天 00:00 出發：/);
  assert.deepEqual([at('中午12點出發去101').departTime, at('中午12點出發去101').departDays], ['12:00', 0]);
  assert.equal(at('明天晚上8點出發去101').departTime, '20:00');
});

test('審查 2：一句多件事—「先查、再看」分段，同一段「跟、和」的多個意圖都列，兩條公車都查，有行程時行程優先', () => {
  const k = (t) => { const it = at(t); return [it.intent, ...(it.also || []).map((x) => x.intent)]; };
  assert.deepEqual(k('先查307，再看油價'), ['bus_route', 'fuel']);
  assert.deepEqual(k('我想知道，油價跟天氣，還有地震'), ['weather', 'fuel', 'quake']);
  assert.deepEqual(k('今天天氣，順便油價和發票'), ['weather', 'fuel', 'invoice']);
  const two = at('307 跟 299 還要多久');
  assert.deepEqual([two.route, two.also.map((x) => x.route)], ['307', ['299']]);
  const trip = at('從西門町去台北101要多久，油價多少');
  assert.deepEqual([trip.intent, trip.from, trip.to, trip.also.map((x) => x.intent)], ['trip', '西門町', '台北101', ['fuel']]);
  // 兩條公車：步驟查兩次、總結兩條都說（從結果尾端取回）
  const steps = demoSteps({ ...two, fromPoint: { lat: 25.0478, lon: 121.517 } }, NOW).map((f) => f({})).filter(Boolean).flatMap((x) => x.calls);
  assert.deepEqual(steps.map((c) => c.args.routeName), ['307', '299']);
  const r = { bus_route_eta: [{ speak: '307 約 5 分。' }, { speak: '299 約 8 分。' }] };
  assert.equal(demoSummary({ ...two, fromPoint: { lat: 25, lon: 121 } }, r), '307 約 5 分。 299 約 8 分。');
  // 行程＋油價：總結先講行程、再講油價
  const tr = { plan_trip: [{ data: { options: [{ id: 'a', role: 'metro' }], best: 'a', ranking: { reason: '選「捷運」。' }, skipped: [], tips: [] } }], fuel_price: [{ speak: '92 31.2。' }] };
  assert.match(demoSummary(trip, tr), /^選「捷運」。.*92 31\.2。$/);
  // 反例：股票名稱用「和」連接不拆；行程＋天氣不另外查天氣（行程本來就看）；長抱怨只問天氣
  assert.deepEqual([at('台積電和0050今天收盤多少').query, at('台積電和0050今天收盤多少').also], ['台積電、0050', undefined]);
  assert.equal(at('台積電和0050收盤，還有油價').query, '台積電、0050');
  assert.equal(at('從西門町去台北101，會下雨嗎').also, undefined);
  assert.equal(at('下雨了，從西門町到台北101').intent, 'trip');
  assert.equal(at('今天好累，早上被罵，晚上想去吃好吃的，等一下會不會下雨').also, undefined);
  assert.equal(at('我跟朋友約好了，307還要多久').also, undefined, '只有一件事');
});

test('審查 3：同一句有抵達時間時，出發時間選在抵達之前；推不出就不用', () => {
  const it = at('我要去台北101，8點前要到，7點出發');
  assert.deepEqual([it.arriveBy, it.departTime], ['08:00', '07:00']);
  assert.equal(at('我要去台北101，8點前要到，9點出發').departTime, undefined, '出發晚於抵達：不採用');
  assert.deepEqual([at('晚上9點前到101，7點出發').arriveBy, at('晚上9點前到101，7點出發').departTime], ['21:00', '19:00']);
  assert.equal(departTimeOf('10點前要到，晚上7點出發', '10:00', NOW), null);
});

test('審查 4：禮貌詞開頭後面還有話照常解析；「X點到 Y」是行程（抵達時間）', () => {
  const it = at('謝謝，那299呢', { history: h('307 到哪了') });
  assert.deepEqual([it.intent, it.route], ['bus_route', '299']);
  assert.equal(at('不好意思，307還要多久').route, '307');
  assert.equal(at('謝謝！').thanks, true, '只有道謝照舊');
  const m = at('明天早上8點到台北101');
  assert.deepEqual([m.intent, m.to, m.arriveBy, m.tomorrow], ['trip', '台北101', '08:00', true]);
  const e = at('晚上8點到台北101');
  assert.deepEqual([e.intent, e.arriveBy], ['trip', '20:00']);
  assert.notEqual(at('我8點到了').intent, 'trip', '沒有地名不是行程');
});
