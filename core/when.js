// 「明天早上」「禮拜六」「夜間」這類說法 → 幾天後、哪個時段（PM 審查 2026-11-28：診所、戶政問明天、禮拜六時答的都是今天）。純函式。
const WEEK = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const twDow = (now) => new Date(now + 8 * 3600e3).getUTCDay();

/**
 * @param {string} s 使用者的句子
 * @param {number} [now]
 * @returns {{ dayOffset: number, period: '上午'|'下午'|'晚上'|null, label: string }|null} 沒說日子也沒說時段回 null
 */
export function whenOf(s, now = Date.now()) {
  const t = String(s ?? '');
  let dayOffset = null, label = '';
  const wk = /(下(?:個|一)?)?(?:禮拜|星期|週|周)([一二三四五六日天])/.exec(t);
  if (/後天/.test(t)) { dayOffset = 2; label = '後天'; }
  else if (/明天|明早|明晚|明日/.test(t)) { dayOffset = 1; label = '明天'; }
  else if (wk) {
    const want = WEEK[wk[2]];
    dayOffset = (want - twDow(now) + 7) % 7 + (wk[1] ? 7 : 0);
    if (dayOffset > 6) dayOffset = Math.min(dayOffset, 13);
    label = `${wk[1] ? '下' : ''}星期${wk[2] === '天' ? '日' : wk[2]}`;
  } else if (/今天|今晚|今早/.test(t)) { dayOffset = 0; label = '今天'; }
  const period = /早上|上午|明早|今早|早診/.test(t) ? '上午' : /中午|下午|午診/.test(t) ? '下午' : /晚上|夜間|夜診|今晚|明晚|下班後|晚診/.test(t) ? '晚上' : null;
  if (dayOffset == null && !period) return null;
  const d = dayOffset ?? 0;
  return { dayOffset: d, period, label: `${label || (d === 0 ? '今天' : '')}${period || ''}` };
}
