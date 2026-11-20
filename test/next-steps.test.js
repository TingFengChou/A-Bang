// 「接下來可以…」（public/js/agent/next-steps.js）：依這一輪結果推導下一步建議
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSteps } from '../public/js/agent/next-steps.js';

const busFocus = { tool: 'bus_route_eta', card: 'bus-route', data: { city: 'Taipei', routeName: '601', focus: { stopName: '民生捷運站(1號出口)', direction: 0, status: 0, etaSec: 300 } } };
const trip = { tool: 'plan_trip', card: 'trip', data: { from: { name: '西門町' }, to: { name: '台北101' }, states: [{ key: 'budget' }] } };

test('選公車：到站提醒、開公車頁優先；已在提醒就不再建議提醒', () => {
  const s = nextSteps([trip, busFocus], { states: [{ key: 'budget' }] });
  assert.deepEqual(s.map((x) => x.label), ['到站前 3 分提醒我', '開公車頁看動態', '我很趕', '回程怎麼走？']);
  assert.deepEqual(s[0].payload, { city: 'Taipei', routeName: '601', stop: '民生捷運站(1號出口)', direction: 0, minutes: 3 });
  assert.match(s[1].payload, /^#\/bus\/Taipei\/601\?stop=/);
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
