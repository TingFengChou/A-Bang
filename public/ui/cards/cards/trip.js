// trip（plan_trip）：建議方案＋分段時間條＋備案（最多 2）＋狀態 chips＋理由句；行動：導航、叫車、訂票（CARDS.md §4、UX.md §6）
import { h } from '../dom.js';

/**
 * 可以設定「提醒我出門」嗎：行程是今天、出門時間在 1 分鐘後。
 * leaveAt 與 date 都是台灣時間（伺服器算的），所以一律以台灣時間比較，不看裝置時區。
 * @param {string} leaveAt 'HH:mm'
 * @param {string|undefined} date 'YYYY-MM-DD'（沒有視為今天）
 * @param {number} [now]
 */
export function canRemind(leaveAt, date, now = Date.now()) {
  if (!/^\d{2}:\d{2}$/.test(leaveAt || '')) return false;
  const tw = new Date(now + 8 * 3600e3);
  if (date && date !== tw.toISOString().slice(0, 10)) return false;
  const [hh, mm] = leaveAt.split(':').map(Number);
  return hh * 60 + mm > tw.getUTCHours() * 60 + tw.getUTCMinutes() + 1;
}

/** 「提醒我出門」：host 支援提醒、且 canRemind 才顯示 */
function remindButton(o, { host, t, state, rerender, payload }) {
  if (!host?.remind || !canRemind(o.leaveAt, payload?.data?.date)) return null;
  if (state.reminded === o.id) return h('span', { class: 'ab-sub', role: 'status' }, t('trip.reminded', { time: o.leaveAt }));
  return h('button', { type: 'button', class: 'ab-btn', onclick: async () => {
    const ok = await host.remind(o.leaveAt, t('trip.remindText', { name: o.name, time: o.leaveAt })).catch(() => false);
    state.reminded = ok ? o.id : null; state.err = ok ? null : t('trip.remindFailed'); rerender();
  } }, t('trip.remind', { time: o.leaveAt }));
}
import { navButton, confirmLinkButton, bookButton } from '../actions.js';

const MAX_ALT = 2;

function legsBar(o, t) {
  const total = o.legs.reduce((n, l) => n + l.minutes, 0) || 1;
  return h('div', { class: 'ab-legs', role: 'img', 'aria-label': o.legs.map((l) => `${t(`trip.leg.${l.mode}`)} ${l.minutes} 分`).join('、') },
    o.legs.map((l) => h('span', { class: `ab-leg ${l.mode}`, style: { flexGrow: String(Math.max(1, l.minutes)), flexBasis: `${(l.minutes / total) * 100}%` }, title: l.detail },
      l.minutes >= 4 ? `${t(`trip.leg.${l.mode}`)} ${l.minutes}` : '')));
}

function optionBlock(o, ctx, best) {
  const { host, t } = ctx;
  const cost = o.costRange ? t('common.priceRange', { low: o.costRange[0], high: o.costRange[1] }) : t('common.price', { n: o.cost });
  const ride = o.role === 'ridehail' && o.legs[0]?.url;
  return h('div', { class: best ? 'ab-option best' : 'ab-option' },
    h('div', { class: 'ab-row' },
      best && h('span', { class: 'ab-badge ab-best' }, t('trip.best')),
      h('span', { class: 'ab-name' }, o.name),
      h('span', { class: 'ab-big' }, t('common.minutes', { n: o.minutes })),
      h('span', { class: 'ab-sub' }, t('trip.arrive', { time: o.arriveAt })),
      h('span', { class: 'ab-sub' }, cost, o.estimated ? `（${t('common.estimated')}）` : '')),
    best && legsBar(o, t),
    best && h('ul', { class: 'ab-legs-detail' }, o.legs.map((l) => h('li', {}, l.detail))),
    best && h('div', { class: 'ab-actions' },
      navButton(host, o.legs[0]?.nav),
      remindButton(o, ctx),
      ride && confirmLinkButton(host, ride, t('trip.ridehailConfirm'), t('trip.ridehail')),
      o.train && bookButton(host, { system: o.role.toUpperCase(), trainNo: o.train.trainNo, date: o.train.date, from: o.train.from, to: o.train.to }, (m) => { ctx.state.err = m; ctx.rerender(); })));
}

export default {
  title: (d, { t }) => t('trip.title', { from: d.from.name, to: d.to.name }),
  body(d, ctx) {
    const { t, state } = ctx;
    const byId = new Map(d.options.map((o) => [o.id, o]));
    const best = byId.get(d.best);
    const alts = d.ranking.ranked.filter((r) => r.id !== d.best).slice(0, MAX_ALT).map((r) => byId.get(r.id)).filter(Boolean);
    return h('div', { class: 'ab-body' },
      d.states?.length > 0 && h('div', { class: 'ab-chips', 'aria-label': t('trip.states') }, d.states.map((s) => h('span', { class: 'ab-chip', title: s.detail || '' },
        `${t(`trip.stateKey.${s.key}`)}・${t(`trip.state.${s.source}`)}`))),
      state.err && h('p', { class: 'ab-fail', role: 'alert' }, state.err),
      best ? optionBlock(best, ctx, true) : h('p', { class: 'ab-empty' }, t(d.ranking.excluded.length ? 'trip.allLate' : 'trip.none')),
      d.ranking.reason && h('p', { class: 'ab-reason' }, d.ranking.reason),
      alts.length > 0 && h('div', { class: 'ab-alts' }, h('h4', {}, t('trip.alternatives')), alts.map((o) => optionBlock(o, ctx, false))),
      d.ranking.excluded.length > 0 && h('div', { class: 'ab-excluded' }, h('h4', {}, t('trip.excluded')),
        h('ul', { class: 'ab-list' }, d.ranking.excluded.map((e) => h('li', { class: 'ab-row off' }, h('span', { class: 'ab-name' }, e.name || e.id), h('span', { class: 'ab-sub' }, e.why))))));
  },
};
