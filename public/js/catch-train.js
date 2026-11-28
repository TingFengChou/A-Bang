// 趕不趕得上那班車（C，2026-11-28 Claude 與 Antigravity 第九輪）：行程卡設了出門提醒、方案是台鐵／高鐵或末班車時，
// 提醒響後（App 開著，或響後 10 分鐘內打開 App）阿幫問一次「要我用一次位置幫你看還趕不趕得上 10:35 的高鐵嗎？」。
// 按〔用一次位置幫我看〕才定位一次（不追蹤）→ 到車站要多久 → 來得及／很趕／趕不上（下一班；末班給叫車預估）。〔已出門／不用〕就不再問。
// 只存在這支手機：哪一班、哪一站（不存位置）；同一個提醒只問一次。
import { shouldAsk, askText, verdictOf, resultText, noLocationText, nextTrain } from '../../core/catch-train.js';
import { abangSays } from './abang-dock.js';
import { browserLocation, inTaiwan } from './agent/client.js';
import { createWebHost } from '../ui/cards/host-web.js';

export const RAIL_CHECK_KEY = 'abang.railCheck';
const ASK_WINDOW_MS = 10 * 60e3; // 提醒響後 10 分鐘內打開 App 才問（太久就沒意義了）
const MAX = 5;

const load = () => { try { const a = JSON.parse(localStorage.getItem(RAIL_CHECK_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const save = (a) => { try { localStorage.setItem(RAIL_CHECK_KEY, JSON.stringify(a.slice(-MAX))); } catch { /* 無痕模式 */ } };

/** 設了出門提醒（reminders.js）：台鐵、高鐵、末班車才記下要問（Antigravity：一般班次不打擾） */
export function watchRail(id, at, rail) {
  if (!id || !shouldAsk(rail)) return;
  save([...load().filter((x) => x.id !== id && x.at + ASK_WINDOW_MS > Date.now()), { id, at, rail }]);
}
/** 取消提醒：也不問了 */
export function unwatchRail(id) { save(load().filter((x) => x.id !== id)); }
export function clearRailChecks() { try { localStorage.removeItem(RAIL_CHECK_KEY); } catch { /* 無痕模式 */ } }

/** 該問的那一班（響過、10 分鐘內、還沒問）；過期的順手清掉 */
export function dueRail(now = Date.now()) {
  const all = load();
  const live = all.filter((x) => x.at + ASK_WINDOW_MS > now);
  if (live.length !== all.length) save(live);
  return live.find((x) => x.at <= now) || null;
}
/** 真的問出去了才記成問過（App 剛啟動、浮動阿幫還沒好時不算，下一次再問） */
export const markAsked = (id) => unwatchRail(id);

const twMin = (now) => { const d = new Date(now + 8 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/** 按了〔用一次位置幫我看〕：定位一次 → 到站時間 → 結果；趕不上查下一班，末班給叫車預估 */
export async function runCheck(rail, { host = createWebHost(), locate = () => browserLocation(8000, { fresh: true }), now = Date.now(), say = (t) => abangSays(t) } = {}) {
  const lang = rail.lang === 'en' ? 'en' : null;
  const pos = await locate().catch(() => null);
  if (!pos || !inTaiwan(pos)) { say(noLocationText(lang)); return 'noLocation'; }
  const me = { lat: pos.lat, lon: pos.lon, name: lang === 'en' ? 'your location' : '您的位置' };
  const st = rail.st && { name: rail.from, lat: rail.st.lat, lon: rail.st.lon };
  const trip = st ? await host.callTool('plan_trip', { from: me, to: st }).catch(() => null) : null;
  const best = trip?.data?.options?.find((o) => o.id === trip.data.best);
  if (!best) { say(lang === 'en' ? "I couldn't work out how long it takes to the station this time." : '這次算不出到車站要多久；保險一點，早點出門。'); return 'failed'; }
  const nowMin = twMin(now);
  const v = verdictOf(rail, nowMin, best.minutes);
  let next = null, taxi = null;
  if (v.kind === 'miss') {
    const tt = await host.callTool(rail.role === 'thsr' ? 'thsr_timetable' : 'tra_timetable', { from: rail.from, to: rail.to, ...(rail.date && { date: rail.date }) }).catch(() => null);
    next = nextTrain(tt?.data?.trains, nowMin, best.minutes, rail.role);
    if (!next && rail.dest) { // 末班過了：叫車預估（行程規劃同一套估法，標「預估」）
      const all = await host.callTool('plan_trip', { from: me, to: rail.dest }).catch(() => null);
      const ride = all?.data?.options?.find((o) => o.role === 'ridehail');
      const m = /(\d+)～(\d+) 元/.exec((ride?.notes || []).join(' '));
      if (m) taxi = { low: Number(m[1]), high: Number(m[2]) };
    }
  }
  say(resultText(rail, v, { toStationMin: best.minutes, next, taxi, lang }));
  return v.kind;
}

/** 提醒響後問一次（App 開著時每 30 秒看一次；從背景回來、點通知打開時也看） */
export function mountCatchTrain() {
  addEventListener('abang:reminder-rail', (e) => watchRail(e.detail.id, e.detail.at, e.detail.rail));
  addEventListener('abang:reminder-cancel', (e) => { if (e.detail?.all) clearRailChecks(); else unwatchRail(e.detail?.id); });
  const check = () => {
    const due = dueRail();
    if (!due) return;
    const en = due.rail.lang === 'en';
    const shown = abangSays(askText(due.rail, en ? 'en' : null), { label: en ? 'Check with my location once' : '用一次位置幫我看', run: () => runCheck(due.rail), closeLabel: en ? 'Already left / no thanks' : '已出門／不用' });
    if (shown) markAsked(due.id);
  };
  setInterval(check, 30e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setTimeout(check, 1500); // 等浮動阿幫掛好再看（App 剛啟動、點通知打開時）
}
