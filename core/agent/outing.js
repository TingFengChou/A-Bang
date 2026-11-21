// 出門建議（S13，2026-11-21）：天氣＋空品一起看，由程式依資料整理成幾句建議（不經模型；數字都來自工具資料）。
// 示範模式直接當總結；模型模式附在預先查詢的結果後面，請模型轉述。

/**
 * @param {{ weather?: { raining?: boolean, pop3h?: number|null, tempC?: number|null }|null, air?: { aqi?: number|null, status?: string }|null, states?: string[] }} d
 *   states：帶小孩、帶長輩時空品的門檻放低、說法針對他們
 * @returns {string[]} 建議（最重要的在前，最多 3 點）；資料都沒有時回空陣列
 */
export function outingAdvice(d = {}) {
  return outingItems(d).map((x) => x.text);
}

/**
 * 同上，帶種類（出門建議卡片的圖示與顏色）：umbrella 帶傘、hot 防曬、cold 保暖、mask 口罩、ok 沒什麼要注意。
 * level：warn＝要注意（下雨、很熱很冷、空品不健康）、info＝可以留意、ok＝安心出門。
 * en：英文說法（S12e；中英文在這裡一起產生，卡片與英文總結都用這一份，數字來自資料）
 * @returns {Array<{ kind: 'umbrella'|'hot'|'cold'|'mask'|'ok', level: 'warn'|'info'|'ok', text: string, en: string }>}
 */
export function outingItems({ weather, air, states = [] } = {}) {
  const out = [];
  const add = (kind, level, text, en) => out.push({ kind, level, text, en });
  if (weather) {
    const p = weather.pop3h;
    if (weather.raining && weather.rainMm1h > 0) add('umbrella', 'warn', '現在正在下雨，記得帶傘', "It's raining now; bring an umbrella");
    else if (weather.raining) add('umbrella', 'warn', `接下來 3 小時降雨機率 ${p}%，很可能下雨，記得帶傘`, `${p}% chance of rain in the next 3 hours; rain is likely, bring an umbrella`);
    else if (p >= 50) add('umbrella', 'warn', `接下來 3 小時降雨機率 ${p}%，帶把傘`, `${p}% chance of rain in the next 3 hours; bring an umbrella`);
    else if (p >= 30) add('umbrella', 'info', `降雨機率 ${p}%，包包放把折傘比較保險`, `${p}% chance of rain; a folding umbrella is a good idea`);
    const t = weather.tempC;
    if (Number.isFinite(t)) {
      if (t >= 32) add('hot', 'warn', `${t}°C 很熱，注意防曬、多喝水`, `${t}°C and very hot; use sunscreen and drink water`);
      else if (t >= 28) add('hot', 'info', `${t}°C 偏熱，注意防曬`, `${t}°C and warm; sun protection helps`);
      else if (t <= 10) add('cold', 'warn', `${t}°C 很冷，多穿一點，注意保暖`, `${t}°C and cold; dress warmly`);
      else if (t <= 16) add('cold', 'info', `${t}°C 偏涼，帶件外套`, `${t}°C and cool; bring a jacket`);
    }
  }
  const who = states.includes('kids') ? '小孩' : states.includes('elder') ? '長輩' : null;
  const whoEn = states.includes('kids') ? 'kids' : states.includes('elder') ? 'seniors' : null;
  if (air && Number.isFinite(air.aqi)) {
    const a = air.aqi;
    if (a > 150) add('mask', 'warn', `空氣品質${air.status || '不良'}（AQI ${a}），盡量少待戶外、戴口罩`, `AQI ${a}, unhealthy air; limit time outdoors and wear a mask`);
    else if (a > 100) add('mask', 'warn', `空氣品質對敏感族群不健康（AQI ${a}），${who ? `${who}記得` : '長輩小孩'}戴口罩、少做戶外運動`, `AQI ${a}, unhealthy for sensitive groups; ${whoEn ? `${whoEn} should` : 'kids and seniors should'} wear a mask and avoid outdoor exercise`);
    else if (who && a > 50) add('mask', 'info', `空氣品質普通（AQI ${a}），${who}比較敏感，少待在路邊`, `AQI ${a}, moderate; ${whoEn} are more sensitive, avoid roadsides`);
  }
  const hasData = (weather && (Number.isFinite(weather.tempC) || Number.isFinite(weather.pop3h))) || (air && Number.isFinite(air.aqi));
  if (!out.length && (weather || air) && !hasData) add('ok', 'info', '這次只查到部分資料，出門前再看一下天氣', 'Only partial data this time; check the weather again before you go');
  if (!out.length && hasData) {
    const tz = weather && Number.isFinite(weather.tempC) ? weather.tempC : null;
    const az = air && Number.isFinite(air.aqi) ? air.aqi : null;
    add('ok', 'ok', `天氣${tz != null ? ` ${tz}°C、` : ''}${az != null ? `空氣品質${air.status || ''}（AQI ${az}）` : ''}都還不錯，安心出門`.replace('、都', '，都'),
      `${[tz != null && `${tz}°C`, az != null && `AQI ${az}`].filter(Boolean).join(', ')}${tz != null || az != null ? '; ' : ''}all good to go out`.replace(/^a/, 'A'));
  }
  return out.slice(0, 3);
}

/** 一句話總結（示範模式的回答） */
export const outingSay = (d) => {
  const a = outingAdvice(d);
  return a.length ? `出門前看了一下：${a.join('；')}。` : '這次沒查到天氣和空品資料，晚點再試。';
};
