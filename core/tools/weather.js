// 工具包：weather（天氣）— 風險分級 L1
import { z } from 'zod';
import { defineTool, T } from './define.js';
import { outingItems } from '../agent/outing.js';
import { resolvePoint } from '../services/places.js';
import { UserError } from '../util.js';

export const weatherNow = defineTool({
  name: 'weather_now',
  title: '現在天氣',
  description: '查座標附近氣象站的現在天氣：氣溫、附近雨量站過去 1 小時雨量 rainMm1h（5 公里內沒有雨量站時為 null）、所在鄉鎮接下來 3 小時降雨機率 pop3h、raining（現在有雨或 3 小時降雨機率 ≥ 70%）。raining=true 時行程規劃應視為「下雨」。地名先用 find_place 轉座標。',
  pack: 'weather', tier: 'L1', card: 'weather',
  source: '中央氣象署', demoNote: '【示範資料：尚未設定中央氣象署授權碼，以下非真實天氣】',
  modeOf: (svc) => svc.weatherMode,
  input: { lat: T.lat, lon: T.lon },
  speak: (d) => {
    const where = d.town || d.station;
    const pop = d.pop3h != null ? `，接下來 3 小時降雨機率 ${d.pop3h}%` : '';
    if (d.rainMm1h > 0) return `${where}現在下雨${pop}。`;
    if (d.raining) return `${where}現在沒下雨${pop}，等一下很可能會下。`;
    return `${where}現在沒下雨${d.tempC != null ? `，${d.tempC}°C` : ''}${pop}。`;
  },
  async run(svc, a) {
    const data = await svc.weather.now(a);
    const where = [data.county, data.town].filter(Boolean).join('') || data.station;
    const text = [
      `${where}（${data.station}${/站$/.test(data.station) ? '' : '測站'}，距離 ${data.distanceM} 公尺${data.observedAt ? `，觀測 ${data.observedAt}` : ''}）`,
      `${data.summary}；過去 1 小時雨量 ${data.rainMm1h ?? '—'} mm${data.rainStation ? `（${data.rainStation}）` : ''}`,
      data.raining ? '判斷：下雨（行程規劃會加「下雨」狀態）' : '判斷：沒下雨',
    ].join('\n');
    return { data, text };
  },
});

/** 2026-01-05 → 1/5（一） */
const dayLabel = (date) => { const [y, m, d] = date.split('-').map(Number); return `${m}/${d}（${'日一二三四五六'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`; };

export const weatherTomorrow = defineTool({
  name: 'weather_tomorrow',
  title: '明天天氣',
  description: '查座標所在鄉鎮明天（台灣時間）的天氣預報：降雨機率 pop（明天各時段最高）、最低／最高溫 minT／maxT、天氣現象 wx。使用者問「明天會下雨嗎」「明天要帶傘嗎」時用這個（weather_now 只有現在）。地名先用 find_place 轉座標。',
  pack: 'weather', tier: 'L1',
  source: '中央氣象署', demoNote: '【示範資料：尚未設定中央氣象署授權碼，以下非真實預報】',
  modeOf: (svc) => svc.weatherMode,
  input: { lat: T.lat, lon: T.lon },
  speak: (d) => {
    const where = [d.county, d.town].filter(Boolean).join('') || '那一帶';
    const t = d.minT != null && d.maxT != null ? `，${d.minT}～${d.maxT}°C` : '';
    const pop = d.pop != null ? `，降雨機率 ${d.pop}%` : '';
    const p = d.dayPop ?? d.pop; // 帶傘看白天
    const umbrella = p >= 50 ? '，記得帶傘' : p >= 30 ? '，包包放把折傘比較保險' : '';
    return `明天 ${dayLabel(d.date)} ${where}${d.wx ? d.wx.replace(/（示範）$/, '') : ''}${t}${pop}${umbrella}。`;
  },
  async run(svc, a) {
    const data = await svc.weather.tomorrow(a);
    return { data, text: `明天 ${data.date} ${[data.county, data.town].filter(Boolean).join('')}：${data.wx ?? '—'}，${data.minT ?? '—'}～${data.maxT ?? '—'}°C，降雨機率 ${data.pop ?? '—'}%` };
  },
});

export const outingAdvice = defineTool({
  name: 'outing_advice',
  title: '出門建議',
  description: '出門前要注意什麼：同時看座標（或地名 place）附近的現在天氣（降雨機率、氣溫）與空氣品質，由程式整理成最多 3 點建議（帶傘、防曬、保暖、口罩），數字都來自中央氣象署與環境部資料。使用者問「出門要注意什麼」「要帶傘嗎」「適合出門嗎」時用這個；with 填同行的小孩（kids）或長輩（elder），空品門檻放低。',
  pack: 'weather', tier: 'L1', card: 'outing',
  source: '中央氣象署、環境部', demoNote: '【部分為示範資料：卡片上標「示範」的天氣或空品尚未設定金鑰，非真實資料】',
  modeOf: (svc) => (svc.weatherMode === 'live' && svc.aqiMode === 'live' ? 'live' : 'demo'),
  input: {
    lat: T.lat.optional(), lon: T.lon.optional(),
    place: z.string().trim().min(1).max(30).optional().describe('地名（沒有座標時用，例如 台北101）'),
    name: z.string().trim().max(30).optional().describe('地點名稱（卡片標題用，選填）'),
    with: z.enum(['kids', 'elder']).optional().describe('同行的小孩或長輩（選填）'),
  },
  // 泡泡只說最重要的一點，其餘在卡片上（設計審查：不逐字重複卡片）
  speak: (d) => `出門前看了一下：${d.items[0].text}${d.items.length > 1 ? `，還有 ${d.items.length - 1} 點在卡片上` : ''}。`,
  async run(svc, input) {
    let a = input;
    if (a.lat == null || a.lon == null) {
      if (!a.place) throw new UserError('請給座標（lat、lon）或地名（place）');
      const p = await resolvePoint(svc.places, a.place);
      a = { ...a, lat: p.lat, lon: p.lon, name: a.name || p.name };
    }
    const [w, q] = await Promise.allSettled([svc.weather.now({ lat: a.lat, lon: a.lon }), svc.life.aqiNearby({ lat: a.lat, lon: a.lon })]);
    const weather = w.status === 'fulfilled' ? w.value : null;
    const air = q.status === 'fulfilled' ? q.value.nearest : null;
    if (!weather && !air) throw w.reason; // 兩個都查不到：照天氣的錯誤回報（UserError／上游錯誤）
    const items = outingItems({ weather, air, states: a.with ? [a.with] : [] });
    const missing = [...(!weather ? ['weather'] : []), ...(!air ? ['air'] : [])]; // 一邊查不到：卡片寫出來（不是靜靜顯示「—」）
    const data = {
      ...(a.name && { name: a.name }),
      weather: weather && { station: weather.station, town: weather.town || '', tempC: weather.tempC ?? null, feelsC: weather.feelsC ?? null, pop3h: weather.pop3h ?? null, raining: !!weather.raining, rainMm1h: weather.rainMm1h ?? null, summary: weather.summary, demo: svc.weatherMode !== 'live' },
      air: air && { site: air.site, aqi: air.aqi ?? null, status: air.status, level: air.level ?? null, demo: svc.aqiMode !== 'live' },
      items,
      ...(missing.length && { missing }),
    };
    const text = [
      ...(weather ? [`天氣：${weather.summary}`] : ['天氣：這次查不到']),
      ...(air ? [`空品：${air.site}測站 AQI ${air.aqi ?? '—'}（${air.status}）`] : ['空品：這次查不到']),
      '出門建議（程式依上面資料整理；請照這些重點回答，不要另外推測）：',
      ...items.map((x) => `- ${x.text}`),
    ].join('\n');
    return { data, text };
  },
});

export default [weatherNow, weatherTomorrow, outingAdvice];
