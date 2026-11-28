// 趕不趕得上那班車（C，2026-11-28 Claude 與 Antigravity 第九輪）：純函式，伺服器與手機共用（前端以 /core/catch-train.js）。
// 行程卡設了出門提醒、方案是台鐵／高鐵或末班車時，提醒響後阿幫問一次「要我用一次位置幫你看還趕不趕得上 10:35 的高鐵嗎？」；
// 使用者按了才定位一次（不追蹤位置），算到車站要多久，照下面的規則說。
// - 留緩衝（Antigravity 的風險：估得太樂觀會害人錯過末班車）：高鐵 8 分、台鐵 5 分（進站、買票、走到月台）；在緩衝內一律說「很趕」
// - 趕不上：給下一班；末班車給叫車預估（標「預估」）
// - 沒拿到位置：照實說算不了（不用預設地區——那不是他現在的位置）

/** 進站、買票、走到月台要多留幾分 */
export const CATCH_BUFFER = { thsr: 8, tra: 5 };
const NAME = { thsr: '高鐵', tra: '台鐵' };
const NAME_EN = { thsr: 'High Speed Rail', tra: 'train' };
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** 這種班次要不要問（Antigravity：只對台鐵、高鐵、末班車問，一般班次不打擾） */
export const shouldAsk = (rail) => Boolean(rail && (rail.role === 'thsr' || rail.role === 'tra' || rail.last) && hm(rail.depart) != null);

/** 提醒響後問的那一句 */
export function askText(rail, lang = null) {
  const en = lang === 'en';
  const what = en ? `the ${rail.depart} ${NAME_EN[rail.role] || 'train'}` : `${rail.depart} 的${NAME[rail.role] || '車'}`;
  if (rail.last) return en ? `Heads up: ${what} is the last one, time to leave. Want me to use your location once to check if you'll make it?` : `注意！${rail.depart} 是末班車，現在該出門了。要我用一次位置幫你看還趕不趕得上嗎？`;
  return en ? `Time to go! Want me to use your location once to check if you'll make ${what}?` : `該出門囉！要我用一次位置幫你看還趕不趕得上${what}嗎？`;
}

/**
 * @param {{ role: string, depart: string }} rail
 * @param {number} nowMin 現在（台灣時間，分）
 * @param {number} toStationMin 到車站要幾分
 * @returns {{ kind: 'ok'|'tight'|'miss', spare: number, buffer: number }}
 */
export function verdictOf(rail, nowMin, toStationMin) {
  const buffer = CATCH_BUFFER[rail.role] ?? 5;
  let left = hm(rail.depart) - nowMin;
  if (left < -12 * 60) left += 24 * 60; // 過午夜
  const spare = Math.round(left - toStationMin);
  return { kind: spare < 0 ? 'miss' : spare < buffer ? 'tight' : 'ok', spare, buffer };
}

/**
 * 結果那一句。
 * @param {object} rail { role, depart, from（上車站）, last? }
 * @param {{ kind, spare }} v verdictOf 的結果
 * @param {{ toStationMin: number, next?: { depart: string, arrive?: string }|null, taxi?: { low: number, high: number }|null, lang?: 'en'|null }} o
 */
export function resultText(rail, v, { toStationMin, next = null, taxi = null, lang = null }) {
  const en = lang === 'en';
  const st = rail.from || (en ? 'the station' : '車站');
  const note = en ? ' (estimate; allow time for the gates and tickets)' : '（僅供參考，進站、買票多留幾分鐘）';
  if (v.kind === 'ok') return en ? `You'll make it: about ${toStationMin} min to ${st}, ${v.spare + toStationMin} min before it leaves${note}.` : `來得及：到${st}約 ${toStationMin} 分，離發車還有 ${v.spare + toStationMin} 分${note}。`;
  if (v.kind === 'tight') return en ? `It's tight: about ${toStationMin} min to ${st}, only ${v.spare} min to spare. Leave now${note}.` : `很趕：到${st}約 ${toStationMin} 分，只剩 ${v.spare} 分緩衝，現在就出發${note}。`;
  const head = en ? `You won't make the ${rail.depart} one (about ${toStationMin} min to ${st}).` : `趕不上 ${rail.depart} 那班（到${st}約 ${toStationMin} 分）。`;
  const alt = next
    ? (en ? ` Next one: ${next.depart}${next.arrive ? `, arriving ${next.arrive}` : ''}.` : `下一班 ${next.depart} 開${next.arrive ? `、${next.arrive} 到` : ''}。`)
    : rail.last
      ? (en ? ' That was the last one today.' : '那是今天的末班車。')
      : (en ? " I couldn't find the next one." : '下一班這次查不到。');
  const cab = !next && taxi ? (en ? ` A taxi is estimated at NT$${taxi.low}–${taxi.high}; check the fare in the taxi app.` : `改叫車預估約 ${taxi.low}～${taxi.high} 元，實際以叫車 App 報價為準。`) : '';
  return `${head}${alt}${cab}`;
}

/** 沒拿到位置（Antigravity：照實說算不了，不用預設地區） */
export const noLocationText = (lang = null) => (lang === 'en' ? "I couldn't get your location, so I can't check that. Leave a little early to be safe." : '沒拿到你的位置，沒辦法幫你算；保險一點，早點出門。');

/** 下一班：時刻表裡發車時間 ≥ 最早能到的時間（現在＋到站＋緩衝）的第一班 */
export function nextTrain(trains, nowMin, toStationMin, role) {
  const ready = nowMin + toStationMin + (CATCH_BUFFER[role] ?? 5);
  return (trains || []).map((t) => ({ ...t, m: hm(t.depart) })).filter((t) => t.m != null && t.m >= ready).sort((a, b) => a.m - b.m)[0] || null;
}
