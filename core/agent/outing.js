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
 * level：warn＝要注意（下雨、很熱很冷、空品不健康）、info＝可以留意、ok＝安心出門
 * @returns {Array<{ kind: 'umbrella'|'hot'|'cold'|'mask'|'ok', level: 'warn'|'info'|'ok', text: string }>}
 */
export function outingItems({ weather, air, states = [] } = {}) {
  const out = [];
  if (weather) {
    if (weather.raining) out.push({ kind: 'umbrella', level: 'warn', text: weather.rainMm1h > 0 ? '現在正在下雨，記得帶傘' : `接下來 3 小時降雨機率 ${weather.pop3h}%，很可能下雨，記得帶傘` });
    else if (weather.pop3h >= 50) out.push({ kind: 'umbrella', level: 'warn', text: `接下來 3 小時降雨機率 ${weather.pop3h}%，帶把傘` });
    else if (weather.pop3h >= 30) out.push({ kind: 'umbrella', level: 'info', text: `降雨機率 ${weather.pop3h}%，包包放把折傘比較保險` });
    const t = weather.tempC;
    if (Number.isFinite(t)) {
      if (t >= 32) out.push({ kind: 'hot', level: 'warn', text: `${t}°C 很熱，注意防曬、多喝水` });
      else if (t >= 28) out.push({ kind: 'hot', level: 'info', text: `${t}°C 偏熱，注意防曬` });
      else if (t <= 10) out.push({ kind: 'cold', level: 'warn', text: `${t}°C 很冷，多穿一點，注意保暖` });
      else if (t <= 16) out.push({ kind: 'cold', level: 'info', text: `${t}°C 偏涼，帶件外套` });
    }
  }
  const who = states.includes('kids') ? '小孩' : states.includes('elder') ? '長輩' : null;
  if (air && Number.isFinite(air.aqi)) {
    if (air.aqi > 150) out.push({ kind: 'mask', level: 'warn', text: `空氣品質${air.status || '不良'}（AQI ${air.aqi}），盡量少待戶外、戴口罩` });
    else if (air.aqi > 100) out.push({ kind: 'mask', level: 'warn', text: `空氣品質對敏感族群不健康（AQI ${air.aqi}），${who ? `${who}記得` : '長輩小孩'}戴口罩、少做戶外運動` });
    else if (who && air.aqi > 50) out.push({ kind: 'mask', level: 'info', text: `空氣品質普通（AQI ${air.aqi}），${who}比較敏感，少待在路邊` });
  }
  const hasData = (weather && (Number.isFinite(weather.tempC) || Number.isFinite(weather.pop3h))) || (air && Number.isFinite(air.aqi));
  if (!out.length && (weather || air) && !hasData) out.push({ kind: 'ok', level: 'info', text: '這次只查到部分資料，出門前再看一下天氣' });
  if (!out.length && hasData) out.push({ kind: 'ok', level: 'ok', text: `天氣${weather && Number.isFinite(weather.tempC) ? ` ${weather.tempC}°C、` : ''}${air && Number.isFinite(air.aqi) ? `空氣品質${air.status || ''}（AQI ${air.aqi}）` : ''}都還不錯，安心出門`.replace('、都', '，都') });
  return out.slice(0, 3);
}

/** 一句話總結（示範模式的回答） */
export const outingSay = (d) => {
  const a = outingAdvice(d);
  return a.length ? `出門前看了一下：${a.join('；')}。` : '這次沒查到天氣和空品資料，晚點再試。';
};
