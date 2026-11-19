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

export default [weatherNow];
