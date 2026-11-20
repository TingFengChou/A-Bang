// trip（plan_trip）：建議方案＋分段時間條＋備案（最多 2）＋狀態 chips＋理由句；行動：導航、叫車、訂票（CARDS.md §4、UX.md §6）
import { h } from '../dom.js';
import { token, modeSvg, modeOf } from '../mode-icons.js';

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

/** 「提醒我出門」：host 支援提醒、且 canRemind 才顯示。第一次要通知權限前先說明為什麼（T7）；設好後可以取消 */
function remindButton(o, { host, t, state, rerender, payload }) {
  if (!host?.remind || !canRemind(o.leaveAt, payload?.data?.date)) return null;
  const set = async () => {
    state.explain = null;
    const id = await host.remind(o.leaveAt, t('trip.remindText', { name: o.name, time: o.leaveAt })).catch(() => false);
    state.reminded = id ? { opt: o.id, id } : null; state.err = id ? null : t('trip.remindFailed'); rerender();
  };
  if (state.reminded?.opt === o.id) {
    return h('div', { class: 'ab-remind' },
      h('span', { class: 'ab-sub', role: 'status' }, t('trip.reminded', { time: o.leaveAt })),
      host.cancelRemind && typeof state.reminded.id === 'string' && h('button', { type: 'button', class: 'ab-btn ab-quiet', onclick: () => { host.cancelRemind(state.reminded.id); state.reminded = null; state.note = t('trip.remindCanceled'); rerender(); } }, t('trip.remindCancel')));
  }
  if (state.explain === o.id) { // 說明為什麼要通知，再跳系統對話框（拒絕過一次就很難再要）
    return h('div', { class: 'ab-remind ab-explain' },
      h('p', { class: 'ab-sub' }, t('trip.remindWhy', { time: o.leaveAt })),
      h('button', { type: 'button', class: 'ab-btn', onclick: set }, t('trip.remindAllow')),
      h('button', { type: 'button', class: 'ab-btn ab-quiet', onclick: () => { state.explain = null; rerender(); } }, t('trip.remindNotNow')));
  }
  return h('button', { type: 'button', class: 'ab-btn', onclick: async () => {
    const st = host.notifyState ? await host.notifyState().catch(() => 'prompt') : 'granted';
    if (st === 'prompt') { state.explain = o.id; state.note = null; rerender(); return; }
    if (st === 'denied' || st === 'unsupported') { state.err = t(st === 'denied' ? 'trip.remindDenied' : 'trip.remindFailed'); rerender(); return; }
    await set();
  } }, t('trip.remind', { time: o.leaveAt }));
}
import { navButton, confirmLinkButton, bookButton } from '../actions.js';

const MAX_ALT = 2;

/**
 * 每段在分段條上的位置（依真實分鐘比例）；太短的段至少佔 minShare，其餘依比例縮，總和 1。
 * @returns {Array<{ mode: string, minutes: number, from: number, to: number }>}
 */
export function legShares(legs, minShare = 0.06) {
  const total = legs.reduce((n, l) => n + Math.max(0, l.minutes || 0), 0);
  if (!legs.length) return [];
  let raw = legs.map((l) => (total ? Math.max(0, l.minutes || 0) / total : 1 / legs.length));
  const small = raw.map((r) => r < minShare);
  const fixed = small.filter(Boolean).length * minShare;
  const rest = raw.reduce((n, r, i) => n + (small[i] ? 0 : r), 0);
  if (fixed < 1 && rest > 0) raw = raw.map((r, i) => (small[i] ? minShare : (r / rest) * (1 - fixed)));
  let at = 0;
  return legs.map((l, i) => { const from = at; at = i === legs.length - 1 ? 1 : at + raw[i]; return { mode: l.mode, minutes: l.minutes, from: +from.toFixed(4), to: +at.toFixed(4) }; });
}

const RUN_SEC = 3.2;
/**
 * 分段條：每段寬度依真實分鐘比例，有交通方式圖示＋分鐘（夠寬才放字）。
 * 上方的小代幣沿路線跑一趟，每段的時間也依分鐘比例；到轉乘點換成下一段的交通方式（走路 → 公車 → 走路），轉乘點亮一下。
 */
function legsBar(o, t) {
  const icon = (mode) => { const i = document.createElement('span'); i.className = 'ab-leg-ic'; i.innerHTML = modeSvg(modeOf(mode) || 'walk'); return i; }; // 常數 SVG
  const sh = legShares(o.legs);
  const runners = sh.map((s, i) => {
    const r = token(s.mode === 'walk' ? 'walk' : (modeOf(s.mode) || o.role), { size: 'sm', cls: `ab-runner${i === sh.length - 1 ? ' last' : ''}` });
    r.style.setProperty('--from', String(s.from));
    r.style.setProperty('--to', String(s.to));
    r.style.setProperty('--d', `${(0.6 + s.from * RUN_SEC).toFixed(2)}s`);
    r.style.setProperty('--t', `${Math.max(0.25, (s.to - s.from) * RUN_SEC).toFixed(2)}s`);
    return r;
  });
  const xfers = sh.slice(1).map((s) => h('span', { class: 'ab-xfer', style: { '--at': String(s.from), '--d': `${(0.6 + s.from * RUN_SEC).toFixed(2)}s` } }));
  return h('div', { class: 'ab-legs-wrap' },
    runners,
    h('div', { class: 'ab-legs', role: 'img', 'aria-label': o.legs.map((l) => `${t(`trip.leg.${l.mode}`)} ${l.minutes} 分`).join('、') },
      o.legs.map((l, i) => h('span', { class: `ab-leg ${l.mode}`, style: { flex: `0 0 ${((sh[i].to - sh[i].from) * 100).toFixed(2)}%`, '--i': String(i) }, title: l.detail },
        sh[i].to - sh[i].from >= 0.08 && icon(l.mode), sh[i].to - sh[i].from >= 0.2 && h('b', null, `${l.minutes}`)))),
    xfers);
}

function optionBlock(o, ctx, best) {
  const { host, t } = ctx;
  const range = o.costRange || [o.cost, o.cost];
  const cost = o.share // 多人叫車：每人分攤（多輛車寫出車數）
    ? `${t('common.pricePerPerson', { low: range[0], high: range[1] })}${o.share.cars > 1 ? t('trip.cars', { n: o.share.cars }) : ''}`
    : o.costRange ? t('common.priceRange', { low: o.costRange[0], high: o.costRange[1] }) : t('common.price', { n: o.cost });
  const ride = o.role === 'ridehail' && o.legs[0]?.url;
  // 備案：「改成這個」＝跟阿幫說改成它（沿用起訖點重算；公車會自動盯到站）
  const pick = !best && host?.ask && h('button', { type: 'button', class: 'ab-btn ab-pick', onclick: () => host.ask(t('trip.pickAsk', { name: o.name })) }, t('trip.pickAsk', { name: o.name })); // 審查：要像按鈕、≥ 44px、寫出方案名
  return h('div', { class: best ? 'ab-option best' : 'ab-option' },
    h('div', { class: 'ab-row' },
      token(o.role, { size: best ? 'lg' : 'md', go: best, label: o.name }),
      best && h('span', { class: 'ab-badge ab-best' }, t('trip.best')),
      h('span', { class: 'ab-name' }, o.name),
      h('span', { class: 'ab-big' }, t('common.minutes', { n: o.minutes })),
      h('span', { class: 'ab-sub' }, t('trip.arrive', { time: o.arriveAt })),
      h('span', { class: 'ab-sub' }, cost, o.estimated ? `（${t('common.estimated')}）` : '')),
    best && legsBar(o, t),
    best && h('ul', { class: 'ab-legs-detail' }, o.legs.map((l) => h('li', {}, token(l.mode, { size: 'xs' }), l.detail))),
    // YouBike 兩端都要看：起點有車、終點有空位；很緊時警告並給備用站
    o.bike && h('div', { class: 'ab-bike-ends' },
      h('span', { class: `ab-chip${o.bike.rent.tight ? ' warn' : ' ok'}` }, t('trip.bikeRent', { name: o.bike.rent.name, n: o.bike.rent.count })),
      h('span', { class: `ab-chip${o.bike.ret.tight ? ' warn' : ' ok'}` }, t('trip.bikeReturn', { name: o.bike.ret.name, n: o.bike.ret.count }))),
    o.bike && (o.bike.rent.tight || o.bike.ret.tight) && h('ul', { class: 'ab-bike-warn' }, o.notes.filter((n) => /可能/.test(n) && !/變動/.test(n)).map((n) => h('li', {}, n))),
    best && h('div', { class: 'ab-actions' },
      navButton(host, o.legs[0]?.nav),
      remindButton(o, ctx),
      ride && confirmLinkButton(host, ride, t('trip.ridehailConfirm'), t('trip.ridehail')),
      o.train && bookButton(host, { system: o.role.toUpperCase(), trainNo: o.train.trainNo, date: o.train.date, from: o.train.from, to: o.train.to }, (m) => { ctx.state.err = m; ctx.rerender(); })),
    pick);
}

export default {
  title: (d, { t }) => t('trip.title', { from: d.from.name, to: d.to.name }),
  body(d, ctx) {
    const { t, state } = ctx;
    const byId = new Map(d.options.map((o) => [o.id, o]));
    const best = byId.get(d.best);
    const warnTips = (d.tips || []).filter((x) => x.kind !== 'cost'); // 時間很緊、帶傘：放在建議方案上面
    const costTips = (d.tips || []).filter((x) => x.kind === 'cost');
    const alts = d.ranking.ranked.filter((r) => r.id !== d.best).slice(0, MAX_ALT).map((r) => byId.get(r.id)).filter(Boolean);
    return h('div', { class: 'ab-body' },
      d.states?.length > 0 && h('div', { class: 'ab-chips', 'aria-label': t('trip.states') }, d.states.map((s) => h('span', { class: 'ab-chip', title: s.detail || '' },
        `${t(`trip.stateKey.${s.key}`)}・${t(`trip.state.${s.source}`)}`))),
      state.err && h('p', { class: 'ab-fail', role: 'alert' }, state.err),
      state.note && h('p', { class: 'ab-sub', role: 'status' }, state.note),
      warnTips.length > 0 && h('ul', { class: 'ab-tips warn', 'aria-label': t('trip.tips') }, warnTips.map((x) => h('li', {}, x.text))),
      best ? optionBlock(best, ctx, true) : h('p', { class: 'ab-empty' }, t(!d.ranking.excluded.length ? 'trip.none' : d.ranking.excluded.every((e) => !String(e.why).includes('超過')) ? 'trip.allAvoided' : 'trip.allLate')),
      d.ranking.reason && h('p', { class: 'ab-reason' }, d.ranking.reason),
      costTips.length > 0 && h('ul', { class: 'ab-tips', 'aria-label': t('trip.costTips') }, costTips.map((x) => h('li', {}, x.text))),
      alts.length > 0 && h('div', { class: 'ab-alts' }, h('h4', {}, t('trip.alternatives')), alts.map((o) => optionBlock(o, ctx, false))),
      d.skipped?.length > 0 && h('ul', { class: 'ab-skipped' }, d.skipped.map((s) => h('li', {}, token(s.role, { size: 'xs' }), t('trip.skipped', { name: { bike: 'YouBike', bus: '公車', metro: '捷運', walk: '步行', ridehail: '叫車' }[s.role] || s.role, why: s.why })))),
      d.ranking.excluded.length > 0 && h('div', { class: 'ab-excluded' }, h('h4', {}, t('trip.excluded')),
        h('ul', { class: 'ab-list' }, d.ranking.excluded.map((e) => h('li', { class: 'ab-row off' }, token(byId.get(e.id)?.role || e.id, { size: 'sm', cls: 'off' }), h('span', { class: 'ab-name' }, e.name || e.id), h('span', { class: 'ab-sub' }, e.why))))));
  },
};
