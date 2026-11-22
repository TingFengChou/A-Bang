// 長對話（UX.md §4.17）：每一輪收起時的一行摘要、「這次問過」的小標、換話題判斷。
// 純函式：只看這一輪的資料（工具結果、決策、總結、提問），不經模型；英文那一輪用英文（下面的字典）。node:test 可測。

/** 距上一輪超過這麼久就算新的話題（分段） */
export const TOPIC_GAP_MS = 30 * 60e3;

/** 工具 → 話題類別（換話題判斷、目錄分組）。交通類（行程、公車、捷運、高鐵台鐵、YouBike、叫車、路況）同一個話題（產品負責人 2026-11-21：問完去 101 再問 307 不分段） */
const TOOL_TOPIC = {
  plan_trip: 'transit', ridehail_link: 'transit', rail_booking_link: 'transit', traffic_status: 'transit', intercity_bus: 'transit',
  bus_route_eta: 'transit', bus_station_eta: 'transit', bus_nearby_stations: 'transit', bus_search_routes: 'transit',
  metro_live_board: 'transit', metro_stations: 'transit',
  thsr_timetable: 'transit', tra_timetable: 'transit', rail_stations: 'transit', rail_fare: 'transit',
  youbike_nearby: 'transit',
  weather_now: 'weather', weather_tomorrow: 'weather', outing_advice: 'weather', aqi_nearby: 'weather',
  earthquake_recent: 'quake', pharmacy_search: 'pharmacy', garbage_truck_nearby: 'garbage', fuel_price: 'fuel',
  invoice_lottery: 'invoice', invoice_check_batch: 'invoice', stock_quote: 'stock',
  scam_check_message: 'scam', scam_lookup_url: 'scam', scam_myth_search: 'scam', sms_sender_check: 'scam',
};
/** 判斷層的意圖（core/agent/judge.js JUDGE_INTENTS）→ 話題類別：還沒有工具結果時先用 */
const INTENT_TOPIC = { trip: 'transit', bus_route: 'transit', nearby_bus: 'transit', youbike: 'transit', metro: 'transit', rail: 'transit', weather: 'weather', aqi: 'weather', quake: 'quake', pharmacy: 'pharmacy', garbage: 'garbage', fuel: 'fuel', invoice: 'invoice', stock: 'stock' };
/** 只是輔助的工具（找地點、路況）：有別的結果時不拿來當這一輪的主題 */
const AUX = new Set(['find_place', 'traffic_status']);

const MODE = {
  zh: { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', thsr: '高鐵', tra: '台鐵', intercity: '客運', ridehail: '叫車' },
  en: { walk: 'Walk', bike: 'YouBike', bus: 'Bus', metro: 'MRT', thsr: 'HSR', tra: 'Train', intercity: 'Intercity bus', ridehail: 'Taxi' },
};
const AQI_EN = { good: 'Good', moderate: 'Moderate', sensitive: 'Unhealthy for sensitive groups', unhealthy: 'Unhealthy', very: 'Very unhealthy', hazardous: 'Hazardous' };
/** 捷運到站狀態代碼（core/services/metro.js）→ 短字（英文那一輪不出現中文） */
const METRO_ST = { zh: { arriving: '進站中', approaching: '即將進站', minutes: (m) => `${m} 分`, scheduled: (m) => (m <= 1 ? '約 1 分內' : `約 ${m} 分`) }, en: { arriving: 'arriving', approaching: 'approaching', minutes: (m) => `${m} min`, scheduled: (m) => (m <= 1 ? '~1 min' : `~${m} min`) } };
const metroStatus = (t, en) => { const f = METRO_ST[en ? 'en' : 'zh'][t.scheduled ? 'scheduled' : t.status]; return typeof f === 'function' ? f(t.etaMin) : f || '—'; };
const SCAM = { zh: { high: '高風險', medium: '有疑點', low: '未發現已知特徵' }, en: { high: 'High risk', medium: 'Suspicious', low: 'No known signs' } };
const L = {
  zh: {
    min: (n) => `${n} 分`, decided: (m) => `決定：${m}`, noWay: '找不到可行方式', weather: '天氣', tomorrow: '明天天氣', air: '空品', outing: '出門建議',
    rain: '下雨', mayRain: '可能會下雨', noRain: '沒下雨', pop: (p) => `降雨 ${p}%`, quake: '地震', pharmacy: '藥局', garbage: '垃圾車', fuel: '油價', invoice: '發票', stock: '股市', index: '大盤', scam: '防詐', url: '網址', sms: '號碼', myth: '闢謠',
    bike: 'YouBike', busStop: '公車站', place: '地點', traffic: '路況', ride: '叫車', book: '訂票', noAnswer: '沒有回答',
    arrive: (s) => `${s}到站`, noBus: '目前沒有車要來', bikes: (n) => `還有 ${n} 台`, noBikes: '暫時沒有車',
    pharmacies: (n, o) => `附近 ${n} 家，今天營業 ${o} 家`, won: (p) => `中了${p}`, lost: '沒中獎', batch: (n, w) => `對了 ${n} 張，中 ${w} 張`,
    up: '漲', down: '跌', flat: '平盤', close: (n, c) => `${n} 收 ${c}`, next: (t) => `下一班 ${t}`, to: (d) => `往${d}`, listed: '在涉詐清單上', notListed: '不在涉詐清單上', myths: (n) => `${n} 篇相關`,
    turn: (n) => `第 ${n} 輪`, folded: '已收起', opened: '已展開', join: '，', arrowSay: '到', sep: '：',
  },
  en: {
    min: (n) => `${n} min`, decided: (m) => `Pick: ${m}`, noWay: 'no option found', weather: 'Weather', tomorrow: 'Tomorrow', air: 'Air', outing: 'Outing tips',
    rain: 'raining', mayRain: 'rain likely', noRain: 'no rain', pop: (p) => `rain ${p}%`, quake: 'Earthquake', pharmacy: 'Pharmacies', garbage: 'Garbage truck', fuel: 'Fuel', invoice: 'Receipt lottery', stock: 'Stocks', index: 'TAIEX', scam: 'Scam check', url: 'Link', sms: 'Sender', myth: 'Myths',
    bike: 'YouBike', busStop: 'Bus stops', place: 'Place', traffic: 'Traffic', ride: 'Taxi', book: 'Tickets', noAnswer: 'no answer',
    arrive: (s) => `in ${s.replace(/ 分$/, ' min')}`, noBus: 'no bus coming', bikes: (n) => `${n} bikes`, noBikes: 'no bikes now',
    pharmacies: (n, o) => `${n} nearby, ${o} open today`, won: (p) => `won ${p}`, lost: 'no win', batch: (n, w) => `${n} checked, ${w} won`,
    up: 'up', down: 'down', flat: 'flat', close: (n, c) => `${n} closed ${c}`, next: (t) => `next ${t}`, to: (d) => `to ${d}`, listed: 'on the scam list', notListed: 'not on the scam list', myths: (n) => `${n} related`,
    turn: (n) => `Turn ${n}`, folded: 'collapsed', opened: 'expanded', join: ', ', arrowSay: ' to ', sep: ': ',
  },
};

const clip = (s, n) => { const a = [...String(s ?? '').replace(/\s+/g, ' ').trim()]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };
const paren = (s) => String(s || '').replace(/（.*?）|\(.*?\)/g, '').trim();
const firstSentence = (s) => String(s || '').replace(/^（[^）]*）/, '').split(/(?<=[。！？!?])\s*|\n/)[0] || '';
const pct = (v) => `${Math.abs(v)}%`;

/** 方案的簡稱：「捷運（板南線轉淡水信義線）」→ 捷運；「公車 601」不變；英文用交通方式 */
function modeName(o, en) {
  if (!o) return '';
  if (en) return o.role === 'bus' && /\d/.test(o.name) ? `Bus ${o.name.replace(/^公車\s*/, '')}` : MODE.en[o.role] || paren(o.name);
  return paren(o.name) || MODE.zh[o.role] || '';
}

/** 一個工具結果的摘要：{ title, detail, short, decided? }；認不得回 null（改用 speak 的第一句） */
function one(r, ctx) {
  const d = r.data || {};
  const T = ctx.T, en = ctx.en;
  switch (r.tool) {
    case 'plan_trip': {
      const from = paren(d.from?.name), to = paren(d.to?.name);
      const opts = ctx.decision?.options || d.options || [];
      const bestId = ctx.best || ctx.decision?.best || d.best;
      const best = opts.find((o) => o.id === bestId);
      const m = modeName(best, en);
      return { title: from && to ? `${from} → ${to}` : to || from, detail: best ? `${m} ${T.min(best.minutes)}` : T.noWay, short: clip(to || from, 8), ...(best && { decided: m, rest: T.min(best.minutes) }) };
    }
    case 'bus_route_eta': {
      const route = en ? `Bus ${d.routeName}` : d.routeName;
      const f = d.focus;
      const stop = f || (d.directions || []).flatMap((x) => x.stops || []).filter((s) => s.etaSec != null).sort((a, b) => a.etaSec - b.etaSec)[0];
      if (!stop) return { title: route, detail: T.noBus, short: d.routeName };
      const st = String(stop.statusText || '');
      return { title: route, detail: `${stop.stopName} ${/^\d+ 分$/.test(st) ? T.arrive(st) : st}`.trim(), short: d.routeName };
    }
    case 'bus_station_eta': {
      const f = (d.arrivals || []).find((x) => x.etaSec != null);
      return { title: T.busStop, detail: f ? `${f.routeName} ${f.statusText}` : T.noBus, short: f?.routeName || T.busStop };
    }
    case 'bus_nearby_stations': {
      const s = d.stations?.[0];
      return { title: T.busStop, detail: s ? `${s.name}${s.distance != null ? ` ${Math.round(s.distance)}m` : ''}` : '—', short: T.busStop };
    }
    case 'youbike_nearby': {
      const s = (d.stations || []).find((x) => x.inService && x.rent > 0);
      return { title: T.bike, detail: s ? `${paren(s.name).replace(/^YouBike\d?\.?\d?_?/, '')} ${T.bikes(s.rent)}` : T.noBikes, short: 'YouBike' };
    }
    case 'metro_live_board': {
      const t = (d.trains || []).find((x) => x.etaMin != null);
      return { title: en ? `MRT ${d.station}` : `${d.station}捷運`, detail: t ? `${T.to(t.destination)} ${metroStatus(t, en)}` : '—', short: clip(d.station, 6) };
    }
    case 'thsr_timetable': case 'tra_timetable': {
      const sys = r.tool === 'thsr_timetable' ? (en ? 'HSR' : '高鐵') : (en ? 'Train' : '台鐵');
      const next = /下一班 (\d{1,2}:\d{2})/.exec(r.speak || '')?.[1] || d.trains?.[0]?.depart;
      return { title: `${sys} ${d.from ?? ''} → ${d.to ?? ''}`.trim(), detail: next ? T.next(next) : '—', short: clip(`${d.from ?? ''}→${d.to ?? ''}`, 8) };
    }
    case 'weather_now': {
      const where = en ? '' : (d.town || d.station || '');
      const state = d.rainMm1h > 0 ? T.rain : d.raining ? T.mayRain : T.noRain;
      return { title: T.weather, detail: [where, d.tempC != null && `${d.tempC}°C`, state].filter(Boolean).join(' '), short: T.weather };
    }
    case 'weather_tomorrow':
      return { title: T.tomorrow, detail: [en ? '' : d.town || d.county, d.minT != null && d.maxT != null && `${d.minT}～${d.maxT}°C`, d.pop != null && T.pop(d.pop)].filter(Boolean).join(' '), short: T.tomorrow };
    case 'aqi_nearby': {
      const n = d.nearest;
      if (!n) return null;
      return { title: T.air, detail: `${en ? '' : `${n.site} `}AQI ${n.aqi ?? '—'} ${en ? AQI_EN[n.level] || '' : n.status || ''}`.trim(), short: T.air };
    }
    case 'outing_advice':
      return { title: T.outing, detail: clip(String(d.items?.[0]?.text || '').split('，')[0], 18), short: T.outing };
    case 'earthquake_recent': {
      const q = d.quakes?.[0];
      return { title: T.quake, detail: q ? `${String(q.time || '').slice(5, 16).replace('T', ' ').replace('-', '/')} M${q.magnitude?.toFixed?.(1) ?? q.magnitude} ${en ? '' : paren(q.location).replace(/位於/, '')}`.trim() : '—', short: T.quake };
    }
    case 'pharmacy_search':
      return { title: T.pharmacy, detail: T.pharmacies((d.pharmacies || []).length, (d.pharmacies || []).filter((p) => p.openToday).length), short: T.pharmacy };
    case 'garbage_truck_nearby': {
      const s = (d.stops || []).find((x) => x.collectToday) || d.stops?.[0];
      return { title: T.garbage, detail: s ? `${clip(s.place, 12)} ${s.time ?? ''}`.trim() : '—', short: T.garbage };
    }
    case 'fuel_price':
      return { title: T.fuel, detail: (d.prices || []).slice(0, 2).map((p) => `${String(p.name).replace('無鉛汽油', '')} ${p.price}`).join('・'), short: T.fuel };
    case 'invoice_lottery':
      if (d.check) return { title: T.invoice, detail: d.check.prize ? T.won(d.check.prize) : T.lost, short: T.invoice };
      return { title: T.invoice, detail: `${en ? '' : `${d.period?.title ?? ''} `}${en ? 'Special' : '特別獎'} ${d.period?.special ?? '—'}`.trim(), short: T.invoice };
    case 'invoice_check_batch': {
      const s = d.summary || {};
      return { title: T.invoice, detail: T.batch((s.won || 0) + (s.lost || 0), s.won || 0), short: T.invoice };
    }
    case 'stock_quote': {
      const q = d.quotes?.[0];
      const x = q || d.indices?.[0];
      if (!x) return null;
      const name = q ? q.name : T.index;
      const move = x.change > 0 ? `${T.up} ${pct(x.changePct)}` : x.change < 0 ? `${T.down} ${pct(x.changePct)}` : T.flat;
      return { title: T.stock, detail: `${T.close(name, x.close)}${T.join}${move}`, short: clip(name, 6) };
    }
    case 'scam_check_message':
      return { title: T.scam, detail: SCAM[en ? 'en' : 'zh'][d.level] || '—', short: T.scam };
    case 'scam_lookup_url':
      return { title: T.url, detail: d.domain ? `${d.domain} ${d.listed ? T.listed : T.notListed}` : '—', short: T.scam };
    case 'scam_myth_search':
      return { title: T.myth, detail: T.myths((d.results || []).length), short: T.myth };
    case 'sms_sender_check':
      return { title: T.sms, detail: `${d.sender ?? ''} ${d.kind ?? ''}`.trim(), short: T.sms };
    case 'find_place':
      return Array.isArray(d) && d[0] ? { title: T.place, detail: paren(d[0].name), short: clip(paren(d[0].name), 6) } : null;
    case 'ridehail_link':
      return { title: T.ride, detail: d.to ? `${T.to(d.to)}` : '—', short: T.ride };
    case 'rail_booking_link':
      return { title: T.book, detail: clip(d.summary, 16), short: T.book };
    default:
      return null;
  }
}

/** 這一輪的主要工具結果（行程優先；找地點、路況只在沒有別的結果時用） */
function mainResults(results) {
  const ok = (results || []).filter((r) => r && r.tool);
  const trip = ok.find((r) => r.tool === 'plan_trip');
  if (trip) return [trip];
  const main = ok.filter((r) => !AUX.has(r.tool));
  // 同一類只留最後一筆（接著查同一路線），最多兩件事（「一句兩件事」）
  const seen = new Map();
  for (const r of main) seen.set(r.tool, r);
  const picked = [...seen.values()].slice(0, 2);
  return picked.length ? picked : ok.slice(-1);
}

/**
 * 這一輪的話題類別（換話題判斷）：工具結果優先，還沒有結果時用判斷層的意圖；只有文字（閒聊、追問）回 null（不算換話題）。
 * @param {{ results?: Array<{ tool: string }>, intent?: string|null, profile?: string }} t
 */
export function topicOf({ results = [], intent = null, profile = null } = {}) {
  if (profile === 'antifraud') return 'scam';
  const m = mainResults(results).find((r) => TOOL_TOPIC[r.tool]);
  if (m) return TOOL_TOPIC[m.tool];
  return INTENT_TOPIC[intent] || null;
}

/**
 * 要不要在這一輪前面分段（「新的話題」）。
 * @param {{ topic: string|null, at: number }|null} prev 上一輪
 * @param {{ topic: string|null, at: number, follow?: boolean }} cur 這一輪；follow：接著上一輪改（沿用起訖點）或從「接下來可以」點的
 * @returns {false|'topic'|'time'}
 */
export function topicBreak(prev, cur) {
  if (!prev || !cur) return false;
  if (Number.isFinite(prev.at) && Number.isFinite(cur.at) && cur.at - prev.at > TOPIC_GAP_MS) return 'time';
  if (cur.follow) return false;
  return prev.topic && cur.topic && prev.topic !== cur.topic ? 'topic' : false;
}

/**
 * 一輪的摘要。
 * @param {{ q: string, results?: Array<{ tool: string, data: any, speak?: string }>, decision?: any, best?: string, text?: string, lang?: 'en'|null }} t
 *   best：決策圖目前選的方案（使用者在圖上加了狀態重算時跟著變）
 * @returns {{ line: string, title: string, detail: string, short: string, decided: string|null, rest: string, spoken: string }}
 *   line：一行摘要（沒有決策時畫面就顯示這一行）；有決策時畫面顯示 title＋「決定：捷運」小標＋rest（22 分），不重複寫兩次「捷運」；
 *   short：目錄的小標；spoken：讀屏用的句子（不含輪次）
 */
export function turnSummary({ q = '', results = [], decision = null, best = null, text = '', lang = null } = {}) {
  const en = lang === 'en';
  const T = L[en ? 'en' : 'zh'];
  const ctx = { T, en, decision, best };
  const parts = mainResults(results).map((r) => one(r, ctx) || (r.speak ? { title: '', detail: clip(firstSentence(r.speak), 24), short: clip(q, 6) } : null)).filter(Boolean);
  let title, detail, short, decided = null, rest = '';
  if (parts.length) {
    title = parts.map((p) => p.title).filter(Boolean).join('・');
    detail = parts.map((p) => p.detail).filter(Boolean).join('・');
    short = parts[0].short || clip(q, 6);
    decided = parts.length === 1 && parts[0].decided || null;
    rest = parts[0].rest || '';
    if (parts.length > 1) { title = ''; detail = parts.map((p) => [p.title, p.detail].filter(Boolean).join(T.sep)).join('・'); }
  } else {
    // 只有文字（閒聊、阿幫反問、答不出來）：提問＋回答的第一句
    title = clip(q, 16);
    detail = text ? clip(firstSentence(text), 24) : T.noAnswer;
    short = clip(q, 6);
  }
  const line = [title, detail].filter(Boolean).join(T.sep);
  const spoken = [title.replace(/\s*→\s*/g, T.arrowSay), detail].filter(Boolean).join(T.join);
  return { line, title, detail, short, decided: decided && T.decided(decided), rest: decided ? rest : '', spoken };
}

/** 收起的摘要按鈕的讀屏名稱：「第 3 輪：西門町到台北101，捷運 22 分，已收起」；open 為 null 時不說狀態（目錄） */
export function roundLabel(n, s, open, lang = null) {
  const T = L[lang === 'en' ? 'en' : 'zh'];
  return `${T.turn(n)}${T.sep}${s.spoken}${open == null ? '' : `${T.join}${open ? T.opened : T.folded}`}`;
}

/** 分隔線文字：「新的話題・22:40」 */
export function topicText(at, lang = null) {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return lang === 'en' ? `New topic · ${hm}` : `新的話題・${hm}`;
}

/** 阿幫這一輪是不是在反問你（還沒回答前不收起）：「阿幫問你」（ADR-0016）還開著，或總結結尾是問號而且沒有卡片 */
export const askedBack = ({ text = '', results = [], askOpen = null } = {}) => !!(typeof askOpen === 'function' ? askOpen() : askOpen) || (/[？?]\s*$/.test(String(text).trim()) && !results.some((r) => r.card));

/** 換話題要比的「上一輪」：往前找最近一個有話題的（「行程 → 謝謝 → 天氣」：天氣跟行程比） */
export const lastTopic = (list) => [...list].reverse().find((r) => r && r.topic) || null;
