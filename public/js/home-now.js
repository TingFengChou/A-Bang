// 首頁上方兩條（2026-11-21 首頁重新設計）：
// 1. 「手機上的 AI」：裝置端 AI（ADR-0014）現在誰在判斷。照實說：可用時說引擎、判斷留在手機；不可用或網頁版說由伺服器判斷，不誇大。
// 2. 「現在」：天氣、空品、最近一個提醒。用現有的 /api/v1/tools/:name（weather_now、aqi_nearby），不新增伺服器端點。
//    沒給過定位權限不跳權限框（用台北車站附近並寫明）；離線、查不到就只留提醒那格，不擋畫面。
// 純函式（edgeLine、nowItems）在 node:test 測；loadNow 碰網路與定位。
import { EDGE_ENGINE_NAME, EDGE_REASON } from './edge-judge.js';

/**
 * 「手機上的 AI」一行要說什麼。
 * @param {{ available?: boolean, engine?: string, reason?: string }|null} st edgeStatus() 的結果（還沒查完傳 null）
 * @param {boolean} enabled 使用者有沒有在設定關掉
 * @returns {{ tone: 'on'|'off'|'wait', label: string, text: string }}
 */
export function edgeLine(st, enabled = true) {
  if (!st) return { tone: 'wait', label: '手機上的 AI', text: '檢查中…' };
  if (st.available && enabled) return { tone: 'on', label: `手機上的 AI・${EDGE_ENGINE_NAME[st.engine] || '手機內建模型'}`, text: '先在手機上聽懂你要做什麼，判斷留在手機' };
  if (st.available) return { tone: 'off', label: '手機上的 AI・已關閉', text: '你關掉了，現在由阿幫伺服器判斷' };
  if (st.reason === 'web') return { tone: 'off', label: '網頁版', text: '由阿幫伺服器判斷；手機 App 可以用手機上的 AI' };
  if (st.reason === 'downloading' || st.reason === 'needs-wifi') return { tone: 'off', label: '手機上的 AI・準備中', text: `${EDGE_REASON[st.reason]}，先由阿幫伺服器判斷` };
  return { tone: 'off', label: '手機上的 AI・不能用', text: `${EDGE_REASON[st.reason] || '目前不能使用'}，由阿幫伺服器判斷` };
}

/**
 * 「現在」的格子（最多三格：天氣、空品、提醒）。查不到的那格不出現；提醒一定有（沒有就說沒有）。
 * @param {{ weather?: object|null, aqi?: object|null, next?: { title: string, sub?: string }|null, place?: string, offline?: boolean, demo?: { weather?: boolean, aqi?: boolean } }} o  demo：那一類是示範資料（標「示範」）
 * @returns {Array<{ id: string, icon: string, href: string, main: string, sub: string, demo?: true }>}
 */
export function nowItems({ weather = null, aqi = null, next = null, place = '', offline = false, demo = {} } = {}) {
  const out = [];
  if (weather && (Number.isFinite(weather.tempC) || weather.summary)) {
    const rainy = weather.rainMm1h > 0 ? '正在下雨' : weather.raining ? '可能會下雨' : weather.pop3h != null ? `降雨 ${weather.pop3h}%` : weather.summary || '';
    out.push({ id: 'weather', icon: 'sun', href: '#/s/weather', main: Number.isFinite(weather.tempC) ? `${Math.round(weather.tempC)}°C` : '天氣', sub: [rainy, place].filter(Boolean).join('・'), ...(demo.weather && { demo: true }) });
  }
  const n = aqi?.nearest;
  if (n && n.aqi != null && n.aqi !== '') out.push({ id: 'aqi', icon: 'air', href: '#/s/aqi', main: `AQI ${n.aqi}`, sub: n.status || '', ...(demo.aqi && { demo: true }) });
  if (offline && !out.length) out.push({ id: 'offline', icon: 'sun', href: '#/s/weather', main: '離線中', sub: '連上網路再看天氣、空品' });
  out.push(next ? { id: 'reminder', icon: 'bell', href: '#/reminders', main: next.title, sub: next.sub || '' } : { id: 'reminder', icon: 'bell', href: '#/reminders', main: '沒有提醒', sub: '看怎麼設' });
  return out;
}

const TTL = 10 * 60_000; // 首頁來回切換不重查（10 分鐘）
/** @type {{ at: number, located: boolean, v: { weather: object, aqi: object, place: string, offline: false } }|null} */
let cache = null;

/** 還有效的上次結果（同步；回首頁時直接畫，不先閃骨架）；沒有回 null */
export const peekNow = (now = Date.now()) => (cache && now - cache.at < TTL ? cache.v : null);

/**
 * 查天氣與空品（不阻擋畫面；任何失敗都回 null 那一格）。
 * 快取：天氣與空品都查到才整包記 10 分鐘（只查到一個，下次兩個都重查）；記下當時有沒有用到你的位置，
 * 之後才允許定位就作廢（不會 10 分鐘內一直顯示台北車站附近）。
 * @param {{ callTool: Function, granted: () => Promise<boolean>, locate: () => Promise<{lat:number,lon:number}|null>, fallback: { lat: number, lon: number } }} deps
 * @returns {Promise<{ weather: object|null, aqi: object|null, place: string, offline: boolean, pos?: { lat: number, lon: number } }>}
 */
export async function loadNow({ callTool, granted, locate, fallback }, now = Date.now()) {
  if (globalThis.navigator?.onLine === false) return { weather: null, aqi: null, place: '', offline: true };
  let ok;
  try { ok = !!(await granted()); } catch { ok = false; } // 沒給過權限就不問（不在首頁跳權限框）
  if (peekNow(now) && (cache.located || !ok)) return cache.v;
  let pos = null;
  try { if (ok) pos = await locate(); } catch { pos = null; }
  const place = pos ? '你附近' : '台北車站附近';
  const p = pos || fallback;
  const get = (name) => callTool(name, { lat: p.lat, lon: p.lon }).then((r) => r?.data || null, () => null);
  const [weather, aqi] = await Promise.all([get('weather_now'), get('aqi_nearby')]);
  const v = { weather, aqi, place, offline: false, ...(pos && { pos: { lat: pos.lat, lon: pos.lon } }) }; // pos：只在有定位時（散步小卡找附近的公園，ADR-0018；只在記憶體）
  if (weather && aqi) cache = { at: now, located: !!pos, v };
  else cache = null; // 少一個：下次重查
  return v;
}
/** 測試用 */
export const _resetNow = () => { cache = null; };
