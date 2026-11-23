// 鐵路轉乘行程（純函式）：從一整天的班表算出「要換車」的走法（台鐵 OD 時刻表只有直達車，支線小站、直達很少的路線查不到）。
// 演算法：Connection Scan（依發車時間掃過每一段「這站 → 下一站」）；起站每一個發車時間各算一次最早抵達，再去掉被別的走法完全比下去的。
// 2026-11-23 產品負責人：「查火車都只給直達，這根本很難查到」。

/** 換車至少要留幾分（同站換月台；台鐵表定轉乘多在 5～10 分） */
export const MIN_TRANSFER_MIN = 5;
/** 最多換幾次車 */
export const MAX_TRANSFERS = 2;
/** 換車的代價：直達車早開不到這麼多、晚到不到這麼多，就不另列要換車的走法 */
export const TRANSFER_PENALTY_MIN = 10;

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
/** 鐵路班表上過午夜的班次（03:00 前發車）是前一天的末班車，算成 24 小時以後（例：00:09 → 24:09） */
export const RAIL_AFTER_MIDNIGHT = 3 * 60;
export const railDepMin = (hhmm) => { const m = toMin(hhmm); return m < RAIL_AFTER_MIDNIGHT ? m + 24 * 60 : m; };
const pad = (n) => String(n).padStart(2, '0');
/** 分鐘 → HH:MM（超過 24 小時照班表寫法回到 00:xx） */
export const hhmmOf = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

/**
 * 某天有開的班次：班表的星期旗標（[日, 一, …, 六]）。
 * @param {Array<{ no, type?, days: number[], stops: Array<[string, number, number]> }>} trains 正規化班表（stops：[站代碼, 到站分, 開車分]，當天分鐘、跨午夜往上加）
 * @param {string} date YYYY-MM-DD（台灣日期）
 */
export function trainsOn(trains, date) {
  const wd = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  return (trains || []).filter((t) => !t.days || t.days[wd]);
}

/** 每一段「這站 → 下一站」，依發車時間排序 */
function connections(trains) {
  const out = [];
  trains.forEach((t, ti) => {
    for (let i = 0; i + 1 < t.stops.length; i++) {
      const [a, , dep] = t.stops[i], [b, arr] = t.stops[i + 1];
      out.push({ ti, from: a, to: b, dep, arr });
    }
  });
  return out.sort((x, y) => x.dep - y.dep || x.arr - y.arr);
}

/** 從 t0 出發的最早抵達（Connection Scan）；回傳最後一段的 label（往回接成各段） */
function scan(conns, trains, o, d, t0, { minTransfer, maxTransfers }) {
  const best = new Map([[o, { arr: t0, n: -1, origin: true }]]);
  const onTrain = new Map(); // ti → 上車的 label
  let lo = 0, hi = conns.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (conns[mid].dep < t0) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < conns.length; i++) {
    const c = conns[i];
    const target = best.get(d);
    if (target && c.dep >= target.arr) break; // 之後發車的都不會更早到
    let enter = onTrain.get(c.ti);
    if (!enter) {
      const at = best.get(c.from);
      if (!at || at.arr + (at.origin ? 0 : minTransfer) > c.dep) continue;
      const n = at.n + 1;
      if (n > maxTransfers) continue;
      enter = { from: c.from, dep: c.dep, prev: at.origin ? null : at, n };
      onTrain.set(c.ti, enter);
    }
    const cur = best.get(c.to);
    if (c.to === o) continue;
    if (!cur || c.arr < cur.arr || (c.arr === cur.arr && enter.n < cur.n)) {
      best.set(c.to, { arr: c.arr, n: enter.n, leg: { ti: c.ti, from: enter.from, to: c.to, dep: enter.dep, arr: c.arr }, prev: enter.prev });
    }
  }
  const end = best.get(d);
  if (!end || end.origin) return null;
  const legs = [];
  for (let x = end; x; x = x.prev) legs.unshift({ ...x.leg, no: trains[x.leg.ti].no, type: trains[x.leg.ti].type });
  return legs;
}

/**
 * 起站 → 迄站一天內的走法（直達與換車都有），每一個都沒有被「更晚出發、更早或同時到、換車不更多」的走法比下去。
 * @returns {Array<{ dep: number, arr: number, transfers: number, legs: Array<{ no, type?, from, to, dep, arr }> }>} 依出發時間排序
 */
export function railJourneys(trains, o, d, { minTransfer = MIN_TRANSFER_MIN, maxTransfers = MAX_TRANSFERS } = {}) {
  if (!o || !d || o === d) return [];
  const conns = connections(trains);
  const starts = [...new Set(conns.filter((c) => c.from === o).map((c) => c.dep))].sort((a, b) => a - b);
  const seen = new Set();
  const out = [];
  for (const t0 of starts) {
    const legs = scan(conns, trains, o, d, t0, { minTransfer, maxTransfers });
    if (!legs) continue;
    const key = legs.map((l) => `${l.no}@${l.dep}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dep: legs[0].dep, arr: legs.at(-1).arr, transfers: legs.length - 1, legs });
  }
  return paretoJourneys(out);
}

/** 去掉被比下去的：另一個走法出發不更早、抵達不更晚、換車不更多（三項都一樣時留一個） */
export function paretoJourneys(list) {
  const beats = (k, j) => k.dep >= j.dep && k.arr <= j.arr && k.transfers <= j.transfers && (k.dep > j.dep || k.arr < j.arr || k.transfers < j.transfers);
  return list.filter((j) => !list.some((k) => k !== j && beats(k, j))).sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}

/**
 * 直達車（OD 時刻表）加上要換車的走法：每多換一次車，都要比換得少的走法明顯好（省 TRANSFER_PENALTY_MIN 分以上）才列。
 * 換得少的走法 K 出發不早於 J 出發前「多換的次數 × 10 分」、抵達不晚於 J 抵達後「多換的次數 × 10 分」→ 不列 J。
 * 例：10:58 開、八堵換 1 次、12:49 到 vs 11:03 開、七堵和八堵換 2 次、12:49 到——後者只晚開 5 分卻多換一次，不列（2026-11-23 真實資料）。
 * @param {Array<{ depart: string, minutes: number }>} direct OD 直達班次
 * @param {ReturnType<typeof railJourneys>} journeys
 * @param {(hhmm: string) => number} depMin 發車字串 → 分（過午夜的末班車算 24:xx）
 */
export function transferExtras(direct, journeys, depMin) {
  const dir = direct.map((t) => { const dep = depMin(t.depart); return { dep, arr: dep + t.minutes, transfers: 0 }; });
  const pool = [...dir, ...journeys];
  const better = (k, j) => { const p = TRANSFER_PENALTY_MIN * (j.transfers - k.transfers); return k.transfers < j.transfers && k.dep >= j.dep - p && k.arr <= j.arr + p; };
  return journeys.filter((j) => j.transfers > 0 && !pool.some((k) => k !== j && better(k, j)));
}

/**
 * 正規化 TDX 台鐵定期時刻表（GeneralTrainTimetable）：只留排班需要的欄位（原始約 4 MB）。
 * 跨午夜的站時間往上加 24 小時，讓同一班車的時間一路遞增。
 */
export function normGeneralTimetable(j, typeName = (t) => t) {
  const list = Array.isArray(j) ? j : j?.TrainTimetables || [];
  const out = [];
  for (const t of list) {
    const info = t.TrainInfo || {};
    const sd = t.ServiceDay || info.ServiceDay || null;
    const days = sd ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((k) => (sd[k] === 1 ? 1 : 0)) : null;
    // 03:00 前從起站開的車是前一天的末班車（與 railDepMin 一致）
    const first = t.StopTimes?.[0]?.DepartureTime || t.StopTimes?.[0]?.ArrivalTime;
    let last = -1, add = first && toMin(first) < RAIL_AFTER_MIDNIGHT ? 24 * 60 : 0;
    const stops = [];
    for (const s of t.StopTimes || []) {
      if (!s?.StationID || !s.ArrivalTime) continue;
      let arr = toMin(s.ArrivalTime) + add, dep = toMin(s.DepartureTime || s.ArrivalTime) + add;
      if (arr < last) { add += 24 * 60; arr += 24 * 60; dep += 24 * 60; }
      if (dep < arr) dep += 24 * 60;
      last = dep;
      if (!Number.isFinite(arr) || !Number.isFinite(dep)) continue;
      stops.push([String(s.StationID), arr, dep]);
    }
    if (stops.length < 2 || !info.TrainNo) continue;
    out.push({ no: String(info.TrainNo), type: typeName(info.TrainTypeName), ...(days && { days }), stops });
  }
  return out;
}
