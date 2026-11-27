// 找最近的戶政事務所、今天是不是上班日（M16-04b）。
// 資料（免金鑰，政府資料開放授權條款－第1版，2026-11-27 實測）：
//   - 自然人憑證申辦點位（內政部，data.gov.tw 177793）：名稱、地址、經緯度——各戶政事務所與辦公室都在裡面（戶政司的通訊 API 沒有座標）
//   - 戶政機關通訊（戶政司 ODRP051，data.gov.tw 7437）：電話（以名稱對應）
//   - 中華民國政府行政機關辦公日曆表（人事行政總處，data.gov.tw 14718）：哪天上班、哪天放假；下載網址每年不同，從 data.gov.tw 的資料集資訊找當年的
// 營業時間各所不同（午休、夜間延時、週六服務），資料沒有結構化的時間：只說「今天是不是上班日」，不說「現在有開」。
import { distanceM } from '../util.js';
import { csvObjects } from '../csv.js';
import { navLinks, walkMinutes } from '../nav.js';

export const OFFICE_URLS = {
  points: 'https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/BFBF8161-45E7-4649-9C91-2E6238EAD15E/resource/F9BBD3DF-C31A-476F-AFF8-B844ABF707FE/download',
  ris: 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP051',
  calendarMeta: 'https://data.gov.tw/api/v2/rest/dataset/14718',
};
export const OFFICE_TTL_SEC = 7 * 24 * 3600;
export const CALENDAR_TTL_SEC = 30 * 24 * 3600;
const TW_MS = 8 * 3600e3;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 申辦點位 CSV → 戶政事務所與辦公室（台灣範圍內的座標）；缺欄位丟錯（opendata-client 沿用上一份） */
export function parseOffices(csv) {
  return csvObjects(csv, ['名稱', '地址', '座標緯度', '座標經度']).filter((r) => /戶政事務所/.test(r['名稱'] || '')).map((r) => ({ name: r['名稱'], address: r['地址'] || '', lat: Number(r['座標緯度']), lon: Number(r['座標經度']) }))
    .filter((o) => o.lat > 21 && o.lat < 27 && o.lon > 118 && o.lon < 123);
}

/** 戶政通訊 API → 名稱對電話 */
export function parseTels(json) {
  const list = Array.isArray(json?.responseData) ? json.responseData : [];
  return new Map(list.filter((x) => x?.orgName && x?.tel).map((x) => [String(x.orgName).trim(), String(x.tel).trim()]));
}

/** 辦公日曆 CSV → 'YYYYMMDD' → { off, note }；缺欄位或一天都沒有就丟錯（不把空表快取 30 天，架構審查 #5） */
export function parseCalendar(csv) {
  const map = new Map(csvObjects(csv, ['西元日期', '是否放假']).filter((r) => /^\d{8}$/.test(r['西元日期'])).map((r) => [r['西元日期'], { off: r['是否放假'] === '2', note: r['備註'] || null }]));
  if (!map.size) throw new Error('辦公日曆沒有任何日期');
  return map;
}

/** data.gov.tw 的資料集資訊 → 指定民國年的辦公日曆下載網址（不要 Google 行事曆專用版） */
export function calendarUrl(meta, rocYear) {
  const list = meta?.result?.distribution || meta?.distribution || [];
  const hit = list.find((x) => x?.resourceDescription === `${rocYear}年中華民國政府行政機關辦公日曆表` && /^https:\/\//.test(x?.resourceDownloadUrl || ''));
  return hit?.resourceDownloadUrl || null;
}

/** 台灣日期（YYYYMMDD、顯示用 M/D、星期） */
export function taipeiDay(now = Date.now()) {
  const d = new Date(now + TW_MS);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return { ymd, year: d.getUTCFullYear(), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）`, weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 };
}

/** 今天上不上班：日曆有就照日曆；沒有（新年度還沒公布、下載失敗）就照週末推，並標示是推的 */
export function workdayOf(cal, now = Date.now()) {
  const day = taipeiDay(now);
  const hit = cal?.get?.(day.ymd);
  if (hit) return { date: day.label, workday: !hit.off, note: hit.note, known: true };
  return { date: day.label, workday: !day.weekend, note: null, known: false };
}

/**
 * @param {{ offices: () => Promise<object[]>, tels: () => Promise<Map<string,string>>, calendar: (year: number) => Promise<Map<string, object>|null> }} fx
 */
export function createGovOfficeServices(fx) {
  return {
    /** @param {{ lat: number, lon: number, limit?: number, now?: number, dayOffset?: number }} a dayOffset：問的是幾天後（「禮拜六有開嗎」） */
    async nearbyOffices({ lat, lon, limit = 3, now = Date.now(), dayOffset = 0 }) {
      const at = now + dayOffset * 864e5;
      const [offices, tels, cal] = await Promise.all([fx.offices(), fx.tels().catch(() => new Map()), fx.calendar(taipeiDay(at).year).catch(() => null)]);
      const list = offices.map((o) => ({ ...o, distanceM: Math.round(distanceM(lat, lon, o.lat, o.lon)) })).sort((a, b) => a.distanceM - b.distanceM).slice(0, limit)
        .map((o) => ({ name: o.name, address: o.address, tel: tels.get(o.name) || null, lat: o.lat, lon: o.lon, distanceM: o.distanceM, walkMin: walkMinutes(o.distanceM), nav: navLinks(o.lat, o.lon, 'walking') }));
      return { offices: list, today: { ...workdayOf(cal, at), ...(dayOffset && { dayOffset }) }, source: '內政部（自然人憑證申辦點位、戶政機關通訊）、人事行政總處辦公日曆' };
    },
  };
}

/** 真實資料：據點與電話快取 7 天、日曆 30 天（opendata-client：失敗時沿用上一份） */
export function createLiveGovOfficeFetchers({ od }) {
  const offices = () => od.get(OFFICE_URLS.points, { ttlSec: OFFICE_TTL_SEC, label: '戶政事務所據點資料', as: 'text', maxBytes: 2 * 1024 * 1024, parse: (t) => { const o = parseOffices(t); if (!o.length) throw new Error('沒有戶政事務所'); return o; } });
  const tels = () => od.get(OFFICE_URLS.ris, { ttlSec: OFFICE_TTL_SEC, label: '戶政機關通訊資料', as: 'json', maxBytes: 2 * 1024 * 1024, parse: parseTels });
  const calendar = async (year) => {
    const meta = await od.get(OFFICE_URLS.calendarMeta, { ttlSec: OFFICE_TTL_SEC, label: '辦公日曆資料集資訊', as: 'json', maxBytes: 1024 * 1024 });
    const url = calendarUrl(meta, year - 1911);
    if (!url) return null; // 新年度的日曆還沒公布：照週末推
    return od.get(url, { ttlSec: CALENDAR_TTL_SEC, label: '行政機關辦公日曆', as: 'text', maxBytes: 512 * 1024, parse: parseCalendar });
  };
  return { offices, tels, calendar };
}
