// 討論串的「→ 影響」：每位小幫手回報的資料，對這次決策有什麼影響（真實資料＋decide.js 的規則，不經模型、不編造）。
// 也產生行程開始前阿幫的一句（判斷層結果：你的狀況、或照你說的改成哪種交通方式），讓使用者一送出就看到阿幫在依他的狀況做事。
import { BAD_AIR_AQI } from '../services/trip.js';

const STATE_SAY = { rush: '趕時間', luggage: '帶行李', budget: '想省錢', lessWalk: '想少走路', rain: '遇到下雨', badAir: '覺得空氣差' };

const MODE_SAY = { bus: '坐公車', bike: '騎 YouBike', walk: '走路', ridehail: '叫車', thsr: '坐高鐵', tra: '坐台鐵', intercity: '坐客運' };

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
  return `${st.length ? `你${st.join('、')}，` : ''}我先看天氣、空品、路況，再比較幾種走法`.slice(0, 60);
}

/** 完整判斷比快速判斷多找到的狀態 → 阿幫補一句（例：「我還注意到你帶行李」）；沒有新的回 null */
export function moreStatesNote(quick, full) {
  const extra = (full?.states || []).filter((k) => !(quick?.states || []).includes(k)).map((k) => STATE_SAY[k]).filter(Boolean);
  return extra.length ? `我還注意到你${extra.join('、')}，會一起算進去` : null;
}

/**
 * 工具結果對決策的影響。tone：bad（讓某些方式扣分）、good（有利或確認可行）、neutral（不影響）。
 * @returns {{ tone: 'bad'|'good'|'neutral', text: string } | null}
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
      return a > BAD_AIR_AQI ? { tone: 'bad', text: `AQI ${a}：空品不佳，戶外方式扣分` } : { tone: 'neutral', text: `AQI ${a}：不影響這次決定` };
    }
    case 'traffic_status':
      if (!data.covered) return { tone: 'neutral', text: '市區短程：不看國道路況' };
      if (data.level === 'jam') return { tone: 'bad', text: `國道塞車約 ${data.delayMin ?? '?'} 分：叫車、客運扣分` };
      return { tone: 'good', text: '國道順暢：開車、客運不扣分' };
    case 'plan_trip': {
      const top = data.ranking?.ranked?.[0];
      const best = data.options?.find((o) => o.id === data.best);
      return best && top ? { tone: 'good', text: `比了 ${data.options.length} 種走法：${best.name} ${top.score} 分最高` } : { tone: 'bad', text: '這次沒有可行的走法' };
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
