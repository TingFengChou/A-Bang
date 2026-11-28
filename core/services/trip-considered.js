// 判斷用到的資料（considered）與「為什麼只有一種方式」（single）：plan_trip 內部查的天氣、空品、國道路況，
// 各自的值與對這次判斷的影響，由程式產生（不經模型）。討論串（data_note 事件）、決策圖「資料」欄、模型看的文字都用這一份。
// 數字只來自上游資料；查不到就照實說查不到（ADR-0009）。
import { STATES } from '../decide.js';
import { toHHMM } from '../util.js';

/** 最近的空品測站超過這個距離就不採用（示範資料只有雙北、桃園、台中的測站；真實資料偏遠地區也可能很遠） */
export const AIR_MAX_M = 25000;
/** AQI 超過這個值（對敏感族群不健康以上）就加「空品不佳」狀態 */
export const BAD_AIR_AQI = 100;
/** 現在沒下雨、3 小時內降雨機率到這個值就加「可能下雨」狀態並提醒帶傘 */
export const RAIN_SOON_POP = 60;

const ROLE = { weather: '天氣', air: '空品', traffic: '路況' };

/**
 * @typedef {{ source: 'weather'|'air'|'traffic', role: string, available: boolean, demo: boolean,
 *   value: string, valueEn: string, text: string, textEn: string, say: string, sayEn: string,
 *   effect: 'none'|'score'|string, tone: 'good'|'bad'|'neutral' }} Considered
 *   value：決策圖節點上的短字（「24°C」「AQI 58」「查不到」）；text：討論串的資料；say：對這次判斷的影響；
 *   effect：none＝不影響、score＝只影響分數（國道車多）、其餘＝加入的自動狀態 key（rain、rainSoon、badAir、traffic）
 */
const item = (source, demo, o) => ({ source, role: ROLE[source], available: true, demo: Boolean(demo), effect: 'none', tone: 'neutral', ...o });
const missing = (source, demo, text, textEn, say = '這次不列入判斷', sayEn = 'not used this time') =>
  item(source, demo, { available: false, value: '查不到', valueEn: 'N/A', text, textEn, say, sayEn });

/** 天氣現象去掉「（示範）」標記（示範另有標籤） */
const cond = (s) => String(s || '').replace(/（示範）|\(demo\)/gi, '').trim();

/** 天氣：下雨→rain、可能下雨→rainSoon，否則不影響 */
export function weatherConsidered(w, { demo = false, today = true } = {}) {
  if (!w) return missing('weather', demo, '這附近查不到天氣資料', 'No weather data nearby', '這次不考慮下雨', 'rain not considered');
  const c = cond(w.weather ?? /^[^，,]+/.exec(w.summary || '')?.[0]);
  const temp = w.tempC != null ? `${w.tempC}°C` : '';
  const pop = w.pop3h != null ? `，3 小時降雨 ${w.pop3h}%` : '';
  const popEn = w.pop3h != null ? `, ${w.pop3h}% chance of rain in 3 h` : '';
  const head = today ? '' : '現在';
  const text = `${head}${[c, temp].filter(Boolean).join(' ') || '天氣'}${pop}${w.raining && w.rainMm1h > 0 ? `，1 小時雨量 ${w.rainMm1h} 毫米` : ''}`;
  const textEn = `${today ? '' : 'Now: '}${temp || 'Weather'}${popEn}`;
  const later = today ? '' : '（出發時可能不同）';
  const value = w.raining ? '下雨' : temp || c || '天氣';
  const valueEn = w.raining ? 'Rain' : temp || 'Weather';
  if (w.raining) return item('weather', demo, { value, valueEn, text, textEn, effect: 'rain', tone: 'bad', say: `正在下雨：少走路、少騎車，室內方案加分${later}`, sayEn: 'Raining: less walking and cycling, indoor options score higher' });
  if (w.pop3h >= RAIN_SOON_POP) return item('weather', demo, { value: `雨 ${w.pop3h}%`, valueEn: `Rain ${w.pop3h}%`, text, textEn, effect: 'rainSoon', tone: 'bad', say: `等一下可能下雨：記得帶傘，戶外方案稍微扣分${later}`, sayEn: 'Rain likely soon: bring an umbrella, outdoor options score a bit lower' });
  return item('weather', demo, { value, valueEn, text, textEn, tone: 'good', say: `不用避雨${later}`, sayEn: 'No need to avoid rain' });
}

/** 空品：AQI > 100 → badAir；最近測站超過 25 公里或沒有數值 → 查不到 */
export function airConsidered(aqi, { demo = false } = {}) {
  const a = aqi?.nearest;
  const demoNote = demo ? '（示範資料只有雙北、桃園、台中的測站）' : '';
  if (!a || a.aqi == null) return missing('air', demo, `附近查不到空品資料${demoNote}`, 'No air-quality data nearby', '這次不考慮空品', 'air quality not considered');
  if (a.distanceM > AIR_MAX_M) {
    return missing('air', demo, `${AIR_MAX_M / 1000} 公里內沒有空品測站，最近的「${a.site}」在 ${Math.round(a.distanceM / 1000)} 公里外${demoNote}`,
      `No air station within ${AIR_MAX_M / 1000} km`, '離太遠，不列入判斷', 'too far away, not used');
  }
  const text = `${a.site}測站 AQI ${a.aqi}（${a.status}）`;
  const textEn = `${a.site} station AQI ${a.aqi}`;
  if (a.aqi > BAD_AIR_AQI) return item('air', demo, { value: `AQI ${a.aqi}`, valueEn: `AQI ${a.aqi}`, text, textEn, effect: 'badAir', tone: 'bad', say: '少待戶外：走路、騎車扣分', sayEn: 'Limit time outdoors: walking and cycling score lower' });
  return item('air', demo, { value: `AQI ${a.aqi}`, valueEn: `AQI ${a.aqi}`, text, textEn, tone: 'good', say: '騎車、走路都可以', sayEn: 'Fine for walking and cycling' });
}

/** 國道路況：塞車→traffic、車多只影響延誤風險分數；市區短程沒有國道資料 */
export function trafficConsidered(t, { demo = false } = {}) {
  if (!t) return missing('traffic', demo, '查不到國道路況', 'No highway traffic data', '這次不考慮塞車', 'traffic not considered');
  if (!t.covered) return item('traffic', demo, { value: '市區', valueEn: 'Local', text: '市區短程：沒有即時路況資料', textEn: 'Short city trip: no live traffic data', say: '不影響', sayEn: 'no effect' });
  if (!t.level) return missing('traffic', demo, '沿途國道暫時沒有車速資料', 'No highway speed data right now', '這次不考慮塞車', 'traffic not considered');
  const worst = [...(t.segments || [])].filter((s) => s.speedKmh > 0 && s.limitKmh > 0).sort((a, b) => a.speedKmh / a.limitKmh - b.speedKmh / b.limitKmh)[0];
  const road = cond(worst?.road || '').replace(/^國道/, '國道 ') || '國道';
  if (t.level === 'jam') return item('traffic', demo, { value: `塞 ${t.delayMin ?? '?'} 分`, valueEn: `+${t.delayMin ?? '?'} min`, text: `${road}塞車，多 ${t.delayMin ?? '?'} 分`, textEn: `Highway jam, about ${t.delayMin ?? '?'} min extra`, effect: 'traffic', tone: 'bad', say: '叫車、客運可能慢', sayEn: 'Taxis and coaches may be slow' });
  if (t.level === 'slow') return item('traffic', demo, { value: '車多', valueEn: 'Slow', text: `${road}車多${t.delayMin ? `，多 ${t.delayMin} 分` : ''}`, textEn: 'Highway traffic is slow', effect: 'score', say: '叫車、客運可能慢一點', sayEn: 'Taxis and coaches may be a bit slow' });
  return item('traffic', demo, { value: '順暢', valueEn: 'Clear', text: '國道順暢', textEn: 'Highway traffic is clear', tone: 'good', say: '不用避開塞車', sayEn: 'No traffic to avoid' });
}

/**
 * plan_trip 判斷用到的三個來源（順序固定：天氣、空品、路況）。
 * @param {{ weather: object|null, aqi: object|null, traffic: object|null, demo: { weather: boolean, air: boolean, traffic: boolean }, today?: boolean }} p
 * @returns {Considered[]}
 */
export function consideredOf({ weather, aqi, traffic, demo = {}, today = true }) {
  return [
    weatherConsidered(weather, { demo: demo.weather, today }),
    airConsidered(aqi, { demo: demo.air }),
    trafficConsidered(traffic, { demo: demo.traffic }),
  ];
}

/** 決策圖節點的第二行：影響（「不影響」「→ 下雨」「查不到」） */
export const effectLabel = (c, en = false) => (!c.available ? (en ? 'N/A' : '查不到') : c.effect === 'none' ? (en ? 'No effect' : '不影響') : c.effect === 'score' ? (en ? 'Delay risk' : '→ 延誤風險') : `→ ${en ? c.effect : STATES[c.effect]?.label || c.effect}`);

// ───────── 只有一種方式時：說明其他方式為什麼不在 ─────────
const MODE_NAME = { walk: '走路', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車', drive: '開車' };
const MODE_ORDER = Object.keys(MODE_NAME);

/**
 * 沒列出的方式與原因。kind：far 太遠、near 太近（不算）、none 查不到站或路線、noService 已經沒有趕得上的班次、skipped 查了但不可行。
 * @param {{ straight: number, roles: Record<string, any>, skipped?: Array<{ role, why }>, limits: object }} p roles：各方式的結果（方案、null、{ none: { kind, why } }、FAILED）
 * @returns {Array<{ role: string, kind: string, why: string }>}
 */
export function missingModes({ straight, roles, skipped = [], limits }) {
  const km = +(straight / 1000).toFixed(1);
  const far = (max) => straight > max;
  const out = [];
  for (const role of MODE_ORDER) {
    const r = roles[role];
    if (r && r.id) continue; // 有方案
    if (role === 'drive') continue; // 自己開車：只有設了「我有車」或說開車才比，沒列不算缺
    if (role === 'intercity') continue; // 客運：多數起訖本來就沒有客運資料，沒有方案就不列、不說原因（產品負責人 2026-11-22）
    const sk = skipped.find((s) => s.role === role);
    if (sk) { const { role: _r, ...rest } = sk; out.push({ role, kind: 'skipped', ...rest }); continue; }
    if (r?.none) { out.push({ role, ...r.none }); continue; }
    if (r === 'failed') { out.push({ role, kind: 'none', why: '資料暫時查不到', whyEn: 'Data unavailable right now' }); continue; }
    const tooFar = { walk: limits.walkMaxM, bike: limits.bikeMaxM, bus: limits.busMaxM, metro: 60000 }[role];
    const tooNear = { bike: limits.bikeMinM, metro: 1500, thsr: limits.railMinM, tra: limits.traMinM ?? limits.railMinM, intercity: limits.intercityMinM }[role];
    if (tooFar && far(tooFar)) out.push({ role, kind: 'far', why: `${km} 公里太遠`, whyEn: `${km} km is too far` });
    else if (tooNear && straight < tooNear) out.push({ role, kind: 'near', why: '距離太近', whyEn: 'Too close' });
    else if (role === 'metro') out.push({ role, kind: 'none', why: '起點或目的地附近沒有捷運站', whyEn: 'No MRT station near the start or destination' });
    else out.push({ role, kind: 'none', why: '這段路查不到', whyEn: 'Nothing found for this trip' });
  }
  return out;
}

const MODE_EN = { walk: 'walking', bike: 'YouBike', bus: 'bus', metro: 'MRT', thsr: 'High Speed Rail', tra: 'train', intercity: 'intercity bus', ridehail: 'taxi', drive: 'driving' };
const andEn = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * 深夜的一句（公車、捷運收班或末班快到了）：回答第一句、討論串、卡片最上面都用這句（由程式依時間與服務結果產生，不經模型）。
 * 例：「現在 00:10，公車和捷運都收班了（捷運約 06:00 首班），先比走路、YouBike、叫車」。
 * 公車收班若是 TDX 額度用完改用示範資料、依時間估的（skip.fallback），照實說。
 * @param {{ skipped?: Array<{ role, closed?, notYet?, first?, fallback? }>, options?: Array<{ role, lastBus?, lastTrain? }>, departMin: number, isNow?: boolean, single?: boolean }} p single：只有一種方式（不說「先比…」）
 * @returns {{ text: string, textEn: string, body: string, bodyEn: string, closed: string[], late: string[], notYet?: true, estimated?: true, fallback?: 'tdx-limit' } | null}
 */
export function nightOf({ skipped = [], options = [], departMin, isNow = false, single = false }) {
  const shut = ['bus', 'metro'].map((r) => skipped.find((s) => s.role === r && s.closed)).filter(Boolean);
  const closed = shut.map((s) => s.role);
  const late = ['bus', 'metro'].filter((r) => !closed.includes(r) && options.some((o) => o.role === r && (o.lastBus || o.lastTrain)));
  if (!closed.length && !late.length) return null;
  const hhmm = toHHMM(departMin);
  const metro = shut.find((s) => s.role === 'metro');
  const est = shut.find((s) => s.role === 'bus' && s.fallback);
  const names = (rs) => rs.map((r) => MODE_NAME[r]).join('和');
  const head = isNow ? `現在 ${hhmm}` : `${hhmm} 出發`, headEn = isNow ? `It's ${hhmm} now` : `Leaving at ${hhmm}`;
  const parts = [], en = [];
  const busEst = est ? '（TDX 額度用完，公車收班是依時間估的，以站牌即時資訊為準）' : '';
  const busEstEn = est ? ' (bus hours estimated from the time: TDX quota used up)' : '';
  if (closed.length === 2 && !metro.notYet) {
    const why = [`捷運約 ${metro.first} 首班`, est && 'TDX 額度用完，公車收班是依時間估的，以站牌即時資訊為準'].filter(Boolean);
    const whyEn = [`MRT starts around ${metro.first}`, est && 'bus hours estimated from the time: TDX quota used up'].filter(Boolean);
    parts.push(`公車和捷運都收班了（${why.join('；')}）`);
    en.push(`buses and the MRT have stopped for the night (${whyEn.join('; ')})`);
  } else {
    if (closed.includes('bus')) { parts.push(`公車已收班${busEst}`); en.push(`buses have stopped for the night${busEstEn}`); }
    // 05:00～05:59：捷運「還沒發車」，不說收班（PR #110 審查）
    if (metro) {
      parts.push(metro.notYet ? `捷運還沒發車（約 ${metro.first} 首班）` : `捷運已收班（約 ${metro.first} 首班）`);
      en.push(metro.notYet ? `the MRT hasn't started yet (first train around ${metro.first})` : `the MRT has stopped for the night (first train around ${metro.first})`);
    }
  }
  if (late.length) {
    parts.push(`${names(late)}末班快到了，早點出門；錯過可以叫車`);
    en.push(`last ${andEn(late.map((r) => MODE_EN[r]))} soon, leave early; a taxi is the backup`);
  }
  const roles = [...new Set(options.map((o) => o.role))];
  if (closed.length && !single) { // 只有一種方式時由 single 說「只找到…」，這裡不再說「先比…」
    parts.push(roles.length ? `先比${roles.map((r) => MODE_NAME[r]).join('、')}` : '目前查不到其他方式');
    en.push(roles.length ? `comparing ${andEn(roles.map((r) => MODE_EN[r]))}` : 'no other way found right now');
  }
  const body = parts.join('，'), bodyEn = `${en.join('; ')}.`;
  return {
    text: `${head}，${body}`, textEn: `${headEn}: ${bodyEn}`,
    body, bodyEn: bodyEn.charAt(0).toUpperCase() + bodyEn.slice(1), // 不帶時間的版本：回答已經說了「明天 00:10 出發：」或出發時間是程式合成的
    closed, late, ...(metro?.notYet && { notYet: true }), ...(est && { estimated: true, fallback: 'tdx-limit' }),
  };
}

const TRANSIT = ['bus', 'metro', 'thsr', 'tra', 'intercity'];
/**
 * TDX 額度用完（真實模式改用示範資料）時沒列入的方式（trip.js limitSkip）：一句照實說，不推假班次（ADR-0010 2026-11-22）。
 * 大眾運輸因此一個都沒有時（noTransit）說「大眾運輸都沒列入」、先比走路／YouBike／叫車（叫車照估算），並建議約 1 分鐘後再問（額度每分鐘重置）。
 * short／shortEn：短的一句（工具發言 speak 用）；suggest：「接下來可以」的「過一分鐘再問一次」（起訖照原本的說法）。
 * @param {{ roles?: string[], options?: Array<{ role: string }>, toName?: string, fromName?: string }} p roles：因額度用完沒列入的方式
 * @returns {{ roles: string[], noTransit: boolean, text: string, textEn: string, short: string, shortEn: string, suggest: Array<{ label: string, ask: string }> } | null}
 */
export function limitedOf({ roles = [], options = [], toName, fromName }) {
  if (!roles.length) return null;
  const noTransit = roles.some((r) => TRANSIT.includes(r)) && !options.some((o) => TRANSIT.includes(o.role));
  const what = roles.map((r) => MODE_NAME[r]).join('、'), whatEn = andEn(roles.map((r) => MODE_EN[r]));
  const lead = /^[A-Za-z]/.test(what) ? ' ' : ''; // 「查不到 YouBike…」：中英文之間空一格
  const left = [...new Set(options.map((o) => o.role))];
  const ride = left.includes('ridehail') ? '（叫車的時間與車資是估算）' : '', rideEn = left.includes('ridehail') ? ' (taxi time and fare are estimates)' : '';
  const leftZh = left.length ? `先比${left.map((r) => MODE_NAME[r]).join('、')}${ride}` : '目前查不到其他方式';
  const leftEn = left.length ? `comparing ${andEn(left.map((r) => MODE_EN[r]))}${rideEn}` : 'no other way found right now';
  const to = String(toName || '').trim(), from = String(fromName || '').trim();
  const fromSaid = from && from !== '您的位置' ? from : '';
  const suggest = to ? [{ label: '過一分鐘再問一次', ask: fromSaid ? `從${fromSaid}到${to}怎麼去` : `去${to}怎麼走` }] : []; // 額度每分鐘重置
  const short = `TDX 額度用完，${what}這次查不到、沒列入`, shortEn = `TDX quota used up: no live ${whatEn} data this time`;
  return noTransit
    ? { roles, noTransit, text: `TDX 額度用完，這次查不到${lead}${what}的即時資料，大眾運輸都沒列入（不推示範的班次）；${leftZh}，約 1 分鐘後再問一次就查得到`, textEn: `TDX quota used up: no live ${whatEn} data this time, so public transport is left out (no demo timetables); ${leftEn}. Ask again in about a minute.`, short, shortEn, suggest }
    : { roles, noTransit, text: `TDX 額度用完，這次查不到${lead}${what}的即時資料，沒列入比較（約 1 分鐘後再問一次）`, textEn: `TDX quota used up: no live ${whatEn} data this time, left out of the comparison (ask again in about a minute).`, short, shortEn, suggest };
}

/**
 * 只有一種方式時的說明（例：「只找到叫車一種方式：距離 26 公里，走路、YouBike、公車、捷運都太遠；高鐵、台鐵、客運 23:30 以後今天沒有趕得上的班次」）。
 * suggest：「接下來可以」的建議（點了就送出那一句，起訖點照原本的說法）；之後可改用「阿幫問你」。
 * fallback：這次有 TDX 額度用完改用示範資料（真實模式下某些方式的結果其實是示範的），照實說。
 * @returns {{ text: string, textEn: string, suggest: Array<{ label: string, ask: string }> } | null}
 */
export function singleNote({ options, missingList, straight, departMin, demo, fallback = false, toName, fromName }) {
  if (options.length !== 1) return null;
  const only = options[0];
  const name = (r) => MODE_NAME[r] || r;
  const pick = (k) => missingList.filter((m) => m.kind === k);
  const join = (xs) => xs.map((m) => name(m.role)).join('、');
  const parts = [];
  const far = pick('far');
  if (far.length) parts.push(`距離 ${+(straight / 1000).toFixed(1)} 公里，${join(far)}都太遠`);
  const noSvc = pick('noService');
  if (noSvc.length) parts.push(`${join(noSvc)} ${toHHMM(departMin)} 以後今天沒有趕得上的班次`);
  const lim = (m) => m.fallback === 'tdx-limit' && !m.closed; // TDX 額度用完沒列入的：合成一句
  for (const m of [...pick('none'), ...pick('skipped')].filter((x) => !lim(x))) parts.push(`${name(m.role)}：${m.why}`);
  const limits = missingList.filter(lim);
  if (limits.length) parts.push(`${join(limits)}：TDX 額度用完，這次查不到（約 1 分鐘後再問一次）`);
  // fallback：額度用完的方式已照實列在原因裡（不推示範的班次，trip.js limitSkip）；這裡只提醒稍後再問
  const text = `只找到${name(only.role)}一種方式${parts.length ? `：${parts.join('；')}` : ''}${demo ? '（現在是示範資料，班次與站牌是模擬的；設定金鑰後就是即時資料）' : fallback && !parts.some((x) => /TDX/.test(x)) ? '（TDX 額度用完，有些資料這次查不到；約 1 分鐘後再問一次）' : ''}`; // 原因裡已經說了額度用完就不重複
  const to = String(toName || '').trim();
  const from = String(fromName || '').trim();
  const fromSaid = from && from !== '您的位置' ? from : ''; // 使用者說了起點：建議也帶著，不然送出後會變成定位或預設起點
  const suggest = [];
  if (to && noSvc.length) suggest.push({ label: '改成明天早上出發', ask: fromSaid ? `明天早上 8 點從${fromSaid}到${to}` : `明天早上 8 點去${to}` });
  if (to && demo && !/台北車站|臺北車站/.test(`${fromName}${to}`)) suggest.push({ label: '改從台北車站出發比較看看', ask: `從台北車站到${to}怎麼去` });
  if (to && !demo && fallback) suggest.push({ label: '過一分鐘再問一次', ask: fromSaid ? `從${fromSaid}到${to}怎麼去` : `去${to}怎麼走` }); // 額度每分鐘重置
  // 英文照實：太遠的只說那幾種；額度用完的另外說（不把高鐵、台鐵說成太遠；PR #126 審查）
  const limitedEn = limits.map((m) => MODE_EN[m.role]);
  const whyEn = [
    ...(far.length ? [`${+(straight / 1000).toFixed(1)} km is too far for ${andEn(far.map((m) => MODE_EN[m.role]))}`] : []),
    ...(noSvc.length ? ['no more trains or coaches you can catch today'] : []),
    ...(limitedEn.length ? [`TDX quota used up, no live ${andEn(limitedEn)} data this time (ask again in about a minute)`] : []),
  ];
  const textEn = `Only ${{ walk: 'walking', bike: 'YouBike', bus: 'the bus', metro: 'the MRT', thsr: 'high speed rail', tra: 'the train', intercity: 'the intercity bus', ridehail: 'a taxi', drive: 'driving' }[only.role] || only.name} works for this trip${whyEn.length ? `: ${whyEn.join('; ')}` : ''}${demo ? ' (demo data)' : fallback && !limitedEn.length ? ' (TDX quota used up; ask again in about a minute)' : ''}.`;
  return { text, textEn, suggest };
}
