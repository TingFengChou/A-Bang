// 這一輪要不要「先查並問」或「先問」（PM 的 Q 情境，2026-11-22）：runDemo 拿到位置之後呼叫，決定問哪一題、猜哪一個。
//   stop  ＝不查資料，只問（查了也是亂算：沒定位又要去台北的票價、只說「高鐵」、路名、只打一個認不得的名字）
//   after ＝先用最可能的答案查（選項第一個標「猜的」），查完再問；按了選項送出完整的一句重算
// 問題的內容在 core/agent/clarify.js；打字回答由 core/agent/ask.js 的 PENDING_SLOTS 接回。一輪最多一題（runDemo 預留 ask.done）。
import { distanceM } from '../util.js';
import { DEFAULT_FROM } from './demo-intent.js';
import { slotAsk } from './ask.js';
import {
  placeGuess, placeAsk, roadAsk, hereAsk, topicAsk, railFromAsk, railToAsk, nearestStation, whereAsk, busStopAsk, invoiceAsk, scamPasteAsk,
  landmarkByName, HERE_M, railName, airportGuess, airportAsk,
} from './clarify.js';
const shortOf = (en, token) => (en ? `Which “${token}” do you mean? Tap one above, or type the full place name.` : `你說的「${token}」是哪裡？點上面一個，或直接打完整的地名。`);

/**
 * @param {object} it parseIntent 的結果（定位之後；可能會改 it：猜的目的地、最近的車站）
 * @param {{ profileId?: string, history?: Array<{ role: string, content: string }> }} [o]
 * @returns {{ stop: { ask: object, short: string, accept?: Set<string> } } | { after: (results: object) => ({ ask: object, accept?: Set<string> } | null) } | null}
 */
export function planAsk(it, { profileId = 'life', history = [], text = '' } = {}) {
  const en = it?.lang === 'en';
  const lang = en ? 'en' : null;
  if (profileId === 'antifraud') return ['empty', 'emptyEn'].includes(it?.intent) ? { after: () => ({ ask: scamPasteAsk('antifraud', it.intent === 'emptyEn' ? 'en' : null) }) } : null;
  if (profileId !== 'life' || !it) return null;
  const at = it.fromPoint || landmarkByName(DEFAULT_FROM);
  if (it.intent === 'scamAsk') return { after: () => ({ ask: scamPasteAsk('life', lang, text, { pasted: !!it.pasted }) }) };
  if (it.road) return { stop: roadAsk(it.road, lang) };
  if (it.category) return { stop: topicAsk(it.category, lang) };
  if (it.ambig && it.bare && it.intent === 'unknown') { // 只打一個認不得的名字（「中正」）：不排行程，問是哪裡
    const g = placeGuess(it.ambig, at);
    const a = placeAsk(it.ambig, g.order, { lang });
    return { stop: { ask: a, short: shortOf(en, it.ambig.token), accept: new Set(a.options.map((o) => o.say)) } };
  }
  if (it.intent === 'trip' && it.airport && !it.to) { // 去機場沒說哪個：有位置（或說了起點）先用最近的機場算，同時問；沒位置只問
    const g = airportGuess(it.fromSaved || it.fromPoint || (it.from && landmarkByName(it.from)) || null, { en }); // 「從家去機場」：常用地點的座標
    if (it.followUp && g.guess) { it.to = g.guess; return null; } // 接著改條件（「那叫車呢」）：問過了，照猜的那個算
    const o = { from: it.from || null, mode: it.mode || null, lang };
    if (!g.guess) { const a = airportAsk(g.order, o); return { stop: a }; }
    it.to = g.guess;
    const a = airportAsk(g.order, { ...o, guess: true });
    return { after: () => ({ ask: a.ask, accept: a.accept }) };
  }
  if (it.intent === 'trip' && it.ambig) { // 同名的地點：先用最可能的算，同時問（PM Q-4、Q-6、Q-9）
    const g = placeGuess(it.ambig, at);
    if (it.followUp) { if (it.ambig.names.includes(it.to)) it.to = g.guess; return null; } // 接著改條件（「那叫車呢」「我趕時間」）：問過了，沒回答＝略過，照猜的那個算（ADR-0016 第 4 點）
    if (g.far) { // 猜的在 30 公里外：不先查（不猜遠的），只問
      const a = placeAsk(it.ambig, g.order, { from: it.from || null, mode: it.mode || null, lang });
      return { stop: { ask: a, short: shortOf(en, it.ambig.token), accept: new Set(a.options.map((o) => o.say)) } };
    }
    if (g.guess) it.to = g.guess;
    if (!g.ask) return null;
    const a = placeAsk(it.ambig, g.order, { guess: true, from: it.from || null, mode: it.mode || null, lang });
    return { after: () => ({ ask: a, accept: new Set(a.options.map((o) => o.say)) }) };
  }
  if (it.intent === 'trip' && it.bare && it.fromPoint && it.to && !it.from && !it.followUp) { // 人就在那裡又只打地名：不排 0 分鐘的行程（PM Q-14）。「去火車站怎麼坐」人在車站旁仍照常排（P5-3、P5-4、Q-26；跟 Q-14 的衝突列給產品負責人）
    const x = landmarkByName(it.to);
    if (x && distanceM(it.fromPoint.lat, it.fromPoint.lon, x.lat, x.lon) <= HERE_M) return { stop: hereAsk(x.name, lang) };
  }
  if (it.intent === 'rail' && it.fare) {
    if (!it.to) return { stop: railToAsk({ system: it.system, fare: true, lang }) }; // 「高鐵票價」：問到哪一站
    if (it.from && !it.fromGuess) return null;
    const near = it.fromPoint && nearestStation(it.fromPoint, it.system);
    if (near && near.name !== railName(it.to)) { it.from = near.name; it.fromGuess = false; it.fromNearest = true; return null; } // 有定位：用最近的站，不猜台北、不問（PM Q-2）
    if (!it.from || near) { delete it.fromGuess; it.from = null; return { stop: railFromAsk({ system: it.system, to: it.to, lang }) }; } // 要去的就是最近的站或台北：問起站（PM Q-1）
    return { after: (r) => (r.rail_fare?.length ? railFromAsk({ system: it.system, to: it.to, guess: railName(it.from), lang }) : null) }; // 沒定位：先用台北算，問起站（PM Q-3）
  }
  if (it.intent === 'rail' && it.anyTo) { // 「高鐵下一班」沒說去哪：最近的站往兩個方向先查，問要去哪一站（PM Q-19）
    const near = it.system === 'THSR' && nearestStation(at, 'THSR');
    if (!near) return { stop: railToAsk({ system: it.system, lang }) };
    it.railNear = near.name;
    return { after: () => railToAsk({ system: it.system, from: near.name, lang }) };
  }
  const located = it.fromPoint || it.places?.[0] || it.savedAt;
  if (it.intent === 'outing' && it.askTo && located) return { after: () => { const g = slotAsk({ intent: 'trip', needs: 'to', lang }, { lang, history }); return g && { ask: g.ask }; } }; // 要出門了：出門建議＋問要去哪（PM Q-13）
  if (['weather', 'aqi', 'outing'].includes(it.intent) && !located && !it.later && !it.also?.length) return { after: (r) => (Object.keys(r).length ? { ask: whereAsk(it.intent, { tomorrow: !!it.tomorrow, lang }) } : null) }; // 沒定位：先查預設地點，問在哪（PM Q-15）
  if (it.intent === 'bus_route' && it.route && !it.stop && !it.toward && !it.followUp && !located && !it.also?.length && !it.alsoWeather) { // 沒定位又沒說站：不列全線，問在哪一站（PM Q-16）
    it.askStop = true;
    return { after: (r) => { const a = busStopAsk(r.bus_route_eta?.at(-1)?.data, lang); return a && { ask: a }; } };
  }
  if (it.intent === 'invoice' && it.wantCheck && !it.also?.length) return { after: (r) => (r.invoice_lottery?.length ? { ask: invoiceAsk(lang) } : null) }; // 問有沒有中獎：報這期號碼，問號碼（PM Q-21）
  return null;
}

/**
 * 模型模式（Claude／地端）也由程式先問：只取不用位置、也不用先查的那幾題（路名、只說類別、只打一個認不得的名字、高鐵台鐵沒說迄站），
 * 跟示範與 edge 模式同一題、同一套選項（ADR-0016「模型模式也由程式送 ask」）。先查並問的那幾題要查詢結果，只在示範與 edge 模式。
 * @returns {{ ask: object, short: string, accept?: Set<string> } | null}
 */
export function askFirst(it, { history = [] } = {}) {
  if (!it) return null;
  // 同名地點、去機場：2026-11-28 起模型模式也「先用猜的算、查完再問」（model-loop 拿到位置後跑 planAsk，Antigravity 第七輪 A）；這裡不先問
  if (!(it.road || it.category || (it.ambig && it.bare && it.intent === 'unknown') || (it.intent === 'rail' && !it.to && (it.fare || (it.anyTo && it.system !== 'THSR'))))) return null;
  return planAsk({ ...it }, { history })?.stop || null;
}
