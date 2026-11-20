// 出門建議（S13，2026-11-21）：天氣＋空品一起看，由程式依資料整理成幾句建議（不經模型；數字都來自工具資料）。
// 示範模式直接當總結；模型模式附在預先查詢的結果後面，請模型轉述。

/**
 * @param {{ weather?: { raining?: boolean, pop3h?: number|null, tempC?: number|null }|null, air?: { aqi?: number|null, status?: string }|null }} d
 * @returns {string[]} 建議（最重要的在前）；資料都沒有時回空陣列
 */
export function outingAdvice({ weather, air } = {}) {
  const out = [];
  if (weather) {
    if (weather.raining) out.push('現在正在下雨，記得帶傘');
    else if (weather.pop3h >= 50) out.push(`接下來 3 小時降雨機率 ${weather.pop3h}%，帶把傘`);
    else if (weather.pop3h >= 30) out.push(`降雨機率 ${weather.pop3h}%，包包放把折傘比較保險`);
    const t = weather.tempC;
    if (Number.isFinite(t)) {
      if (t >= 32) out.push(`${t}°C 很熱，注意防曬、多喝水`);
      else if (t >= 28) out.push(`${t}°C 偏熱，注意防曬`);
      else if (t <= 10) out.push(`${t}°C 很冷，穿保暖一點`);
      else if (t <= 16) out.push(`${t}°C 偏涼，帶件外套`);
    }
  }
  if (air && Number.isFinite(air.aqi)) {
    if (air.aqi > 150) out.push(`空氣品質${air.status || '不良'}（AQI ${air.aqi}），盡量少待戶外、戴口罩`);
    else if (air.aqi > 100) out.push(`空氣品質對敏感族群不健康（AQI ${air.aqi}），長輩小孩戴口罩、少做戶外運動`);
  }
  if (!out.length && (weather || air)) out.push(`天氣${weather && Number.isFinite(weather.tempC) ? ` ${weather.tempC}°C、` : ''}${air && Number.isFinite(air.aqi) ? `空氣品質${air.status || ''}（AQI ${air.aqi}）` : ''}都還不錯，安心出門`.replace('、都', '，都'));
  return out;
}

/** 一句話總結（示範模式的回答） */
export const outingSay = (d) => {
  const a = outingAdvice(d);
  return a.length ? `出門前看了一下：${a.join('；')}。` : '這次沒查到天氣和空品資料，晚點再試。';
};
