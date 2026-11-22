// 討論串的「→ 影響」：每位小幫手回報的資料，對這次決策有什麼影響（真實資料＋decide.js 的規則，不經模型、不編造）。
// 也產生行程開始前阿幫的一句（判斷層結果：你的狀況、或照你說的改成哪種交通方式），讓使用者一送出就看到阿幫在依他的狀況做事。
import { STATES } from '../decide.js';
import { BAD_AIR_AQI, AIR_MAX_M } from '../services/trip.js';

const AVOID_SAY = { bike: 'YouBike', walk: '長距離步行' };
const STATE_SAY = { rush: '趕時間', luggage: '帶行李', budget: '想省錢', lessWalk: '想少走路', rain: '遇到下雨', badAir: '覺得空氣差', elder: '帶著長輩', kids: '帶著小孩', mobility: '行動不便' };

const MODE_SAY = { bus: '坐公車', bike: '騎 YouBike', walk: '走路', ridehail: '叫車', drive: '開車', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運' };

/**
 * 判斷層結果 → 阿幫在行程開始前的一句（≤ 60 字；agent_note）。只在行程時說，而且要有資訊（不再每次都說「我聽懂了」）：
 *   接著改：「照你說的改成坐公車，用剛才的起點和目的地重算」；新行程：「你想省錢，我先看天氣、空品、路況，再比較幾種走法」。
 * 其他查詢回 null（小幫手的第一句就說明在查什麼）。
 * @param {{ intent: string, states: string[], followUp?: boolean, mode?: string }} j
 */
export function judgeNote(j) {
  if (!j || j.intent !== 'trip') return null;
  const st = (j.states || []).map((k) => STATE_SAY[k]).filter(Boolean);
  if (j.followUp) return `${j.mode ? `照你說的改成${MODE_SAY[j.mode] || j.mode}` : `好，${st.length ? `你${st.join('、')}` : '換個條件'}`}，用剛才的起點和目的地重算`.slice(0, 60);
  // 帶長輩、帶小孩、行動不便：先說會避開哪些方式（PR #36 設計審查）
  const avoid = [...new Set((j.states || []).flatMap((k) => STATES[k]?.exclude || []))].map((m) => AVOID_SAY[m]).filter(Boolean);
  return `${st.length ? `你${st.join('、')}，` : ''}${avoid.length ? `我會避開${avoid.join('和')}，` : ''}我先看天氣、空品、路況，再比較幾種走法`.slice(0, 60);
}

/** 出門建議前的一句：帶小孩或長輩時說空品標準會放嚴（不用行程的說法）；其他回 null */
export function outingNote(states = []) {
  const who = states.includes('kids') ? '小孩' : states.includes('elder') ? '長輩' : null;
  return who ? `你帶著${who}，我會把空品標準放嚴一點` : null;
}

/** 完整判斷比快速判斷多找到的狀態 → 阿幫補一句（例：「我還注意到你帶行李」）；沒有新的回 null */
export function moreStatesNote(quick, full) {
  const extra = (full?.states || []).filter((k) => !(quick?.states || []).includes(k)).map((k) => STATE_SAY[k]).filter(Boolean);
  return extra.length ? `我還注意到你${extra.join('、')}，會一起算進去` : null;
}

/** YouBike 兩端（起點有車、終點有空位）：很緊或不可行時一定要說 */
function bikeImpact(data) {
  const skip = data.skipped?.find((s) => s.role === 'bike');
  if (skip) return { tone: 'bad', text: `YouBike：${skip.why}，不列入` };
  const b = data.options?.find((o) => o.role === 'bike')?.bike;
  if (!b) return null;
  if (b.ret.tight) return { tone: 'bad', text: b.ret.backup ? `YouBike：「${b.ret.name}」只剩 ${b.ret.count} 個空位，停滿就改還「${b.ret.backup.name}」` : `YouBike：「${b.ret.name}」只剩 ${b.ret.count} 個空位，騎到時可能停滿` };
  if (b.rent.tight) return { tone: 'bad', text: b.rent.backup ? `YouBike：「${b.rent.name}」只剩 ${b.rent.count} 台，借不到就改去「${b.rent.backup.name}」` : `YouBike：「${b.rent.name}」只剩 ${b.rent.count} 台，可能被借光` };
  return { tone: 'good', text: `YouBike：「${b.rent.name}」${b.rent.count} 台可借、「${b.ret.name}」${b.ret.count} 個空位` };
}

const ROLE_SAY = { walk: '走路', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車', drive: '開車' };
/** 沒列入的方式與原因（plan_trip missing；YouBike 由 bikeImpact 說、深夜收班已在工具發言第一句說） */
function missingImpact(data) {
  const xs = (data.missing || []).filter((m) => m.role !== 'bike' && !(m.closed && data.night));
  return xs.length ? { tone: 'neutral', text: `沒列入：${xs.map((m) => `${ROLE_SAY[m.role] || m.role}（${m.why}）`).join('、')}` } : null;
}

/**
 * 工具結果對決策的影響。tone：bad（讓某些方式扣分）、good（有利或確認可行）、neutral（不影響）。
 * @returns {{ tone: 'bad'|'good'|'neutral', text: string } | Array<{ tone: string, text: string }> | null} 行程可能有兩行（比較結果＋YouBike 兩端）
 */
export function impactOf(name, data) {
  if (!data) return null;
  switch (name) {
    case 'weather_now':
      if (data.raining) return { tone: 'bad', text: '下雨：走路、YouBike 在「戶外」會扣分' };
      if ((data.pop3h ?? 0) >= 50) return { tone: 'neutral', text: `降雨機率 ${data.pop3h}%：先記著，現在沒下就不扣分` };
      return { tone: 'good', text: '沒下雨：走路、YouBike 不扣分' };
    case 'aqi_nearby': {
      const a = data.nearest?.aqi;
      if (a == null) return null;
      if (data.nearest.distanceM > AIR_MAX_M) return { tone: 'neutral', text: `最近的測站在 ${Math.round(data.nearest.distanceM / 1000)} 公里外：不列入判斷` }; // 與 plan_trip 相同的上限
      return a > BAD_AIR_AQI ? { tone: 'bad', text: `AQI ${a}：空品不佳，戶外方式扣分` } : { tone: 'neutral', text: `AQI ${a}：不影響這次決定` };
    }
    case 'traffic_status':
      if (!data.covered) return { tone: 'neutral', text: '市區短程：不看國道路況' };
      if (data.level === 'jam') return { tone: 'bad', text: `國道塞車約 ${data.delayMin ?? '?'} 分：叫車、客運扣分` };
      return { tone: 'good', text: '國道順暢：開車、客運不扣分' };
    case 'plan_trip': {
      const top = data.ranking?.ranked?.[0];
      const best = data.options?.find((o) => o.id === data.best);
      if (data.modeUnavailable && best) return [{ tone: 'bad', text: `沒有可行的${{ walk: '步行', bike: 'YouBike', bus: '公車', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車', drive: '開車' }[data.modeUnavailable] || ''}方案：改建議${best.name}` }, bikeImpact(data)].filter(Boolean);
      if (data.single && best) return [{ tone: 'bad', text: data.single.text }, bikeImpact(data)].filter(Boolean); // 只有一種方式：說明其他方式為什麼不在
      const main = best && top ? { tone: 'good', text: data.mode ? `照你說的選${best.name}（${data.ranking.ranked.find((r) => r.id === best.id)?.score ?? '?'} 分）` : `比了 ${data.options.length} 種走法：${best.name} ${top.score} 分最高` } : { tone: 'bad', text: '這次沒有可行的走法' };
      const lines = [main, bikeImpact(data), missingImpact(data)].filter(Boolean);
      return lines.length > 1 ? lines : main;
    }
    case 'bus_route_eta': {
      const f = data.focus;
      if (!f || f.status !== 0 || f.etaSec == null) return null;
      return { tone: f.etaSec < 180 ? 'bad' : 'good', text: f.etaSec < 180 ? '這班快到了，走過去可能趕不上' : `還有約 ${Math.round(f.etaSec / 60)} 分，來得及走過去` };
    }
    default:
      return null;
  }
}
