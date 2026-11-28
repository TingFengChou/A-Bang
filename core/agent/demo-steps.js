// 示範模式（規則）的步驟：解析出的意圖 → 分段計畫（每段點名哪些工具、怎麼帶參數）。
// 拆 demo-intent.js 第三步（架構第二輪 #4）：解析留在 demo-intent.js，步驟在這裡，總結在 demo-summary.js。
import { DEPTS } from '../services/clinic.js';
import { LANDMARKS } from '../services/places.js';
import { nowTW, distanceM } from '../util.js';
import { DEFAULT_FROM, DEFAULT_AREA, NEARBY, countyOf, nearestRail, tripDepartAt } from './demo-intent.js';

const DEPTS_LABEL = Object.fromEntries(DEPTS.map((d) => [d.id, d.label]));
const DRAMA_LIST_SAY = { hot: '熱門排行', new: '新上架短劇', completed: '已完結短劇', taiwan: '台灣自製短劇' };

/**
 * 意圖 → 分段計畫。每段 `(results) => ({ note, calls })`，results 是之前各段的 callTool 結果（依名稱）。
 * 同一段的 calls 平行執行。
 * @returns {Array<(r: Record<string, any[]>) => ({ note: string, calls: Array<{ name: string, args: object }> } | null)>}
 */
export function demoSteps(it, now = Date.now()) {
  if (it.also?.length && it.intent !== 'bus_route') return [...demoSteps({ ...it, also: undefined }, now), ...alsoSteps(it, now)];
  const point = (r, i) => r.find_place?.[i]?.data?.[0];
  const ll = (p) => p && { lat: p.lat, lon: p.lon };
  switch (it.intent) {
    case 'trip': {
      // 起點：說了地名 → 查地標；沒說但有裝置定位（M5-07）→ 直接用座標；都沒有 → 示範預設
      // 起訖點可以是座標（現在位置、常用地點：家、公司）或地名（查地標）
      const fp = it.fromSaved || (!it.from && it.fromPoint);
      const tp = it.toSaved || null;
      const from = it.from || DEFAULT_FROM;
      const names = [fp ? null : from, tp || it.nearRail ? null : it.to].filter(Boolean);
      // 沒說哪一站的火車站：起點最近的台鐵／高鐵站（P5-4）；總結與追問用它的名稱
      const railTo = (a) => { const x = a && nearestRail(a, it.nearRail); if (x) it.to = x.name; return x && { lat: x.lat, lon: x.lon, name: x.name }; };
      const pts = (r) => { const a = fp || point(r, 0); const b = tp || (it.nearRail ? railTo(a) : point(r, fp ? 0 : 1)); return [a, b]; };
      const asArg = (p) => (p === fp || p === tp ? { lat: p.lat, lon: p.lon, name: p.name } : p.name);
      const departAt = tripDepartAt(it, now); // 明天：抵達前 4 小時或 06:00；今天：現在
      const userStates = it.states;
      return [
        ...(names.length ? [() => ({ note: `@地點 ${names.length === 2 ? `先確認「${names[0]}」和「${names[1]}」在哪` : `確認「${names[0]}」在哪`}`, calls: names.map((q) => ({ name: 'find_place', args: { query: q } })) })] : []),
        // 明天的行程看明天的預報（目的地；P2-4「明早八點前要到台大，會下雨嗎」），今天看現在的天氣
        (r) => { // 起訖不到 1 公里：不看國道（traffic_status 會說起訖太近，TRAFFIC_MIN_M）
          const [a, b] = pts(r);
          if (!a || !b) return null;
          const far = distanceM(a.lat, a.lon, b.lat, b.lon) >= 1000;
          return { note: far ? '@天氣 @空品 @路況 看一下外面的狀況' : '@天氣 @空品 看一下外面的狀況', calls: [it.tomorrow ? { name: 'weather_tomorrow', args: ll(b) } : { name: 'weather_now', args: ll(a) }, { name: 'aqi_nearby', args: ll(a) }, ...(far ? [{ name: 'traffic_status', args: { from: ll(a), to: ll(b) } }] : [])] };
        },
        (r) => { const [a, b] = pts(r); return a && b ? { note: '@行程 幫您比較幾種走法', calls: [{ name: 'plan_trip', args: {
          from: asArg(a), to: asArg(b), // 地名：卡片標題顯示地名；定位：帶座標與「你的位置」
          departAt,
          ...((userStates.length || it.arriveBy || it.mode || it.avoid?.length || it.party) && { prefs: { ...(userStates.length && { states: userStates }), ...(it.arriveBy && { arriveBy: it.arriveBy }), ...(it.mode && { mode: it.mode }), ...(it.avoid?.length && { avoid: it.avoid }), ...(it.party && { party: it.party }) } }),
        } }] } : null; },
      ];
    }
    case 'bus_route':
      return [
        ...(it.places[0] ? [() => ({ note: `@地點 「${it.places[0]}」在哪個縣市`, calls: [{ name: 'find_place', args: { query: it.places[0] } }] })] : []),
        // 說了地點 → 離那裡最近的站；沒說 → 離你（裝置定位）最近的站；都沒有 → 全線
        (r) => {
          const p = point(r, 0);
          const near = p ? { lat: p.lat, lon: p.lon, name: p.name } : it.fromPoint ? ll(it.fromPoint) : null;
          const tw = it.toward ? { toward: it.toward } : {}; // 「307 往板橋」：只看往板橋的方向（PM Q-18）
          if (it.stop) return { note: `@公車 ${it.route} 到「${it.stop}」還要多久`, calls: [{ name: 'bus_route_eta', args: { ...(p ? { city: p.city } : near ? {} : { city: 'Taipei' }), routeName: it.route, stop: it.stop, ...(near && { near }), ...tw } }] }; // 說了站名：盯那一站（位置只用來推縣市）
          return { note: `@公車 ${it.route}${it.toward ? ` 往${it.toward}` : ''} 現在到哪了${near ? '，離您最近的站多久到' : ''}`, calls: [{ name: 'bus_route_eta', args: { ...(p ? { city: p.city } : near ? {} : { city: 'Taipei' }), routeName: it.route, ...(near && { near }), ...tw } }] };
        },
        ...alsoSteps(it),
        // 一句兩件事：順便看天氣（同一個位置）
        ...(it.alsoWeather ? [(r) => { const p = point(r, 0) || it.fromPoint || null; return p ? { note: '@天氣 順便看一下天氣', calls: [{ name: 'weather_now', args: ll(p) }] } : null; }] : []),
      ];
    case 'youbike':
    case 'nearby_bus':
    case 'weather':
    case 'aqi':
    case 'garbage': {
      const place = it.places[0] || DEFAULT_FROM;
      if (it.intent === 'weather' && it.later) return []; // 後天以後：說明查不到，不拿現在的天氣充數
      const [tool, note] = NEARBY[it.intent === 'weather' && it.tomorrow ? 'weatherTomorrow' : it.intent];
      if (!it.places[0] && it.fromPoint) return [() => ({ note, calls: [{ name: tool, args: ll(it.fromPoint) }] })]; // 用裝置定位
      return [
        () => ({ note: `@地點 找「${place}」的位置`, calls: [{ name: 'find_place', args: { query: place } }] }),
        (r) => (point(r, 0) ? { note, calls: [{ name: tool, args: ll(point(r, 0)) }] } : null),
      ];
    }
    case 'outing': { // 天氣＋空品一起查（同一個位置；說了地點就查那裡）
      const at = !it.places[0] && it.fromPoint ? ll(it.fromPoint) : null;
      const place = it.places[0] || DEFAULT_FROM;
      const who = it.states?.includes('kids') ? 'kids' : it.states?.includes('elder') ? 'elder' : null;
      const args = (p, name) => ({ ...ll(p), ...(name && { name }), ...(who && { with: who }) });
      if (at) return [() => ({ note: '@天氣 @空品 出門前幫您看一下', calls: [{ name: 'outing_advice', args: args(it.fromPoint) }] })];
      return [
        () => ({ note: `@地點 找「${place}」的位置`, calls: [{ name: 'find_place', args: { query: place } }] }),
        (r) => (point(r, 0) ? { note: '@天氣 @空品 出門前幫您看一下', calls: [{ name: 'outing_advice', args: args(point(r, 0), point(r, 0).name || place) }] } : null),
      ];
    }
    case 'metro':
      if (!it.station) { // 沒說站：句子裡的地標或現在位置最近的捷運站（拿不到位置就用預設地點）；說了路線只找這條線
        const near = it.near || (it.fromPoint ? ll(it.fromPoint) : DEFAULT_FROM);
        const where = it.near ? `「${it.near}」` : it.fromPoint ? '離您' : `「${DEFAULT_FROM}」`;
        return [() => ({ note: `@捷運 找${where}最近的${it.line || ''}站，看${it.last ? '末班車' : '下一班'}`, calls: [{ name: 'metro_live_board', args: { near, ...(it.system && { system: it.system }), ...(it.line && { line: it.line }), ...(it.last && { last: true }), ...(it.toward && { toward: it.toward }) } }] })];
      }
      // 系統照句子說的（「高雄捷運美麗島站」）；沒說交給工具在各系統的站名裡找（S5，不預設台北）
      return [() => ({ note: `@捷運 ${it.station}站${it.last ? '的末班車' : '下一班'}`, calls: [{ name: 'metro_live_board', args: { ...(it.system && { system: it.system }), station: it.station, ...(it.fromPoint && { near: ll(it.fromPoint) }), ...(it.last && { last: true }) } }] })];
    case 'traffic': { // 國道路況（S7）：起訖是地名、常用地點或現在位置；沒有目的地不查（已經先問了）
      const fp = it.fromSaved || (!it.from && it.fromPoint);
      const from = fp ? { lat: fp.lat, lon: fp.lon, name: fp.name || '您的位置' } : it.from || DEFAULT_FROM;
      const to = it.toSaved ? { lat: it.toSaved.lat, lon: it.toSaved.lon, name: it.toSaved.name } : it.to;
      if (!to) return [];
      const say = (x) => (typeof x === 'string' ? x : x.name);
      return [() => ({ note: `@路況 看「${say(from)}」到「${say(to)}」沿途的國道`, calls: [{ name: 'traffic_status', args: { from, to } }] })];
    }
    case 'rail': {
      const name = it.system === 'THSR' ? 'thsr_timetable' : 'tra_timetable';
      const label = it.system === 'THSR' ? '高鐵' : '台鐵';
      const date = it.tomorrow ? nowTW(now + 864e5).date : undefined;
      if (it.fare && !it.from) return []; // 要去台北又沒說起站：先問（總結）
      if (it.anyTo) { // 「高鐵下一班」沒說去哪：最近的站往兩端各查一次（runDemo 已算好 railNear），再問要去哪一站
        if (!it.railNear) return [];
        const calls = ['南港', '左營'].filter((t) => t !== it.railNear).map((to) => ({ name, args: { from: it.railNear, to, ...(date && { date }) } }));
        return [() => ({ note: `@${label} 看${it.railNear}站往兩個方向的下一班`, calls })];
      }
      if (it.fare) return [() => ({ note: `@${label} ${it.from}到${it.to}的票價`, calls: [{ name: 'rail_fare', args: { system: it.system, from: it.from, to: it.to } }] })];
      if (!it.from) { // 沒說起站：句中地名、或現在位置（拿不到就預設地點）最近的車站
        const near = it.near || (it.fromPoint ? ll(it.fromPoint) : DEFAULT_FROM);
        const where = it.near ? `「${it.near}」` : it.fromPoint ? '離您' : `「${DEFAULT_FROM}」`;
        return [() => ({ note: `@${label} 找${where}最近的站，看到${it.to}的班次`, calls: [{ name, args: { to: it.to, near, ...(date && { date }) } }] })];
      }
      return [() => ({ note: `@${label} ${it.from}到${it.to}的班次`, calls: [{ name, args: { from: it.from, to: it.to, ...(date && { date }) } }] })];
    }
    case 'quake':
      return [() => ({ note: '@地震 最近的地震報告', calls: [{ name: 'earthquake_recent', args: { ...(it.county && { county: it.county }), limit: 5 } }] })];
    case 'pharmacy': {
      // 診所（clinic）與藥局同一套：說了區就查那一區、說了地點用地點推估、沒說用你的位置
      const [tool, who, what, extra] = it.clinic
        ? ['clinic_search', '診所', `${it.when?.label || ''}${it.dept ? `${DEPTS_LABEL[it.dept]}` : ''}診所（${it.when ? '那個時段' : '這個時段'}有登記看診的排前面）`, { ...(it.dept && { dept: it.dept }), ...(it.when && { dayOffset: it.when.dayOffset, ...(it.when.period && { period: it.when.period }) }) }]
        : ['pharmacy_search', '藥局', '健保藥局', {}];
      if (!it.area && it.places[0]) { // 「板橋車站附近的藥局」：用地標的座標推估在哪一區
        const place = it.places[0];
        return [
          () => ({ note: `@地點 找「${place}」的位置`, calls: [{ name: 'find_place', args: { query: place } }] }),
          (r) => (point(r, 0) ? { note: `@${who} 「${place}」那一區的${what}`, calls: [{ name: tool, args: { ...ll(point(r, 0)), ...extra } }] } : null),
        ];
      }
      if (!it.area && it.fromPoint) return [() => ({ note: `@${who} 依您的位置找這一區的${what}`, calls: [{ name: tool, args: { ...ll(it.fromPoint), ...extra } }] })]; // S16
      const area = it.area || DEFAULT_AREA;
      return [() => ({ note: `@${who} ${area}的${what}`, calls: [{ name: tool, args: { area, ...extra } }] })];
    }
    case 'fuel':
      return [() => ({ note: '@油價 中油這週的牌價', calls: [{ name: 'fuel_price', args: {} }] })];
    case 'gov': // 去政府辦事要帶什麼（M16-04a）：我的E政府的申辦說明；找戶政事務所（M16-04b）：用位置找最近的、說今天是不是上班日
      if (it.govLink) return [() => ({ note: '@辦事 找官方網站的入口', calls: [{ name: 'gov_official_link', args: { topic: it.govQuery || '' } }] })];
      if (it.lostPassportEn) return []; // 觀光客掉了護照：固定指引，不查資料
      if (it.govPassport) return [() => ({ note: '@辦事 看領務局與各辦事處現在的護照等待人數', calls: [{ name: 'passport_waiting', args: it.passportOffice ? { office: it.passportOffice } : {} }] })];
      if (it.govOffice) {
        const note = `@辦事 找附近的戶政事務所，看${it.when?.dayOffset ? it.when.label.replace(/上午|下午|晚上/, '') : '今天'}是不是上班日`;
        const day = it.when?.dayOffset ? { dayOffset: it.when.dayOffset } : {}; // 「禮拜六有開嗎」：問那一天
        if (it.fromPoint) return [() => ({ note, calls: [{ name: 'gov_office_nearby', args: { ...ll(it.fromPoint), ...day } }] })]; // 用裝置定位
        return [ // 拿不到位置：先從臺北車站附近找（總結會說明）
          () => ({ note: `@地點 找「${DEFAULT_FROM}」的位置`, calls: [{ name: 'find_place', args: { query: DEFAULT_FROM } }] }),
          (r) => (point(r, 0) ? { note, calls: [{ name: 'gov_office_nearby', args: { ...ll(point(r, 0)), ...day } }] } : null),
        ];
      }
      return [() => ({ note: '@辦事 查我的E政府的申辦說明', calls: [{ name: 'gov_service_info', args: { query: it.govQuery || '', ...(countyOf(it.govQuery || '') && { county: countyOf(it.govQuery) }) } }] })]; // 說了縣市：那個縣市的版本也排前面
    case 'stock':
      return [() => ({ note: it.query ? `@股市 查「${it.query}」的收盤行情` : '@股市 看一下大盤收盤', calls: [{ name: 'stock_quote', args: { ...(it.query && { query: it.query }) } }] })];
    case 'invoice':
      return [() => ({ note: it.number ? '@發票 幫您對獎' : '@發票 最新一期中獎號碼', calls: [{ name: 'invoice_lottery', args: { ...(it.number && { number: it.number }) } }] })];
    case 'drama': { // 找短劇（ADR-0019）：搜尋（類型、劇名）或排行；搜尋沒結果改看熱門；問劇情再看第一部的簡介
      const pick = (list) => ({ note: `@短劇 看 MyDrama 的${DRAMA_LIST_SAY[list]}`, calls: [{ name: 'drama_picks', args: { list, limit: 5 } }] });
      if (!it.dramaQuery) return [() => pick(it.dramaList || 'hot')];
      return [
        () => ({ note: `@短劇 在 MyDrama 找「${it.dramaQuery}」`, calls: [{ name: 'drama_search', args: { query: it.dramaQuery, limit: 5 } }] }),
        (r) => {
          const first = r.drama_search?.at(-1)?.data?.items?.[0];
          if (!first) return { ...pick('hot'), note: '@短劇 沒找到，改看熱門排行' };
          return it.dramaDetail ? { note: `@短劇 看《${first.title}》的簡介`, calls: [{ name: 'drama_series', args: { id: first.id } }] } : null;
        },
      ];
    }
    default:
      return [];
  }
}

/** 一句問好幾件事的其他幾件（P5-8）：天氣、空品用同一個位置（說的地點、你的位置，都沒有用示範預設）；其他不用位置 */
function alsoSteps(it, now = Date.now()) {
  const def = LANDMARKS.items.find((x) => x.name === DEFAULT_FROM);
  return (it.also || []).flatMap((x) => {
    if (x.intent === 'weather' || x.intent === 'aqi') {
      const [tool, note] = NEARBY[x.intent === 'weather' && x.tomorrow ? 'weatherTomorrow' : x.intent];
      return [(r) => { const p = r.find_place?.[0]?.data?.[0] || it.fromPoint || def; return { note: note.replace(/^(@\S+) /, '$1 順便'), calls: [{ name: tool, args: { lat: p.lat, lon: p.lon } }] }; }];
    }
    return demoSteps({ ...x, places: [], states: [], ...(it.fromPoint && { fromPoint: it.fromPoint }) }, now); // 公車：離你最近的站
  });
}
