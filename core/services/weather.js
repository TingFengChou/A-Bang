// 天氣服務（真實版，中央氣象署）：座標附近測站的現在天氣＋所在鄉鎮接下來 3 小時降雨機率（docs/MCP_TOOLS.md §7）
// ⚠️ 欄位待 M1 驗證，全部防禦性解析：觀測值 -99 等異常值視為沒有資料；預報解析不到時 pop3h 為 null。
import { assertLatLon, distanceM } from '../util.js';

export const RAIN_POP = 70; // 3 小時降雨機率 ≥ 70% 也算「下雨」

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > -90 ? n : null; };

/** 是否算「下雨」：現在有雨量，或接下來 3 小時降雨機率高 */
export const isRaining = (rainMm1h, pop3h) => (rainMm1h ?? 0) > 0 || (pop3h ?? 0) >= RAIN_POP;

/** 觀測資料 → [{ name, town, county, lat, lon, observedAt, tempC, rainMm1h, weather }] */
export function parseStations(json) {
  const list = json?.records?.Station || json?.records?.location || [];
  return list.map((s) => {
    const c = (s.GeoInfo?.Coordinates || []).find((x) => /WGS84/i.test(x.CoordinateName)) || s.GeoInfo?.Coordinates?.[0] || {};
    const w = s.WeatherElement || {};
    return {
      name: s.StationName || '', town: s.GeoInfo?.TownName || '', county: s.GeoInfo?.CountyName || '',
      lat: num(c.StationLatitude), lon: num(c.StationLongitude),
      observedAt: s.ObsTime?.DateTime || null,
      tempC: num(w.AirTemperature),
      rainMm1h: num(w.Now?.Precipitation ?? w.Precipitation),
      weather: typeof w.Weather === 'string' && w.Weather !== '-99' ? w.Weather : null,
    };
  }).filter((s) => s.lat != null && s.lon != null);
}

/** 鄉鎮預報 → 最近一個時段的 3 小時降雨機率（找名稱含「3小時降雨機率」或 PoP3h 的元素） */
export function parsePop3h(json, town) {
  const locs = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if ((o.LocationName || o.locationName) && (o.WeatherElement || o.weatherElement)) locs.push(o);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  walk(json?.records);
  const loc = locs.find((l) => (l.LocationName || l.locationName) === town) || (locs.length === 1 ? locs[0] : null);
  if (!loc) return null;
  const el = (loc.WeatherElement || loc.weatherElement).find((e) => /3小時降雨機率|PoP3h/i.test(e.ElementName || e.elementName || ''));
  const t = el?.Time?.[0] || el?.time?.[0];
  const v = t?.ElementValue?.[0] || t?.elementValue?.[0];
  const n = num(v && (v.ProbabilityOfPrecipitation ?? v.value ?? Object.values(v)[0]));
  return n == null ? null : Math.max(0, Math.min(100, n));
}

/** 組成輸出（live 與 mock 共用） */
export function buildWeather(st, pop3h, lat, lon) {
  const raining = isRaining(st.rainMm1h, pop3h);
  const bits = [st.weather, st.tempC != null ? `${st.tempC}°C` : null, pop3h != null ? `3 小時降雨機率 ${pop3h}%` : null].filter(Boolean);
  return {
    station: st.name, town: st.town, county: st.county,
    distanceM: distanceM(lat, lon, st.lat, st.lon),
    observedAt: st.observedAt, tempC: st.tempC, rainMm1h: st.rainMm1h, pop3h, raining,
    summary: bits.join('，') || '暫無觀測資料',
  };
}

export function createWeatherServices(cwa) {
  return {
    weather: {
      async now({ lat, lon }) {
        [lat, lon] = assertLatLon(lat, lon);
        const [auto, manned] = await Promise.all([
          cwa.get('O-A0001-001', {}, 600),
          cwa.get('O-A0003-001', {}, 600).catch(() => null), // 局屬站失敗時只用自動站
        ]);
        const stations = [...parseStations(auto), ...parseStations(manned)].filter((s) => s.tempC != null || s.rainMm1h != null);
        if (!stations.length) throw new Error('氣象署觀測資料暫時無法取得');
        const st = stations.reduce((a, b) => (distanceM(lat, lon, a.lat, a.lon) <= distanceM(lat, lon, b.lat, b.lon) ? a : b));
        // 鄉鎮預報：F-D0047-089（全臺鄉鎮未來 3 天，⚠️ 待驗證）；失敗時 pop3h 為 null，不影響觀測
        const fc = st.town ? await cwa.get('F-D0047-089', { LocationName: st.town }, 3600).catch(() => null) : null;
        return buildWeather(st, parsePop3h(fc, st.town), lat, lon);
      },
    },
  };
}
