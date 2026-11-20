// 工具包：weather（天氣）— 風險分級 L1
import { defineTool, T } from './define.js';

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

export default [weatherNow, weatherTomorrow];
