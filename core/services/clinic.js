// 現在有看診的診所（健保署特約醫事機構－診所，data.gov.tw 39283，每日）：和藥局同一個來源，沒有座標 → 以「縣市＋鄉鎮區」搜尋，
// 依健保署登記的固定看診時段（上午／下午／晚上）判斷「這個時段有登記看診」。只說有登記，不說「看診中」：臨時休診不會反映。
// 不做醫療判斷：只照使用者說的科別篩選，不從症狀推科別。
import { csvObjects } from '../csv.js';
import { nowTW, UserError } from '../util.js';

export const CLINICS_URL = 'https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-D21004-009';
export const CLINICS_TTL_SEC = 86400;
export const PERIODS = ['上午', '下午', '晚上'];
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const REQUIRED = ['醫事機構代碼', '醫事機構名稱', '醫事機構種類', '地址', '診療科別', '固定看診時段', '終止合約或歇業日期'];

/** 全形數字與「台」統一，地址比對用（與藥局相同） */
const norm = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/台/g, '臺').replace(/\s+/g, '');

/** 機構種類 → 西醫／牙醫／中醫（病理中心等不列） */
export function kindOf(kind) {
  const k = String(kind ?? '');
  if (/牙醫/.test(k)) return 'dental';
  if (/中醫/.test(k)) return 'tcm';
  if (/西醫|一般診所|專科診所|^醫院$|精神科醫院/.test(k)) return 'western';
  return null;
}

/**
 * 使用者說的科別 → 篩選條件（只認明講的科別，不從症狀推）。
 * kind：牙醫、中醫看機構種類；其他看「診療科別」。
 */
export const DEPTS = [
  { id: 'dental', label: '牙科', say: /牙醫|牙科|看牙|洗牙|補牙|拔牙|植牙|根管/, kind: 'dental' },
  { id: 'tcm', label: '中醫', say: /中醫|針灸|推拿|傷科|把脈/, kind: 'tcm' },
  { id: 'peds', label: '小兒科', say: /小兒科|兒科|兒童科/, dept: /^兒科$/ },
  { id: 'ent', label: '耳鼻喉科', say: /耳鼻喉/, dept: /耳鼻喉/ },
  { id: 'eye', label: '眼科', say: /眼科/, dept: /^眼科$/ },
  { id: 'derm', label: '皮膚科', say: /皮膚科/, dept: /^皮膚科$/ },
  { id: 'obgyn', label: '婦產科', say: /婦產科|婦科|產科/, dept: /^婦產科$/ },
  { id: 'fm', label: '家醫科', say: /家醫|家庭醫學/, dept: /^家醫科$/ },
  { id: 'im', label: '內科', say: /(?<![中胃腸])內科/, dept: /^內科$/ },
  { id: 'ortho', label: '骨科', say: /骨科/, dept: /^骨科$/ },
  { id: 'rehab', label: '復健科', say: /復健/, dept: /^復健科$/ },
  { id: 'psy', label: '身心科', say: /身心科|精神科/, dept: /^精神科$/ },
  { id: 'uro', label: '泌尿科', say: /泌尿/, dept: /^泌尿科$/ },
  { id: 'surg', label: '外科', say: /(?<![整骨神經])外科/, dept: /^外科$/ },
  { id: 'neuro', label: '神經科', say: /神經科|神經內科/, dept: /^神經科$/ },
];
/** 句子裡明講的科別 id（沒有回 null） */
export const deptOf = (s) => DEPTS.find((d) => d.say.test(String(s ?? '')))?.id || null;

/** 固定看診時段文字 → 7×3（[星期日..六][上午、下午、晚上]，true＝看診）；空的回 null */
export function weekSlots(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  return WEEK.map((w) => PERIODS.map((p) => s.includes(`星期${w}${p}看診`)));
}

/** 現在是哪個看診時段（台灣時間；與卡片相同：8–12 上午、12–18 下午、18–22 晚上；其他回 null） */
export function periodAt(now = Date.now()) {
  const hr = new Date(now + 8 * 3600e3).getUTCHours();
  return hr >= 8 && hr < 12 ? '上午' : hr >= 12 && hr < 18 ? '下午' : hr >= 18 && hr < 22 ? '晚上' : null;
}
const dowAt = (now) => new Date(Date.parse(`${nowTW(now).date}T12:00:00+08:00`)).getUTCDay();

/** 下載的 CSV → 精簡的診所列表（解析一次、快取這份；已歇業的仍保留，查詢時依日期排除） */
export function parseClinics(text) {
  const out = [];
  for (const r of csvObjects(text, REQUIRED)) {
    const kind = kindOf(r['醫事機構種類']);
    if (!kind) continue;
    out.push({
      code: String(r['醫事機構代碼'] || '').trim(), name: String(r['醫事機構名稱'] || '').trim(), kind,
      phone: String(r['電話'] || '').trim() || null, address: norm(r['地址']),
      depts: String(r['診療科別'] || '').split(',').map((x) => x.trim()).filter(Boolean),
      slots: weekSlots(r['固定看診時段']), end: String(r['終止合約或歇業日期'] || '').trim(),
    });
  }
  return out;
}

/**
 * 查某一區（或名稱）的診所，這個時段有登記看診的排前面。
 * @param {ReturnType<typeof parseClinics>} rows
 * @param {{ area?: string, query?: string, dept?: string, now?: number, limit?: number, dayOffset?: number, period?: string|null }} a
 *   dayOffset／period：問的是哪一天、哪個時段（「明天上午」「禮拜天」「夜間」）；沒給就是現在
 */
export function clinicSearch(rows, { area, query = '', dept = null, now = Date.now(), limit = 10, dayOffset = 0, period: askPeriod = null }) {
  const a = norm(area), q = norm(query);
  if (!a && !q) throw new UserError('請說哪一區（例如「臺北市大安區」）或診所名稱。');
  const d = dept ? DEPTS.find((x) => x.id === dept) : null;
  if (dept && !d) throw new UserError(`不認得「${dept}」這個科別。`);
  const today = nowTW(now).date.replaceAll('-', '');
  const planned = dayOffset > 0 || !!askPeriod; // 問的是別的日子或指定時段：照那天那個時段排
  const dow = dowAt(now + dayOffset * 864e5);
  const period = planned ? askPeriod : periodAt(now);
  const pi = PERIODS.indexOf(period);
  const hourNow = new Date(now + 8 * 3600e3).getUTCHours();
  const list = [];
  for (const r of rows) {
    if (/^\d{8}$/.test(r.end) && r.end < today) continue; // 已終止合約或歇業
    if (a && !r.address.includes(a)) continue;
    if (q && !norm(r.name).includes(q) && !r.address.includes(q)) continue;
    if (d ? (d.kind ? r.kind !== d.kind : r.kind !== 'western' || !r.depts.some((x) => d.dept.test(x))) : !q && r.kind !== 'western') continue; // 沒說科別：只列西醫（牙醫、中醫要明講）
    const todayOpen = r.slots ? PERIODS.filter((_, i) => r.slots[dow][i]) : null;
    // 還沒過的時段：現在的時段、之後的時段（清晨 8 點前整天都還沒過；晚上 10 點後都過了）
    const later = planned ? [] : todayOpen && todayOpen.filter((p) => (period ? PERIODS.indexOf(p) > pi : hourNow < 8));
    list.push({
      code: r.code, name: r.name, kind: r.kind, depts: r.depts.slice(0, 4), phone: r.phone, address: r.address,
      today: todayOpen, openNow: todayOpen ? (period ? todayOpen.includes(period) : planned ? todayOpen.length > 0 : false) : null, laterToday: later || [],
      nav: { google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address}`)}` },
    });
  }
  // 只說區名（「中正區」）而好幾個縣市都有：只列第一個縣市的（與藥局相同）
  const cityOf = (c) => /^(.{2}[市縣])/.exec(c.address)?.[1] || null;
  const cities = a && !/[市縣]/.test(a) ? [...new Set(list.map(cityOf).filter(Boolean))] : [];
  const mine = cities.length > 1 ? list.filter((c) => cityOf(c) === cities[0]) : list;
  const rank = (c) => (c.openNow ? 0 : c.laterToday.length ? 1 : c.today == null ? 2 : 3);
  const sorted = mine.map((c, i) => [c, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([c]) => c);
  return {
    area: area || null, query: query || null, dept: d ? d.label : null, weekday: `星期${WEEK[dow]}`, period,
    phase: planned ? 'planned' : period ? 'open' : hourNow < 8 ? 'early' : 'late', // 問別的日子或時段／看診時段中／清晨還沒開始／晚上 10 點後
    ...(planned && { dayOffset }),
    total: mine.length, openNowCount: mine.filter((c) => c.openNow).length, laterCount: mine.filter((c) => !c.openNow && c.laterToday.length).length,
    clinics: sorted.slice(0, limit),
    ...(cities.length > 1 && { city: cities[0], otherCities: cities.slice(1) }),
  };
}

/** @param {{ clinics: () => Promise<ReturnType<typeof parseClinics>> }} fx */
export function createClinicServices(fx) {
  return { clinics: { search: async (a, now = Date.now()) => clinicSearch(await fx.clinics(), { ...a, now }) } };
}

/** 真實：od＝createOpenDataClient()（失敗時沿用上一份） */
export function createLiveClinicFetchers({ od }) {
  return { clinics: () => od.get(CLINICS_URL, { ttlSec: CLINICS_TTL_SEC, maxBytes: 32 * 2 ** 20, label: '健保署診所資料', parse: parseClinics }) };
}
