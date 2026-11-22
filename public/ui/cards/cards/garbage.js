// garbage（garbage_truck_nearby）：附近清運點（時間、今天有沒有收、距離）、新北市車輛即時位置
import { h, hhmm } from '../dom.js';
import { navButton } from '../actions.js';

/** 今天這個時間還有幾分鐘（台灣時間）；格式不對回 null，已經過了回負數 */
export const minutesUntil = (hm, now = Date.now()) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || ''));
  if (!m) return null;
  const tw = new Date(now + 8 * 3600e3);
  return Number(m[1]) * 60 + Number(m[2]) - (tw.getUTCHours() * 60 + tw.getUTCMinutes());
};
/**
 * 清運時間的狀態：時段（「19:30–19:40」）用開始判斷倒數、用結束判斷已過。
 * @returns {{ kind: 'soon'|'now'|'passed'|null, n?: number }}
 */
export function truckWhen(time, now = Date.now()) {
  const start = minutesUntil(time, now);
  if (start == null) return { kind: null };
  const endText = /[–~-]\s*(\d{1,2}:\d{2})/.exec(String(time))?.[1];
  const end = endText ? minutesUntil(endText, now) : start;
  if (end < -10) return { kind: 'passed' };
  if (start <= 0) return { kind: 'now' };
  return start <= 120 ? { kind: 'soon', n: start } : { kind: null };
}

/** 提前幾分提醒倒垃圾 */
export const GARBAGE_LEAD_MIN = 10;
/** 「提醒我」的時間（HH:mm，台灣時間）：清運開始前 10 分；已經不到 10 分、過了、不是今天回 null */
export function garbageRemindAt(s, now = Date.now()) {
  if (!s?.collectToday) return null;
  const start = minutesUntil(s.time, now);
  if (start == null || start <= GARBAGE_LEAD_MIN + 1) return null;
  const tw = new Date(now + 8 * 3600e3);
  const at = tw.getUTCHours() * 60 + tw.getUTCMinutes() + start - GARBAGE_LEAD_MIN;
  return at >= 24 * 60 ? null : `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`;
}

/** 提醒我倒垃圾（產品負責人 2026-11-22「查過垃圾車，也可以問需不需要設定提醒」）：今天還沒到的清運點，前 10 分通知 */
function remindButton(s, { host, t, state, rerender, locale }) {
  const at = garbageRemindAt(s);
  if (!at || !host?.remind || host.canNotify === false) return null;
  const key = `garbage|${s.place}|${s.time}`;
  const cur = host.reminderFor ? host.reminderFor(key) : state.reminded?.[key];
  if (cur) return h('span', { class: 'ab-chip ok' }, t('garbage.reminded', { time: at }));
  return h('button', { class: 'ab-btn', type: 'button', onclick: async (e) => {
    e.stopPropagation();
    const id = await host.remind(at, t('garbage.remindText', { time: String(s.time).slice(0, 5), place: s.place }), { key, ...(locale === 'en' && { lang: 'en' }) }).catch(() => false);
    state.reminded = { ...(state.reminded || {}), [key]: id || null };
    state.remindErr = id ? null : t('garbage.remindFailed');
    rerender?.();
  } }, t('garbage.remind', { n: GARBAGE_LEAD_MIN }));
}

export default {
  refreshSec: 120, // 倒數跟著更新
  title: (_d, { t }) => t('garbage.title'),
  announce: (d) => { const s = d.stops.find((x) => x.truck); return s ? `${s.route}：${s.truck.location}` : null; },
  body(d, { host, t, state = {}, rerender, locale }) {
    if (!d.stops.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('garbage.empty', { covered: d.covered.join('、') })));
    return h('div', { class: 'ab-body' },
      h('ul', { class: 'ab-list' }, d.stops.map((s) => { const w = s.collectToday ? truckWhen(s.time) : { kind: null }; return h('li', { class: s.collectToday && w.kind !== 'passed' ? 'ab-gb' : 'ab-gb off' },
        h('div', { class: 'ab-row' },
          h('strong', { class: 'ab-time' }, s.time ?? '—'),
          w.kind === 'soon' && h('span', { class: 'ab-chip ok' }, t('garbage.in', { n: w.n })),
          w.kind === 'now' && h('span', { class: 'ab-chip ok' }, t('garbage.now')),
          w.kind === 'passed' && h('span', { class: 'ab-chip' }, t('garbage.passed')),
          h('span', { class: 'ab-name' }, s.place),
          h('span', { class: 'ab-sub' }, t('common.meters', { n: s.distanceM }))),
        h('p', { class: 'ab-sub' }, `${s.route}・`, s.collectToday ? t('garbage.today') : t('garbage.notToday'), s.days ? `（${s.days}）` : ''),
        s.truck && h('p', { class: 'ab-truck' }, t('garbage.truck', { car: s.truck.car, where: s.truck.location, time: hhmm(s.truck.at.replace(' ', 'T') + '+08:00') })),
        h('div', { class: 'ab-actions' }, navButton(host, s.nav), remindButton(s, { host, t, state, rerender, locale }))); })),
      state.remindErr && h('p', { class: 'ab-sub', role: 'status' }, state.remindErr),
      h('p', { class: 'ab-foot' }, t('garbage.note', { covered: d.covered.join('、') })));
  },
};
