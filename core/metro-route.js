// 捷運轉乘規劃（純函式）：用各線車站順序（TDX StationOfLine）建路網，最短路徑＋轉乘懲罰，算出坐哪條線、往哪個方向、坐幾站、在哪裡轉乘。
// 同名的站就是轉乘站（同系統不同線、跨系統都是；「臺／台」、機場捷運站名結尾的「站」視為相同）。
// 時間依站數估算（不含等車），不查站間行駛時間（每分鐘只有 5 次 TDX 額度）；票價另由 ODFare 查。
import { normName } from './util.js';

/** 站名比對用的鍵：臺／台相同、去掉結尾的「站」（機場捷運「三重站」＝台北捷運「三重」；「台北車站」兩邊一致） */
export const stationKey = (name) => normName(String(name || '')).replace(/站$/, '');

/** 哪些系統的路網相通（同一個城市）：北部五個系統靠同名站互轉（多半經台北捷運），南部兩個，台中一個 */
export const REGION = { TRTC: 'N', NTMC: 'N', TYMC: 'N', NTDLRT: 'N', NTALRT: 'N', KRTC: 'S', KLRT: 'S', TMRT: 'C' };
export const regionSystems = (r) => Object.keys(REGION).filter((k) => REGION[k] === r);
/** 規劃 A 系統到 B 系統要載入哪些系統的路網：北部加台北捷運（三鶯線、淡海、安坑輕軌都靠北捷轉），南部兩個都載 */
export function linkedSystems(a, b = a) {
  const r = REGION[a];
  return [...new Set([a, b, ...(r === 'N' ? ['TRTC'] : r === 'S' ? regionSystems('S') : [])])];
}
/** 票價分段：同一個系統連續坐的幾段算一張票（ODFare 起站到迄站），跨系統分開 */
export function fareGroups(legs) {
  const groups = [];
  for (const l of legs) { const g = groups.at(-1); if (g && g.system === l.system) g.toId = l.toId; else groups.push({ system: l.system, fromId: l.fromId, toId: l.toId }); }
  return groups;
}

/** 每站約幾分（含停站；2026-11-23 依北捷站間行駛時間約 1.5～2 分估）；轉乘約幾分（走到另一個月台） */
export const PER_STOP_MIN = { TRTC: 2, NTMC: 2, TYMC: 3, TMRT: 2, KRTC: 2, NTDLRT: 2.5, NTALRT: 2.5, KLRT: 2.5 };
export const TRANSFER_MIN = 5;
export const CROSS_SYSTEM_MIN = 7; // 跨系統（換到另一家公司的月台，通常要多走一段）
const FORK_MIN = 3; // 同一條線分岔（中和新蘆線：往迴龍的車在大橋頭換往蘆洲的車）

/**
 * 北捷的支線（StationOfLine 依 Sequence 排列時會接在主線最後一站後面，不能照順序相連）：
 *   shuttle：支線是接駁車，要在 parent 換車（小碧潭支線在七張、新北投支線在北投）；
 *   fork：直通車分岔（中和新蘆線蘆洲支線從大橋頭分出去，南勢角的車直通蘆洲或迴龍；淡海輕軌藍海線從濱海沙崙分出去）。
 * 高雄捷運 R4A、R22A、機場捷運 A14a 是主線上的站，不是支線。
 */
/** 環狀線（高雄輕軌 2024 年成圈）：兩個方向的終點都是籬仔內，卡片說「下一站」不說「往哪」 */
const LOOP = new Set(['KLRT']);

const BRANCH = {
  TRTC: {
    G: { shuttle: { ids: ['G03A'], parent: 'G03', name: '小碧潭支線', en: 'Xiaobitan Branch' } },
    R: { shuttle: { ids: ['R22A'], parent: 'R22', name: '新北投支線', en: 'Xinbeitou Branch' } },
    O: { fork: { from: 'O50', parent: 'O12' } },
  },
  // 淡海輕軌藍海線（台北海洋大學、沙崙、淡水漁人碼頭）在濱海沙崙分出去，紅樹林直通；StationOfLine 接在崁頂後面（V11 → V28）
  NTDLRT: { V: { fork: { from: 'V28', parent: 'V09' } } },
};

/**
 * 一個系統的各線（[{ lineId, line, lineEn?, color?, stations: [{ id, name, nameEn? }]（依順序） }]）→ 路線（route，一段可以直接坐的車）。
 * 支線另成一條 route（shuttle 名稱用支線名；fork 用同一條線的名稱、key 加 -F）。
 */
export function toRoutes(system, lines) {
  const out = [];
  for (const l of lines || []) {
    const st = (l.stations || []).filter((s) => s?.id && s?.name);
    if (st.length < 2) continue;
    const b = BRANCH[system]?.[l.lineId];
    const base = { system, lineId: l.lineId, line: l.line, ...(l.lineEn && { lineEn: l.lineEn }), ...(l.color && { color: l.color }) };
    if (b?.shuttle) {
      const ids = new Set(b.shuttle.ids);
      const parent = st.find((s) => s.id === b.shuttle.parent);
      out.push({ ...base, key: `${system}:${l.lineId}`, stations: st.filter((s) => !ids.has(s.id)) });
      if (parent) out.push({ ...base, key: `${system}:${l.lineId}-S`, line: b.shuttle.name, lineEn: b.shuttle.en, stations: [parent, ...st.filter((s) => ids.has(s.id))] });
    } else if (b?.fork) {
      const i = st.findIndex((s) => s.id === b.fork.from), p = st.findIndex((s) => s.id === b.fork.parent);
      if (i > 0 && p >= 0) {
        out.push({ ...base, key: `${system}:${l.lineId}`, stations: st.slice(0, i) });
        out.push({ ...base, key: `${system}:${l.lineId}-F`, fork: true, stations: [...st.slice(0, p + 1), ...st.slice(i)] });
      } else out.push({ ...base, key: `${system}:${l.lineId}`, stations: st });
    } else if (LOOP.has(system)) {
      // 環狀線：頭尾相連（資料最後一站不是第一站時補上，籬仔內 → … → 籬仔內）
      const ring = stationKey(st[0].name) === stationKey(st[st.length - 1].name) ? st : [...st, st[0]];
      out.push({ ...base, key: `${system}:${l.lineId}`, loop: true, stations: ring });
    } else out.push({ ...base, key: `${system}:${l.lineId}`, stations: st });
  }
  return out;
}

/** 小型二元堆（最短路徑用） */
function heap() {
  const a = [];
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } };
  const down = (i) => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } };
  return { push(x) { a.push(x); up(a.length - 1); }, pop() { const t = a[0], e = a.pop(); if (a.length) { a[0] = e; down(0); } return t; }, get size() { return a.length; } };
}

/**
 * 最短路徑（坐車分鐘＋轉乘懲罰）：狀態是「在哪條 route 的第幾站」；同名站之間可以轉乘。
 * @param {ReturnType<typeof toRoutes>} routes
 * @returns {null | { minutes, transfers, legs: Array<{ system, key, lineId, line, lineEn?, color?, from, fromEn?, fromId, to, toEn?, toId, stops, minutes, next, nextEn?, toward?, towardEn?, loop?, dir: 1|-1 }> }}
 */
export function findRoute(routes, from, to) {
  const fk = stationKey(from), tk = stationKey(to);
  if (!fk || !tk || fk === tk) return null;
  const at = new Map(); // 站名鍵 → [[route 索引, 站索引]]
  routes.forEach((r, ri) => r.stations.forEach((s, si) => { const k = stationKey(s.name); if (!at.has(k)) at.set(k, []); at.get(k).push([ri, si]); }));
  if (!at.has(fk) || !at.has(tk)) return null;
  const id = (ri, si) => `${ri}|${si}`;
  const dist = new Map(), prev = new Map();
  const q = heap();
  for (const [ri, si] of at.get(fk)) { dist.set(id(ri, si), 0); q.push([0, ri, si]); }
  let end = null;
  while (q.size) {
    const [d, ri, si] = q.pop();
    if (d > (dist.get(id(ri, si)) ?? Infinity)) continue;
    const r = routes[ri];
    const k = stationKey(r.stations[si].name);
    if (k === tk) { end = [ri, si]; break; }
    const relax = (rj, sj, w, kind) => {
      const nd = d + w, key = id(rj, sj);
      if (nd < (dist.get(key) ?? Infinity)) { dist.set(key, nd); prev.set(key, [ri, si, kind]); q.push([nd, rj, sj]); }
    };
    const per = PER_STOP_MIN[r.system] ?? 2;
    if (si + 1 < r.stations.length) relax(ri, si + 1, per, 'ride');
    if (si > 0) relax(ri, si - 1, per, 'ride');
    for (const [rj, sj] of at.get(k)) {
      if (rj === ri) continue;
      const o = routes[rj];
      const w = o.system !== r.system ? CROSS_SYSTEM_MIN : o.lineId === r.lineId && !o.key.endsWith('-S') && !r.key.endsWith('-S') ? FORK_MIN : TRANSFER_MIN;
      relax(rj, sj, w, 'xfer');
    }
  }
  if (!end) return null;
  // 還原路徑 → 一段一段（同一條 route 連續坐的是一段）
  const path = [end];
  for (let cur = end; prev.has(id(cur[0], cur[1]));) { const p = prev.get(id(cur[0], cur[1])); cur = [p[0], p[1]]; path.unshift(cur); }
  const legs = [];
  for (let i = 0; i < path.length;) {
    let j = i;
    while (j + 1 < path.length && path[j + 1][0] === path[i][0]) j++;
    if (j > i) legs.push(legOf(routes, path[i][0], path[i][1], path[j][1]));
    i = j + 1;
  }
  if (!legs.length) return null;
  const minutes = Math.round(legs.reduce((s, l) => s + l.minutes, 0) + legs.slice(1).reduce((s, l, i) => s + (l.system !== legs[i].system ? CROSS_SYSTEM_MIN : TRANSFER_MIN), 0));
  return { minutes, transfers: legs.length - 1, legs: mergeForks(legs, routes) };
}

function legOf(routes, ri, a, b) {
  const r = routes[ri];
  const s = r.stations;
  const dir = b > a ? 1 : -1;
  const end = dir > 0 ? s[s.length - 1] : s[0];
  const next = s[a + dir];
  const stops = Math.abs(b - a);
  return {
    system: r.system, key: r.key, lineId: r.lineId, line: r.line, ...(r.lineEn && { lineEn: r.lineEn }), ...(r.color && { color: r.color }),
    from: s[a].name, ...(s[a].nameEn && { fromEn: s[a].nameEn }), fromId: s[a].id,
    to: s[b].name, ...(s[b].nameEn && { toEn: s[b].nameEn }), toId: s[b].id,
    stops, minutes: stops * (PER_STOP_MIN[r.system] ?? 2), dir,
    next: next.name, ...(next.nameEn && { nextEn: next.nameEn }),
    // 環狀線沒有「往哪」（終點都是籬仔內）：卡片改說下一站
    ...(r.loop ? { loop: true } : { toward: end.name, ...(end.nameEn && { towardEn: end.nameEn }) }),
  };
}

/**
 * 分岔線（中和新蘆線）：這一段兩條 route 都有（南勢角 → 古亭）時，往哪個方向都可以坐 →「往 迴龍／蘆洲」。
 */
function mergeForks(legs, routes) {
  return legs.map((l) => {
    if (l.loop) return l;
    const twins = routes.filter((r) => r.system === l.system && r.lineId === l.lineId && r.key !== l.key && !r.key.endsWith('-S') && !l.key.endsWith('-S'));
    const ends = [];
    for (const r of twins) {
      const a = r.stations.findIndex((s) => s.id === l.fromId), b = r.stations.findIndex((s) => s.id === l.toId);
      if (a < 0 || b < 0 || Math.sign(b - a) !== l.dir) continue;
      const e = l.dir > 0 ? r.stations[r.stations.length - 1] : r.stations[0];
      if (stationKey(e.name) !== stationKey(l.toward)) ends.push(e);
    }
    if (!ends.length) return l;
    return { ...l, toward: [l.toward, ...ends.map((e) => e.name)].join('／'), ...(l.towardEn && ends.every((e) => e.nameEn) && { towardEn: [l.towardEn, ...ends.map((e) => e.nameEn)].join(' / ') }) };
  });
}

/**
 * 看板上的這班車是不是往這一段的方向：同一條線有某條 route 同時有上車站、這段的下一站與這班車的終點，而且下一站在上車站與終點之間。
 * 環狀線（高雄輕軌，終點都是籬仔內）分不出來 → false（卡片不顯示下一班）。
 */
export function trainGoesWay(routes, leg, destination) {
  const r = routes.find((x) => x.key === leg.key);
  if (!r || r.loop) return false;
  const a = r.stations.findIndex((s) => s.id === leg.fromId);
  const next = r.stations[a + leg.dir];
  if (a < 0 || !next) return false;
  const dk = stationKey(String(destination || '').replace(/（.*）$/, ''));
  return routes.some((x) => {
    if (x.system !== r.system || x.lineId !== r.lineId) return false;
    const i = x.stations.findIndex((s) => s.id === leg.fromId), n = x.stations.findIndex((s) => s.id === next.id), d = x.stations.findIndex((s) => stationKey(s.name) === dk);
    return i >= 0 && n >= 0 && d >= 0 && d !== i && Math.sign(n - i) === Math.sign(d - i) && Math.abs(d - i) >= Math.abs(n - i);
  });
}

/**
 * 「往南港的板南線」：只留往那個方向的車（PM 第二輪）。toward 落在「這一站之後、到終點站為止」才算同方向；
 * 名稱可以只寫一部分（「南港」對到南港展覽館）。都對不到回 null（照原本全部列）。
 * @param {Array<{ lineId?: string, destination: string }>} trains 看板的車
 * @param {Array<{ lineId: string, stations: Array<{ name: string }> }>} lines svc.metro.lines() 的各線站序
 * @param {string} station 這一站的站名
 * @param {string} toward 使用者說的方向（站名）
 */
export function towardTrains(trains, lines, station, toward) {
  const tk = stationKey(toward);
  if (!tk) return null;
  const at = stationKey(station);
  const hit = (name) => { const k = stationKey(name); return k === tk || k.startsWith(tk) || tk.startsWith(k); };
  const out = trains.filter((t) => {
    if (hit(t.destination)) return true; // 終點站就是說的方向（往南港展覽館）
    const line = lines.find((l) => t.lineId && String(t.lineId).startsWith(l.lineId));
    if (!line) return false;
    const names = line.stations.map((s) => stationKey(s.name));
    const i = names.indexOf(at), d = names.findIndex((n) => n === stationKey(t.destination)), w = names.findIndex((n) => n === tk || n.startsWith(tk));
    if (i < 0 || d < 0 || w < 0 || w === i) return false;
    return Math.sign(w - i) === Math.sign(d - i) && Math.abs(w - i) <= Math.abs(d - i);
  });
  return out.length ? out : null;
}
