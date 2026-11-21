// bus-route（bus_route_eta）：方向切換、站序時間軸、即將到站高亮、點站牌 → 導航／提問（CARDS.md §4）
// 有 focus（選公車後盯的上車站，L-14）：上方大倒數、標「你在這上車」、到站前 3／5 分提醒、開公車頁看動態
import { etaLabel } from '../countdown.js';
import { h } from '../dom.js';
import { navButton } from '../actions.js';
import { token } from '../mode-icons.js';

const SOON_SEC = 180;

/** 上車站大倒數＋提醒（同一路線同一站已在提醒就顯示「已設定」） */
/**
 * 公車離上車站還有幾站：從上車站往前數，到站時間比上車站早的連續站（車會先經過這些站），全部來自真實站序與到站時間。
 * @returns {{ away: number, window: Array<{ name: string, seq: number }>, busAt: number } | null} busAt＝公車在 window 裡的位置（0…window.length-1）
 */
export function railOf(dir, f) {
  if (!dir || f.status !== 0 || f.etaSec == null) return null;
  const i = dir.stops.findIndex((s) => s.seq === f.seq);
  if (i < 0) return null;
  let away = 0;
  for (let k = i - 1; k >= 0; k--) {
    const s = dir.stops[k];
    if (s.status === 0 && s.etaSec != null && s.etaSec < f.etaSec) away++;
    else break;
  }
  const from = Math.max(0, i - Math.max(away, 1) - 1);
  const window = dir.stops.slice(from, i + 1).map((s) => ({ name: s.stopName, seq: s.seq }));
  // 車在最遠那個「比較早到」的站之前半站；那站已是視窗第一站時就停在第一站（不跑出軌道）
  const idx = Math.max(0, window.length - 1 - away);
  return { away, window, busAt: away > 0 && idx > 0 ? idx - 0.5 : idx };
}

function focusBlock(d, f, { host, t, rerender, state, locale }) {
  const w = host?.arrivalWatch?.();
  const watching = w && w.routeName === d.routeName && w.stop === f.stopName;
  const live = f.status === 0 && f.etaSec != null;
  const dir = (d.directions || []).find((x, i) => (x.direction ?? i) === f.direction);
  const rail = railOf(dir, f);
  // 進度環：以開始盯的到站時間為分母（重畫時保留在 state），越接近越滿
  if (live) state.firstEta = Math.max(state.firstEta || 0, f.etaSec);
  const progress = live && state.firstEta ? Math.min(1, Math.max(0, 1 - f.etaSec / state.firstEta)) : 0;
  const near = live && f.etaSec <= Math.max(180, (watching ? w.minutes : 0) * 60);
  const ring = h('span', { class: `ab-ring${near ? ' near' : ''}`, style: { '--p': progress.toFixed(3) } }, token('bus', { size: 'lg', go: live }));
  return h('div', { class: `ab-focus${near ? ' near' : ''}` },
    h('div', { class: 'ab-focus-row' },
      ring,
      h('span', { class: 'ab-sub' }, t('busRoute.focusAt', { stop: f.stopName })),
      h('strong', { class: 'ab-focus-eta', ...(live && { 'data-eta-sec': f.etaSec }) }, etaText(f, t, locale))),
    watching && w.stuck && h('div', { class: 'ab-stuck' }, // 外殼的 toast 已念過一次：這裡不加 live role（每 20 秒重畫不重念）
      h('p', {}, t(`busRoute.stuck.${w.stuck}`, { route: d.routeName })),
      host?.ask && h('button', { type: 'button', class: 'ab-btn ab-primary', onclick: () => host.ask(w.trip?.to ? t('busRoute.stuckAskTo', { to: w.trip.to }) : t('busRoute.stuckAsk')) }, t('busRoute.stuckBtn'))),
    watching
      ? h('p', { class: 'ab-sub ab-alert-on', role: 'status' }, t(w.skip ? 'busRoute.alertNext' : 'busRoute.alertSet', { n: w.minutes, when: t(`busRoute.${host?.arrivalNote?.() || 'whenOpenPage'}`) }),
        h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { host.unwatchArrival?.(); state.alertMsg = t('busRoute.alertCanceled'); rerender(); } }, t('busRoute.alertCancel')))
      : live && host?.watchArrival && h('div', { class: 'ab-actions' }, state.alertMsg && h('p', { class: 'ab-sub', role: 'status' }, state.alertMsg), [3, 5].map((n) => h('button', { type: 'button', class: 'ab-btn', onclick: async () => {
        state.alertMsg = null;
        await host.watchArrival({ city: d.city, routeName: d.routeName, stop: f.stopName, direction: f.direction, minutes: n, ...(locale === 'en' && { lang: 'en' }) }); // 英文卡片：通知也用英文
        rerender();
      } }, t('busRoute.alertBtn', { n })))),
    rail && railView(rail, t, state),
    host?.navigate && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => host.navigate(`#/bus/${encodeURIComponent(d.city)}/${encodeURIComponent(d.routeName)}?stop=${encodeURIComponent(f.stopName)}&dir=${f.direction}${locale === 'en' ? '&lang=en' : ''}`) }, t('busRoute.openPage')));
}

/** 車→我 進度軌：幾站外、站點、公車代幣（刷新時從上次的位置滑到新位置；位置只依真實站序，不在兩次刷新之間推估） */
/** 車牌當鍵：刷新時同一台車從舊位置滑到新位置（slide.js） */
const plated = (el, plate) => { el.dataset.plate = plate; return el; };

function railView(rail, t, state) {
  const n = rail.window.length;
  const pct = (x) => (n <= 1 ? 100 : (x / (n - 1)) * 100);
  const to = pct(rail.busAt);
  const from = state.railPct ?? to;
  state.railPct = to;
  const bus = token('bus', { size: 'sm', cls: 'ab-rail-bus' });
  bus.style.left = `${from}%`;
  if (from !== to) requestAnimationFrame(() => requestAnimationFrame(() => { bus.style.left = `${to}%`; }));
  return h('div', { class: 'ab-rail', role: 'img', 'aria-label': t('busRoute.away', { n: rail.away }) },
    h('div', { class: 'ab-rail-head' }, h('strong', null, rail.away ? t('busRoute.away', { n: rail.away }) : t('busRoute.atStop'))),
    h('div', { class: 'ab-rail-track' },
      h('span', { class: 'ab-rail-fill', style: { width: `${to}%` } }),
      rail.window.map((s, i) => h('span', { class: `ab-rail-dot${i === n - 1 ? ' me' : ''}`, style: { left: `${pct(i)}%` }, title: s.name })),
      bus),
    h('div', { class: 'ab-rail-labels' }, h('span', null, rail.window[0].name), h('span', null, rail.window.at(-1).name)));
}

/** 到站文字：中文用資料的 statusText；英文依狀態與秒數自己說（S12f） */
export const etaText = (s, t, locale) => {
  if (locale !== 'en' || !s) return s?.statusText;
  if (s.status === 0 && s.etaSec != null) return etaLabel(s.etaSec); // 跟每秒倒數同一套規則（不會一秒後換字）
  const k = `busRoute.st.${s.status}`;
  return t(k) === k ? s.statusText : t(k);
};
/** 方向：英文把「往 X」換成「To X」（站名維持中文） */
const dirLabel = (label, locale) => (locale === 'en' ? String(label || '').replace(/^往\s*/, 'To ') : label);

export default {
  refreshSec: 20,
  title: (d, { t }) => t('busRoute.title', { route: d.routeName }),
  /** 播報：使用者點開的站優先；否則目前方向即將進站的站（最多 3 個） */
  announce(d, { t, state, locale }) {
    const dir = (d.directions || [])[Math.min(state.dir ?? 0, Math.max(0, (d.directions || []).length - 1))];
    if (!dir) return null;
    const open = dir.stops.find((s) => s.seq === state.stop);
    if (open) return t('busRoute.announceStop', { route: d.routeName, stop: open.stopName, eta: etaText(open, t, locale) });
    const soon = dir.stops.filter((s) => s.etaSec != null && s.etaSec < SOON_SEC).slice(0, 3).map((s) => s.stopName);
    return soon.length ? t('busRoute.announceSoon', { route: d.routeName, stops: soon.join('、') }) : null;
  },
  body(d, { host, t, state, rerender, locale }) {
    const dirs = d.directions || [];
    const f = d.focus;
    if (f && state.dir == null) state.dir = Math.max(0, dirs.findIndex((x, i) => (x.direction ?? i) === f.direction));
    const di = Math.min(state.dir ?? 0, Math.max(0, dirs.length - 1));
    const dir = dirs[di];
    const tabs = dirs.length > 1 && h('div', { class: 'ab-tabs', role: 'tablist', 'aria-label': t('busRoute.switchDir') },
      dirs.map((x, i) => h('button', { type: 'button', role: 'tab', class: i === di ? 'ab-tab on' : 'ab-tab', 'aria-selected': i === di ? 'true' : 'false',
        onclick: () => { state.dir = i; state.stop = null; rerender(); } }, dirLabel(x.label, locale))));
    if (!dir) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('common.empty')));
    const list = h('ol', { class: 'ab-timeline' }, dir.stops.map((s) => {
      const soon = s.etaSec != null && s.etaSec < SOON_SEC;
      const open = state.stop === s.seq;
      const me = f && (dir.direction ?? di) === f.direction && s.seq === f.seq;
      return h('li', { class: `ab-stop${soon ? ' soon' : ''}${open ? ' open' : ''}${me ? ' me' : ''}` },
        h('button', { type: 'button', class: 'ab-stop-row', 'aria-expanded': open ? 'true' : 'false', onclick: () => {
          state.stop = open ? null : s.seq;
          if (!open) host?.setContext?.(t('busRoute.context', { route: d.routeName, stop: s.stopName }));
          rerender();
        } },
        s.plate ? plated(token('bus', { size: 'sm', go: true, label: t('busRoute.busHere') }), s.plate) : h('span', { class: 'ab-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'ab-name' }, s.stopName, me && h('span', { class: 'ab-me' }, t('busRoute.boardHere'))),
        h('span', { class: soon ? 'ab-eta soon' : 'ab-eta', ...(s.status === 0 && s.etaSec != null && { 'data-eta-sec': s.etaSec }) }, etaText(s, t, locale)),
        s.plate && h('span', { class: 'ab-bus', title: t('busRoute.busHere') }, t('busRoute.plate', { plate: s.plate }))),
        open && h('div', { class: 'ab-actions' },
          navButton(host, s.nav),
          host?.ask && h('button', { type: 'button', class: 'ab-btn', onclick: () => host.ask(t('busRoute.ask', { route: d.routeName, stop: s.stopName })) }, t('common.more'))));
    }));
    return h('div', { class: 'ab-body' }, f && focusBlock(d, f, { host, t, rerender, state, locale }), tabs, list);
  },
};
