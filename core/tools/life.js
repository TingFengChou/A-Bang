// 工具包：life（生活服務，M10）— 風險分級 L1。首頁格子、問阿幫、MCP 共用（ADR-0002）。
import { z } from 'zod';
import { defineTool, T } from './define.js';
import { UserError } from '../util.js';
import { DEPTS, PERIODS } from '../services/clinic.js';
/** 清運時段（「17:06–17:09」）今天已經結束超過 10 分（台灣時間）；格式不對回 false */
export function truckPassed(time, now = Date.now()) {
  const hm = /(\d{1,2}):(\d{2})(?!.*\d{1,2}:\d{2})/.exec(String(time || ''));
  if (!hm) return false;
  const tw = new Date(now + 8 * 3600e3);
  return Number(hm[1]) * 60 + Number(hm[2]) - (tw.getUTCHours() * 60 + tw.getUTCMinutes()) < -10;
}

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
  speak: (d) => `${d.nearest.downSite ? `最近的${d.nearest.downSite}測站維護中，改看` : ''}${d.nearest.site}測站 AQI ${d.nearest.aqi ?? '—'}，${d.nearest.status}${d.nearest.pm25 != null ? `，PM2.5 ${d.nearest.pm25}` : ''}。`,
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
  speak: (d) => {
    // 問某縣市（「花蓮剛剛是不是地震」）：講那個縣市有感的最近一次，不是只報別處那次（P4-4）
    if (d.county && d.quakes.length) {
      const q = d.quakes.find((x) => x.countyIntensity);
      return q ? `${d.county}最近一次有感：${q.time.slice(5, 16).replace('T', ' ')} 規模 ${q.magnitude?.toFixed(1)}，${q.location.replace(/\s*\(.*\)/, '')}，${d.county}震度 ${q.countyIntensity}。` : `最近 ${d.quakes.length} 次地震報告都沒有列出${d.county}的震度（無感或未列）。`;
    }
    return d.quakes[0] ? `最近一次：${d.quakes[0].time.slice(5, 16).replace('T', ' ')} 規模 ${d.quakes[0].magnitude?.toFixed(1)}，${d.quakes[0].location.replace(/\s*\(.*\)/, '')}，最大震度 ${d.quakes[0].maxIntensity ?? '—'}。` : '最近沒有地震報告。';
  },
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
  description: '依地區（例如「臺北市大安區」）或藥局名稱查健保特約藥局：電話、地址、今天的營業時段（上午／下午／晚上）。資料沒有座標，所以用地區搜尋；沒說地區時可給座標（lat、lon），依位置判斷在哪一區。附地圖搜尋連結。',
  pack: PACK, tier: 'L1', card: 'pharmacy', source: '衛生福利部中央健康保險署（健保特約藥局）', demoNote: DEMO, modeOf: (svc) => svc.openDataMode,
  input: { area: z.string().trim().max(20).optional().describe('縣市＋鄉鎮區，例如 臺北市大安區'), query: z.string().trim().max(20).optional().describe('藥局名稱或路名（選填）'), lat: T.lat.optional().describe('沒說地區時：所在位置緯度'), lon: T.lon.optional().describe('沒說地區時：所在位置經度') },
  speak: (d) => (d.pharmacies.length ? `${d.otherCities ? `先列${d.city}的；` : ''}找到 ${d.pharmacies.length} 家，今天（${d.weekday}）有營業時段的 ${d.pharmacies.filter((p) => p.openToday).length} 家。${d.otherCities ? `「${d.area}」在${d.otherCities.join('、')}也有，要查那裡請說「${d.otherCities[0]}${d.area}」。` : ''}` : '沒有找到符合的健保藥局。'),
  async run(svc, input) {
    const { lat, lon, ...a } = input;
    let areaFrom = null;
    if ((lat == null) !== (lon == null)) throw new UserError('座標要同時給緯度和經度。');
    if (!a.area && lat != null) { // 「附近的藥局」：先從位置推估行政區（S16；最近的測站可能在隔壁區）
      const d = await svc.weather.district({ lat, lon }).catch(() => null);
      if (!d) throw new UserError('沒辦法從位置判斷在哪一區，請說縣市和鄉鎮區，例如「大安區的藥局」。');
      a.area = d.area;
      areaFrom = { by: 'location', station: d.station, distanceM: d.distanceM, demo: d.demo };
    }
    const data = { ...(await svc.life.pharmacies(a)), ...(areaFrom && { areaFrom }) };
    const guess = areaFrom && `依位置推估在「${data.area}」${areaFrom.demo ? '（示範）' : `（最近的測站：${areaFrom.station}）`}，不對請說哪一區。`;
    const text = (guess ? `${guess}\n` : '') + (data.pharmacies.length
      ? data.pharmacies.map((p) => `- ${p.name}｜${p.phone ?? '—'}｜${p.address}｜今天：${p.today == null ? '未提供' : p.today.length ? p.today.join('、') : '休息'}`).join('\n')
      : '沒有找到符合的健保藥局。');
    return { data, text };
  },
});

export const clinicSearch = defineTool({
  name: 'clinic_search',
  title: '現在有看診的診所',
  description: '依地區（例如「臺北市大安區」）找健保特約診所，這個時段（上午／下午／晚上）有登記看診的排前面；可指定使用者明講的科別（小兒科、耳鼻喉科、牙科、中醫…）。資料沒有座標，所以用地區搜尋；沒說地區時可給座標（lat、lon），依位置判斷在哪一區。看診時段是診所向健保署登記的固定時段，臨時休診不會反映。不要從症狀推薦科別、不判斷病情；胸痛、呼吸困難、昏倒等急症請使用者先撥 119。',
  pack: PACK, tier: 'L1', card: 'clinic', source: '衛生福利部中央健康保險署（健保特約診所）', demoNote: DEMO, modeOf: (svc) => svc.openDataMode,
  input: {
    area: z.string().trim().max(20).optional().describe('縣市＋鄉鎮區，例如 臺北市大安區'),
    dept: z.enum(DEPTS.map((d) => d.id)).optional().describe(`使用者明講的科別：${DEPTS.map((d) => `${d.id}＝${d.label}`).join('、')}；沒說就不給（只列西醫診所）`),
    query: z.string().trim().max(20).optional().describe('診所名稱或路名（選填）'),
    dayOffset: z.number().int().min(0).max(13).optional().describe('問的是幾天後（明天 1、後天 2、禮拜天依今天算）；沒說就是現在'),
    period: z.enum(PERIODS).optional().describe('問的時段：上午、下午、晚上（夜間、夜診＝晚上）'),
    lat: T.lat.optional().describe('沒說地區時：所在位置緯度'), lon: T.lon.optional().describe('沒說地區時：所在位置經度'),
  },
  speak: (d) => clinicSay(d),
  async run(svc, input) {
    const { lat, lon, ...a } = input;
    let areaFrom = null;
    if ((lat == null) !== (lon == null)) throw new UserError('座標要同時給緯度和經度。');
    if (!a.area && lat != null) { // 「附近有開的診所」：先從位置推估行政區（與藥局相同；最近的測站可能在隔壁區）
      const d = await svc.weather.district({ lat, lon }).catch(() => null);
      if (!d) throw new UserError('沒辦法從位置判斷在哪一區，請說縣市和鄉鎮區，例如「大安區的診所」。');
      a.area = d.area;
      areaFrom = { by: 'location', station: d.station, distanceM: d.distanceM, demo: d.demo };
    }
    const data = { ...(await svc.clinics.search(a)), ...(areaFrom && { areaFrom }) };
    if (data.phase === 'late' && data.total) { // 晚上 10 點後：順便說明天上午有幾家（PM 審查：晚上替小孩、長輩找隔天門診）
      const t = await svc.clinics.search({ ...a, dayOffset: 1, period: '上午' });
      data.tomorrow = { weekday: t.weekday, count: t.openNowCount };
    }
    const guess = areaFrom && `依位置推估在「${data.area}」${areaFrom.demo ? '（示範）' : `（最近的測站：${areaFrom.station}）`}，不對請說哪一區。`;
    const line = (c) => `- ${c.name}｜${c.phone ?? '—'}｜${c.address}｜${c.depts.join('、') || '不分科'}｜今天：${c.today == null ? '未提供' : c.today.length ? c.today.join('、') : '休診'}${c.openNow ? '（這個時段有登記看診）' : ''}`;
    const text = [guess, clinicSay(data), ...data.clinics.map(line),
      '看診時段是診所向健保署登記的固定時段，臨時休診不會反映，出門前先打電話。阿幫不判斷病情、不推薦科別；胸痛、呼吸困難、昏倒等急症請先撥 119。'].filter(Boolean).join('\n');
    return { data, text };
  },
});

/** 一句話：這一區、這個時段有登記看診的幾家（只說「有登記」，不說看診中）；看診時間都過了提醒急診與 119 */
export function clinicSay(d) {
  const what = d.dept ? `${d.dept}診所` : '西醫診所';
  const where = `${d.otherCities ? d.city : ''}${d.area || d.query || ''}`;
  const after = `；身體很不舒服請到醫院急診，緊急狀況撥 119。`;
  if (!d.total) return `${where}沒有找到${d.dept ? `「${d.dept}」的` : '符合的'}健保特約診所。`;
  if (d.phase === 'planned') {
    const when = `${dayWord(d)}${d.period || ''}`;
    return d.openNowCount ? `${where}${when}有登記看診的${what}有 ${d.openNowCount} 家。時段是登記的，出門前先打電話確認。` : `${where}的${what}${when}沒有登記看診，可以換個時段或換一區問看看。`;
  }
  if (d.openNowCount) return `${where}有 ${d.openNowCount} 家${what}登記${d.period}看診${d.laterCount ? `，今天稍晚還有 ${d.laterCount} 家` : ''}。時段是登記的，出門前先打電話確認。`;
  if (d.laterCount) return d.phase === 'early'
    ? `診所還沒開始看診；${where}今天有登記看診的${what}有 ${d.laterCount} 家，時段在卡片上。`
    : `${where}的${what}這個時段（${d.period}）沒有登記看診，今天稍晚有 ${d.laterCount} 家。`;
  const tmr = d.tomorrow?.count ? `明天上午這一區有 ${d.tomorrow.count} 家登記看診。` : '';
  return d.phase === 'late' ? `現在已過診所的看診時間，${where}的${what}今天都看完了${after}${tmr}` : `${where}的${what}今天接下來沒有登記看診${after}`;
}
/** 「明天」「後天」「星期六」（問的是別的日子時） */
export const dayWord = (d) => (d.dayOffset === 1 ? '明天' : d.dayOffset === 2 ? '後天' : d.dayOffset ? d.weekday : '今天');

export const garbageTruckNearby = defineTool({
  name: 'garbage_truck_nearby',
  title: '垃圾車',
  description: '查座標附近的垃圾車清運點（目前支援臺北市、新北市）：地點、時間、今天有沒有收、距離；新北市另附車輛即時位置。',
  pack: PACK, tier: 'L1', card: 'garbage', source: '臺北市政府環境保護局、新北市政府環境保護局（開放資料）', demoNote: DEMO, modeOf: (svc) => svc.openDataMode,
  input: { lat: T.lat, lon: T.lon, radius: z.number().int().min(100).max(1000).default(500).describe('搜尋半徑（公尺）') },
  speak: (d) => {
    const now = Date.now();
    // 今天還沒收過的優先（時段結束超過 10 分算收過，跟卡片 truckWhen 一樣）；今天的都收過了照實說（生活資料審查 #5：23:00 還說「最近的清運點 17:06」）
    const today = d.stops.filter((x) => x.collectToday);
    const left = today.find((x) => !truckPassed(x.time, now));
    if (!left && today.length) return `今天附近的清運點都收過了（最近的${today[0].place}在 ${today[0].time}）。`;
    const s = left || d.stops[0];
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

const STATUS_TEXT = { pending: '還沒開獎', unavailable: '超過最近 6 期，查不到' };

export const invoiceCheckBatch = defineTool({
  name: 'invoice_check_batch',
  title: '發票批次對獎',
  description: '一次對多張發票（最多 50 張）：每張給 8 碼號碼與消費日期（或期別），回每張是否中獎；還沒開獎的回開獎日。網頁「我的發票」開獎後自動對獎用。',
  pack: PACK, tier: 'L1', source: '財政部（統一發票中獎號碼）', demoNote: DEMO, modeOf: (svc) => svc.openDataMode,
  input: {
    items: z.array(z.object({
      number: z.string().trim().regex(/^[A-Za-z]{0,2}[-\s]?\d{8}$/, '發票號碼請輸入 8 位數字'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '消費日期格式是 YYYY-MM-DD').optional(),
      period: z.string().regex(/^\d{5}$/, '期別例如 11507').optional(),
    }).refine((x) => x.date || x.period, '每張發票要有消費日期或期別')).min(1).max(50).describe('發票：[{ number, date | period }]'),
  },
  speak: (d) => {
    const s = d.summary;
    const done = s.won + s.lost;
    return [done && (s.won ? `對了 ${done} 張，中 ${s.won} 張，共 ${money(s.amount)} 元！` : `對了 ${done} 張，這次沒有中獎。`), s.pending && `${s.pending} 張還沒開獎。`].filter(Boolean).join('') || '這些發票都超過最近 6 期，查不到。';
  },
  async run(svc, a) {
    const data = await svc.life.invoiceCheckMany(a);
    return { data, text: data.results.map((r) => `- ${r.number}（${r.period} 期）：${r.status === 'won' ? `${r.prize} ${money(r.amount)} 元` : r.status === 'lost' ? '沒有中獎' : `${STATUS_TEXT[r.status]}${r.status === 'pending' ? `，${r.drawDate} 開獎` : ''}`}`).join('\n') };
  },
});

export default [aqiNearby, earthquakeRecent, pharmacySearch, clinicSearch, garbageTruckNearby, fuelPrice, invoiceLottery, invoiceCheckBatch];
