// 「接下來可以…」（public/js/agent/next-steps.js）：依這一輪結果推導下一步建議
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSteps } from '../public/js/agent/next-steps.js';

const busFocus = { tool: 'bus_route_eta', card: 'bus-route', data: { city: 'Taipei', routeName: '601', focus: { stopName: '民生捷運站(1號出口)', direction: 0, status: 0, etaSec: 300 } } };
const trip = { tool: 'plan_trip', card: 'trip', data: { from: { name: '西門町' }, to: { name: '台北101' }, states: [{ key: 'budget' }] } };

test('選公車：到站提醒、開公車頁優先；已在提醒就不再建議提醒', () => {
  const s = nextSteps([trip, busFocus], { states: [{ key: 'budget' }] });
  assert.deepEqual(s.map((x) => x.label), ['到站前 3 分提醒我', '上車後提醒我下車', '我很趕', '回程怎麼走？']);
  assert.deepEqual(s[0].payload, { city: 'Taipei', routeName: '601', stop: '民生捷運站(1號出口)', direction: 0, minutes: 3 });
  assert.match(s[1].payload, /^#\/bus\/Taipei\/601\?stop=.+&dir=0&alight=1$/, '行程中模式：到公車頁直接選下車站');
  const ridingNow = nextSteps([trip, busFocus], null, { riding: { routeName: '601' } });
  assert.ok(ridingNow.some((x) => x.label === '開公車頁看動態') && !ridingNow.some((x) => x.label === '上車後提醒我下車'), '已在坐車中：改回開公車頁');
  const noBus = nextSteps([{ ...busFocus, data: { ...busFocus.data, focus: { ...busFocus.data.focus, status: 3, etaSec: null } } }], null);
  assert.ok(!noBus.some((x) => x.label === '上車後提醒我下車'), '末班已過或沒有車：不建議');
  const watching = nextSteps([trip, busFocus], null, { watching: { routeName: '601', stop: '民生捷運站(1號出口)' } });
  assert.ok(!watching.some((x) => x.kind === 'remind'));
});

test('行程（不是公車）：決策圖還沒有的狀態、回程、目的地天氣；已有的狀態不重複', () => {
  const s = nextSteps([{ ...trip, data: { ...trip.data, states: [] } }], { states: [{ key: 'rush' }] });
  assert.deepEqual(s.map((x) => [x.label, x.kind]), [['想省錢', 'state'], ['少走路', 'state'], ['回程怎麼走？', 'ask'], ['台北101天氣如何？', 'ask']]);
  assert.equal(s[2].payload, '從台北101到西門町怎麼去？');
});

test('股市、發票、天氣：各自的下一步；沒有結果回空陣列（畫面改回一般建議）', () => {
  const st = nextSteps([{ tool: 'stock_quote', card: 'stock', data: { quotes: [{ name: '台積電', similar: [] }] } }], null);
  assert.deepEqual(st.map((x) => x.label), ['看大盤', '那0050呢？', '那聯發科呢？', '那鴻海呢？']);
  assert.deepEqual(nextSteps([{ tool: 'invoice_lottery', card: 'invoice', data: {} }], null).map((x) => x.kind), ['navigate', 'ask']);
  assert.deepEqual(nextSteps([{ tool: 'weather_now', card: 'weather', data: {} }], null).map((x) => x.label), ['空氣品質呢？', '明天會下雨嗎？']);
  assert.deepEqual(nextSteps([], null), []);
});

test('PM 第二輪審查：起點是「您的位置」不給「回程怎麼走？」（原本會排成 101 到 101）', async () => {
  const { nextSteps } = await import('../public/js/agent/next-steps.js');
  const trip = { tool: 'plan_trip', data: { from: { name: '您的位置' }, to: { name: '台北101' }, options: [{ id: 'a', role: 'metro' }], best: 'a' } };
  const s = nextSteps([trip], null, {});
  assert.ok(!s.some((x) => x.label === '回程怎麼走？'), s.map((x) => x.label).join('、'));
  assert.ok(s.some((x) => x.label === '台北101天氣如何？'));
});

test('決策圖重算改推叫車：行程自動跟的那一路公車不再給提醒；圖上已選的狀況不再給（設計第三輪 #1 後續）', () => {
  const t = { ...trip, data: { ...trip.data, best: 'bus-601', options: [{ id: 'bus-601', role: 'bus', follow: { city: 'Taipei', routeName: '601', stop: '民生捷運站(1號出口)' } }, { id: 'ridehail', role: 'ridehail' }] } };
  const before = nextSteps([t, busFocus], { states: [{ key: 'budget' }] });
  assert.equal(before[0].label, '到站前 3 分提醒我', '原本推公車');
  const after = nextSteps([t, busFocus], { states: [{ key: 'budget' }] }, { current: { best: 'ridehail', states: [{ key: 'rush', source: 'picked' }] } });
  assert.ok(!after.some((x) => /提醒我|公車頁/.test(x.label)), after.map((x) => x.label).join('、'));
  assert.ok(!after.some((x) => x.label === '我很趕'), '已選了趕時間');
  assert.ok(after.some((x) => x.label === '回程怎麼走？'));
  const back = nextSteps([t, busFocus], { states: [{ key: 'budget' }] }, { current: { best: 'bus-601', states: [] } });
  assert.equal(back[0].label, '到站前 3 分提醒我', '切回公車：照舊');
  const other = { ...busFocus, data: { ...busFocus.data, routeName: '307' } }; // 另外問的公車（不是行程跟的那一路）照舊
  assert.equal(nextSteps([t, other], {}, { current: { best: 'ridehail', states: [] } })[0].label, '到站前 3 分提醒我');
});
