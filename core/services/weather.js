// 天氣服務（真實版，中央氣象署）：座標附近測站的現在天氣＋所在鄉鎮接下來 3 小時降雨機率（docs/MCP_TOOLS.md §7）
// 欄位防禦性解析：觀測值 -99 等異常值視為沒有資料；預報解析不到時 pop3h 為 null。
// 鄉鎮預報（2026-11-22 實測）：F-D0047-089 是「全臺各縣市」層級（Location 是 22 個縣市，不是鄉鎮），用鄉鎮名稱篩一律空的；
// 鄉鎮要用各縣市的「未來 3 天逐 3 小時」資料集（F-D0047-001～085，見 TOWN_FORECAST）加 LocationName。
// 雨量：氣象站 `WeatherElement.Now.Precipitation` 是「當日累積」，不能判斷現在有沒有下雨；
// 過去 1 小時雨量改取雨量站 O-A0002-001 的 `RainfallElement.Past1hr.Precipitation`（最近且 5 公里內的站）。
import { assertLatLon, distanceM, normName } from '../util.js';
import { CwaError } from '../cwa-client.js';

export const RAIN_POP = 70; // 3 小時降雨機率 ≥ 70% 也算「下雨」
export const RAIN_GAUGE_MAX_M = 5000; // 雨量站超過這個距離就不代表使用者所在地，rainMm1h 為 null

/**
 * 各縣市的鄉鎮預報資料集（未來 3 天，溫度逐 1 小時、降雨機率與天氣現象逐 3 小時）。2026-11-22 逐一實測 LocationsName。
 * 鍵是 normName 後的縣市名（臺／台視為相同）。
 */
export const TOWN_FORECAST = Object.fromEntries(Object.entries({
  宜蘭縣: '001', 桃園市: '005', 新竹縣: '009', 苗栗縣: '013', 彰化縣: '017', 南投縣: '021', 雲林縣: '025', 嘉義縣: '029',
  屏東縣: '033', 臺東縣: '037', 花蓮縣: '041', 澎湖縣: '045', 基隆市: '049', 新竹市: '053', 嘉義市: '057', 臺北市: '061',
  高雄市: '065', 新北市: '069', 臺中市: '073', 臺南市: '077', 連江縣: '081', 金門縣: '085',
}).map(([k, v]) => [normName(k), `F-D0047-${v}`]));
/** 縣市 → 鄉鎮預報資料集代碼；不認得的縣市回 null */
export const townForecastId = (county) => TOWN_FORECAST[normName(county || '')] || null;

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > -90 ? n : null; };

/** 是否算「下雨」：現在有雨量，或接下來 3 小時降雨機率高 */
export const isRaining = (rainMm1h, pop3h) => (rainMm1h ?? 0) > 0 || (pop3h ?? 0) >= RAIN_POP;

const wgs84 = (s) => (s.GeoInfo?.Coordinates || []).find((x) => /WGS84/i.test(x.CoordinateName)) || s.GeoInfo?.Coordinates?.[0] || {};

/** 觀測資料 → [{ name, town, county, lat, lon, observedAt, tempC, weather }]（不含雨量：Now.Precipitation 是當日累積） */
export function parseStations(json) {
  const list = json?.records?.Station || json?.records?.location || [];
  return list.map((s) => {
    const c = wgs84(s);
    const w = s.WeatherElement || {};
    return {
      name: s.StationName || '', town: s.GeoInfo?.TownName || '', county: s.GeoInfo?.CountyName || '',
      lat: num(c.StationLatitude), lon: num(c.StationLongitude),
      observedAt: s.ObsTime?.DateTime || null,
      tempC: num(w.AirTemperature),
      humidity: num(w.RelativeHumidity), // %（⚠️ 待 M1 驗證）
      windMs: num(w.WindSpeed), // m/s（⚠️ 待 M1 驗證）
      weather: typeof w.Weather === 'string' && w.Weather !== '-99' ? w.Weather : null,
    };
  }).filter((s) => s.lat != null && s.lon != null);
}

/** 雨量站（O-A0002-001）→ [{ name, lat, lon, rainMm1h }]；只留過去 1 小時雨量有效的站 */
export function parseRainGauges(json) {
  const list = json?.records?.Station || [];
  return list.map((s) => {
    const c = wgs84(s);
    return { name: s.StationName || '', lat: num(c.StationLatitude), lon: num(c.StationLongitude), rainMm1h: num(s.RainfallElement?.Past1hr?.Precipitation) };
  }).filter((s) => s.lat != null && s.lon != null && s.rainMm1h != null);
}

/** 台灣時間的日期字串 YYYY-MM-DD（時間戳加 8 小時） */
const twDate = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
/** 預報時間字串 → 時間戳：沒有時區（「2026-11-21 21:00:00」）一律當台灣時間，不看主機時區（Docker 預設 UTC） */
export const twParse = (v) => {
  if (typeof v !== 'string' || !v) return NaN;
  const t = v.trim().replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(t) ? t : `${t}+08:00`);
};
const twHour = (ms) => new Date(ms + 8 * 3600e3).getUTCHours();

/**
 * 鄉鎮預報 → 明天（台灣時間）的摘要 { date, pop, minT, maxT, wx }；元素名稱與時間欄位都防禦性比對（2026-11-22 以 F-D0047-065 實測：溫度用 DataTime、其餘 StartTime／EndTime）。
 * pop：明天各時段降雨機率的最大值（3 小時或 12 小時都可）；溫度取「溫度／最高／最低溫度」的最小與最大。沒有任何明天的資料回 null。
 */
export function parseTomorrow(json, town, now = Date.now(), county = '') {
  const locs = [];
  const walk = (o, parentCounty) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, parentCounty)); return; }
    const c = o.LocationsName || o.locationsName || parentCounty;
    if ((o.LocationName || o.locationName) && (o.WeatherElement || o.weatherElement)) locs.push({ loc: o, county: c || '' });
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, c);
  };
  walk(json?.records, '');
  const same = locs.filter((l) => normName(l.loc.LocationName || l.loc.locationName) === normName(town));
  const byCounty = county ? same.filter((l) => !l.county || normName(l.county) === normName(county)) : same;
  const loc = (byCounty.find((l) => l.county) || byCounty[0] || (locs.length === 1 && !county ? locs[0] : null))?.loc;
  if (!loc) return null;
  const date = twDate(now + 864e5);
  const els = loc.WeatherElement || loc.weatherElement || [];
  const values = (re) => {
    const el = els.find((e) => re.test(e.ElementName || e.elementName || ''));
    const out = [];
    for (const t of el?.Time || el?.time || []) {
      const start = twParse(t.StartTime ?? t.startTime ?? t.DataTime ?? t.dataTime);
      if (Number.isNaN(start) || twDate(start) !== date) continue;
      const v = (t.ElementValue || t.elementValue || [])[0] || {};
      out.push({ v, hour: twHour(start) });
    }
    return out;
  };
  const nums = (re, key, day = false) => values(re).filter((x) => !day || (x.hour >= 6 && x.hour < 18)).map(({ v }) => num(v[key] ?? v.value ?? Object.values(v)[0])).filter((x) => x != null);
  const pops = nums(/降雨機率|PoP/i, 'ProbabilityOfPrecipitation');
  const dayPops = nums(/降雨機率|PoP/i, 'ProbabilityOfPrecipitation', true); // 白天（06～18 時）：帶傘看這個，半夜的雨不提醒
  const temps = [...nums(/^溫度$|^T$/i, 'Temperature'), ...nums(/最高溫度|MaxT/i, 'MaxTemperature'), ...nums(/最低溫度|MinT/i, 'MinTemperature')];
  const wx = values(/天氣現象|^Wx$/i).map(({ v }) => v.Weather ?? v.value).find((x) => typeof x === 'string' && x) || null;
  if (!pops.length && !temps.length && !wx) return null;
  return { date, pop: pops.length ? Math.max(...pops) : null, dayPop: dayPops.length ? Math.max(...dayPops) : null, minT: temps.length ? Math.min(...temps) : null, maxT: temps.length ? Math.max(...temps) : null, wx };
}

/** 最近且在 RAIN_GAUGE_MAX_M 內的雨量站；沒有就 null */
export function nearestGauge(gauges, lat, lon) {
  let best = null, bestD = Infinity;
  for (const g of gauges) {
    const d = distanceM(lat, lon, g.lat, g.lon);
    if (d < bestD) { best = g; bestD = d; }
  }
  return bestD <= RAIN_GAUGE_MAX_M ? best : null;
}

/**
 * 鄉鎮預報 → 現在所在（尚未結束）時段的 3 小時降雨機率（找名稱含「3小時降雨機率」或 PoP3h 的元素）；全部時段都已結束回 null。
 * 同名鄉鎮（例：臺北市與基隆市都有「中正區」）以上層 LocationsName（縣市）區分；給了 county 卻對不到縣市時回 null，不拿別縣市的資料。
 */
export function parsePop3h(json, town, now = Date.now(), county = '') {
  const locs = [];
  const walk = (o, parentCounty) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, parentCounty)); return; }
    const c = o.LocationsName || o.locationsName || parentCounty;
    if ((o.LocationName || o.locationName) && (o.WeatherElement || o.weatherElement)) locs.push({ loc: o, county: c || '' });
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, c);
  };
  walk(json?.records, '');
  const same = locs.filter((l) => normName(l.loc.LocationName || l.loc.locationName) === normName(town));
  const byCounty = county ? same.filter((l) => !l.county || normName(l.county) === normName(county)) : same;
  const hit = byCounty.length === 1 ? byCounty[0] : byCounty.find((l) => l.county) || byCounty[0] || (locs.length === 1 && !county ? locs[0] : null);
  const loc = hit?.loc;
  if (!loc) return null;
  const el = (loc.WeatherElement || loc.weatherElement).find((e) => /3小時降雨機率|PoP3h/i.test(e.ElementName || e.elementName || ''));
  const times = el?.Time || el?.time || [];
  // 快取可能讓第一個時段已經過去：取第一個還沒結束的時段（沒有結束時間的視為有效）
  const t = times.find((x) => { const end = Date.parse(x.EndTime ?? x.endTime); return Number.isNaN(end) || end > now; });
  const v = t?.ElementValue?.[0] || t?.elementValue?.[0];
  const n = num(v && (v.ProbabilityOfPrecipitation ?? v.value ?? Object.values(v)[0]));
  return n == null ? null : Math.max(0, Math.min(100, n));
}

/**
 * 體感溫度（°C，一位小數）：澳洲氣象局 apparent temperature（氣溫、相對濕度、風速）；缺濕度或風速回 null（呼叫端改用氣溫）。
 * AT = Ta + 0.33e − 0.70ws − 4.00，e = 濕度/100 × 6.105 × exp(17.27Ta / (237.7 + Ta))
 */
export function apparentTemp(tempC, humidity, windMs) {
  if (![tempC, humidity, windMs].every(Number.isFinite) || humidity < 0 || humidity > 100 || windMs < 0) return null;
  const e = (humidity / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  return Math.round((tempC + 0.33 * e - 0.7 * windMs - 4) * 10) / 10;
}

/** 組成輸出（live 與 mock 共用） */
export function buildWeather(st, gauge, pop3h, lat, lon) {
  const rainMm1h = gauge?.rainMm1h ?? null;
  const raining = isRaining(rainMm1h, pop3h);
  // 附近 15 公里內都沒有測站回報氣溫（pickNowStation 才會選到沒有氣溫的站）：照實說，不只留空（2026-11-23 產品負責人）
  const bits = [st.weather, st.tempC != null ? `${st.tempC}°C` : NO_TEMP_ZH, pop3h != null ? `3 小時降雨機率 ${pop3h}%` : null].filter(Boolean);
  return {
    station: st.name, town: st.town, county: st.county,
    distanceM: distanceM(lat, lon, st.lat, st.lon),
    observedAt: st.observedAt, tempC: st.tempC, feelsC: apparentTemp(st.tempC, st.humidity, st.windMs), rainMm1h, rainStation: gauge?.name ?? null, pop3h, raining,
    summary: bits.join('，') || '暫無觀測資料',
  };
}

/** 溫度要從多近的測站拿（公尺）：最近的站沒有氣溫（只有天氣描述，例：善化、萬隆國小）時改用這個距離內最近、有氣溫的站 */
export const TEMP_STATION_M = 15_000;
/** 附近都沒有測站回報氣溫時的說明（摘要、語音共用；卡片走字典 weather.noTemp） */
export const NO_TEMP_ZH = '附近 15 公里內的測站都沒有回報氣溫';
/** 天氣描述（晴、陰）可以借多近的站（公尺）：有氣溫的站常沒有天氣描述 */
export const DESC_STATION_M = 10_000;
/**
 * 「現在天氣」用哪個測站（2026-11-23 產品負責人：手機首頁的天氣沒有溫度）：
 * 最近而且有氣溫的站（TEMP_STATION_M 內）為主；那一站沒有天氣描述時，借 DESC_STATION_M 內最近、有描述的站的描述。
 * 附近都沒有氣溫的站才用最近的站（溫度為 null）。
 */
export function pickNowStation(stations, lat, lon) {
  const d = (s) => distanceM(lat, lon, s.lat, s.lon);
  const nearest = (list) => (list.length ? list.reduce((a, b) => (d(a) <= d(b) ? a : b)) : null);
  const near = nearest(stations);
  const warm = nearest(stations.filter((s) => s.tempC != null));
  // 縣市、鄉鎮（標題與鄉鎮預報）照你所在位置最近的站；氣溫借別站時不會變成隔壁區（生活資料審查：#152 的副作用）
  const base = warm && d(warm) <= TEMP_STATION_M ? { ...warm, town: near.town || warm.town, county: near.county || warm.county } : near;
  if (base.weather) return base;
  const desc = nearest(stations.filter((s) => s.weather));
  return desc && d(desc) <= DESC_STATION_M ? { ...base, weather: desc.weather } : base;
}

export function createWeatherServices(cwa) {
  /** 最近的觀測站（含鄉鎮名稱，給鄉鎮預報用） */
  async function nearestStation(lat, lon) {
    const [auto, manned] = await Promise.all([cwa.get('O-A0001-001', {}, 600), cwa.get('O-A0003-001', {}, 600).catch(() => null)]);
    const stations = [...parseStations(auto), ...parseStations(manned)].filter((s) => s.town);
    if (!stations.length) throw new CwaError(502, '氣象署觀測資料暫時無法取得');
    return stations.reduce((a, b) => (distanceM(lat, lon, a.lat, a.lon) <= distanceM(lat, lon, b.lat, b.lon) ? a : b));
  }

  /** 測站所在鄉鎮的預報（縣市對應的資料集＋LocationName，1 小時快取）；認不出縣市或沒有鄉鎮名稱回 null */
  async function townForecast(st) {
    const id = st.town && townForecastId(st.county);
    return id ? cwa.get(id, { LocationName: st.town }, 3600) : null;
  }

  return {
    weather: {
      /** 座標所在的行政區（S16，藥局用）：最近觀測站的縣市＋鄉鎮，附測站與距離（測站可能在隔壁區，呼叫端要說是推估） */
      async district({ lat, lon }) {
        [lat, lon] = assertLatLon(lat, lon);
        const st = await nearestStation(lat, lon);
        if (!st.county || !st.town) return null;
        return { county: st.county, town: st.town, area: `${st.county}${st.town}`, station: st.name, distanceM: Math.round(distanceM(lat, lon, st.lat, st.lon)), demo: false };
      },
      /** 明天的天氣（所在縣市的鄉鎮預報 TOWN_FORECAST）：降雨機率（明天各時段最高）、最低／最高溫、天氣現象 */
      async tomorrow({ lat, lon }, now = Date.now()) {
        [lat, lon] = assertLatLon(lat, lon);
        const st = await nearestStation(lat, lon);
        const fc = await townForecast(st);
        const d = fc && parseTomorrow(fc, st.town, now, st.county);
        if (!d) throw new CwaError(502, '明天的預報暫時查不到，晚點再試');
        return { town: st.town, county: st.county, ...d };
      },
      async now({ lat, lon }) {
        [lat, lon] = assertLatLon(lat, lon);
        const [auto, manned, rain] = await Promise.all([
          cwa.get('O-A0001-001', {}, 600),
          cwa.get('O-A0003-001', {}, 600).catch(() => null), // 局屬站失敗時只用自動站
          cwa.get('O-A0002-001', {}, 600).catch(() => null), // 雨量站失敗時 rainMm1h 為 null
        ]);
        const stations = [...parseStations(auto), ...parseStations(manned)].filter((s) => s.tempC != null || s.weather != null);
        if (!stations.length) throw new CwaError(502, '氣象署觀測資料暫時無法取得');
        const st = pickNowStation(stations, lat, lon);
        // 鄉鎮預報（所在縣市的 F-D0047-0xx，與 tomorrow 共用快取）；失敗時 pop3h 為 null，不影響觀測
        const fc = await townForecast(st).catch(() => null);
        return buildWeather(st, nearestGauge(parseRainGauges(rain), lat, lon), parsePop3h(fc, st.town, Date.now(), st.county), lat, lon);
      },
    },
  };
}
