// 首頁「夜色與光」的資料（ADR-0023；規格 docs/HOME_REDESIGN.md §4、§9）。
// 把手機上已經有的東西（現在的天氣空品與辦公日曆、常用地點、固定通勤方式、上次的對話、行程、散步判斷）
// 整理成 ContextSnapshot 交給 core/home-suggest.js；自己不做判斷。
// 打開首頁時最多查 2 個交通即時資料（TDX 每分鐘有額度）：通勤第一段 > 附近 YouBike > 收藏的站牌；其他按了才查。
// 純函式（commuteOf、snapshotOf、tilePlan、capsFor、svcOrder）在 node:test 測；loadTransit 碰網路。
import { miniApps } from './registry.js';

export const COMMUTE_KEY = 'abang.commute';
/** 首頁打開時最多查幾個交通即時資料（§9） */
export const MAX_LIVE_CALLS = 2;

/** 存在手機的固定通勤方式（壞掉或不完整就當沒有） */
export function commuteOf(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || typeof v.from !== 'string' || typeof v.to !== 'string' || !Array.isArray(v.legs) || !v.legs.length) return null;
    const leg = (l) => (l && l.mode === 'bus' && typeof l.route === 'string' ? { mode: 'bus', route: l.route.slice(0, 20), ...(typeof l.stop === 'string' && { stop: l.stop.slice(0, 40) }), ...(typeof l.city === 'string' && { city: l.city.slice(0, 20) }), ...(Number.isInteger(l.direction) && { direction: l.direction }) }
      : l && l.mode === 'metro' && typeof l.line === 'string' ? { mode: 'metro', line: l.line.slice(0, 8), name: String(l.name || l.line).slice(0, 12), ...(typeof l.station === 'string' && { station: l.station.slice(0, 20) }) } : null);
    const legs = v.legs.map(leg);
    if (legs.some((x) => !x)) return null;
    const backLegs = Array.isArray(v.backLegs) ? v.backLegs.map(leg).filter(Boolean) : null;
    return { from: v.from, to: v.to, legs, ...(backLegs?.length && { backLegs }), ...(Array.isArray(v.out) && { out: v.out.slice(0, 2) }), ...(Array.isArray(v.back) && { back: v.back.slice(0, 2) }) };
  } catch { return null; }
}
export function loadCommute(store = globalThis.localStorage) {
  try { return commuteOf(store?.getItem(COMMUTE_KEY)); } catch { return null; }
}
export function saveCommute(c, store = globalThis.localStorage) {
  const v = commuteOf(c);
  if (!v) return false;
  try { store.setItem(COMMUTE_KEY, JSON.stringify(v)); globalThis.dispatchEvent?.(new CustomEvent('abang:memory')); return true; } catch { return false; }
}
export function clearCommute(store = globalThis.localStorage) {
  try { store.removeItem(COMMUTE_KEY); globalThis.dispatchEvent?.(new CustomEvent('abang:memory')); } catch { /* 無痕模式 */ }
}

/**
 * 組 ContextSnapshot（§4）。
 * @param {{ now: number, nowData?: any, places?: object, commute?: any, override?: 'fixed'|'here'|null, transit?: object,
 *   trip?: { href: string }|null, walk?: object|null, last?: { q: string, at: number }|null, onboarded?: boolean, demo?: boolean, quotaOut?: boolean }} o
 */
export function snapshotOf({ now, nowData = null, places = {}, commute = null, override = null, transit = {}, trip = null, walk = null, last = null, onboarded = true, demo = false, quotaOut = false }) {
  const pos = nowData?.pos;
  const area = nowData?.area || null;
  const P = {};
  for (const [k, p] of Object.entries(places || {})) if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) P[k] = { lat: p.lat, lon: p.lon, ...(p.area ? { area: p.area } : p.name && p.name !== k ? { area: p.name } : {}) };
  return {
    now,
    day: nowData?.day || null,
    location: { auto: pos ? { lat: pos.lat, lon: pos.lon, ...(area && { area }) } : null, override },
    places: P,
    commute,
    env: { weather: nowData?.weather || null, aqi: nowData?.aqi || null },
    transit,
    user: { onboarded, trip, walk, last },
    source: { offline: !!nowData?.offline, demo, quotaOut },
  };
}

/** 上次問的那句（chat-store 的最後一則使用者訊息；12 小時內） */
export function lastAsk(chat) {
  const m = chat?.messages ? [...chat.messages].reverse().find((x) => x.role === 'user') : null;
  return m ? { q: m.content.slice(0, 60), at: chat.at } : null;
}

/**
 * 打開首頁要查哪些交通即時資料（最多 MAX_LIVE_CALLS 個）。
 * @returns {Array<{ kind: 'leg'|'bike'|'fav', leg?: object, fav?: object }>}
 */
export function tilePlan({ commute = null, legIndex = 0, pos = null, fav = null } = {}) {
  const out = [];
  const leg = commute?.legs?.[legIndex];
  if (leg?.mode === 'bus' && leg.city) out.push({ kind: 'leg', leg });
  if (pos) out.push({ kind: 'bike' });
  if (fav?.type === 'station' && fav.city && fav.stationId) out.push({ kind: 'fav', fav });
  return out.slice(0, MAX_LIVE_CALLS);
}

/**
 * 查交通即時資料（失敗就是不知道：不放進 transit，不寫成 0）。
 * @param {{ callTool: Function, plan: ReturnType<typeof tilePlan>, pos?: {lat:number,lon:number}|null }} o
 */
export async function loadTransit({ callTool, plan, pos = null }) {
  const transit = { bus: [], metro: [] };
  let bike = null, fav = null, quotaOut = false;
  await Promise.all(plan.map(async (p) => {
    try {
      if (p.kind === 'leg') {
        const r = await callTool('bus_route_eta', { city: p.leg.city, routeName: p.leg.route, ...(p.leg.stop && { stop: p.leg.stop }), ...(p.leg.direction != null && { direction: p.leg.direction }) });
        const f = r?.data?.focus;
        if (f && Number.isFinite(f.etaSec)) transit.bus.push({ route: p.leg.route, stop: f.stopName, mins: Math.max(0, Math.round(f.etaSec / 60)) });
      } else if (p.kind === 'bike' && pos) {
        const r = await callTool('youbike_nearby', { lat: pos.lat, lon: pos.lon, radius: 500 });
        bike = (r?.data?.stations || []).find((s) => s.inService !== false) || null;
      } else if (p.kind === 'fav') {
        const r = await callTool('bus_station_eta', { city: p.fav.city, stationId: p.fav.stationId });
        const a = (r?.data?.arrivals || []).find((x) => Number.isFinite(x.etaSec));
        fav = a ? { title: p.fav.title, route: a.routeName, mins: Math.max(0, Math.round(a.etaSec / 60)), href: p.fav.href } : null;
      }
    } catch (e) { if (/額度|429|太頻繁/.test(String(e?.message || e))) quotaOut = true; }
  }));
  return { transit, bike, fav, quotaOut };
}

/** 服務列：依時段排（前面是這個時段常用的），防詐一定在前 8 個 */
const ORDER = {
  morning: ['bus', 'metro', 'bike', 'weather', 'tra', 'thsr', 'aqi', 'antifraud'],
  day: ['bus', 'weather', 'pharmacy', 'metro', 'aqi', 'antifraud', 'invoice', 'stock'],
  evening: ['bus', 'metro', 'garbage', 'pharmacy', 'weather', 'antifraud', 'bike', 'invoice'],
  late: ['bus', 'metro', 'tra', 'pharmacy', 'weather', 'antifraud', 'bike', 'quake'],
};
export function svcOrder(min) {
  const part = min >= 5 * 60 && min < 10 * 60 ? 'morning' : min >= 10 * 60 && min < 16 * 60 ? 'day' : min >= 16 * 60 && min < 22 * 60 ? 'evening' : 'late';
  const first = ORDER[part].map((id) => miniApps.find((a) => a.id === id)).filter(Boolean);
  return [...first, ...miniApps.filter((a) => !first.includes(a))];
}

/**
 * 「更多功能」：只列這支手機做得到的（ADR-0023 §4）。
 * @param {'ios'|'android'|'web'} platform
 * @returns {Array<{ id: string, title: string, text: string, act: 'try'|'info', href?: string, info?: string }>}
 */
export function capsFor(platform) {
  const app = platform === 'ios' || platform === 'android';
  const list = [
    { id: 'cam', title: '拍照查詢', text: '拍發票對獎\n拍站牌查路線', act: 'try', href: '#/agent?act=cam' },
    platform === 'ios' && { id: 'siri', title: 'Siri 語音查詢', text: '對 Siri 說\n「問阿幫 307」', act: 'info', info: '對 Siri 說「問阿幫」加上問題，或在「捷徑」App 加入「問阿幫」「查詐騙」。阿幫會打開並照原本的流程查。' },
    platform === 'android' && { id: 'widget', title: '主畫面小工具', text: '桌面直接看\n今天的提醒', act: 'try' },
    app && { id: 'lock', title: '出門倒數', text: platform === 'ios' ? '鎖定畫面與動態島\n顯示到站倒數' : '通知列\n顯示出門倒數', act: 'info', info: platform === 'ios' ? '在行程卡按「出門倒數」，鎖定畫面與動態島會顯示還有幾分要出門。' : '在行程卡按「出門倒數」，通知列會顯示還有幾分要出門。' },
    { id: 'cal', title: '加入行事曆與分享', text: '行程加入行事曆\n或分享給家人', act: 'info', info: '在行程卡按「加到行事曆」或「分享」，最後一步由手機的系統畫面確認，阿幫不會自己送出。' },
    app && { id: 'walk', title: '散步提醒', text: '天氣良好時\n提醒您出門走走', act: 'try', href: '#/settings' },
  ];
  return list.filter(Boolean);
}

/** 台北捷運路線名 → 代碼（首頁路線色；其他系統沒有代碼就用名稱） */
const LINE_CODE = { 文湖線: 'BR', 淡水信義線: 'R', 松山新店線: 'G', 中和新蘆線: 'O', 板南線: 'BL', 環狀線: 'Y' };
const NEAR_PLACE_M = 400;
const distM = (a, b) => { const r = (d) => (d * Math.PI) / 180; const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(x)); };
const placeAt = (p, places) => (p && Number.isFinite(p.lat) ? Object.entries(places || {}).find(([, v]) => v && Number.isFinite(v.lat) && distM(p, v) <= NEAR_PLACE_M)?.[0] || null : null);
const show = (k) => (k === '家' ? '住家' : k);

/**
 * 查完路線 →「設為固定通勤方式」（ADR-0023 §8、共同決議 B）：從行程卡的那個方案組出固定通勤方式，順便推出回程與預設時段。
 * 只收住家 ↔ 公司／學校之間的公車或捷運方案（起訖點在常用地點 400 公尺內）；其他回 null（卡片不顯示按鈕）。
 * @returns {{ commute: object, out: string, back: string }|null}
 */
export function commuteFromTrip(data, optId, places) {
  const o = data?.options?.find((x) => x.id === optId);
  if (!o) return null;
  const a = placeAt(data.from, places), b = placeAt(data.to, places);
  const work = (k) => k === '公司' || k === '學校';
  if (!a || !b || a === b || !((a === '家' && work(b)) || (work(a) && b === '家'))) return null;
  let legs = null;
  if (o.role === 'bus' && o.follow?.routeName) legs = [{ mode: 'bus', route: o.follow.routeName, ...(o.follow.stop && { stop: o.follow.stop }), ...(o.follow.city && { city: o.follow.city }), ...(Number.isInteger(o.follow.direction) && { direction: o.follow.direction }) }];
  else if (o.role === 'metro' && o.metro?.lines) {
    const names = String(o.metro.lines).split('轉').map((x) => x.trim()).filter(Boolean);
    const stations = [o.metro.from, ...(o.metro.vias || (o.metro.via ? [o.metro.via] : []))];
    legs = names.map((n, i) => ({ mode: 'metro', line: LINE_CODE[n] || n.slice(0, 8), name: n.slice(0, 12), ...(stations[i] && { station: stations[i] }) }));
  }
  if (!legs?.length) return null;
  const strip = (l) => (l.mode === 'bus' ? { mode: 'bus', route: l.route, ...(l.city && { city: l.city }) } : { mode: 'metro', line: l.line, name: l.name }); // 反方向的上車站不知道：不猜
  const home = a === '家';
  const commute = home
    ? { from: '家', to: b, legs, backLegs: [...legs].reverse().map(strip), out: ['06:00', '10:00'], back: ['16:30', '21:00'] }
    : { from: '家', to: a, legs: [...legs].reverse().map(strip), backLegs: legs, out: ['06:00', '10:00'], back: ['16:30', '21:00'] };
  const label = (l) => (l.mode === 'bus' ? l.route : l.name);
  return {
    commute,
    out: `${show('家')} → ${commute.legs.map(label).join(' → ')} → ${show(commute.to)}（上班日 06:00–10:00）`,
    back: `${show(commute.to)} → ${commute.backLegs.map(label).join(' → ')} → ${show('家')}（上班日 16:30–21:00）`,
  };
}
