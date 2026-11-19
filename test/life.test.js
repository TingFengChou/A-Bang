// 生活服務（M10）：各資料的整理邏輯（真實欄位格式）、對獎規則、示範模式 tools、開放資料 client 的快取與錯誤
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aqiNearby, aqiLevel, quakeList, todayHours, pharmacySearch, garbageNearby, fuelPrices, parseInvoiceRss, checkInvoice, rocDate, normAddr, createLiveLifeFetchers } from '../core/services/life.js';
import { createOpenDataClient } from '../core/opendata-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices, dataSources } from '../core/index.js';

const svc = createServices({ forceMock: true });
const THU = Date.parse('2026-11-19T10:00:00+08:00'); // 星期四
const WED = Date.parse('2026-11-18T10:00:00+08:00');

test('空品：最近測站、等級、pm2.5 欄位、缺座標略過', () => {
  const rows = [
    { sitename: '萬華', county: '臺北市', aqi: '58', status: '普通', 'pm2.5': '21', latitude: '25.046503', longitude: '121.507972', publishtime: '2026/11/19 08:00:00' },
    { sitename: '遠方', county: '高雄市', aqi: '', status: '', latitude: '22.6', longitude: '120.3' },
    { sitename: '壞資料', aqi: '10' },
  ];
  const r = aqiNearby(rows, { lat: 25.0478, lon: 121.517 });
  assert.equal(r.nearest.site, '萬華');
  assert.equal(r.nearest.pm25, 21);
  assert.equal(r.nearest.level, 'moderate');
  assert.equal(r.nearest.publishTime, '2026-11-19 08:00:00');
  assert.equal(r.nearby[0].aqi, null);
  assert.equal(r.nearby[0].status, '資料維護中');
  assert.deepEqual([aqiLevel(50)[1], aqiLevel(151)[1], aqiLevel(301)[2]], ['良好', '對所有族群不健康', 'hazard']);
});

test('地震：氣象署欄位、最大震度、指定縣市、去重、依時間排序', () => {
  const eq = (no, time, mag, areas) => ({ EarthquakeNo: no, Web: 'https://scweb.cwa.gov.tw/x', EarthquakeInfo: { OriginTime: time, FocalDepth: 10, Epicenter: { Location: '花蓮縣政府東方  20.1  公里', EpicenterLatitude: 24, EpicenterLongitude: 121.8 }, EarthquakeMagnitude: { MagnitudeValue: mag } }, Intensity: { ShakingArea: areas } });
  const a = [{ AreaDesc: '最大震度4級地區', CountyName: '花蓮縣', AreaIntensity: '4級' }, { AreaDesc: '花蓮縣地區', CountyName: '花蓮縣', AreaIntensity: '4級' }, { AreaDesc: '臺北市地區', CountyName: '臺北市', AreaIntensity: '2級' }];
  const q = quakeList([['significant', { records: { Earthquake: [eq(1, '2026-11-10T01:00:00+08:00', 5.1, a)] } }], ['local', { records: { Earthquake: [eq(2, '2026-11-12T01:00:00+08:00', 3.2, [{ AreaDesc: '宜蘭縣地區', CountyName: '宜蘭縣', AreaIntensity: '5弱' }]), eq(1, '2026-11-10T01:00:00+08:00', 5.1, a)] } }]], { county: '台北市' });
  assert.equal(q.length, 2);
  assert.equal(q[0].maxIntensity, '5弱');
  assert.equal(q[1].maxIntensity, '4級');
  assert.equal(q[1].countyIntensity, '2級');
  assert.equal(q[1].location, '花蓮縣政府東方 20.1 公里');
  assert.equal(q[0].countyIntensity, null);
});

test('藥局：今天時段、已歇業排除、台／臺與全形數字、要有地區或名稱', () => {
  assert.deepEqual(todayHours('星期四上午看診、星期四下午休診、星期四晚上看診', 4), ['上午', '晚上']);
  assert.equal(todayHours('', 4), null);
  const rows = [
    { 醫事機構代碼: '1', 醫事機構名稱: '甲藥局', 地址: '臺北市大安區和平東路３段１號', 固定看診時段: '星期四上午看診', 終止合約或歇業日期: '20291129', 電話: '(02)1' },
    { 醫事機構代碼: '2', 醫事機構名稱: '乙藥局', 地址: '臺北市大安區信義路1號', 固定看診時段: '', 終止合約或歇業日期: '20230820' },
  ];
  const r = pharmacySearch(rows, { area: '台北市大安區', now: THU });
  assert.deepEqual(r.pharmacies.map((p) => p.name), ['甲藥局']);
  assert.equal(r.pharmacies[0].address, '臺北市大安區和平東路3段1號');
  assert.deepEqual(r.pharmacies[0].today, ['上午']);
  assert.match(r.pharmacies[0].nav.google, /^https:\/\/www\.google\.com\/maps\/search\//);
  assert.equal(pharmacySearch(rows, { query: '和平東路3段', now: THU }).pharmacies.length, 1);
  assert.throws(() => pharmacySearch(rows, {}), /請輸入地區/);
  assert.equal(normAddr('台中１０'), '臺中10');
});

test('垃圾車：臺北週三停收、新北依星期欄位、即時車輛、半徑', () => {
  const taipei = [{ 行政區: '中正區', 里別: '黎明里', 路線: '南昌-1', 車次: '第1車', 車號: '059-BV', 抵達時間: '1720', 離開時間: '1724', 地點: '某路1號', 經度: '121.5172', 緯度: '25.0480' }];
  const ntpc = [{ city: '板橋區', lineid: '220001', linename: 'A01路線下午', name: '民生路二段80號', village: '玉光里', longitude: '121.4717', latitude: '25.0183', time: '13:45', garbagethursday: 'Y', garbagewednesday: '' }];
  const gps = [{ lineid: '220001', car: 'KEV-1', time: '2026/11/19 13:40:00', location: '新北市板橋區民生路二段60號', longitude: '121.472', latitude: '25.0185' }];
  const tp = garbageNearby({ taipei, ntpc, gps }, { lat: 25.0478, lon: 121.517, now: WED });
  assert.equal(tp.stops.length, 1);
  assert.equal(tp.stops[0].time, '17:20–17:24');
  assert.equal(tp.stops[0].collectToday, false);
  const nt = garbageNearby({ taipei, ntpc, gps }, { lat: 25.0183, lon: 121.4717, now: THU });
  assert.equal(nt.stops[0].collectToday, true);
  assert.equal(nt.stops[0].days, '週四收');
  assert.equal(nt.stops[0].truck.car, 'KEV-1');
  assert.equal(nt.stops[0].truck.at, '2026-11-19 13:40:00');
  assert.equal(garbageNearby({ taipei, ntpc, gps }, { lat: 22.6, lon: 120.3 }).stops.length, 0);
});

test('油價與發票：民國日期、零售牌價、RSS 解析、對獎規則', () => {
  assert.equal(rocDate('1151116'), '2026-11-16');
  const f = fuelPrices([{ 型別名稱: '汽柴油零售', 產品名稱: '95無鉛汽油', 參考牌價_金額: 32.7, 計價單位: '元/ 公升', 牌價生效日期: '1151116' }, { 型別名稱: '其他', 產品名稱: '95無鉛汽油', 參考牌價_金額: 1 }]);
  assert.deepEqual(f, { effectiveDate: '2026-11-16', prices: [{ name: '95無鉛汽油', price: 32.7, unit: '元/公升' }] });
  const xml = '<rss><channel><item><title>115年 07~08月</title><link>https://www.etax.nat.gov.tw/etw-main/ETW183W2_11507</link><description><![CDATA[<p>特別獎：89996565</p><p>特獎：91098182</p><p>頭獎：54348835、44991397、06595111</p>]]></description></item></channel></rss>';
  const [p] = parseInvoiceRss(xml);
  assert.deepEqual([p.period, p.special, p.first[2]], ['11507', '89996565', '06595111']);
  assert.equal(checkInvoice(p, '89996565').prize, '特別獎');
  assert.equal(checkInvoice(p, '91098182').amount, 2_000_000);
  assert.equal(checkInvoice(p, '14348835').prize, '二獎');
  assert.equal(checkInvoice(p, '00095111').prize, '四獎');
  assert.equal(checkInvoice(p, '12340111').prize, '六獎');
  assert.equal(checkInvoice(p, '12345678').prize, null);
  assert.equal(checkInvoice(p, '111').partial, true);
  assert.throws(() => checkInvoice(p, '1234'), /8 位數字/);
  assert.throws(() => parseInvoiceRss('<rss></rss>'), /期別/);
});

test('示範模式 tools：6 個都有卡片與 speak；發票對獎；L1', async () => {
  const P = { lat: 25.0478, lon: 121.517 };
  for (const [n, a, card] of [['aqi_nearby', P, 'aqi'], ['earthquake_recent', {}, 'quake'], ['pharmacy_search', { area: '臺北市大安區' }, 'pharmacy'], ['garbage_truck_nearby', P, 'garbage'], ['fuel_price', {}, 'fuel'], ['invoice_lottery', { number: '54348835' }, 'invoice']]) {
    const r = await callTool(svc, n, a);
    assert.equal(r.card, card, n);
    assert.equal(r.mode, 'demo', n);
    assert.ok(r.speak && r.text, n);
  }
  assert.equal((await callTool(svc, 'invoice_lottery', { number: '54348835' })).data.check.prize, '頭獎');
  await assert.rejects(callTool(svc, 'invoice_lottery', { number: '12' }), /8 位數字/);
  await assert.rejects(callTool(svc, 'invoice_lottery', { period: '10001' }), /最近 6 期/);
});

test('開放資料 client：快取、同時只下載一次、失敗沿用舊資料、錯誤不含網址參數；空品金鑰無效', async () => {
  let n = 0, t = 0, fail = false;
  const od = createOpenDataClient({ now: () => t, fetchImpl: async () => { n++; if (fail) throw new Error('x?api_key=SECRET'); return new Response('[1]'); } });
  const o = { ttlSec: 60, label: '測試資料', as: 'json' };
  assert.deepEqual(await Promise.all([od.get('u', o), od.get('u', o)]), [[1], [1]]);
  assert.equal(n, 1);
  t = 61_000; fail = true;
  assert.deepEqual(await od.get('u', o), [1]); // 沿用舊的
  await assert.rejects(od.get('v', o), (e) => e.name === 'OpenDataError' && /測試資料連線失敗/.test(e.message) && !/SECRET/.test(e.message));
  const bad = createOpenDataClient({ fetchImpl: async () => new Response('api_key 不存在。', { status: 200 }) });
  const fx = createLiveLifeFetchers({ od: bad, cwa: null, moenvKey: 'k', demo: {} });
  await assert.rejects(fx.aqi(), /環境部空氣品質資料格式不符預期/);
});

test('dataSources：各類資料真實／示範（網頁標示用），不含金鑰', () => {
  const ids = (x) => x.map((s) => `${s.id}:${s.mode}`);
  assert.deepEqual(ids(dataSources(svc)), ['transit:demo', 'weather:demo', 'aqi:demo', 'quake:demo', 'opendata:demo', 'antifraud:demo']);
  // 只開免金鑰開放資料：藥局等與防詐是真實，需金鑰的仍是示範
  const open = createServices({ openData: true });
  assert.deepEqual(ids(dataSources(open)), ['transit:demo', 'weather:demo', 'aqi:demo', 'quake:demo', 'opendata:live', 'antifraud:live']);
  assert.ok(dataSources(open).every((s) => Object.keys(s).join() === 'id,name,mode'));
});
