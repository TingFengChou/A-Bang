// 討論串的「→ 影響」：每位小幫手回報的資料，對這次決策有什麼影響（真實資料＋decide.js 的規則，不經模型、不編造）。
// 也產生阿幫一開始的「我聽懂了」（判斷層結果），讓使用者一送出就看到阿幫在依他的狀況做事，而不是只有 loading。
import { BAD_AIR_AQI } from '../services/trip.js';

const INTENT_SAY = {
  trip: '想知道怎麼去', bus_route: '在等公車', youbike: '想找 YouBike', nearby_bus: '想找附近站牌', metro: '想搭捷運', rail: '想查高鐵台鐵',
  weather: '想知道天氣', aqi: '想知道空氣品質', quake: '想知道地震', pharmacy: '在找藥局', garbage: '想知道垃圾車', fuel: '想看油價', invoice: '想對發票', stock: '想看股市',
};
const STATE_SAY = { rush: '趕時間', luggage: '帶行李', budget: '想省錢', lessWalk: '想少走路', rain: '遇到下雨', badAir: '覺得空氣差' };

/**
 * 判斷層結果 → 阿幫的第一句（≤ 60 字；agent_note）。意圖不明時回 null。
 * @param {{ intent: string, states: string[] }} j
 */
export function judgeNote(j) {
  if (!j || !INTENT_SAY[j.intent]) return null;
  const st = (j.states || []).map((k) => STATE_SAY[k]).filter(Boolean);
  const tail = j.intent === 'trip' ? '我先看地點、天氣、空品、路況，再比較幾種走法' : '我請小幫手查一下';
  return `我聽懂了：你${INTENT_SAY[j.intent]}${st.length ? `，而且${st.join('、')}` : ''}。${tail}`.slice(0, 60);
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
