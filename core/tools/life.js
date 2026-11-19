// 工具包：life（生活服務，M10）— 風險分級 L1。首頁格子、問阿幫、MCP 共用（ADR-0002）。
import { z } from 'zod';
import { defineTool, T } from './define.js';

const PACK = 'life';
const DEMO = '【示範資料：開放資料的部分片段，非即時完整資料】';
const money = (n) => n.toLocaleString('zh-TW');

export const aqiNearby = defineTool({
  name: 'aqi_nearby',
  title: '空氣品質',
  description: '查座標附近環境部空氣品質測站的即時 AQI、狀態（良好、普通…）、主要污染物與 PM2.5（每小時更新）。地名先用 find_place 轉座標。',
  pack: PACK, tier: 'L1', card: 'aqi', source: '環境部環境資料開放平臺（空氣品質指標 AQI）',
  demoNote: '【示範資料：尚未設定環境部 api_key（MOENV_API_KEY），以下非即時空品】', modeOf: (svc) => svc.aqiMode,
  input: { lat: T.lat, lon: T.lon },
  speak: (d) => `${d.nearest.site}測站 AQI ${d.nearest.aqi ?? '—'}，${d.nearest.status}${d.nearest.pm25 != null ? `，PM2.5 ${d.nearest.pm25}` : ''}。`,
  async run(svc, a) {
    const data = await svc.life.aqiNearby(a);
    const n = data.nearest;
    const text = [`最近測站：${n.county}${n.site}（${(n.distanceM / 1000).toFixed(1)} 公里，${n.publishTime} 發布）`,
      `AQI ${n.aqi ?? '—'}（${n.status}）${n.pollutant ? `，主要污染物：${n.pollutant}` : ''}；PM2.5 ${n.pm25 ?? '—'}、PM10 ${n.pm10 ?? '—'}、O3 ${n.o3 ?? '—'}`,
      ...data.nearby.map((s) => `- ${s.site}：AQI ${s.aqi ?? '—'}（${s.status}）`)].join('\n');
    return { data, text };
  },
});

export const earthquakeRecent = defineTool({
  name: 'earthquake_recent',
  title: '最近地震',
  description: '查中央氣象署最近的地震報告（顯著有感與小區域）：時間、規模、深度、震央、最大震度；給縣市時另回該縣市震度。',
  pack: PACK, tier: 'L1', card: 'quake', source: '中央氣象署（地震報告）',
  demoNote: '【示範資料：尚未設定中央氣象署授權碼，以下為過去的地震報告片段】', modeOf: (svc) => svc.quakeMode,
  input: { county: z.string().trim().max(10).optional().describe('縣市，例如 臺北市（選填）'), limit: z.number().int().min(1).max(10).default(5).describe('筆數') },
  speak: (d) => (d.quakes[0] ? `最近一次：${d.quakes[0].time.slice(5, 16).replace('T', ' ')} 規模 ${d.quakes[0].magnitude?.toFixed(1)}，${d.quakes[0].location.replace(/\s*\(.*\)/, '')}，最大震度 ${d.quakes[0].maxIntensity ?? '—'}。` : '最近沒有地震報告。'),
  async run(svc, a) {
    const data = await svc.life.quakes(a);
    const text = data.quakes.length
      ? data.quakes.map((q) => `- ${q.time.replace('T', ' ').slice(0, 16)} 規模 ${q.magnitude?.toFixed(1)}、深度 ${q.depthKm} 公里，${q.location}；最大震度 ${q.maxIntensity ?? '—'}${data.county ? `，${data.county} ${q.countyIntensity ?? '無感或未列'}` : ''}`).join('\n')
      : '最近沒有地震報告。';
    return { data, text };
  },
});

export const pharmacySearch = defineTool({
  name: 'pharmacy_search',
  title: '健保藥局',
  description: '依地區（例如「臺北市大安區」）或藥局名稱查健保特約藥局：電話、地址、今天的營業時段（上午／下午／晚上）。資料沒有座標，所以用地區搜尋；附地圖搜尋連結。',
  pack: PACK, tier: 'L1', card: 'pharmacy', source: '衛生福利部中央健康保險署（健保特約藥局）', demoNote: DEMO, modeOf: (svc) => svc.openDataMode,
  input: { area: z.string().trim().max(20).optional().describe('縣市＋鄉鎮區，例如 臺北市大安區'), query: z.string().trim().max(20).optional().describe('藥局名稱或路名（選填）') },
  speak: (d) => (d.pharmacies.length ? `找到 ${d.pharmacies.length} 家，今天（${d.weekday}）有營業時段的 ${d.pharmacies.filter((p) => p.openToday).length} 家。` : '沒有找到符合的健保藥局。'),
  async run(svc, a) {
    const data = await svc.life.pharmacies(a);
    const text = data.pharmacies.length
      ? data.pharmacies.map((p) => `- ${p.name}｜${p.phone ?? '—'}｜${p.address}｜今天：${p.today == null ? '未提供' : p.today.length ? p.today.join('、') : '休息'}`).join('\n')
      : '沒有找到符合的健保藥局。';
    return { data, text };
  },
});

export const garbageTruckNearby = defineTool({
  name: 'garbage_truck_nearby',
  title: '垃圾車',
  description: '查座標附近的垃圾車清運點（目前支援臺北市、新北市）：地點、時間、今天有沒有收、距離；新北市另附車輛即時位置。',
  pack: PACK, tier: 'L1', card: 'garbage', source: '臺北市政府環境保護局、新北市政府環境保護局（開放資料）', demoNote: DEMO, modeOf: (svc) => svc.openDataMode,
  input: { lat: T.lat, lon: T.lon, radius: z.number().int().min(100).max(1000).default(500).describe('搜尋半徑（公尺）') },
  speak: (d) => {
    const s = d.stops.find((x) => x.collectToday) || d.stops[0];
    return s ? `最近的清運點在${s.place}（${s.distanceM} 公尺），${s.time ?? '時間未提供'}${s.collectToday ? '' : '，今天不收'}。` : '附近沒有找到垃圾車清運點（目前只有臺北市、新北市資料）。';
  },
  async run(svc, a) {
    const data = await svc.life.garbage(a);
    const text = data.stops.length
      ? data.stops.map((s) => `- ${s.time ?? '—'}｜${s.place}（${s.distanceM} 公尺）｜${s.route}｜${s.collectToday ? '今天有收' : '今天不收'}${s.days ? `（${s.days}）` : ''}${s.truck ? `｜車輛目前在 ${s.truck.location}` : ''}`).join('\n')
      : '附近沒有找到垃圾車清運點（目前只有臺北市、新北市資料）。';
    return { data, text };
  },
});

export const fuelPrice = defineTool({
  name: 'fuel_price',
  title: '油價',
  description: '查台灣中油目前的汽柴油零售牌價（92、95、98 無鉛汽油與超級柴油，元／公升）與生效日期（每週一調整）。',
  pack: PACK, tier: 'L1', card: 'fuel', source: '台灣中油（牌價開放資料）', demoNote: DEMO, modeOf: (svc) => svc.openDataMode,
  input: {},
  speak: (d) => `${d.effectiveDate ?? ''} 起：${d.prices.map((p) => `${p.name.replace('無鉛汽油', '')} ${p.price}`).join('、')}。`,
  async run(svc) {
    const data = await svc.life.fuel();
    return { data, text: [`中油牌價（${data.effectiveDate ?? '—'} 生效，元／公升）：`, ...data.prices.map((p) => `- ${p.name}：${p.price}`)].join('\n') };
  },
});

export const invoiceLottery = defineTool({
  name: 'invoice_lottery',
  title: '發票對獎',
  description: '查統一發票最近 6 期中獎號碼（特別獎、特獎、頭獎）；給發票號碼（8 碼或末 3 碼）時幫忙對獎。期別格式為民國年＋起始月，例如 11507＝115 年 7–8 月。',
  pack: PACK, tier: 'L1', card: 'invoice', source: '財政部（統一發票中獎號碼）', demoNote: DEMO, modeOf: (svc) => svc.openDataMode,
  input: {
    // 沒有任何數字（模型把「這期」「最新」放進來）視為沒給：只查中獎號碼
    number: z.preprocess((v) => (typeof v === 'string' && !/\d/.test(v) ? undefined : v),
      z.string().trim().regex(/^[A-Za-z]{0,2}[-\s]?\d{3}(\d{5})?$/, '發票號碼請輸入 8 位數字（或末 3 碼）').optional())
      .describe('要對獎的發票號碼（8 碼或末 3 碼，只有數字）；只查中獎號碼時不要給'),
    period: z.string().regex(/^\d{5}$/, '期別例如 11507').optional().describe('期別（選填，預設最新一期）'),
  },
  speak: (d) => (d.check ? (d.check.prize ? `${d.check.prize}！${d.check.amount ? `獎金 ${money(d.check.amount)} 元。` : ''}` : '這張沒有中獎。') : `${d.period.title}：特別獎 ${d.period.special}、特獎 ${d.period.grand}。`),
  async run(svc, a) {
    const data = await svc.life.invoice(a);
    const p = data.period;
    const lines = [`${p.title}（期別 ${p.period}）`, `特別獎 ${p.special}（1,000 萬）`, `特獎 ${p.grand}（200 萬）`, `頭獎 ${p.first.join('、')}（20 萬；末 7～3 碼相同為二～六獎）`];
    if (data.check) lines.push(`對獎 ${data.check.number}：${data.check.prize ? `${data.check.prize}${data.check.amount ? `，${money(data.check.amount)} 元` : ''}` : '沒有中獎'}${data.check.note ? `（${data.check.note}）` : ''}`);
    return { data, text: lines.join('\n') };
  },
});

export default [aqiNearby, earthquakeRecent, pharmacySearch, garbageTruckNearby, fuelPrice, invoiceLottery];
