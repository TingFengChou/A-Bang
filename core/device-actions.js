// 阿幫動手做（ADR-0021）：裝置動作的內容由程式從卡片資料產生（不經模型），最後一步交給系統畫面確認——
// 加到行事曆（系統的新增行程畫面／網頁下載 .ics）、分享（系統分享面板／網頁 Web Share 或複製）。
// 純函式：伺服器與手機共用（前端經 /core/device-actions.js；server/http.js SHARED_CORE、scripts/build-app.js、public/sw.js 都要列）。

/** 裝置動作的名稱（host 方法、ask 的 action.name、請求的 deviceActions.can） */
export const DEVICE_ACTIONS = ['addCalendar', 'share'];
/** 對應的意圖（判斷層 JUDGE_INTENTS） */
export const ACTION_OF_INTENT = { calendar: 'addCalendar', share: 'share' };

const TZ_OFFSET_MIN = 8 * 60; // 台灣時間（UTC+8，沒有日光節約）
const DAY = 24 * 60;
export const LIMITS = { title: 80, location: 80, notes: 500, shareText: 600, shareTitle: 60, maxHours: 24 };

const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const pad = (n) => String(n).padStart(2, '0');
/** 費用（多人叫車寫每人分攤，與卡片相同） */
const costOf = (o, en) => {
  const r = o.costRange || (o.cost != null ? [o.cost, o.cost] : null);
  if (!r) return '';
  const v = r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`;
  if (o.share) return en ? `NT$${v} per person${o.share.cars > 1 ? ` (${o.share.cars} cars)` : ''}` : `每人 ${v} 元${o.share.cars > 1 ? `（${o.share.cars} 輛車）` : ''}`;
  return en ? `NT$${v}` : `${v} 元`;
};
const clip = (s, n) => { const a = [...String(s ?? '').replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' ? '\n' : '')).trim()]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };
const HERE = /^(?:你的位置|your location|現在位置)$/i;

/** 台灣日期（YYYY-MM-DD）＋從當天 0 點起的分鐘 → epoch 毫秒 */
export function taipeiMs(date, minutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!m || !Number.isFinite(minutes)) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 0, minutes - TZ_OFFSET_MIN);
}

/** 行程卡片（plan_trip 的 data）的方案：預設是建議方案；找不到回 null */
export function tripOption(data, optId = null) {
  const opts = Array.isArray(data?.options) ? data.options : [];
  return opts.find((o) => o.id === (optId || data?.best)) || null;
}

/** 方案的出發與抵達（epoch 毫秒）；資料不夠回 null */
export function tripTimes(data, o) {
  if (!data || !o) return null;
  const depart = hm(data.departAt);
  let start = hm(o.leaveAt) ?? depart;
  if (start == null) return null;
  if (depart != null && start + DAY / 2 < depart) start += DAY; // 23:50 問、隔天 00:10 出發
  let end = Number.isFinite(o.arriveMin) ? o.arriveMin : hm(o.arriveAt);
  if (end == null && Number.isFinite(o.minutes)) end = start + o.minutes;
  if (end == null) return null;
  while (end < start) end += DAY; // 跨午夜
  const s = taipeiMs(data.date, start), e = taipeiMs(data.date, end);
  return s != null && e != null && e > s ? { start: s, end: e } : null;
}

const placeName = (p, en) => (HERE.test(String(p?.name || '')) ? (en ? 'my location' : '我這裡') : String(p?.name || ''));

/**
 * 行程 → 行事曆事件（系統的新增行程畫面先填好，使用者確認才加入）。
 * @returns {{ title: string, start: number, end: number, location?: string, notes: string } | null}
 */
export function calendarFromTrip(data, { optId = null, lang = null } = {}) {
  const o = tripOption(data, optId);
  const t = tripTimes(data, o);
  if (!t || !data?.to?.name) return null;
  const en = lang === 'en';
  const to = String(data.to.name);
  const legs = (o.legs || []).map((l) => (en && l.detailEn) || l.detail).filter(Boolean);
  const cost = costOf(o, en);
  const notes = [
    ...legs,
    Number.isFinite(o.minutes) ? (en ? `About ${o.minutes} min${cost ? `, ${cost}` : ''}` : `約 ${o.minutes} 分${cost ? `、${cost}` : ''}${o.estimated ? '（含估算）' : ''}`) : '',
    en ? 'Planned by A-Bang. Check live times before you leave.' : '阿幫排的行程；出發前再看一次即時資料。',
  ].filter(Boolean).join('\n');
  return cleanCalendarEvent({
    title: en ? `${to} (${o.name})` : `去${to}（${o.name}）`,
    start: t.start, end: t.end,
    ...(!HERE.test(String(data.from?.name || '')) && data.from?.name && { location: String(data.from.name) }), // 從你的位置出發：不寫座標或「你的位置」
    notes,
  });
}

/**
 * 行程 → 分享內容（系統分享面板，使用者自己選對象）。不帶出發地座標；目的地附 Google 地圖連結。
 * @returns {{ title: string, text: string, url?: string } | null}
 */
export function shareFromTrip(data, { optId = null, lang = null } = {}) {
  const o = tripOption(data, optId);
  if (!o || !data?.to?.name) return null;
  const en = lang === 'en';
  const t = tripTimes(data, o);
  const time = (ms) => { const d = new Date(ms + TZ_OFFSET_MIN * 60000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const from = placeName(data.from, en), to = String(data.to.name);
  const cost = costOf(o, en);
  const head = en
    ? `${from} → ${to}: ${o.name}${t ? `, leave ${time(t.start)}, arrive ${time(t.end)}` : ''}${Number.isFinite(o.minutes) ? `, about ${o.minutes} min` : ''}${cost ? `, ${cost}` : ''}.`
    : `${from === '我這裡' ? '從我這裡' : `從${from}`}到${to}：坐${o.name}${t ? `，${time(t.start)} 出發、${time(t.end)} 到` : ''}${Number.isFinite(o.minutes) ? `，約 ${o.minutes} 分` : ''}${cost ? `，${cost}` : ''}。`;
  const legs = (o.legs || []).map((l) => (en && l.detailEn) || l.detail).filter(Boolean).join(en ? ' → ' : ' → ');
  const lat = Number(data.to.lat), lon = Number(data.to.lon);
  const url = Number.isFinite(lat) && Number.isFinite(lon) && lat > 21 && lat < 27 && lon > 118 && lon < 123
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)}%2C${lon.toFixed(5)}&travelmode=transit` : undefined;
  return cleanShare({ title: en ? `Trip to ${to}` : `去${to}的走法`, text: `${head}${legs ? `\n${legs}` : ''}\n${en ? '(via A-Bang)' : '（阿幫）'}`, ...(url && { url }) });
}

/** 檢查並整理行事曆事件（host 執行前、測試用）；不合格回 null */
export function cleanCalendarEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const title = clip(e.title, LIMITS.title).replace(/\n/g, ' ');
  const start = Number(e.start), end = Number(e.end);
  if (!title || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > LIMITS.maxHours * 3600000) return null;
  const location = e.location ? clip(e.location, LIMITS.location).replace(/\n/g, ' ') : '';
  const notes = clip(e.notes, LIMITS.notes);
  return { title, start, end, ...(location && { location }), notes };
}

/** 檢查並整理分享內容；連結只收 https；不合格回 null */
export function cleanShare(p) {
  if (!p || typeof p !== 'object') return null;
  const text = clip(p.text, LIMITS.shareText);
  if (!text) return null;
  const title = clip(p.title, LIMITS.shareTitle).replace(/\n/g, ' ');
  let url;
  try { const u = new URL(String(p.url)); if (u.protocol === 'https:') url = u.href; } catch { /* 沒有或不合格就不帶 */ }
  return { ...(title && { title }), text, ...(url && { url }) };
}

const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsTime = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };
/** 每行最多 75 位元組（RFC 5545 §3.1）：以字元為單位折行，中文不會被切成半個字 */
function fold(line) {
  const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** 行事曆事件 → .ics 文字（網頁下載用；手機 App 改開系統的新增行程畫面） */
export function toIcs(event, { uid, now = Date.now() } = {}) {
  const e = cleanCalendarEvent(event);
  if (!e) return null;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//A-Bang//Device Actions//ZH-TW', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${String(uid || `${e.start}-${e.end}`).replace(/[^A-Za-z0-9.@_-]/g, '')}@abang`,
    `DTSTAMP:${icsTime(now)}`, `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    ...(e.notes ? [`DESCRIPTION:${icsEscape(e.notes)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
