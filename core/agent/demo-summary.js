// 示範模式（規則）的總結：工具結果 → 阿幫說的那段話（中文與英文）。數字一律取自工具資料（ADR-0009）。
// 拆 demo-intent.js 第二步（架構第二輪 #4）：解析與步驟留在 demo-intent.js，總結在這裡。
import { enName, outingEn, SPEAK_EN } from '../tools/speak-en.js';
import { LANDMARKS } from '../services/places.js';
import { nextStepOf } from '../tools/trip.js';
import { BUS_OFF, withoutBus, busOffEntry } from '../services/trip.js';
import { upcomingTrains } from '../tools/transit.js';
import { outingSay } from './outing.js';
import { DEFAULT_FROM, DEFAULT_AREA, NO_ADVICE, INVOICE_WALLET_HINT, ALSO_TOOL, docShort, dayWord, isNearby } from './demo-intent.js';

/** 示範資料只收了少數地區的工具（找不到時要說是示範資料） */
const DEMO_SPARSE = new Set(['pharmacy_search', 'clinic_search', 'garbage_truck_nearby']);
/** 英文方案名稱（卡片目前仍是中文；回答用英文） */
const enPlace = (name) => { const l = (LANDMARKS.items || LANDMARKS).find((x) => x.name === name); const en = l?.en || l?.aliases?.find((a) => /^[A-Za-z]{4,}/.test(a)); return en ? `${en} (${name})` : name; };
const EN_MODE_NAME = { walk: 'walking', bike: 'YouBike', bus: 'bus', metro: 'MRT', thsr: 'High Speed Rail', tra: 'train', intercity: 'intercity bus', ridehail: 'taxi', drive: 'driving' };
/** 英文總結（S12；數字取自工具資料） */
function englishSummary(it, results) {
  const note = ' Station and place names are shown in Chinese.';
  if (it.intent === 'drama') { // 短劇（ADR-0019）：劇名、簡介是中文
    const d = (results.drama_search?.at(-1)?.data?.items?.length ? results.drama_search : results.drama_picks)?.at(-1)?.data;
    if (!d?.items?.length) return "I couldn't find any short dramas right now. Try again later.";
    const open = d.items.some((x) => x.appLink) || d.store ? ' Tap “Watch on MyDrama” on the card to open the app.' : '';
    return `${d.kind === 'search' ? 'Short dramas on MyDrama that match' : 'Popular short dramas on MyDrama'}: ${d.items.slice(0, 3).map((x) => `《${x.title}》`).join(', ')}. Titles and episodes are in Chinese.${open}`;
  }
  if (it.intent === 'trip') {
    const trip = results.plan_trip?.[0]?.data;
    const best = trip?.options.find((o) => o.id === trip.best);
    if (!best) return trip || !((results.find_place || []).some((r) => r?.data?.length) || it.fromPoint || it.fromSaved || it.toSaved)
      ? `I couldn't find a good way to get there. Try another place name.${note}`
      : `I couldn't get the trip data this time (a data source had a problem). Please ask again in a moment.${note}`; // 地點找到了、行程沒拿到：照實說
    const cost = `${best.costRange ? `NT$${best.costRange[0]}-${best.costRange[1]}` : best.cost ? `NT$${best.cost}` : 'free'}${best.share ? ` per person (${best.share.party} people)` : ''}`;
    const rainSoon = trip.states?.some((x) => x.key === 'rainSoon') ? ` Rain is likely within 3 hours (${trip.weather?.pop3h}%), bring an umbrella.` : '';
    const tight = trip.tight ? ` Time is tight: only ${trip.tight.slackMin} min to spare, leave now.` : '';
    const from = it.from ? enPlace(it.from) : it.fromPoint ? 'your location' : enPlace(DEFAULT_FROM);
    const missing = trip.modeUnavailable ? `I couldn't find a ${EN_MODE_NAME[trip.modeUnavailable] || trip.modeUnavailable} option, so here's the best alternative. ` : '';
    const night = trip.night?.textEn ? `${trip.night.textEn} ` : ''; // 深夜：第一句先說公車、捷運收班或末班快到了
    // 今天不會來的直達公車（站牌即時資訊）：一條（route）或全部（role 層級；收班由深夜那句說）
    const off = (trip.missing || []).filter((m) => m.role === 'bus' && !m.closed && (m.kind === 'route' || /live stop info/.test(m.whyEn || '')))
      .filter((m) => m.kind !== 'route').map((m) => `${m.whyEn}. `).join('')
      + offGroups((trip.missing || []).filter((m) => m.kind === 'route'), 'whyEn').map(([why, routes]) => `${routes.length > 1 ? 'Buses' : 'Bus'} ${routes.join(', ')}: ${why}, so I left ${routes.length > 1 ? 'them' : 'it'} out. `).join('');
    const eta = results.bus_route_eta?.at(-1)?.data;
    // 保底：推薦的公車盯到站後發現今天不會來（重排後仍是這班）→ 不說「Best: Bus」，改推排名下一個
    if (best.role === 'bus' && eta?.focus && eta.routeName === best.follow?.routeName && BUS_OFF[eta.focus.status]) return `${night}${off}${busOffSay(trip, eta, 'en')}${note}`;
    const limited = trip.limited?.textEn ? `${trip.limited.textEn} ` : ''; // TDX 額度用完：示範班次不推，先照實說（PR #126 審查）
    return `${night}${limited}${missing}${off}From ${from} to ${enPlace(it.to)}, I compared ${trip.options.length} ${trip.options.length === 1 ? 'option' : 'options'}. Best: ${enName(best)}, about ${best.minutes} min, ${cost}, arriving ${best.arriveAt}.${rainSoon}${tight}${note}`;
  }
  if (it.intent === 'weather') {
    const where = it.places[0] ? ` in ${enPlace(it.places[0]).replace(/ Station \(.*\)$/, '').replace(/ Main$/, '')}` : it.fromPoint ? ' where you are' : ` in ${enPlace(DEFAULT_FROM)}`;
    const w = results.weather_tomorrow?.at(-1)?.data, n = results.weather_now?.at(-1)?.data;
    if (w) return `Tomorrow${where}: ${w.minT ?? '?'}-${w.maxT ?? '?'}°C, ${w.pop ?? '?'}% chance of rain${(w.dayPop ?? w.pop) >= 50 ? ', bring an umbrella' : ''}.`;
    if (n) return `Right now${where}: ${n.tempC ?? '?'}°C, ${n.raining ? 'raining' : n.rainKnown === false ? 'no rain data this time' : 'not raining'}${n.pop3h != null ? `, ${n.pop3h}% chance of rain in the next 3 hours` : ''}.`;
  }
  if (it.intent === 'rail') {
    // 票價（P3-7）：沒說起站是從台北算，要說
    const f = results.rail_fare?.at(-1)?.data;
    if (it.fare && f) return `${it.system === 'THSR' ? 'High Speed Rail' : 'Train'} fare: ${SPEAK_EN.rail_fare(f)}${it.fromGuess ? ' I assumed you start from Taipei; tell me if you start somewhere else.' : it.fromNearest ? ` I used the ${it.system === 'THSR' ? 'HSR' : 'train'} station nearest to you (${f.from || it.from}); tell me if you start somewhere else.` : ''}${note}`;
    const t = (results.thsr_timetable || results.tra_timetable)?.at(-1)?.data;
    const up = t && upcomingTrains(t); // 下一班＝還沒開的第一班（不是當天第一班）
    const next = (up?.length ? up : t?.trains)?.[0];
    if (next) return `${it.system === 'THSR' ? 'High Speed Rail' : 'Train'} from ${t.from} to ${t.to}: next one leaves ${next.depart}, arrives ${next.arrive}.${note}`;
  }
  if (it.intent === 'metro') { const m = results.metro_live_board?.at(-1)?.data; const tr = m?.trains?.find((x) => x.etaMin != null); if (m) return tr ? `MRT ${m.station}: ${tr.etaMin <= 0 && !tr.scheduled ? `train to ${tr.destination} arriving now` : `next train to ${tr.destination} in ${tr.scheduled ? 'about ' : ''}${Math.max(1, tr.etaMin)} min`}.${note}` : `MRT ${m.station}: no live arrival data right now.`; }
  if (it.intent === 'traffic') { const t = results.traffic_status?.at(-1); return t ? `${enPlace(t.data.from)} → ${enPlace(t.data.to)}: ${SPEAK_EN.traffic_status(t.data)}${note}` : `I couldn't get freeway traffic for that route (the two places may be too close).${note}`; }
  if (it.intent === 'aqi') { const a = results.aqi_nearby?.at(-1)?.data?.nearest; if (a) return `Air quality near ${a.site} station: AQI ${a.aqi}${a.aqi > 100 ? ', consider wearing a mask' : ''}.`; }
  if (it.intent === 'youbike') { const b = results.youbike_nearby?.at(-1)?.data?.stations?.[0]; if (b) return `Nearest YouBike station: ${b.name}, ${b.rent ?? '?'} bikes and ${b.returnSlots ?? '?'} free docks.${note}`; }
  if (it.intent === 'outing') { const o = results.outing_advice?.at(-1)?.data; if (o) { const tips = o.items.map(outingEn).filter(Boolean); return `Before you head out: ${tips.join('; ')}.${note}`; } }
  if (it.intent === 'gov') {
    if (it.lostPassportEn) return 'If you are visiting Taiwan: report the loss at the nearest police station to get a police report (call 110 in an emergency), then contact your country\'s embassy or representative office in Taiwan for a replacement travel document. The 24-hour foreigner hotline 0800-024-111 (free, English) can help. Taiwanese citizens can ask me in Chinese about 護照遺失.';
    const o = results.gov_office_nearby?.at(-1)?.data;
    if (it.govOffice && o) return `${SPEAK_EN.gov_office_nearby(o)} Opening hours vary by office (lunch break, some evenings and Saturdays), so call before you go${o.offices[0]?.tel ? ` (${o.offices[0].tel})` : ''}. Office names are shown in Chinese.${it.noLocation ? ' I could not get your location, so I searched near Taipei Main Station.' : ''}`;
    const p = results.passport_waiting?.at(-1)?.data;
    if (it.govPassport && p) return `${SPEAK_EN.passport_waiting(p)} These are head counts only, not wait times; booking online is much faster.`;
    return 'For government services, ask me in Chinese for now (for example 換身分證要帶什麼). I can find the nearest household registration office or show passport office queues in English.';
  }
  if (it.intent === 'pharmacy' && it.clinic) { const c = results.clinic_search?.at(-1)?.data; if (c) return `${SPEAK_EN.clinic_search(c)}${c.areaFrom ? ' The area was guessed from your location; tell me the district if it is wrong.' : ''} Hours are what clinics registered with NHI; call before you go. For an emergency, call 119.${note}`; }
  if (it.intent === 'pharmacy') { const p = results.pharmacy_search?.at(-1)?.data; if (p) return `${SPEAK_EN.pharmacy_search(p)}${p.areaFrom ? ' The area was guessed from your location; tell me the district if it is wrong.' : ` You didn't say where, so I searched ${p.area}; tell me the district.`} Tap a pharmacy for the map.${note}`; }
  if (it.thanks) return "You're welcome! Have a good trip.";
  if (it.intent === 'savedMissing') return `I don't know where your ${({ 家: 'home', 公司: 'office', 學校: 'school' })[it.missing] || 'saved place'} is yet. Set it in Settings & privacy → Saved places, or just tell me the place name (e.g. "How do I get to Banqiao Station?").`; // 「I'm at Taipei 101, about to go home」：還沒設定家
  if (it.help) return (it.greet ? `${it.greet[0].toUpperCase()}${it.greet.slice(1)}! I'm Abang. ` : '') + 'I can help you get around Taiwan (bus, MRT, train, high-speed rail, YouBike, taxi, from A to B) and check daily info (weather, air quality, earthquakes, pharmacies, garbage trucks, fuel prices, invoices, stock closing prices). Try: "How do I get to Taipei 101?"';
  if (it.intent === 'unknown' && it.topic) return `Got it — you want to ${it.topic}. Abang can't do that yet; I can help with getting around Taiwan (bus, MRT, train, YouBike, taxi), the weather and daily info. Try: "How do I get to Taipei 101?"`;
  if (it.intent === 'unknown') return 'Sorry, I didn\'t catch that. I can help with getting around Taiwan (bus, MRT, train, YouBike, taxi), the weather, and finding a pharmacy or a clinic open nearby. Try: "How do I get to Taipei 101?"';
  // 什麼都沒查到（例：車站或地點不在資料裡）：照實說，不說「Here you go」
  if (!Object.keys(results).length) return "Sorry, I couldn't get that information right now (the station or place may not be covered). Try another name.";
  return `Here you go.${note}`;
}

/** 示範模式的總結（取自工具結果，不經模型） */
/** 深夜：公車已收班或接近末班的一句（示範與模型模式共用，S10）；沒有回 '' */
/** bare：不帶「現在 00:10／00:10 出發」（回答已經說了「明天 00:10 出發：」，或出發時間是程式合成的、使用者沒說） */
export function nightNote(trip, { bare = false } = {}) {
  if (trip?.night?.text) return `${bare && trip.night.body ? trip.night.body : trip.night.text}。`; // plan_trip 產生的深夜一句（公車、捷運收班或末班快到了；trip-considered.js nightOf）
  const closed = trip?.skipped?.find((x) => x.role === 'bus' && /收班|末班已過/.test(x.why));
  return closed ? `${closed.why}。` : trip?.options?.some((o) => o.lastBus) ? '末班快到了，早點出門；錯過可以叫車或騎 YouBike。' : '';
}

export function demoSummary(it, results, suggestions = []) {
  if (it.intent === 'scamAsk' && it.lang === 'en') return "To check a suspicious message, open Anti-fraud (Home → Anti-fraud) and paste the message, link or phone number, or take a photo of it. Until then, don't click links, transfer money, or share codes.";
  // 問藥局晚上有沒有開：補一句晚上有登記營業的（健保署只登記上午、下午、晚上時段；P3-4）
  if (it.intent === 'pharmacy' && it.evening && !it.lang) {
    const list = results.pharmacy_search?.at(-1)?.data?.pharmacies || [];
    const night = list.filter((x) => x.today?.includes('晚上'));
    const add = list.length ? (night.length ? ` 今天晚上有登記營業的：${night.slice(0, 3).map((x) => x.name).join('、')}${night.length > 3 ? ` 等 ${night.length} 家` : ''}（以藥局公告為準，出門前可先打電話）。` : ' 這一區今天沒有登記晚上營業的藥局，可以換一區問看看。') : '';
    return `${summaryCore(it, results, suggestions)}${add}`;
  }
  // 一句問好幾件事：主要的照平常說，其他幾件接著說各自的一句話（P5-8）
  if (it.also?.length && !it.lang) {
    // 其他幾件是最後查的：從各工具結果的尾端取回（同一個工具查兩次，例如兩條公車，也分得開）
    const own = { ...results }, tail = [];
    for (const x of [...it.also].reverse()) {
      const k = ALSO_TOOL[x.intent]?.(x);
      if (!own[k]?.length) continue;
      tail.unshift(own[k].at(-1).speak);
      own[k] = own[k].slice(0, -1);
      if (!own[k].length) delete own[k];
    }
    const head = demoSummary({ ...it, also: undefined }, own, suggestions);
    return [head, ...tail.filter(Boolean)].join(' ');
  }
  // 一句兩件事（公車＋天氣）：兩個都說（P2-2）
  if (it.intent === 'bus_route' && it.alsoWeather && !it.lang) { const b = results.bus_route_eta?.at(-1)?.speak; const w = results.weather_now?.at(-1)?.speak; if (b || w) return [b, w].filter(Boolean).join(' '); }
  if (it.intent === 'fuel' && !it.lang) { // 只報問的那一種；問漲跌要照實說資料只有這週（P4-1）
    const f = results.fuel_price?.at(-1)?.data;
    if (f?.prices?.length) {
      const one = it.grade && f.prices.find((x) => (it.grade === '柴油' ? /^柴油|^超級柴油/.test(x.name) : x.name.startsWith(it.grade)));
      const head = one ? `${one.name.replace('無鉛汽油', ' 無鉛')}：${one.price} 元／公升（${f.effectiveDate ?? '本週'} 起）。` : summaryCore(it, results, suggestions);
      return `${head}${it.trend ? ' 漲跌：開放資料只有這週的牌價，沒有上週可以比；調整幅度請看中油每週日的公告。' : ''}`;
    }
  }
  if (it.intent === 'rail' && it.fare && !it.from) return it.lang === 'en' ? 'Which station are you starting from? Tell me and I\'ll look up the fare.' : `您要從哪一站出發？告訴我起站，我幫您查到${it.to}的票價。`;
  if (it.intent === 'rail' && it.anyTo) return railAnySummary(it, results);
  if (it.intent === 'bus_route' && it.askStop && !it.lang) { // 沒定位又沒說站：不列全線，請他說在哪一站等（PM Q-16）
    const d = results.bus_route_eta?.at(-1)?.data;
    const dirs = (d?.directions || []).map((x) => x.label).filter(Boolean);
    if (d) return `${d.routeName}${dirs.length ? ` 有${dirs.length === 2 ? '兩個' : ''}方向（${dirs.join('、')}）` : ''}。沒拿到您的位置，告訴我您在哪一站等，我幫您看那一站還要多久。`;
  }
  if (it.ack) return it.lang === 'en' ? 'OK! Ask me anything else anytime.' : '好的！還想查什麼隨時跟我說。';
  const text0 = summaryCore(it, results, suggestions);
  const text = it.intent === 'trip' && it.roadAsk && !it.lang && results.plan_trip?.length ? `${text0} 市區道路塞不塞，開放資料查不到（路況只有國道）。` : text0; // 「坐公車會不會塞車」：排行程，照實說（PR #127 審查）
  // 要訂票（「幫我訂明天的高鐵票」）：阿幫只給官方連結（ADR-0011；P2-10）
  if (it.intent === 'rail' && it.fare && it.fromGuess && !it.lang) return `${text}（您沒說從哪一站出發，我先用${String(it.from).replace(/臺/g, '台')}算；告訴我起站就重查。）`;
  if (it.intent === 'rail' && it.fare && it.fromNearest && !it.lang) return `${text}（您沒說從哪一站出發，我用離您最近的${it.system === 'THSR' ? '高鐵' : '火車'}站「${it.from}」算；從別站出發就告訴我。）`; // PM Q-2
  if (it.intent === 'rail' && it.book && !it.lang) return `${text} 訂票請按卡片上的官方訂票連結，在${it.system === 'THSR' ? '高鐵' : '台鐵'}官網或 App 完成（阿幫不代訂、不付款）。`;
  return text;
}
/** 「高鐵下一班」沒說去哪：最近的站往兩個方向的下一班，再問要去哪一站（PM Q-19） */
function railAnySummary(it, results) {
  const list = (results.thsr_timetable || results.tra_timetable || []).map((r) => r.data).filter(Boolean);
  const en = it.lang === 'en';
  if (!list.length) return en ? 'Which station are you going to? Tell me and I\'ll look up the next train.' : '您要去哪一站？告訴我迄站，我幫您查下一班。';
  const pre = it.fromPoint ? '' : en ? `I didn't get your location, so I used ${DEFAULT_FROM}. ` : it.noLocation ? `（沒拿到您的位置，先看「${DEFAULT_FROM}」最近的站。）` : `（您沒說在哪，先看「${DEFAULT_FROM}」最近的站。）`;
  const parts = list.map((d) => { const up = upcomingTrains(d); const n = (up || d.trains)[0]; return n ? (en ? `toward ${d.to}: next leaves ${n.depart}` : `往${d.to}下一班 ${n.depart} 出發`) : (en ? `toward ${d.to}: no more trains today` : `往${d.to}今天沒有班次了`); });
  const st = String(list[0].from || it.railNear).replace(/臺/g, '台');
  return en ? `${pre}Nearest HSR station: ${st}. ${parts.join('; ')}. Which station are you going to?`
    : `${pre}${it.fromPoint ? '離您最近' : '最近'}的高鐵站是${st}：${parts.join('、')}。要去哪一站？告訴我，我幫您查那一站的班次。`;
}
/** 找短劇的總結（ADR-0019）：數字與劇名來自工具；有 App 連結才說「按卡片開 App」 */
export function dramaSummary(it, results) {
  const search = results.drama_search?.at(-1), picks = results.drama_picks?.at(-1), series = results.drama_series?.at(-1);
  const canOpen = (d) => !!(d?.items?.some((x) => x.appLink) || d?.store);
  const open = (d) => (canOpen(d) ? '按卡片上的「在 MyDrama 看」就會開 App（沒裝會到商店頁）。' : '');
  if (series) {
    const x = series.data.items[0];
    return `${series.speak}${x.synopsis ? `簡介：${x.synopsis.length > 90 ? `${x.synopsis.slice(0, 90)}…` : x.synopsis}` : ''} ${open(series.data)}`.trim();
  }
  if (search && search.data.items.length) return `${search.speak} ${open(search.data)}還想找別的類型也可以跟我說，例如「懸疑」「重生」。`.trim();
  if (picks) return `${search ? `MyDrama 沒有找到「${search.data.query}」的短劇，先給您看熱門的：` : ''}${picks.speak} ${open(picks.data)}想看特定類型就說，例如「甜寵」「懸疑」。`.trim();
  return '這次沒查到短劇資料（片庫連不上）；先問點別的，過一會兒再找劇。';
}
/** 不會來的路線依原因分組：[[原因, [路線…]]]（「公車 R2、R3 今天沒有營運」一句說完） */
function offGroups(list, key = 'why') {
  const m = new Map();
  for (const x of list) m.set(x[key], [...(m.get(x[key]) || []), x.route]);
  return [...m.entries()];
}
/** 保底（run.js 沒能重排、推薦的仍是今天不會來的公車）：照實說這班不會來，改推把它排除後重新比較的建議（withoutBus，同一套 decide()；不拿 ranking 第二名），不問到站提醒 */
export function busOffSay(trip, eta, lang = null) {
  const f = eta.focus, off = BUS_OFF[f.status];
  const alt = withoutBus(trip, [busOffEntry(eta.routeName, f.status)]);
  const next = alt.options.find((o) => o.id === alt.best);
  if (lang === 'en') return `Bus ${eta.routeName} at ${f.stopName}: ${off.whyEn}, so it won't come.${next ? ` Instead: ${enName(next)}, about ${next.minutes} min, arriving ${next.arriveAt}.` : ' Try a taxi or YouBike.'}`;
  const step = next && nextStepOf(next);
  return `公車 ${eta.routeName} 在「${f.stopName}」${off.why}，這班不會來。${next ? `改推「${next.name}」：約 ${next.minutes} 分，${next.arriveAt} 到。${step ? `下一步：${step}。` : ''}` : '可以叫車或騎 YouBike。'}`;
}
/** 捷運的一句（m01）：下一班之外，其他方向（或其他線）也說；問末班車就說時刻表的末班 */
const metroEta = (t) => (t.scheduled ? `約 ${Math.max(1, t.etaMin)} 分（時刻表）` : t.etaMin <= 0 ? '進站中' : t.etaMin <= 1 ? '即將進站' : `約 ${t.etaMin} 分`);
function metroSay(it, r) {
  const d = r?.data;
  if (!d) return r?.speak || '這次沒查到捷運資料。';
  if (it.last) {
    const list = d.lastTrains || [];
    if (!list.length) return `${d.station}：查不到時刻表的末班車資料，末班時間請以車站公告為準。`;
    return `${d.station}站的末班車（依時刻表）：${list.slice(0, 4).map((x) => `${x.line ? `${x.line}` : ''}往${x.destination} ${x.time}`).join('、')}。`;
  }
  const seen = new Set();
  const lanes = (d.trains || []).filter((t) => t.etaMin != null && !seen.has(`${t.lineId}|${t.destination}`) && seen.add(`${t.lineId}|${t.destination}`));
  const more = lanes.slice(1, 4).map((t) => `往${t.destination}${metroEta(t)}`);
  return `${r.speak}${more.length ? `其他方向：${more.join('、')}。` : ''}`;
}
/** 公車末班（到站資料只有末班已過的狀態，沒有末班時刻）：照實說 */
function busLastSay(it, r) {
  const d = r?.data;
  if (!d) return r?.speak || '這次沒查到公車資料。';
  const f = d.focus;
  const stops = (d.directions || []).flatMap((x) => x.stops);
  const passed = f ? f.status === 3 : stops.length > 0 && stops.every((x) => x.status === 3 || x.status === 4);
  return passed
    ? `${r.speak} ${d.routeName} 今天的末班車已經過了；可以叫車或騎 YouBike。`
    : `${r.speak} ${d.routeName} 現在還有車。開放資料只有即時到站、沒有公車的末班時刻，確切的末班時間請看站牌公告。`;
}
/** 附近站牌（n02）：最近的站有哪些路線也說 */
function nearbySay(r) {
  const st = r?.data?.stations?.[0];
  if (!st?.routes?.length) return r?.speak || '這次沒查到附近的站牌。';
  return `${r.speak}「${st.name}」有 ${st.routes.slice(0, 8).join('、')}${st.routes.length > 8 ? ` 等 ${st.routes.length} 條路線` : ''}。`;
}
function summaryCore(it, results, suggestions = []) {
  if (it.lang === 'en') return englishSummary(it, results);
  if (it.intent === 'drama') return dramaSummary(it, results);
  if (it.intent === 'outing') {
    const pre = it.fromPoint || it.places[0] ? '' : it.noLocation ? `（沒拿到您的位置，先看「${DEFAULT_FROM}」附近。）` : `（您沒說在哪，我先看「${DEFAULT_FROM}」附近。）`;
    const o = results.outing_advice?.at(-1);
    return `${pre}${o ? o.speak : outingSay({})}`;
  }
  if (it.intent === 'weather' && it.later) return '我目前只查得到現在和明天的天氣，後天以後的預報還沒辦法；要不要先看明天的？';
  if (it.intent === 'savedMissing') return `我還不知道您的「${it.missing}」在哪。到「設定與隱私 → 常用地點」按「輸入地點」選附近的車站或地標，或下次在${it.missing === '家' ? '家' : it.missing}時按「設成現在位置」，之後說「${it.missing === '家' ? '回家' : `去${it.missing}`}」就能直接規劃。現在也可以直接說地名，例如「${it.missing === '家' ? '回板橋' : '去台北車站'}」。`;
  if (it.reset) return '好，重新開始。想去哪裡、想查什麼？沒說起點的話，我用您現在的位置。';
  if (it.intent === 'access') return '阿幫目前拿到的開放資料沒有電梯、無障礙出口的位置，還查不到是哪一站、哪個出口。台北捷運各站都設有無障礙電梯，位置可以看站內指標，或撥台北捷運客服 (02)218-12345 問；告訴我要去哪裡，我可以幫您排少走路的路線（記得說坐輪椅或行動不便）。';
  if (it.intent === 'scamAsk' && it.pasted && it.lang !== 'en') return '這則訊息有網址，又催您限時處理、要您點連結或付款，很像詐騙簡訊。按上面的「帶到防詐檢查」，我在防詐幫您比對 165 的詐騙手法；確認之前先不要點連結、不要回傳資料或驗證碼。有疑問請撥 165。';
  if (it.intent === 'scamAsk') return it.lang === 'en' ? "To check a suspicious message, open Anti-fraud (Home → Anti-fraud) and paste the message, link or phone number, or take a photo of it. Until then, don't click links, transfer money, or share codes." : '要檢查可疑的訊息，請到「防詐」（首頁 → 防詐）把簡訊、LINE、網址或來電號碼貼上，或拍下來，我幫您比對 165 的詐騙手法。確認之前，先不要點連結、不要匯款、不要給驗證碼。';
  if (it.intent === 'limits') return '我不能替您按叫車、付款或訂票（安全與隱私，付款與個資只在官方 App 裡處理）：我會給您官方 App 或網站的連結，由您自己確認、付款。要的話告訴我要去哪裡，我比較怎麼去、附上官方叫車連結。';
  if (it.intent === 'emergency') return '如果有人受傷、昏倒或有危險，先打 119（救護、火災）或 110（報警）；手機沒有 SIM 卡或沒訊號也可以撥 112。在安全的地方等救援，不要移動受傷的人。需要的話我可以幫您查最近的路怎麼走。';
  if (it.intent === 'reminder') return '提醒要在卡片上設：查公車或排行程後，按卡片上的「提醒我」或「盯這班」，車快到、該出門時阿幫會通知您；坐上車後也可以設下車提醒。設好的提醒都在下面的「提醒」分頁，可以隨時取消。';
  if (it.intent === 'gov') { // 去政府辦事（M16-04a）：照工具資料說，提醒以機關公告為準；不代替申辦
    const gl = results.gov_official_link?.[0];
    if (it.govLink) return gl?.data?.links?.length ? `${gl.speak}按卡片上的按鈕開官網；只從官方網站或 App 進去，不要點簡訊或訊息裡的連結。` : '這件事我沒有對應的官方入口，可以換個說法，例如「罰單」「報稅」「勞保年資」。';
    const pw = results.passport_waiting?.[0];
    if (it.govPassport) return pw ? `${pw.speak}只有人數、沒有預估時間；先網路預約會快很多，卡片上有網路預約的連結。` : '護照等待人數這次拿不到（領務局的資料連不上）；急的話可以直接打給外交部領事事務局。';
    const o = results.gov_office_nearby?.[0];
    if (it.govOffice) return o ? `${o.speak}${o.data.offices[0]?.tel ? `各所營業時間不同（午休、夜間延時、週六服務），出發前可以先打電話（${o.data.offices[0].tel}）。` : '各所營業時間不同，出發前可以先打電話確認。'}${it.noLocation ? '沒拿到您的位置，先用台北車站附近找。' : ''}` : '戶政事務所的資料這次拿不到（內政部的資料連不上）；急的話可以撥 1996 內政服務專線問最近的戶政事務所。';
    const g = results.gov_service_info?.[0];
    const s = g?.data?.items?.[0];
    if (!g) return '我的E政府的申辦資料這次拿不到（資料來源連不上，不是沒有這項服務）；急的話可以直接打給辦理的機關。';
    if (!s) return `${g.speak}可以說得更具體一點，例如「換身分證要帶什麼」「戶籍謄本怎麼申請」。`;
    const short = docShort(s.docs[0]) ? s.docs.map(docShort).filter(Boolean).slice(0, 3) : []; // 第一條就是分類標題（依情況不同）時不唸 // 先唸前幾樣要帶的（PM 審查：只說「列在卡片上」聽不到重點）
    return `${g.speak}${short.length ? `要帶：${short.join('、')}${s.docs.length > short.length ? '等，完整的在卡片上' : ''}。` : s.docs.length ? '要帶的東西列在卡片上，' : ''}卡片上也有官方網頁；要身分驗證的部分請在官方網頁或到現場自己辦，阿幫不代替申辦。`;
  }
  if (it.intent === 'calendar') return it.lang === 'en' ? 'Plan a trip first, then tap "Add to calendar" on the card. Your phone\'s calendar opens so you can check it before saving.' : '先排好行程，再按卡片上的「加到行事曆」；會打開手機的行事曆，您確認後才加入。';
  if (it.intent === 'share') return it.lang === 'en' ? 'Plan a trip first, then tap "Share" on the card. Your phone\'s share menu opens and you pick who gets it.' : '先排好行程，再按卡片上的「分享」；會打開手機的分享選單，由您選要傳給誰。';
  if (it.intent === 'settings') return '設定在「我的 → 設定與隱私」：可以設常用地點（家、公司、學校）、「我有車」、語言、通知，也可以關掉手機上的 AI。設好常用地點後，說「回家」「去公司」我就知道在哪。';
  if (it.chat) return `${it.greet ? `${it.greet}！` : ''}我是阿幫，想查交通或生活資訊直接說就好，例如「去台北 101」「307 到哪了？」「今天會下雨嗎」。`;
  if (it.thanks) return '不客氣！還想查什麼隨時跟我說。';
  if (it.sorry) return '沒關係！想查什麼直接說就好，例如「去台北 101」、「307 到哪了？」。';
  // 範圍外但聽得懂想做什麼（判斷層的 topic，core/topic.js）：照實說聽懂了什麼、阿幫還沒有這項服務（不說成「聽不懂」）
  if (it.intent === 'unknown' && it.topic) return `聽懂了，您想「${it.topic}」。這個阿幫還沒有提供，沒辦法幫您查。我可以查交通（公車、捷運、台鐵、高鐵、YouBike、從 A 到 B 怎麼去）、天氣、空品、藥局、油價、發票、股市收盤，也可以幫您看訊息是不是詐騙。`;
  if (it.intent === 'unknown') return `${it.greet ? `${it.greet}！我是阿幫。` : ''}我可以幫您查交通（公車、捷運、台鐵、高鐵、YouBike、從 A 到 B 怎麼去）、生活資訊（天氣、空品、地震、藥局、有看診的診所、垃圾車、油價、發票、股市收盤）、去政府辦事（要帶什麼、最近的戶政事務所、護照等多久）和可疑訊息。試試看：${suggestions.slice(0, 3).map((q) => `「${q}」`).join('、')}`;
  if (it.intent === 'traffic' && it.cityOnly) return `阿幫拿到的路況開放資料只有國道（高速公路）${it.area ? `，「${String(it.area).replace(/臺/g, '台')}」一帶` : '，'}市區道路塞不塞查不到。要看國道就告訴我從哪裡到哪裡（例如「台北到新竹」）。`; // 市區路況（PR #127 審查）
  if (it.intent === 'traffic') { // 國道路況（S7）：起訖、結果照工具資料說
    const t = results.traffic_status?.at(-1);
    const nm = (x) => String((typeof x === 'string' ? x : x?.name) || '').replace(/臺/g, '台');
    if (!t) return `沒查到「${nm(it.fromSaved || it.from) || (it.fromPoint ? '您的位置' : DEFAULT_FROM)}」到「${nm(it.toSaved || it.to)}」沿途的國道路況（兩地太近，或這次連不上交通部的路況資料）；要出門可以直接問怎麼去。`;
    return `${nm(t.data.from)} → ${nm(t.data.to)}：${t.speak}${it.freeway ? `（看的是這段路沿途的國道，不只${it.freeway}）` : ''}`;
  }
  const last = Object.values(results).flat().filter(Boolean).at(-1);
  if (!last) return '這次沒查到資料，換個說法或加上地名試試看。';
  if (it.intent === 'trip') {
    const trip = results.plan_trip?.[0];
    const bestOpt0 = trip?.data?.options?.find((o) => o.id === trip.data.best);
    const asked = it.askWhat && bestOpt0 ? (it.askWhat === 'cost' ? `「${bestOpt0.name}」${bestOpt0.cost ? `約 ${bestOpt0.cost} 元` : '不用錢'}${bestOpt0.minutes ? `、${bestOpt0.minutes} 分` : ''}。`
      : it.askWhat === 'when' ? `現在出發、坐「${bestOpt0.name}」約 ${bestOpt0.arriveAt || '—'} 到；要幾點前到可以跟我說（例如「9 點前要到」），我幫您算幾點出門。`
        : `「${bestOpt0.name}」約 ${bestOpt0.minutes} 分${bestOpt0.arriveAt ? `（${bestOpt0.arriveAt} 到）` : ''}。`) : ''; // 追問時間、票價、幾點出門：先回答問的（PM 第二輪 #3）
    const synth = !it.departTime && !it.arriveBy && it.tomorrow && trip?.data?.departAt ? `（${dayWord(it)} ${trip.data.departAt} 出發算的；要改時間跟我說幾點。）` : ''; // 「明天去台北101」沒說幾點：說清楚用幾點算的（PM 第二輪審查）
    const when = `${asked}${synth}${it.departTime ? `${dayWord(it)} ${it.departTime} 出發：` : ''}${it.nearRail && it.to ? `最近的${it.nearRail === 'THSR' ? '高鐵' : '火車'}站是「${String(it.to).replace(/臺/g, '台')}」。` : ''}`; // 說了幾點出發、沒說哪一站的火車站，總結先講（P5-2、P5-4）
    const pre = `${when}${it.from || it.fromPoint ? '' : it.noLocation ? `（沒拿到您的位置，先從「${DEFAULT_FROM}」算；告訴我從哪出發就重算。）` : `（您沒說從哪出發，我先用「${DEFAULT_FROM}」算。）`}`;
    // 今天不會來的直達路線（站牌即時資訊：今日未營運、末班已過、交管不停靠；plan_trip 或盯到站後重排已排除）：先說，使用者才知道為什麼不推它
    const off = (trip?.data.missing || []).filter((m) => m.kind === 'route');
    const offSay = offGroups(off).map(([why, routes]) => `公車 ${routes.join('、')} ${why}，這次不推。`).join('');
    // 選了公車：阿幫已自動盯上車站（run.js busFollowUp）→ 講公車多久到、主動問要不要到站提醒
    const bus = results.bus_route_eta?.at(-1)?.data?.focus && results.bus_route_eta.at(-1);
    const busBest = trip?.data.options.find((o) => o.id === trip.data.best);
    if (trip && bus && busBest?.role === 'bus' && busBest.follow?.routeName === bus.data.routeName) {
      const walk = busBest.follow.walkMin;
      const f = bus.data.focus;
      // 保底：盯到的是今天不會來（重排後仍是這班）→ 不說「選公車」、不問到站提醒，改推排名下一個
      if (BUS_OFF[f.status]) return `${pre}${offSay}${busOffSay(trip.data, bus.data)}`;
      const miss = walk && f.status === 0 && f.etaSec != null && f.etaSec < walk * 60; // 走過去要比車到還久
      const last = busBest.lastBus;
      if (last) return `${pre}${offSay}${trip.data.ranking.reason} ${bus.speak.replace(/。$/, '')}${walk ? `，走過去約 ${walk} 分` : ''}。這可能是末班，早點出門；趕不上就叫車或騎 YouBike。`;
      return `${pre}${offSay}${trip.data.ranking.reason} ${bus.speak.replace(/。$/, '')}${walk ? `，走過去約 ${walk} 分` : ''}${miss ? '，這班可能趕不上。要我在下一班快到時提醒您嗎？' : '。要我在公車快到站時提醒您嗎？'}按卡片上的「到站前 3 分提醒我」。`;
    }
    // 深夜：公車已收班或接近末班，先說（S10）
    const night = nightNote(trip?.data, { bare: Boolean(it.departTime || it.tomorrow) }); // 說了幾點（when 已說）或明天合成的時間：不再說一次時間
    const closed = trip?.data.skipped?.some((x) => x.role === 'bus' && /收班|末班已過/.test(x.why));
    // 下一步依建議方式（叫車按官方連結、步行導航…；不再一律問「要我幫你開導航嗎」）
    const bestOpt = trip?.data.options.find((o) => o.id === trip.data.best);
    const reason = closed ? trip.data.ranking.reason.replace(/^公車這次沒有可行的方案；/, '') : trip?.data.ranking.reason; // 已說收班，不再重複「公車沒有可行的方案」
    const urgent = (trip?.data.tips || []).filter((x) => x.kind !== 'cost'); // 分攤金額在卡片上，泡泡只說要馬上注意的
    const tips = urgent.length ? ` ${urgent.map((x) => `${x.text}。`).join('')}` : '';
    const one = trip?.data.single ? `${trip.data.single.text.replace(/（現在是示範資料.*）$/, '')}。` : ''; // 只有一種方式：先說其他方式為什麼不在（數字來自 plan_trip）
    // 公車、捷運沒列入（不是深夜收班、也不是只有一種方式）：一句說原因，使用者才不會以為是 bug
    const miss = trip && !one ? (trip.data.missing || []).filter((m) => ['bus', 'metro'].includes(m.role) && !m.closed && m.kind !== 'route' && m.fallback !== 'tdx-limit') : []; // 額度用完的由 lim 一起說 // 單一路線（kind 'route'）已在 offSay 說
    // TDX 額度用完沒列入的方式（示範班次不推）：只有一種方式時 single 已說，否則說 limited 一句
    const lim = trip?.data.limited && !one ? `${trip.data.limited.text}。` : '';
    const missSay = miss.length ? ` ${miss.map((m) => `${m.role === 'bus' ? '公車' : '捷運'}沒列入：${m.why}`).join('；')}。` : '';
    if (!trip) {
      // 沒有行程結果：地點其實找到了（或用了定位）就照實說是資料暫時沒拿到，不說成「找不到地點」
      const found = (results.find_place || []).some((r) => r?.data?.length) || it.fromPoint || it.fromSaved || it.toSaved;
      return found ? `${pre}這次沒拿到行程資料（資料來源連不上，不是沒有路線）；可以再問一次，或換個說法。` : `${pre}找不到這兩個地點，換個說法試試看。`;
    }
    return `${pre}${night}${offSay}${one}${lim}${reason}${missSay}${tips}${nextStepOf(bestOpt) ? ` 下一步：${nextStepOf(bestOpt)}。` : ''}`;
  }
  // 沒說地點時用了示範預設，先講清楚
  const pre = (isNearby(it) || (it.intent === 'metro' && !it.station && !it.near)) && !it.places[0] && !it.fromPoint
    ? (it.noLocation ? `（沒拿到您的位置，先查「${DEFAULT_FROM}」附近；告訴我地點就重查。）` : `（您沒說在哪，我先查「${DEFAULT_FROM}」附近。）`)
    : it.intent === 'pharmacy' && !it.area ? (results[it.clinic ? 'clinic_search' : 'pharmacy_search']?.at(-1)?.data?.areaFrom ? `（依${it.places[0] ? `「${it.places[0]}」的位置` : it.fromPoint?.area ? '您設定的預設地區' : '您的位置'}推估在「${results[it.clinic ? 'clinic_search' : 'pharmacy_search'].at(-1).data.area}」，不對請說哪一區。）` : it.noLocation ? `（沒拿到您的位置，我先查「${DEFAULT_AREA}」；告訴我哪一區就重查。）` : `（您沒說哪一區，我先查「${DEFAULT_AREA}」。）`)
    : it.intent === 'stock' && it.advice ? NO_ADVICE : '';
  // 發票：主動提議存到「我的發票」，開獎後自動對獎（號碼只存在手機）
  // 示範模式找不到（藥局、診所、垃圾車）：示範資料只收了少數地區，不要讓人以為那一區真的沒有（V3 走查 F6）
  const demoEmpty = DEMO_SPARSE.has(Object.keys(results).find((k) => results[k]?.includes(last)) || '') && last?.mode === 'demo' && /沒有找到|沒查到/.test(last?.speak || '') ? '（現在用的是示範資料，只收了少數地區，所以可能找不到；正式上線會查真實資料。）' : '';
  const post = it.intent === 'invoice' ? ` ${INVOICE_WALLET_HINT}` : `${demoEmpty}${it.hospital ? ' 醫院的看診資料這裡沒有，上面是附近有看診的診所；身體很不舒服、急症請直接打 119 或去急診。' : ''}`; // 問醫院（PM 第三輪 #5）：照實說資料只有診所
  const body = it.intent === 'metro' && results.metro_live_board?.length ? metroSay(it, results.metro_live_board.at(-1)) // 兩個方向都說（m01）、末班車
    : it.intent === 'bus_route' && it.last && results.bus_route_eta?.length ? busLastSay(it, results.bus_route_eta.at(-1))
      : it.intent === 'nearby_bus' && results.bus_nearby_stations?.length ? `${it.lost ? '別擔心，先看您附近最近的站牌：' : ''}${nearbySay(results.bus_nearby_stations.at(-1))}${it.lost ? ' 要回家可以說「我要回家」，阿幫幫您排怎麼走。' : ''}` // 列出站牌的路線（n02）；迷路先安撫、給下一步
        : last.speak || '查好了，結果在下面的卡片。';
  return `${pre}${body}${post}`;
}
