// 工具包：transit（交通）／捷運 — 風險分級 L1
import { z } from 'zod';
import { defineTool, T, clip } from './define.js';
import { distanceM, normName, UserError } from '../util.js';
import { TdxError } from '../tdx-client.js';
import { resolvePoint } from '../services/places.js';
import { withNav, navLinks } from '../nav.js';
import { METRO_SYSTEMS, METRO_STATUS, metroStatusText, findMetroStation } from '../services/metro.js';

const PACK = 'transit';
const system = z.enum(Object.keys(METRO_SYSTEMS)).describe(`捷運系統：${Object.entries(METRO_SYSTEMS).map(([k, v]) => `${k}=${v}`).join('、')}`);

export const metroStations = defineTool({
  name: 'metro_stations',
  title: '捷運車站清單',
  description: '列出某捷運系統的車站代碼、名稱與座標；每站附導航連結 nav。站名可直接給 metro_live_board 使用。',
  pack: PACK, tier: 'L1',
  input: { system },
  speak: (d, a) => `${METRO_SYSTEMS[a.system]}共有 ${d.length} 個車站。`,
  async run(svc, a) {
    const data = withNav(await svc.metro.stations(a));
    return { data, text: clip([`${METRO_SYSTEMS[a.system]}車站 ${data.length} 個：`, data.map((s) => `${s.name}(${s.id})`).join('、')]) };
  },
});

export const metroLiveBoard = defineTool({
  name: 'metro_live_board',
  title: '捷運即時到站',
  description: `查詢捷運某一站各線各方向的下一班車還有幾分鐘到站（etaMin 為分鐘；status 為狀態代碼 ${METRO_STATUS.join('／')}：arriving 進站中、approaching 1 分內、scheduled 依時刻表估算），依到站時間排序；附車站導航連結 nav。站名不確定時先用 metro_stations。使用者沒說站名時給 near（他現在的位置），自動用離他最近的捷運站（3 公里內）；說了路線（例：文湖線）時給 line，只找這條線的站、只列這條線的車。`,
  pack: PACK, tier: 'L1', card: 'metro',
  input: {
    system: system.optional().describe('捷運系統；使用者說了「高雄捷運」「機捷」等就要給；沒給時依站名在各系統找（有 near 時優先找離他近的那個系統）'),
    station: z.string().trim().min(1).max(30).optional().describe('站名或代碼，例如 台北車站、市政府、BL12；沒說站名時省略並給 near'),
    near: T.point('使用者現在的位置（沒說站名時用）：自動找最近的捷運站').optional(),
    line: z.string().trim().max(10).optional().describe('路線名稱或代碼（選填），例如 板南線、文湖線、BL、BR'),
    last: z.boolean().optional().describe('問末班車時給 true：多回 lastTrains（依時刻表，各線各方向今天最後一班的時間）'),
  },
  speak: (d) => {
    if (d.source === 'frequency') return d.headway ? `${d.station}：台中捷運沒有到站時間的開放資料，現在大約${headwaySay(d.headway)}一班。` : `${d.station}：台中捷運現在不在營運時間（約 06:00～24:00）。`;
    if (d.lastTrains) return d.lastTrains.length ? `${d.station}的末班車（時刻表）：${d.lastTrains.slice(0, 4).map((x) => `往${x.destination} ${x.time}`).join('、')}。` : `${d.station}查不到時刻表的末班車資料。`;
    const t = d.trains.find((x) => x.etaMin != null);
    const lineSay = t?.line ? `${t.line}` : '';
    // 時刻表估算的班次（北捷即時到站只有進站中）：照實說「依時刻表約」
    const train = t && (t.scheduled ? `${lineSay}依時刻表約 ${Math.max(1, t.etaMin)} 分鐘後有往${t.destination}的車` : t.etaMin <= 1 ? `${lineSay}往${t.destination}的車${metroStatusText(t)}` : `${lineSay}最快 ${t.etaMin} 分鐘後有往${t.destination}的車`);
    if (d.nearest) {
      // 用預設地點（沒拿到位置）時不說「離你」；地點就是那一站時不重複（「臺北車站」→ 台北車站）
      const same = d.nearest.from && normName(d.nearest.from).replace(/站$/, '') === normName(d.station).replace(/站$/, '');
      const who = !d.nearest.from ? `離你最近的是${d.station}（約 ${fmtM(d.nearest.distanceM)}）` : same ? d.station.replace(/(?<!站)$/, '站') : `離「${d.nearest.from}」最近的是${d.station}（約 ${fmtM(d.nearest.distanceM)}）`;
      return train ? `${who}：${train}。` : `${who}目前沒有即時到站資料。`;
    }
    if (!t) return `${d.station}目前沒有即時到站資料。`;
    return `${d.station}${train.slice(lineSay.length)}。`;
  },
  async run(svc, a) {
    const line = lineCode(a.line);
    const near = !a.station && a.near ? await nearestMetro(svc, await resolvePoint(svc.places, a.near), a.system, line) : null;
    if (!a.station && !near) throw new UserError(a.near ? `你附近 3 公里內沒有${a.line ? `${a.line}的` : ''}捷運站；請告訴我站名，例如「市政府站下一班」` : '請告訴我哪一站，例如「市政府站下一班」');
    // 只給站名沒給系統：在各系統的站名裡找（台北優先；有位置時找離他近的那個系統），不預設台北（「美麗島」是高雄捷運，S5）
    const sys = near ? near.system : a.system || await systemOfStation(svc, a.station, a.near ? await resolvePoint(svc.places, a.near).catch(() => null) : null);
    const raw = await svc.metro.liveBoard({ system: sys, station: near ? near.station : a.station, ...(a.last && { last: true }) });
    // 指定路線：只列這條線的車（看板其他線的車放後面不列）
    const trains = line ? raw.trains.filter((t) => (t.lineId || '').startsWith(line)) : raw.trains;
    const data = { ...raw, trains: line && trains.length ? trains : raw.trains, nav: navLinks(raw.lat, raw.lon), ...(near && { nearest: { distanceM: near.distanceM, ...(typeof a.near === 'string' && { from: a.near }) } }) };
    const lastLines = data.lastTrains ? (data.lastTrains.length ? [`末班車（時刻表）：${data.lastTrains.map((x) => `${x.line || ''} 往 ${x.destination} ${x.time}`).join('、')}`] : ['末班車：查不到時刻表']) : [];
    const text = data.source === 'frequency'
      ? `${METRO_SYSTEMS[data.system]} ${data.station}：${data.note}；${data.headway ? `現在約${headwaySay(data.headway)}一班` : '現在不在營運時間'}。`
      : data.trains.length
      ? clip([...lastLines, `${METRO_SYSTEMS[data.system]} ${data.station} ${data.source && data.source !== 'live' ? '到站（' + data.note + '）' : '即時到站'}（更新：${data.updatedAt}）`, ...data.trains.map((t) => `- ${t.line} 往 ${t.destination}：${metroStatusText(t)}${t.scheduled ? '（時刻表）' : ''}`)])
      : `${METRO_SYSTEMS[data.system]} ${data.station} 目前沒有即時到站資料（部分系統只在營運時段、或只提供部分車站看板）。`;
    return { data, text };
  },
});

/** 班距：「每 8 分」或「每 8～10 分」 */
const headwaySay = (h) => (h.max > h.min ? `每 ${h.min}～${h.max} 分` : `每 ${h.min} 分`);
const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 公尺`);
const NEAR_MAX_M = 3000;

/**
 * 只有站名時是哪個捷運系統：各系統的車站清單裡找得到的（台北、桃園機捷、台中、高雄的順序）；好幾個系統都有（「市政府」）時，
 * 有位置就用離他近的那一站，沒有就台北優先。都找不到丟 UserError（說各系統都沒有，不說成「台北捷運找不到」）。
 */
export async function systemOfStation(svc, station, pt = null) {
  const systems = Object.keys(METRO_SYSTEMS);
  const lists = await Promise.allSettled(systems.map((sys) => svc.metro.stations({ system: sys })));
  if (lists.every((r) => r.status === 'rejected')) throw new TdxError(503, '捷運車站資料暫時查不到，請稍後再試');
  const hits = [];
  lists.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    try { const st = findMetroStation(r.value, station, systems[i]); hits.push({ system: systems[i], st, exact: normName(st.name) === normName(station).replace(/站$/, '') || normName(st.name) === normName(station) }); } catch { /* 這個系統沒有 */ }
  });
  if (!hits.length) throw new UserError(`台北、桃園、台中、高雄捷運都找不到「${station}」站；請確認站名，或說是哪個捷運（例如「高雄捷運美麗島站」）`);
  const far = (x) => (pt && Number.isFinite(x.st.lat) ? distanceM(pt.lat, pt.lon, x.st.lat, x.st.lon) : 0);
  hits.sort((x, y) => y.exact - x.exact || far(x) - far(y)); // 站名完全相同的優先，再看離他近的；同分照台北、機捷、台中、高雄
  return hits[0].system;
}

/** 路線名稱 → 代碼字首（台北、桃園；顏色也通）；看不懂回 null */
const LINE_CODES = [[/板南|藍/, 'BL'], [/淡水信義|淡水|信義|紅/, 'R'], [/松山新店|松山|新店|綠/, 'G'], [/中和新蘆|新蘆|橘/, 'O'], [/文湖|棕/, 'BR'], [/環狀|黃/, 'Y'], [/萬大/, 'LG'], [/機場/, 'A']];
export function lineCode(line) {
  if (!line) return null;
  const s = String(line).trim();
  if (/^[A-Z]{1,2}$/i.test(s)) return s.toUpperCase();
  return LINE_CODES.find(([re]) => re.test(s))?.[1] || null;
}

/** 離某點最近的捷運站（指定系統只找該系統；指定路線只找這條線的站）；超過 3 公里回 null；各系統都查不到丟 TdxError */
export async function nearestMetro(svc, pt, only, line = null) {
  if (!pt) return null;
  const systems = only ? [only] : Object.keys(METRO_SYSTEMS);
  const lists = await Promise.allSettled(systems.map((sys) => svc.metro.stations({ system: sys })));
  if (lists.every((r) => r.status === 'rejected')) throw new TdxError(503, '捷運車站資料暫時查不到，請稍後再試');
  let best = null;
  lists.forEach((r, i) => {
    for (const s of r.status === 'fulfilled' ? r.value : []) {
      if (!Number.isFinite(s.lat) || (line && !(s.lines || []).includes(line))) continue;
      const m = Math.round(distanceM(pt.lat, pt.lon, s.lat, s.lon));
      if (!best || m < best.distanceM) best = { system: systems[i], station: s.name, distanceM: m };
    }
  });
  return best && best.distanceM <= NEAR_MAX_M ? best : null;
}

export default [metroStations, metroLiveBoard];
