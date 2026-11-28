// 首頁「今天」卡（主動助手第一版，2026-11-28 Claude 與 Antigravity 第十三輪）。
// 沒問也在對的時間出現，但只在打開 App 的那一刻、在前景算（不背景排程、不推播、不追蹤位置）：
//   時段（早上、白天、傍晚、深夜）× 今天上不上班（人事行政總處辦公日曆：補班日、連假都對；查不到照週末推）
//   × 手機上已經有的東西（常用地點、預設地區、現在的天氣與空品）→ 一句話、幾個提醒、一兩個馬上能按的問題。
// 三種情況（Antigravity：新手不能看到一張叫他去設定的空卡）：
//   設了家和公司（或學校）→ 通勤版：上班日早上「今天怎麼去公司」、傍晚「回家怎麼走」
//   沒設常用地點 → 輕量版：一樣給天氣與時段的建議，另外邀請設定家和公司
//   還沒看完使用說明 → 不顯示（首頁照舊，不跟引導搶）
// 天氣是騎機車的人最在意的（要不要穿雨衣、戴口罩），所以天氣、空品是每一版的基底，有通勤再疊上去。
// 查不到不說成沒有（降級原則）：天氣查不到就說「這次查不到」，下不下雨不知道就說不知道。
// 純函式（node:test 測）；畫面在 pages/home.js。
import { twClock } from '../../core/suggest.js';

const WEEK = '日一二三四五六';

/** 時段：跟首頁問候、建議問題同一套切法 */
export function dayPart(hour) {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 16) return 'day';
  if (hour >= 16 && hour < 21) return 'evening';
  return 'late';
}
const greetOf = (hour) => (hour < 5 ? '夜深了' : hour < 11 ? '早安' : hour < 18 ? '午安' : '晚安');

/**
 * 今天是哪一種日子。day：gov_office_nearby 的 today（辦公日曆）；沒有就照星期推（known: false）。
 * @returns {{ work: boolean, weekend: boolean, label: string, known: boolean }}
 */
export function dayKind(day, dow) {
  const weekend = dow === 0 || dow === 6;
  const work = typeof day?.workday === 'boolean' ? day.workday : !weekend;
  const known = !!day?.known;
  let label;
  if (work) label = weekend && known ? '補班日' : '上班日';
  else if (!weekend && known) label = day?.note ? `放假・${day.note}` : '放假';
  else label = '週末';
  return { work, weekend, label, known };
}

/**
 * 天氣與空品給的提醒（最多三個；騎車的人也照顧到）。
 * @returns {{ tips: Array<{ icon: string, text: string, tone?: 'warn'|'bad' }>, wet: boolean, bad: boolean, unknown: boolean }}
 */
export function weatherTips(weather, aqi, { offline = false } = {}) {
  const tips = [];
  if (!weather) {
    tips.push({ icon: 'info', text: offline ? '離線中，連上網路再看天氣' : '天氣這次查不到（不是沒有，晚點再看）' });
    return { tips, wet: false, bad: false, unknown: true };
  }
  const pop = Number.isFinite(weather.pop3h) ? weather.pop3h : null;
  let wet = false;
  if (weather.rainMm1h > 0) { tips.push({ icon: 'umbrella', text: '正在下雨：帶傘，騎車記得穿雨衣', tone: 'warn' }); wet = true; }
  else if (weather.raining) { tips.push({ icon: 'umbrella', text: `可能會下雨${pop != null ? `（${pop}%）` : ''}：帶把傘，騎車備好雨衣`, tone: 'warn' }); wet = true; }
  else if (pop != null && pop >= 30) { tips.push({ icon: 'umbrella', text: `降雨 ${pop}%：包包放把折傘` }); wet = pop >= 50; }
  else if (weather.rainKnown === false) tips.push({ icon: 'info', text: '下不下雨這次查不到，出門前再看一眼' });
  const t = Number.isFinite(weather.tempC) ? Math.round(weather.tempC) : null;
  if (t != null && t >= 32) tips.push({ icon: 'thermo', text: `${t}°C 很熱：多喝水、注意防曬`, tone: 'warn' });
  else if (t != null && t <= 14) tips.push({ icon: 'thermo', text: `${t}°C 偏冷：多帶件外套` });
  const n = Number(aqi?.nearest?.aqi);
  const bad = Number.isFinite(n) && n > 100;
  if (bad) tips.push({ icon: 'mask', text: `空品不佳（AQI ${n}）：騎車、運動戴口罩`, tone: 'bad' });
  return { tips: tips.slice(0, 3), wet, bad, unknown: false };
}

const ask = (q) => `#/agent?q=${encodeURIComponent(q)}`;

/**
 * 「今天」卡要顯示什麼。
 * @param {{
 *   now?: number, day?: { workday?: boolean, known?: boolean, note?: string|null }|null,
 *   weather?: object|null, aqi?: object|null, offline?: boolean,
 *   places?: Record<string, { name?: string }>, area?: { county: string, town: string }|null, located?: boolean,
 *   onboarded?: boolean, loading?: boolean,
 * }} o
 * @returns {{ show: false }|{ show: true, tier: 'commute'|'light', date: string, kind: ReturnType<typeof dayKind>, say: string, tips: Array, acts: Array<{ label: string, href: string, primary?: true }>, basis: string }}
 */
export function todayPlan({ now = Date.now(), day = null, weather = null, aqi = null, offline = false, places = {}, area = null, located = false, onboarded = true, loading = false } = {}) {
  if (!onboarded) return { show: false };
  const { hour, dow } = twClock(now);
  const d = new Date(Number(now) + 8 * 3600e3);
  const date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[dow]}）`;
  const part = dayPart(hour);
  const kind = dayKind(day, dow);
  const w = loading ? { tips: [], wet: false, bad: false, unknown: false } : weatherTips(weather, aqi, { offline });
  const home = !!places['家'];
  const dest = places['公司'] ? '公司' : places['學校'] ? '學校' : null;
  const tier = home && dest ? 'commute' : 'light';
  const where = located ? '你附近' : area ? `${area.county}${area.town}` : '台北車站附近';
  // 回家的按鈕：有定位從現在的位置；沒定位但設了公司就寫「從公司回家」（看得出起點，第十五輪 Antigravity）
  const homeAct = () => (!located && places['公司'] && kind.work
    ? { label: '從公司回家怎麼走', href: ask('從公司回家怎麼走？'), primary: true }
    : { label: '回家怎麼走', href: ask('回家怎麼走？'), primary: true });

  // 數字在下面的格子、要怎麼做在提醒裡：這一句只說「今天是什麼樣的一天、建議做什麼」，不重複
  const fine = !loading && !w.unknown && !w.wet && !w.bad;

  // 時段 × 日子 × 常用地點：一句話＋馬上能按的問題
  const acts = [];
  let lead;
  if (kind.work && part === 'morning') {
    lead = kind.label === '補班日' ? '今天要補班。' : '上班日。';
    if (tier === 'commute') { lead += `出門前看一下怎麼去${dest}最快。`; acts.push({ label: `今天怎麼去${dest}`, href: ask(`去${dest}怎麼走最快？`), primary: true }); }
    else acts.push({ label: '捷運下一班幾分', href: ask('捷運下一班幾分？'), primary: true });
  } else if (kind.work && part === 'evening') {
    lead = '辛苦了。';
    if (home) { lead += '回家前看一下車。'; acts.push(homeAct()); }
    else acts.push({ label: '附近有哪些公車站', href: ask('附近有哪些公車站？'), primary: true });
  } else if (!kind.work && part === 'evening' && home) { // 回家模式（第十五輪 f）：週末、放假的傍晚也一樣，按了才查（不自動查、不先要定位）
    lead = `${kind.label === '週末' ? '週末' : '今天放假'}的晚上。要回家時看一下車。`;
    acts.push(homeAct());
  } else if (part === 'late') {
    lead = '晚了，留意末班車。';
    acts.push({ label: '捷運幾點收班', href: ask('捷運幾點收班？'), primary: true });
    if (home) acts.push({ label: '回家怎麼走最快', href: ask('回家怎麼走最快？') });
  } else if (!kind.work) {
    lead = kind.label === '週末' ? '週末。' : `今天放假${day?.note ? `（${day.note}）` : ''}。`;
    lead += w.wet || w.bad ? '待在室內也不錯。' : fine ? `${where}天氣不錯，出去走走吧。` : '';
    acts.push({ label: '今天適合出門嗎', href: ask('出門要注意什麼？'), primary: true });
    acts.push({ label: '附近有看診的診所', href: ask('附近有開的診所嗎') });
  } else {
    lead = w.wet ? '午後出門記得帶傘。' : '要出門的話，先問我怎麼去。';
    acts.push({ label: w.wet ? '出門要帶傘嗎' : '出門要注意什麼', href: ask(w.wet ? '今天出門要帶傘嗎？' : '出門要注意什麼？'), primary: true });
  }
  if (tier === 'light' && acts.length < 2) acts.push({ label: '設家和公司，每天幫你看怎麼去', href: '#/settings' });

  const keys = ['家', '公司', '學校'].filter((k) => places[k]);
  const basis = ['依據：', located ? '你的位置' : area ? `${area.county}${area.town}` : '台北車站附近', keys.length ? `・${keys.join('、')}` : '', kind.known ? '・辦公日曆' : ''].join('');
  return { show: true, tier, date, kind, say: `${greetOf(hour)}！${lead}${loading ? '我在看天氣…' : ''}`, tips: w.tips, acts: acts.slice(0, 2), basis };
}

/**
 * 首頁「這個時段常用」（第十四輪 e）：只放兩格、放在格子上面；下面的格子位置不動（Antigravity：整頁洗牌會破壞肌肉記憶）。
 * 上班日早上公車、捷運；傍晚公車、垃圾車；深夜捷運（收班）、藥局；白天與放假天氣、YouBike；放假早上天氣、藥局。
 * @returns {{ ids: string[], label: string }}
 */
export function pinnedTiles({ now = Date.now(), workday = null } = {}) {
  const { hour, dow } = twClock(now);
  const work = typeof workday === 'boolean' ? workday : !(dow === 0 || dow === 6);
  const part = dayPart(hour);
  if (part === 'morning') return work ? { ids: ['bus', 'metro'], label: '通勤時間' } : { ids: ['weather', 'pharmacy'], label: '放假的早上' };
  if (part === 'evening') return { ids: ['bus', 'garbage'], label: work ? '下班時間' : '傍晚' };
  if (part === 'late') return { ids: ['metro', 'pharmacy'], label: '晚上' };
  return { ids: ['weather', 'bike'], label: work ? '白天' : '放假的白天' };
}
