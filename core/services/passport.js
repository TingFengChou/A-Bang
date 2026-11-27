// 護照現場等待人數（M16-04c）：外交部領事事務局「申辦、領取護照現場等待人數即時動態」（data.gov.tw 165115，RSS，每分鐘更新，免金鑰）。
// 只有人數與叫號，沒有預估時間：照實報人數，不自己換算成分鐘。據點：領務局（臺北）與中部、南部、雲嘉南辦事處（東部當天沒有就不列）。
export const PASSPORT_URL = 'https://www.boca.gov.tw/sp-wain-board-rss-1.xml';
export const PASSPORT_PAGE = 'https://www.boca.gov.tw/sp-wain-board-1.html';
export const PASSPORT_BOOKING = 'https://ppass.boca.gov.tw/';
export const PASSPORT_TTL_SEC = 60;

const num = (s) => { const t = String(s ?? '').trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; }; // 沒有這個欄位是「沒資料」，不是 0
const tag = (xml, name) => { const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`).exec(xml); return m ? m[1].trim() : null; };
const sum = (...xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
/** 據點的短名（給回答用）：領務局在臺北 */
const SHORT_EN = { 外交部領事事務局: 'BOCA (Taipei)', 外交部中部辦事處: 'Central Office (Taichung)', 外交部南部辦事處: 'Southern Office (Kaohsiung)', 外交部雲嘉南辦事處: 'Yunlin-Chiayi-Tainan Office (Chiayi)', 外交部東部辦事處: 'Eastern Office (Hualien)' };
const SHORT = { 外交部領事事務局: '領務局（臺北）', 外交部中部辦事處: '中部辦事處（臺中）', 外交部南部辦事處: '南部辦事處（高雄）', 外交部雲嘉南辦事處: '雲嘉南辦事處（嘉義）', 外交部東部辦事處: '東部辦事處（花蓮）' };

/**
 * RSS → 各據點的等待人數。申辦分一般件（現場抽號）與網路預約件；領件有的據點分上下午（合計）。
 * @returns {{ updatedAt: string|null, offices: Array<{ name: string, short: string, general: { waiting: number|null, now: number|null }, online: { waiting: number|null, now: number|null }, pickup: { waiting: number|null } }> }}
 */
export function parsePassportWait(xml) {
  const s = String(xml || '');
  const pub = tag(s, 'pubDate');
  const t = pub ? Date.parse(pub) : NaN;
  const offices = [...s.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const it = m[1];
    const name = tag(it, 'location') || '';
    const n = (k) => num(tag(it, k));
    return {
      name, short: SHORT[name] || name, ...(SHORT_EN[name] && { shortEn: SHORT_EN[name] }),
      general: { waiting: n('AP_GeneralWaitingPersonCount'), now: n('AP_GeneralInProcessNumber') },
      online: { waiting: n('AP_OnlineWaitingPersonCount'), now: n('AP_OnlineInProcessNumber') },
      pickup: { waiting: sum(n('RP_WaitingPersonCount'), n('RP_AMWaitingPersonCount'), n('RP_PMWaitingPersonCount')) },
    };
  }).filter((o) => o.name && (o.general.waiting != null || o.pickup.waiting != null));
  return { updatedAt: Number.isFinite(t) ? new Date(t).toISOString() : null, offices };
}

/** 台灣時間 HH:MM */
export const twClock = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return Number.isFinite(d.getTime()) ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : null; };

/** @param {{ load: () => Promise<string> }} fx */
export function createPassportServices(fx) {
  return {
    /** @param {{ office?: string|null }} [a] 只看某個據點（「台中」「高雄」…） */
    async passportWait({ office = null } = {}) {
      const d = parsePassportWait(await fx.load());
      const want = office ? String(office).replace(/台/g, '臺') : null;
      const pick = want ? d.offices.filter((o) => o.name.includes(want) || o.short.includes(want)) : [];
      return { ...d, offices: pick.length ? pick : d.offices, booking: PASSPORT_BOOKING, page: PASSPORT_PAGE, source: '外交部領事事務局' };
    },
  };
}

/** 真實資料：快取 60 秒（opendata-client：失敗時沿用上一份，最多 2 分鐘） */
export function createLivePassportFetchers({ od }) {
  return { load: () => od.get(PASSPORT_URL, { ttlSec: PASSPORT_TTL_SEC, label: '護照現場等待人數', as: 'text', maxBytes: 256 * 1024 }) };
}
