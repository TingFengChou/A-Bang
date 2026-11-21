// 「接下來可以…」：每一輪回答後，輸入框上方的建議換成依這一輪結果推導的下一步（使用者回饋：一開始的通用範例不適合一直留著）。
// 純函式：只看這一輪的工具結果（卡片資料）與決策，回傳建議；畫面（agent.js）決定怎麼執行。
//   kind：ask＝送出一句話、remind＝到站提醒（host.watchArrival）、navigate＝開 App 內頁面、state＝在決策圖加狀態（瀏覽器重算，不呼叫伺服器）
const STATE_LABEL = { rush: '我很趕', budget: '想省錢', lessWalk: '少走路', luggage: '帶行李' };
const STATE_LABEL_EN = { rush: 'In a hurry', budget: 'On a budget', lessWalk: 'Less walking', luggage: 'With luggage' }; // 與卡片字典 en.js trip.stateKey 相同
const POPULAR_STOCKS = ['台積電', '0050', '聯發科', '鴻海'];
const short = (s) => String(s || '').replace(/（.*?）|\(.*?\)/g, '').trim();

/**
 * @param {Array<{ tool: string, card?: string|null, data: any, args?: object }>} results 這一輪成功的工具結果（依出現順序）
 * @param {{ states?: Array<{ key: string, on?: boolean }> } | null} decision 這一輪的 decision 事件（有行程時）
 * @param {{ watching?: { routeName: string, stop: string } | null, lang?: 'en' }} [ctx] 目前的到站提醒（已設定就不再建議）；lang：英文那一輪（S12c）
 * @returns {Array<{ label: string, kind: 'ask'|'remind'|'navigate'|'state', payload?: any }>} 最多 4 個
 */
export function nextSteps(results, decision, { watching = null, lang = null } = {}) {
  const en = lang === 'en';
  const out = [];
  const add = (s) => { if (s && !out.some((x) => x.label === s.label)) out.push(s); };
  const byTool = (name) => results.filter((r) => r.tool === name).at(-1);

  const bus = byTool('bus_route_eta');
  const f = bus?.data?.focus;
  if (f) {
    const on = watching && watching.routeName === bus.data.routeName && watching.stop === f.stopName;
    if (!on && f.status === 0 && f.etaSec != null) add({ label: en ? 'Remind me 3 min before' : '到站前 3 分提醒我', kind: 'remind', payload: { city: bus.data.city, routeName: bus.data.routeName, stop: f.stopName, direction: f.direction, minutes: 3, ...(en && { lang: 'en' }) } });
    add({ label: en ? 'Open bus page' : '開公車頁看動態', kind: 'navigate', payload: `#/bus/${encodeURIComponent(bus.data.city)}/${encodeURIComponent(bus.data.routeName)}?stop=${encodeURIComponent(f.stopName)}&dir=${f.direction}` });
  } else if (bus) {
    add({ label: en ? 'Open bus page' : '開公車頁看動態', kind: 'navigate', payload: `#/bus/${encodeURIComponent(bus.data.city)}/${encodeURIComponent(bus.data.routeName)}` });
  }

  const trip = byTool('plan_trip')?.data;
  if (trip) {
    // 決策圖上還沒有的狀態：點了在瀏覽器重算（不重問）
    const have = new Set((decision?.states || trip.states || []).map((s) => s.key));
    for (const k of ['rush', 'budget', 'lessWalk']) if (!have.has(k)) { add({ label: (en ? STATE_LABEL_EN : STATE_LABEL)[k], kind: 'state', payload: k }); if (out.length >= 3) break; }
    if (en) return out.slice(0, 4); // 英文：要再問的建議會變成中文問句，先不給
    const from = short(trip.from?.name), to = short(trip.to?.name);
    if (from && to) add({ label: '回程怎麼走？', kind: 'ask', payload: `從${to}到${from}怎麼去？` });
    if (to) add({ label: `${to}天氣如何？`, kind: 'ask', payload: `${to}天氣如何？` });
  }

  const stock = byTool('stock_quote')?.data;
  if (stock) {
    const asked = new Set((stock.quotes || []).map((q) => q.name));
    if (stock.quotes?.length) add({ label: '看大盤', kind: 'ask', payload: '大盤今天怎麼樣' });
    for (const s of stock.quotes?.[0]?.similar || []) add({ label: `是${s.name}嗎？`, kind: 'ask', payload: `${s.code} 股價` });
    for (const n of POPULAR_STOCKS) if (!asked.has(n) && out.length < 4) add({ label: `那${n}呢？`, kind: 'ask', payload: `那${n}呢？` });
  }

  if (byTool('invoice_lottery')) {
    add({ label: '存到我的發票', kind: 'navigate', payload: '#/s/invoice' });
    add({ label: '上一期中獎號碼', kind: 'ask', payload: '上一期的發票中獎號碼' });
  }
  if (byTool('weather_now') && !trip) { add({ label: '空氣品質呢？', kind: 'ask', payload: '附近的空氣品質' }); add({ label: '明天會下雨嗎？', kind: 'ask', payload: '明天會下雨嗎？' }); }
  if (byTool('aqi_nearby') && !trip) add({ label: '天氣呢？', kind: 'ask', payload: '附近天氣如何？' });
  if (byTool('youbike_nearby')) add({ label: '附近公車站呢？', kind: 'ask', payload: '附近有什麼公車站牌' });
  if (byTool('bus_nearby_stations')) add({ label: '附近 YouBike 呢？', kind: 'ask', payload: '附近還有 YouBike 嗎？' });
  if (byTool('fuel_price')) add({ label: '這期發票號碼', kind: 'ask', payload: '這期發票號碼是多少？' });
  return out.slice(0, 4);
}
