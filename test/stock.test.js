// 股市收盤行情：證交所／櫃買中心欄位解析、指數漲跌方向、名稱比對、示範 tool、開放資料 client 的解析與空資料
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTwse, parseTpex, parseIndices, findStock, splitQuery, stockQuote, createLiveStockFetchers, STOCK_URLS } from '../core/services/stock.js';
import { createOpenDataClient } from '../core/opendata-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices, dataSources } from '../core/index.js';
import { runDemo } from '../core/agent/run.js';
import { getProfile } from '../core/agents/index.js';
import { applyOutputGuardrails, NO_ADVICE_NOTE } from '../core/agent/guardrails.js';

const TWSE = [
  { Date: '1151118', Code: '2330', Name: '台積電', TradeVolume: '50794225', TradeValue: '110637335600', OpeningPrice: '2200.00', HighestPrice: '2210.00', LowestPrice: '2150.00', ClosingPrice: '2175.00', Change: '5.0000', Transaction: '180875' },
  { Date: '1151118', Code: '00402A', Name: '主動安聯美國科技', TradeVolume: '3013509', OpeningPrice: '8.70', HighestPrice: '8.76', LowestPrice: '8.56', ClosingPrice: '8.59', Change: '-0.0300' },
  { Date: '1151118', Code: '00625K', Name: '富邦上証+R', TradeVolume: '', OpeningPrice: '', HighestPrice: '', LowestPrice: '', ClosingPrice: '', Change: '0.0000' },
];
const TPEX = [
  { Date: '1151119', SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '490.00', Change: '-54.00 ', Open: '551.00', High: '551.00', Low: '490.00', TradingShares: '9738231', TransactionAmount: '4906510188', TransactionNumber: '21283' },
  { Date: '1151119', SecuritiesCompanyCode: '00411A', CompanyName: '主動統一前沿科技', Close: '8.63', Change: '+0.01', Open: '8.73', High: '8.84', Low: '8.60', TradingShares: '7669184' },
  { Date: '1151119', SecuritiesCompanyCode: '00870B', CompanyName: '元大15年EM主權債', Close: ' ---', Change: '--- ', Open: '---', High: '---', Low: '---', TradingShares: '0' },
  { Date: '1151119', SecuritiesCompanyCode: '713456', CompanyName: '環球晶元大58購01', Close: '1.20', Change: '0.10' }, // 權證：略過
];

test('證交所：民國日期、數字、負漲跌、漲跌幅、成交張數；無成交為 null', () => {
  const [tsmc, etf, none] = parseTwse(TWSE);
  assert.deepEqual([tsmc.code, tsmc.market, tsmc.date, tsmc.close, tsmc.change, tsmc.changePct, tsmc.volumeLots], ['2330', '上市', '2026-11-18', 2175, 5, 0.23, 50794]);
  assert.deepEqual([etf.change, etf.changePct], [-0.03, -0.35]);
  assert.deepEqual([none.close, none.change, none.changePct, none.volumeLots], [null, null, null, null]);
  assert.deepEqual(parseTwse({ not: 'array' }), []);
});

test('櫃買中心：「+」「---」與尾端空白、略過權證', () => {
  const q = parseTpex(TPEX);
  assert.deepEqual(q.map((x) => x.code), ['6488', '00411A', '00870B']);
  assert.deepEqual([q[0].change, q[0].changePct, q[0].market, q[0].date], [-54, -9.93, '上櫃', '2026-11-19']);
  assert.equal(q[1].change, 0.01);
  assert.deepEqual([q[2].close, q[2].open, q[2].change], [null, null, null]);
});

test('指數：加權指數依「漲跌」符號、櫃買指數取最後一筆有收盤的日期', () => {
  const twse = [{ 日期: '1151118', 指數: '寶島股價指數', 收盤指數: '44216.00', 漲跌: '+', 漲跌點數: '114.38' }, { 日期: '1151118', 指數: '發行量加權股價指數', 收盤指數: '40194.91', 漲跌: '-', 漲跌點數: '102.80', 漲跌百分比: '0.26' }];
  const tpex = [{ Date: '20261118', Close: '307.55', Change: '0.94' }, { Date: '20261119', Close: '285.33', Change: '-22.22' }, { Date: '20261120', Close: '', Change: '' }];
  const [taiex, otc] = parseIndices(twse, tpex);
  assert.deepEqual([taiex.id, taiex.close, taiex.change, taiex.changePct, taiex.date], ['taiex', 40194.91, -102.8, -0.26, '2026-11-18']);
  assert.deepEqual([otc.id, otc.date, otc.change, otc.changePct], ['tpex', '2026-11-19', -22.22, -7.22]);
  assert.deepEqual(parseIndices(null, []), []);
});

test('比對：代號（不分大小寫）→ 完整名稱（臺／台相同）→ 名稱開頭 → 包含；找不到列在 notFound', () => {
  const quotes = [...parseTwse(TWSE), ...parseTpex(TPEX)];
  assert.equal(findStock(quotes, '00402a').hit.code, '00402A');
  assert.equal(findStock(quotes, '臺積電').hit.code, '2330');
  const p = findStock(quotes, '主動');
  assert.equal(p.hit.code, '00402A'); // 名稱開頭、短名優先
  assert.deepEqual(p.similar.map((s) => s.code), ['00411A']);
  assert.deepEqual(splitQuery('台積電、0050 和 聯發科,鴻海；a；b；c'), ['台積電', '0050', '聯發科', '鴻海', 'a']);
  const r = stockQuote({ quotes, indices: [] }, { query: '2330、台積電、火星' });
  assert.deepEqual([r.quotes.map((x) => x.code), r.notFound], [['2330'], ['火星']], '同一檔只列一次');
  assert.deepEqual(stockQuote({ quotes, indices: [] }, {}).quotes, []);
});

test('stock_quote（示範）：文字含免責、speak 講收盤與漲跌、找不到不丟錯；不給 query 只回指數', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'stock_quote', { query: '台積電、環球晶、火星' });
  assert.equal(r.card, 'stock');
  assert.equal(r.mode, 'demo');
  assert.match(r.speak, /台積電 11\/18 收 2175，漲 5/);
  assert.match(r.speak, /環球晶 11\/19 收 490，跌 54/);
  assert.match(r.speak, /找不到「火星」/);
  assert.match(r.text, /不構成投資建議/);
  const idx = await callTool(svc, 'stock_quote', {});
  assert.deepEqual(idx.data.indices.map((i) => i.id), ['taiex', 'tpex']);
  assert.match(idx.speak, /^加權指數 11\/18 收 40194\.91/);
  assert.ok(dataSources(svc).find((s) => s.id === 'opendata').name.includes('股市'));
});

test('真實 fetchers：下載後先解析再快取；空清單視為上游錯誤', async () => {
  const urls = [];
  const fetchImpl = async (u) => { urls.push(u); return new Response(JSON.stringify(u === STOCK_URLS.twse ? TWSE : u === STOCK_URLS.tpex ? [] : []), { status: 200 }); };
  const fx = createLiveStockFetchers({ od: createOpenDataClient({ fetchImpl }) });
  const tw = await fx.twse();
  assert.equal(tw[0].name, '台積電');
  await fx.twse();
  assert.equal(urls.length, 1, '快取');
  await assert.rejects(fx.tpex(), /櫃買中心收盤行情格式不符預期：沒有資料/);
});

test('問阿幫（示範）：追問沿用上一題的股市，事件流以 stock 卡片結尾', async () => {
  const svc = createServices({ forceMock: true });
  const es = [];
  const messages = [{ role: 'user', content: '台積電股價多少' }, { role: 'assistant', content: '台積電 11/18 收 2175。' }, { role: 'user', content: '那聯發科呢？' }];
  await runDemo(svc, { messages }, (e) => es.push(e));
  const r = es.filter((e) => e.type === 'tool_result').at(-1);
  assert.equal(r.card, 'stock');
  assert.equal(r.data.quotes[0].code, '2454');
  assert.match(es.find((e) => e.type === 'text').delta, /聯發科/);
});

test('輸出護欄（finance）：買賣建議、漲跌預測、目標價整句換掉並送 guardrail；一般行情與交通建議不動', () => {
  const p = getProfile('life');
  const g = applyOutputGuardrails(p, '台積電 11/18 收 2175，漲 5 元。我建議你可以逢低買進。股價應該會繼續上漲！目標價 3000。要不要也看看 0050？');
  assert.equal(g.text, `台積電 11/18 收 2175，漲 5 元。${NO_ADVICE_NOTE}要不要也看看 0050？`);
  assert.deepEqual(g.hits, [{ tier: 'L2', rule: 'no-investment-advice' }]);
  for (const ok of ['建議搭捷運，比較不會淋雨。', '建議買來回票比較便宜。', '我幫你看多少錢。', '油價下週一調整。', '阿幫不提供投資建議，只能報開放資料的收盤數字：台積電收 2175。', '加權指數 11/18 收 40194.91，漲 102.8 點。']) assert.deepEqual(applyOutputGuardrails(p, ok), { text: ok, hits: [] }, ok);
  assert.equal(applyOutputGuardrails(getProfile('antifraud'), '建議你逢低買進。').text.startsWith('建議你逢低買進'), true, '沒有 finance 工具包的 agent 不套用');
});
