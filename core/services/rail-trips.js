// 台鐵班次（直達＋要換車的走法）：tra_timetable 與 plan_trip 共用。
// 直達車照舊用 OD 時刻表（當天、最準）；換車的走法用台鐵定期時刻表（GeneralTrainTimetable，一天下載一次）在本機算（core/rail-journeys.js）。
// 2026-11-23 產品負責人：「查火車都只給直達，這根本很難查到」——台北到平溪、集集、內灣這種支線小站，OD 時刻表一班都沒有。
import { railJourneys, transferExtras, trainsOn, hhmmOf, railDepMin } from '../rail-journeys.js';
import { findStation } from './transit.js';

/** 換車班次的來源說明（卡片、工具文字） */
export const TRANSFER_NOTE = '要換車的班次依台鐵定期時刻表推算，以當天公告為準';
export const TRANSFER_NOTE_EN = 'Trips with a change of train are worked out from the TRA regular timetable; check the day’s official schedule';

/** 票價用哪個車種：換車時取最高等的那段（區間 < 區間快 < 復興 < 莒光 < 自強 < 普悠瑪、太魯閣） */
const FARE_RANK = ['區間', '區間快', '復興', '莒光', '自強', '自強3000', '普悠瑪', '太魯閣'];
export function fareTypeOf(legs) {
  let best = null, r = -1;
  for (const l of legs) { const i = FARE_RANK.indexOf(l.type); if (i > r) { r = i; best = l.type; } }
  return best;
}

/** 一個換車走法 → 時刻表的一列（trainNo「4012→4712」、legs 每段車次與站、via 換車站） */
export function transferRow(j, nameOf) {
  const legs = j.legs.map((l) => ({ trainNo: l.no, ...(l.type && { type: l.type }), from: nameOf(l.from), to: nameOf(l.to), depart: hhmmOf(l.dep), arrive: hhmmOf(l.arr) }));
  const fareType = fareTypeOf(legs);
  return {
    trainNo: legs.map((l) => l.trainNo).join('→'),
    depart: hhmmOf(j.dep), arrive: hhmmOf(j.arr), minutes: j.arr - j.dep,
    transfers: j.transfers, via: legs.slice(1).map((l) => l.from), legs,
    ...(fareType && { fareType }),
    planned: true, // 定期時刻表推算（不是當天的 OD 時刻表）
  };
}

/**
 * 台鐵時刻表＋換車走法。定期時刻表查不到（額度、上游錯誤）時就只有直達車，標 transfersUnavailable。
 * @returns {Promise<{ from, to, date, trains: object[], transferNote?: string, transfersUnavailable?: true }>}
 */
export async function traTrips(svc, { from, to, date }) {
  const tt = await svc.rail.traTimetable({ from, to, ...(date && { date }) });
  if (typeof svc.rail.traGeneral !== 'function') return tt;
  const gen = await svc.rail.traGeneral().catch(() => null);
  // 定期時刻表這次拿不到（額度、上游錯誤）：只有直達車，照實標示「換車的走法暫時查不到」（不說成沒有換車的走法）
  if (!Array.isArray(gen) || !gen.length) return { ...tt, transfersUnavailable: true };
  const st = await svc.rail.traStations();
  let o, d;
  try { o = findStation(st, tt.from, '台鐵'); d = findStation(st, tt.to, '台鐵'); } catch { return tt; }
  const extra = transferExtras(tt.trains || [], railJourneys(trainsOn(gen, tt.date), String(o.id), String(d.id)), railDepMin);
  if (!extra.length) return tt;
  const names = new Map(st.map((s) => [String(s.id), s.name]));
  const nameOf = (id) => names.get(String(id)) || String(id);
  const trains = [...(tt.trains || []), ...extra.map((j) => transferRow(j, nameOf))].sort((x, y) => x.depart.localeCompare(y.depart));
  return { ...tt, trains, transferNote: TRANSFER_NOTE, transferNoteEn: TRANSFER_NOTE_EN };
}
