// 生活服務資料（M10，首頁格子）：空氣品質、地震、藥局、垃圾車、油價、發票對獎。
// 下載與快取在 fetchers（真實：政府開放資料；示範：core/data/demo/ 的真實片段），整理邏輯共用（架構規則 3：介面相同）。
// 來源與欄位已實測（2026-11-19，docs/DATA_SOURCES.md §5.2）。
import { csvObjects } from '../csv.js';
import { nowTW, distanceM as haversine, UserError } from '../util.js';
import { navLinks } from '../nav.js';

export const URLS = {
  aqi: (key) => `https://data.moenv.gov.tw/api/v2/aqx_p_432?api_key=${encodeURIComponent(key)}&limit=1000&format=JSON`,
  pharmacies: 'https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21005-001',
  garbageTaipei: 'https://data.taipei/api/dataset/6bb3304b-4f46-4bb0-8cd1-60c66dcd1cae/resource/a6e90031-7ec4-4089-afb5-361a4efe7202/download',
  garbageNtpc: 'https://data.ntpc.gov.tw/api/datasets/edc3ad26-8ae7-4916-a00b-bc6048d19bf8/csv/file',
  garbageNtpcGps: 'https://data.ntpc.gov.tw/api/datasets/28ab4122-60e1-4065-98e5-abccb69aaca6/csv/file',
  fuel: 'https://vipmbr.cpc.com.tw/opendata/mainprodlistprice',
  invoice: 'https://invoice.etax.nat.gov.tw/invoice.xml',
};

const num = (v) => { const n = Number(String(v ?? '').trim()); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };
/** 全形數字與「台」統一，地址比對用 */
export const normAddr = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/台/g, '臺').replace(/\s+/g, '');
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** 民國日期 1151116 → 2026-11-16 */
export const rocDate = (s) => { const m = String(s ?? '').trim().match(/^(\d{2,3})(\d{2})(\d{2})$/); return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : null; };
const twDow = (now) => new Date(Date.parse(`${nowTW(now).date}T12:00:00+08:00`)).getUTCDay();

// ── 空氣品質（環境部 aqx_p_432，每小時）──
const AQI_LEVELS = [[50, '良好', 'good'], [100, '普通', 'moderate'], [150, '對敏感族群不健康', 'sensitive'], [200, '對所有族群不健康', 'unhealthy'], [300, '非常不健康', 'very'], [Infinity, '危害', 'hazard']];
export const aqiLevel = (aqi) => (aqi == null ? null : AQI_LEVELS.find(([max]) => aqi <= max));

export function aqiNearby(rows, { lat, lon }) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => {
    const sLat = num(r.latitude), sLon = num(r.longitude);
    if (sLat == null || sLon == null) return null;
    const aqi = num(r.aqi);
    const lv = aqiLevel(aqi);
    return {
      site: r.sitename, county: r.county, aqi, status: r.status || lv?.[1] || '資料維護中', level: lv?.[2] ?? null,
      pollutant: r.pollutant || null, pm25: num(r['pm2.5']), pm10: num(r.pm10), o3: num(r.o3),
      publishTime: String(r.publishtime || '').replaceAll('/', '-'), lat: sLat, lon: sLon, distanceM: Math.round(haversine(lat, lon, sLat, sLon)),
    };
  }).filter(Boolean).sort((a, b) => a.distanceM - b.distanceM);
  if (!list.length) throw new UserError('找不到空氣品質測站資料');
  return { nearest: list[0], nearby: list.slice(1, 4) };
}

// ── 地震（中央氣象署 E-A0015-001 顯著有感、E-A0016-001 小區域）──
const intensityNum = (s) => num(String(s ?? '').replace(/級.*/, '').replace('弱', '').replace('強', '.5'));
export function quakeList(raws, { county, limit = 5 } = {}) {
  const out = [];
  for (const [kind, raw] of raws) {
    for (const e of raw?.records?.Earthquake || []) {
      const info = e.EarthquakeInfo || {};
      const areas = (e.Intensity?.ShakingArea || []).filter((a) => a.CountyName && !/^最大震度/.test(a.AreaDesc || ''));
      const max = areas.reduce((m, a) => ((intensityNum(a.AreaIntensity) ?? -1) > (intensityNum(m) ?? -1) ? a.AreaIntensity : m), null);
      const mine = county ? areas.find((a) => normAddr(a.CountyName).includes(normAddr(county))) : null;
      out.push({
        no: String(e.EarthquakeNo ?? ''), kind, time: info.OriginTime || '', magnitude: num(info.EarthquakeMagnitude?.MagnitudeValue),
        depthKm: num(info.FocalDepth), location: String(info.Epicenter?.Location || '').replace(/\s+/g, ' ').trim(),
        lat: num(info.Epicenter?.EpicenterLatitude), lon: num(info.Epicenter?.EpicenterLongitude), maxIntensity: max || null,
        ...(county && { countyIntensity: mine?.AreaIntensity || null }),
        areas: areas.slice(0, 8).map((a) => ({ county: a.CountyName, intensity: a.AreaIntensity })),
        report: /^https:\/\//.test(e.Web || '') ? e.Web : null,
      });
    }
  }
  const seen = new Set();
  return out.filter((q) => (seen.has(q.time + q.location) ? false : seen.add(q.time + q.location))).sort((a, b) => b.time.localeCompare(a.time)).slice(0, limit);
}

// ── 藥局（健保署特約藥局，每日；沒有座標 → 以地區與名稱搜尋）──
/** 固定看診時段字串 → 今天的開放時段（上午／下午／晚上） */
export function todayHours(text, dow) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  const open = ['上午', '下午', '晚上'].filter((p) => s.includes(`星期${WEEK[dow]}${p}看診`));
  return open;
}
export function pharmacySearch(rows, { area, query = '', now = Date.now(), limit = 20 }) {
  const a = normAddr(area), q = normAddr(query);
  if (!a && !q) throw new UserError('請輸入地區（例如「臺北市大安區」）或藥局名稱');
  const today = nowTW(now).date.replaceAll('-', '');
  const dow = twDow(now);
  const list = [];
  for (const r of rows) {
    const end = String(r['終止合約或歇業日期'] || '').trim();
    if (/^\d{8}$/.test(end) && end < today) continue; // 已終止或歇業
    const addr = normAddr(r['地址']);
    if (a && !addr.includes(a)) continue;
    if (q && !normAddr(r['醫事機構名稱']).includes(q) && !addr.includes(q)) continue;
    const hours = todayHours(r['固定看診時段'], dow);
    list.push({
      code: r['醫事機構代碼'], name: r['醫事機構名稱'], phone: r['電話'] || null, address: addr,
      today: hours, openToday: hours ? hours.length > 0 : null,
      nav: { google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r['醫事機構名稱']} ${addr}`)}` },
    });
    if (list.length >= limit) break;
  }
  return { area: area || null, query: query || null, weekday: `星期${WEEK[dow]}`, pharmacies: list };
}

// ── 垃圾車（臺北市清運點位、新北市路線＋即時 GPS）──
const hhmm4 = (s) => { const m = String(s ?? '').match(/^(\d{1,2}):?(\d{2})$/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
export function garbageNearby({ taipei = [], ntpc = [], gps = [] }, { lat, lon, radius = 500, now = Date.now(), limit = 10 }) {
  const dow = twDow(now);
  const stops = [];
  for (const r of taipei) {
    const sLat = num(r['緯度']), sLon = num(r['經度']);
    if (sLat == null || sLon == null) continue;
    const d = haversine(lat, lon, sLat, sLon);
    if (d > radius) continue;
    const from = hhmm4(r['抵達時間']), to = hhmm4(r['離開時間']);
    stops.push({
      city: '臺北市', district: r['行政區'], village: r['里別'], place: r['地點'], route: `${r['路線']} ${r['車次']}`.trim(), car: r['車號'] || null,
      time: from && to && to !== from ? `${from}–${to}` : from, collectToday: dow !== 0 && dow !== 3, days: '週日、週三停收', lat: sLat, lon: sLon, distanceM: Math.round(d),
    });
  }
  for (const r of ntpc) {
    const sLat = num(r.latitude), sLon = num(r.longitude);
    if (sLat == null || sLon == null) continue;
    const d = haversine(lat, lon, sLat, sLon);
    if (d > radius) continue;
    const days = WEEK_EN.map((w, i) => (r[`garbage${w}`] === 'Y' ? WEEK[i] : null)).filter(Boolean);
    const truck = gps.find((g) => String(g.lineid) === String(r.lineid));
    stops.push({
      city: '新北市', district: r.city, village: r.village, place: r.name, route: r.linename, lineId: String(r.lineid), car: truck?.car || null,
      time: hhmm4(r.time), collectToday: r[`garbage${WEEK_EN[dow]}`] === 'Y', days: days.length ? `週${days.join('、')}收` : null, lat: sLat, lon: sLon, distanceM: Math.round(d),
      ...(truck && num(truck.latitude) != null && { truck: { car: truck.car, at: String(truck.time || '').replaceAll('/', '-'), location: truck.location, distanceM: Math.round(haversine(sLat, sLon, num(truck.latitude), num(truck.longitude))) } }),
    });
  }
  stops.sort((a, b) => a.distanceM - b.distanceM);
  return { lat, lon, radius, weekday: `星期${WEEK[dow]}`, stops: stops.slice(0, limit).map((s) => ({ ...s, nav: navLinks(s.lat, s.lon) })), covered: ['臺北市', '新北市'] };
}

// ── 油價（台灣中油牌價，每週一生效）──
const FUELS = ['92無鉛汽油', '95無鉛汽油', '98無鉛汽油', '超級柴油'];
export function fuelPrices(rows) {
  const retail = (Array.isArray(rows) ? rows : []).filter((r) => String(r['型別名稱']).trim() === '汽柴油零售');
  const prices = FUELS.map((name) => {
    const r = retail.find((x) => String(x['產品名稱']).trim() === name);
    return r ? { name, price: num(r['參考牌價_金額']), unit: String(r['計價單位']).replace(/\s+/g, '') } : null;
  }).filter((p) => p && p.price != null);
  if (!prices.length) throw new Error('找不到汽柴油零售牌價');
  return { effectiveDate: rocDate(retail[0]?.['牌價生效日期']), prices };
}

// ── 統一發票中獎號碼（財政部 RSS，最近 6 期）──
const tagOf = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)); return m ? m[1].trim() : ''; };
export function parseInvoiceRss(xml) {
  const periods = [];
  for (const [, item] of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const desc = tagOf(item, 'description').replace(/<[^>]+>/g, '\n');
    const nums = (label) => (desc.match(new RegExp(`${label}：([\\d、,\\s]+)`)) || [])[1]?.match(/\d{8}/g) || [];
    const link = tagOf(item, 'link');
    const ym = link.match(/(\d{5})$/)?.[1] || null;
    periods.push({ period: ym, title: tagOf(item, 'title'), special: nums('特別獎')[0] || null, grand: nums('特獎')[0] || null, first: nums('頭獎'), link: /^https:\/\//.test(link) ? link : null });
  }
  if (!periods.length) throw new Error('RSS 沒有期別');
  return periods;
}
const PRIZES = [['二獎', 7, 40000], ['三獎', 6, 10000], ['四獎', 5, 4000], ['五獎', 4, 1000], ['六獎', 3, 200]];
/** 對獎：8 碼完整比對；只給末 3 碼時只能判斷「可能中六獎以上」 */
export function checkInvoice(p, number) {
  const n = String(number).replace(/\D/g, '');
  if (!/^\d{3}$|^\d{8}$/.test(n)) throw new UserError('發票號碼請輸入 8 位數字（或末 3 碼）');
  if (n.length === 3) {
    const hit = p.first.some((f) => f.endsWith(n));
    return { number: n, partial: true, prize: hit ? '可能中獎（末 3 碼與頭獎相同）' : null, amount: hit ? 200 : 0, note: hit ? '請輸入完整 8 碼確認獎別' : '末 3 碼沒有對中頭獎；特別獎、特獎需 8 碼全中' };
  }
  if (n === p.special) return { number: n, prize: '特別獎', amount: 10_000_000 };
  if (n === p.grand) return { number: n, prize: '特獎', amount: 2_000_000 };
  if (p.first.includes(n)) return { number: n, prize: '頭獎', amount: 200_000 };
  for (const [name, k, amount] of PRIZES) if (p.first.some((f) => f.slice(-k) === n.slice(-k))) return { number: n, prize: name, amount };
  return { number: n, prize: null, amount: 0 };
}

/**
 * @param {{ aqi: () => Promise<any[]>, quakes: () => Promise<Array<[string, any]>>, pharmacies: () => Promise<object[]>,
 *   garbage: () => Promise<{ taipei: object[], ntpc: object[], gps: object[] }>, fuel: () => Promise<any[]>, invoice: () => Promise<string> }} fx
 */
export function createLifeServices(fx) {
  return {
    life: {
      aqiNearby: async (a) => aqiNearby(await fx.aqi(), a),
      quakes: async (a = {}) => ({ county: a.county || null, quakes: quakeList(await fx.quakes(), a) }),
      pharmacies: async (a) => pharmacySearch(await fx.pharmacies(), a),
      garbage: async (a) => garbageNearby(await fx.garbage(a), a),
      fuel: async () => fuelPrices(await fx.fuel()),
      invoice: async ({ number, period } = {}) => {
        const periods = parseInvoiceRss(await fx.invoice());
        const p = period ? periods.find((x) => x.period === period) : periods[0];
        if (!p) throw new UserError(`找不到 ${period} 期的中獎號碼（只提供最近 6 期）`);
        return { period: p, periods: periods.map(({ period: id, title }) => ({ period: id, title })), ...(number && { check: checkInvoice(p, number) }) };
      },
    },
  };
}

/** 真實：od＝createOpenDataClient()、cwa＝createCwaClient()（可為 null）、moenvKey（可為空） */
export function createLiveLifeFetchers({ od, cwa, moenvKey, demo }) {
  const csv = (label, required) => (t) => csvObjects(t, required);
  const inTaipeiArea = ({ lat, lon }) => lat > 24.6 && lat < 25.35 && lon > 121.2 && lon < 122.1; // 雙北範圍外不必下載
  return {
    aqi: moenvKey
      ? () => od.get(URLS.aqi(moenvKey), { ttlSec: 600, label: '環境部空氣品質資料', parse: (t) => { if (!/^\s*\[/.test(t)) throw new Error('金鑰無效或回應不是 JSON'); return JSON.parse(t); } })
      : demo.aqi,
    quakes: cwa ? async () => [['significant', await cwa.get('E-A0015-001', { limit: 10 }, 300)], ['local', await cwa.get('E-A0016-001', { limit: 10 }, 300)]] : demo.quakes,
    pharmacies: () => od.get(URLS.pharmacies, { ttlSec: 86400, label: '健保署藥局資料', parse: csv('藥局', ['醫事機構代碼', '醫事機構名稱', '地址', '固定看診時段', '終止合約或歇業日期']) }),
    garbage: async (pos) => {
      if (!inTaipeiArea(pos)) return { taipei: [], ntpc: [], gps: [] };
      const [taipei, ntpc, gps] = await Promise.all([
        od.get(URLS.garbageTaipei, { ttlSec: 86400, label: '臺北市垃圾車資料', parse: csv('臺北', ['抵達時間', '地點', '經度', '緯度']) }),
        od.get(URLS.garbageNtpc, { ttlSec: 86400, label: '新北市垃圾車資料', parse: csv('新北', ['lineid', 'name', 'longitude', 'latitude', 'time']) }),
        od.get(URLS.garbageNtpcGps, { ttlSec: 60, label: '新北市垃圾車即時位置', parse: csv('GPS', ['lineid', 'car', 'longitude', 'latitude']) }).catch(() => []),
      ]);
      return { taipei, ntpc, gps };
    },
    fuel: () => od.get(URLS.fuel, { ttlSec: 3600, label: '中油牌價資料', as: 'json' }),
    invoice: () => od.get(URLS.invoice, { ttlSec: 3600, label: '財政部發票中獎號碼' }),
  };
}
