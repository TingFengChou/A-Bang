// 長對話（UX.md §4.17）：舊的輪收成一行摘要、換話題分段、30 分鐘分段（public/js/agent/turn-summary.js，純函式）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnSummary, topicOf, topicBreak, roundLabel, topicText, askedBack, lastTopic, TOPIC_GAP_MS } from '../public/js/agent/turn-summary.js';
import { reminderItems, reminderRef } from '../public/js/reminder-items.js';
import { judgeInfo } from '../core/agent/run.js';
import { pruneLinks, linkReminders, chatTurnFor } from '../public/js/agent/chat-links.js';

const trip = {
  tool: 'plan_trip', card: 'trip',
  data: { from: { name: '西門町' }, to: { name: '台北101' }, best: 'metro', options: [{ id: 'metro', role: 'metro', name: '捷運（板南線轉淡水信義線）', minutes: 22 }, { id: 'bus-601', role: 'bus', name: '公車 601', minutes: 32 }] },
};
const decision = { best: 'metro', options: trip.data.options };

test('摘要：行程＝起訖＋決定的方式與分鐘（決策圖重算後跟著變）', () => {
  const s = turnSummary({ q: '從西門町到台北101怎麼去', results: [{ tool: 'find_place', data: [{ name: '西門町' }] }, trip], decision });
  assert.equal(s.line, '西門町 → 台北101：捷運 22 分');
  assert.equal(s.decided, '決定：捷運');
  assert.equal(s.rest, '22 分');
  assert.equal(s.short, '台北101');
  assert.equal(roundLabel(3, s, false), '第 3 輪：西門町到台北101，捷運 22 分，已收起');
  assert.equal(roundLabel(3, s, true), '第 3 輪：西門町到台北101，捷運 22 分，已展開');
  assert.equal(roundLabel(3, s, null), '第 3 輪：西門町到台北101，捷運 22 分', '目錄不說狀態');
  const picked = turnSummary({ q: 'x', results: [trip], decision, best: 'bus-601' });
  assert.equal(picked.line, '西門町 → 台北101：公車 601 32 分', '使用者在決策圖上改了：用圖上現在選的');
  const none = turnSummary({ q: 'x', results: [{ ...trip, data: { ...trip.data, best: null } }] });
  assert.equal(none.line, '西門町 → 台北101：找不到可行方式');
  assert.equal(none.decided, null);
});

test('摘要：公車（聚焦的站、沒聚焦時最快到的站、沒有車）', () => {
  const focus = turnSummary({ q: '307 到敦化市場', results: [{ tool: 'bus_route_eta', data: { routeName: '307', focus: { stopName: '敦化市場', statusText: '3 分', etaSec: 190 }, directions: [] } }] });
  assert.equal(focus.line, '307：敦化市場 3 分到站');
  assert.equal(focus.short, '307');
  const any = turnSummary({ q: '307', results: [{ tool: 'bus_route_eta', data: { routeName: '307', directions: [{ stops: [{ stopName: 'A', etaSec: 400, statusText: '6 分' }, { stopName: 'B', etaSec: 100, statusText: '即將進站' }] }] } }] });
  assert.equal(any.line, '307：B 即將進站');
  const none = turnSummary({ q: '307', results: [{ tool: 'bus_route_eta', data: { routeName: '307', directions: [{ stops: [{ stopName: 'A', etaSec: null }] }] } }] });
  assert.equal(none.line, '307：目前沒有車要來');
});

test('摘要：捷運、天氣、空品、發票、股市、防詐', () => {
  const metro = turnSummary({ q: '台北車站下一班', results: [{ tool: 'metro_live_board', data: { station: '台北車站', trains: [{ destination: '南港展覽館', etaMin: 1, status: 'approaching' }] } }] });
  assert.equal(metro.line, '台北車站捷運：往南港展覽館 即將進站');
  const w = turnSummary({ q: '天氣', results: [{ tool: 'find_place', data: [{ name: '中正紀念堂' }] }, { tool: 'weather_now', data: { town: '中正區', station: '臺北', tempC: 17, rainMm1h: 0, raining: false } }] });
  assert.equal(w.line, '天氣：中正區 17°C 沒下雨', '找地點只是輔助，不當主題');
  assert.equal(w.short, '天氣');
  const rain = turnSummary({ q: '天氣', results: [{ tool: 'weather_now', data: { town: '中正區', tempC: 17, rainMm1h: 2 } }] });
  assert.match(rain.line, /下雨$/);
  const aqi = turnSummary({ q: '空品', results: [{ tool: 'aqi_nearby', data: { nearest: { site: '萬華', aqi: 58, status: '普通', level: 'moderate' } } }] });
  assert.equal(aqi.line, '空品：萬華 AQI 58 普通');
  const inv = turnSummary({ q: '發票', results: [{ tool: 'invoice_lottery', data: { period: { title: '115年 07~08月', special: '89996565' } } }] });
  assert.equal(inv.line, '發票：115年 07~08月 特別獎 89996565');
  const won = turnSummary({ q: '對獎', results: [{ tool: 'invoice_lottery', data: { period: {}, check: { prize: '六獎' } } }] });
  assert.equal(won.line, '發票：中了六獎');
  const stk = turnSummary({ q: '台積電', results: [{ tool: 'stock_quote', data: { quotes: [{ name: '台積電', close: 2000, change: -100, changePct: -4.76 }], indices: [] } }] });
  assert.equal(stk.line, '股市：台積電 收 2000，跌 4.76%');
  assert.equal(stk.short, '台積電');
  const idx = turnSummary({ q: '大盤', results: [{ tool: 'stock_quote', data: { quotes: [], indices: [{ name: '加權指數', close: 36033.29, change: 120, changePct: 0.33 }] } }] });
  assert.equal(idx.line, '股市：大盤 收 36033.29，漲 0.33%');
  const scam = turnSummary({ q: '這是詐騙嗎', results: [{ tool: 'scam_check_message', card: 'scam-risk', data: { level: 'high', findings: [], urls: [] } }] });
  assert.equal(scam.line, '防詐：高風險');
  assert.equal(scam.short, '防詐');
});

test('摘要：只有文字（閒聊、答不出來）用提問＋回答第一句；一句兩件事合在一行', () => {
  const s = turnSummary({ q: '謝謝', results: [], text: '不客氣！還想查什麼隨時跟我說。' });
  assert.equal(s.line, '謝謝：不客氣！');
  assert.equal(s.short, '謝謝');
  assert.equal(turnSummary({ q: '在嗎', text: '' }).line, '在嗎：沒有回答');
  const long = turnSummary({ q: '請幫我查一下從台北車站到台中車站最便宜的方法是什麼呢', text: '（您沒說時間，我先用現在。）好的，我幫您比較了高鐵、台鐵與客運三種方式。' });
  assert.ok([...long.title].length <= 16, '提問太長截短');
  assert.match(long.detail, /^好的/, '回答開頭的括號說明略過');
  const two = turnSummary({ q: '307 到哪了，會下雨嗎', results: [{ tool: 'bus_route_eta', data: { routeName: '307', focus: { stopName: '敦化市場', statusText: '5 分', etaSec: 300 } } }, { tool: 'weather_now', data: { town: '大安區', tempC: 20, raining: false } }] });
  assert.equal(two.line, '307：敦化市場 5 分到站・天氣：大安區 20°C 沒下雨');
  assert.equal(two.short, '307');
  const busMetro = turnSummary({ q: '307 和捷運', results: [{ tool: 'bus_route_eta', data: { routeName: '307', focus: { stopName: 'A', statusText: '5 分', etaSec: 300 } } }, { tool: 'metro_live_board', data: { station: '市政府', trains: [{ destination: '頂埔', etaMin: 3, status: 'minutes' }] } }] });
  assert.equal(busMetro.line, '307：A 5 分到站・市政府捷運：往頂埔 3 分', '同是交通的兩件事也都留著');
  const unknown = turnSummary({ q: '油價', results: [{ tool: 'some_new_tool', speak: '新工具查好了。還有別的。' }] });
  assert.equal(unknown.line, '新工具查好了。', '認不得的工具：用工具一句話回報的第一句');
});

test('摘要：英文那一輪用英文', () => {
  const s = turnSummary({ q: 'How do I get to Taipei 101', results: [trip], decision, lang: 'en' });
  assert.equal(s.line, '西門町 → 台北101: MRT 22 min');
  assert.equal(s.decided, 'Pick: MRT');
  assert.equal(roundLabel(2, s, false, 'en'), 'Turn 2: 西門町 to 台北101, MRT 22 min, collapsed');
  const bus = turnSummary({ q: 'bus 307', results: [{ tool: 'bus_route_eta', data: { routeName: '307', focus: { stopName: '敦化市場', statusText: '3 分', etaSec: 190 } } }], lang: 'en' });
  assert.equal(bus.line, 'Bus 307: 敦化市場 in 3 min');
  const w = turnSummary({ q: 'weather', results: [{ tool: 'weather_now', data: { town: '中正區', tempC: 17, raining: false } }], lang: 'en' });
  assert.equal(w.line, 'Weather: 17°C no rain');
  assert.equal(w.short, 'Weather');
  assert.equal(topicText(new Date(2026, 10, 21, 22, 40).getTime(), 'en'), 'New topic · 22:40');
});

test('換話題：類別不同才分段（交通類同一個話題）；接著問、只有文字不算；超過 30 分鐘一定分段', () => {
  const at = new Date(2026, 10, 21, 22, 0).getTime();
  assert.equal(topicOf({ results: [{ tool: 'find_place' }, { tool: 'weather_now' }, { tool: 'plan_trip' }] }), 'transit', '行程裡的天氣不算天氣話題');
  // 產品負責人 2026-11-21：行程、公車、捷運、高鐵台鐵、YouBike 都是交通，同一個話題（問完去 101 再問 307 不分段）
  for (const tool of ['plan_trip', 'bus_route_eta', 'bus_nearby_stations', 'metro_live_board', 'thsr_timetable', 'tra_timetable', 'youbike_nearby', 'ridehail_link']) assert.equal(topicOf({ results: [{ tool }] }), 'transit', tool);
  for (const intent of ['trip', 'bus_route', 'nearby_bus', 'youbike', 'metro', 'rail']) assert.equal(topicOf({ results: [], intent }), 'transit', intent);
  assert.equal(topicBreak({ topic: topicOf({ results: [{ tool: 'plan_trip' }] }), at }, { topic: topicOf({ results: [{ tool: 'bus_route_eta' }] }), at: at + 60e3 }), false, '去 101 → 問 307：不分段');
  assert.equal(topicOf({ results: [{ tool: 'aqi_nearby' }] }), 'weather', '天氣、空品同一類');
  assert.equal(topicOf({ results: [{ tool: 'outing_advice' }] }), 'weather', '出門建議也是天氣類');
  assert.equal(topicOf({ results: [], intent: 'aqi' }), 'weather', '還沒有結果：先用判斷層的意圖');
  assert.equal(topicBreak({ topic: 'transit', at }, { topic: 'weather', at: at + 60e3 }), 'topic', '交通 → 天氣：分段');
  assert.equal(topicOf({ results: [], intent: 'unknown' }), null);
  assert.equal(topicOf({ results: [{ tool: 'scam_lookup_url' }], profile: 'antifraud' }), 'scam');
  assert.equal(topicBreak({ topic: 'trip', at }, { topic: 'bus', at: at + 60e3 }), 'topic');
  assert.equal(topicBreak({ topic: 'trip', at }, { topic: 'trip', at: at + 60e3 }), false);
  assert.equal(topicBreak({ topic: 'trip', at }, { topic: 'weather', at: at + 60e3, follow: true }), false, '從「接下來可以」點的、沿用起訖點：接著問');
  assert.equal(topicBreak({ topic: 'trip', at }, { topic: null, at: at + 60e3 }), false, '只有文字（謝謝）不分段');
  assert.equal(topicBreak({ topic: null, at }, { topic: 'bus', at: at + 60e3 }), false);
  assert.equal(topicBreak({ topic: 'trip', at }, { topic: 'trip', at: at + TOPIC_GAP_MS + 1 }), 'time', '超過 30 分鐘');
  assert.equal(topicBreak({ topic: 'trip', at }, { topic: 'trip', at: at + TOPIC_GAP_MS }), false, '剛好 30 分鐘不分');
  assert.equal(topicBreak({ topic: 'trip', at }, { topic: null, at: at + 31 * 60e3, follow: true }), 'time', '隔很久，接著問也分段');
  assert.equal(topicBreak(null, { topic: 'bus', at }), false, '第一輪不分');
  assert.equal(topicText(new Date(2026, 10, 21, 22, 40).getTime()), '新的話題・22:40');
});

test('阿幫反問您（還沒回答）：結尾問號、沒有卡片', () => {
  assert.equal(askedBack({ text: '您要從哪裡出發？', results: [] }), true);
  assert.equal(askedBack({ text: '選公車。要不要設提醒？', results: [{ tool: 'plan_trip', card: 'trip' }] }), false, '有卡片＝已經答了');
  assert.equal(askedBack({ text: '好的。', results: [] }), false);
});

test('提醒清單每筆有 ref（提醒頁「看當時的對話」用）', () => {
  const now = new Date(2026, 10, 21, 8, 0).getTime();
  const items = reminderItems({ arrival: { routeName: '307', stop: '敦化市場', minutes: 3 }, alight: { routeName: '601', dest: '市府' }, leave: [{ id: 'r1', at: now + 60e3, text: '該出門了：捷運' }], now });
  assert.deepEqual(items.map((x) => x.ref), ['alight|601|市府', 'arrival|307|敦化市場', 'leave|r1']);
  assert.equal(reminderRef({ kind: 'arrival', routeName: '307', stop: '敦化市場' }), 'arrival|307|敦化市場');
});

// PR #109 審查修正
test('審查 1：判斷層的 followUp 帶到前端（接著改不分段）', () => {
  assert.equal(judgeInfo({ intent: 'trip', source: 'rules', followUp: true }).followUp, true);
  assert.equal('followUp' in judgeInfo({ intent: 'trip', source: 'embed', confidence: 0.9 }), false);
});

test('審查 6：「阿幫問您」還開著也算反問（這一輪先不收）', () => {
  assert.equal(askedBack({ text: '選捷運。', results: [{ tool: 'plan_trip', card: 'trip' }], askOpen: () => true }), true);
  assert.equal(askedBack({ text: '選捷運。', results: [{ tool: 'plan_trip', card: 'trip' }], askOpen: () => false }), false, '答過或略過');
});

test('審查 7：換話題往前找最近有話題的輪（行程 → 謝謝 → 天氣 要分段）', () => {
  const at = Date.now();
  const list = [{ n: 1, topic: 'transit', at }, { n: 2, topic: null, at }];
  assert.equal(lastTopic(list).n, 1);
  assert.equal(topicBreak(lastTopic(list), { topic: 'weather', at }), 'topic');
  assert.equal(lastTopic([{ topic: null }]), null);
});

test('審查 5：提醒連結只連 10 分鐘內操作過的那一輪；取消就拿掉', async () => {
  const map = new Map([['arrival|307|A', 1], ['leave|r1', 2], ['leave|r2', 3]]);
  pruneLinks(map, 'leave', ['leave|r2']);
  assert.deepEqual([...map.keys()], ['arrival|307|A', 'leave|r2'], '出門提醒取消或響完：拿掉');
  pruneLinks(map, 'arrival', []);
  assert.deepEqual([...map.keys()], ['leave|r2'], '到站提醒取消（事件 null）');
  let touched = null;
  let k = 0;
  const host = { remind: async () => `r${++k}`, watchArrival: async () => true };
  const clear = linkReminders(host, { recent: () => touched, has: () => true });
  const id1 = await host.remind('10:00', '該出門了');
  assert.equal(chatTurnFor(`leave|${id1}`), null, '沒有在對話裡操作過：不連（不猜最新一輪）');
  touched = { n: 4, view: {} };
  const id2 = await host.remind('10:05', '該出門了');
  assert.equal(chatTurnFor(`leave|${id2}`), 4);
  clear();
  assert.equal(chatTurnFor(`leave|${id2}`), null, '清除本機資料');
});
