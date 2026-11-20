// bus-route（bus_route_eta）：方向切換、站序時間軸、即將到站高亮、點站牌 → 導航／提問（CARDS.md §4）
// 有 focus（選公車後盯的上車站，L-14）：上方大倒數、標「你在這上車」、到站前 3／5 分提醒、開公車頁看動態
import { h } from '../dom.js';
import { navButton } from '../actions.js';

const SOON_SEC = 180;

/** 上車站大倒數＋提醒（同一路線同一站已在提醒就顯示「已設定」） */
function focusBlock(d, f, { host, t, rerender }) {
  const w = host?.arrivalWatch?.();
  const watching = w && w.routeName === d.routeName && w.stop === f.stopName;
  const live = f.status === 0 && f.etaSec != null;
  return h('div', { class: 'ab-focus' },
    h('div', { class: 'ab-focus-row' },
      h('span', { class: 'ab-sub' }, t('busRoute.focusAt', { stop: f.stopName })),
      h('strong', { class: 'ab-focus-eta', ...(live && { 'data-eta-sec': f.etaSec }) }, f.statusText)),
    watching
      ? h('p', { class: 'ab-sub ab-alert-on', role: 'status' }, t(w.skip ? 'busRoute.alertNext' : 'busRoute.alertSet', { n: w.minutes }),
        h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { host.unwatchArrival?.(); rerender(); } }, t('busRoute.alertCancel')))
      : live && host?.watchArrival && h('div', { class: 'ab-actions' }, [3, 5].map((n) => h('button', { type: 'button', class: 'ab-btn', onclick: async () => {
        await host.watchArrival({ city: d.city, routeName: d.routeName, stop: f.stopName, direction: f.direction, minutes: n });
        rerender();
      } }, t('busRoute.alertBtn', { n })))),
    host?.navigate && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => host.navigate(`#/bus/${encodeURIComponent(d.city)}/${encodeURIComponent(d.routeName)}?stop=${encodeURIComponent(f.stopName)}&dir=${f.direction}`) }, t('busRoute.openPage')));
}

export default {
  refreshSec: 20,
  title: (d, { t }) => t('busRoute.title', { route: d.routeName }),
  /** 播報：使用者點開的站優先；否則目前方向即將進站的站（最多 3 個） */
  announce(d, { t, state }) {
    const dir = (d.directions || [])[Math.min(state.dir ?? 0, Math.max(0, (d.directions || []).length - 1))];
    if (!dir) return null;
    const open = dir.stops.find((s) => s.seq === state.stop);
    if (open) return t('busRoute.announceStop', { route: d.routeName, stop: open.stopName, eta: open.statusText });
    const soon = dir.stops.filter((s) => s.etaSec != null && s.etaSec < SOON_SEC).slice(0, 3).map((s) => s.stopName);
    return soon.length ? t('busRoute.announceSoon', { route: d.routeName, stops: soon.join('、') }) : null;
  },
  body(d, { host, t, state, rerender }) {
    const dirs = d.directions || [];
    const f = d.focus;
    if (f && state.dir == null) state.dir = Math.max(0, dirs.findIndex((x, i) => (x.direction ?? i) === f.direction));
    const di = Math.min(state.dir ?? 0, Math.max(0, dirs.length - 1));
    const dir = dirs[di];
    const tabs = dirs.length > 1 && h('div', { class: 'ab-tabs', role: 'tablist', 'aria-label': t('busRoute.switchDir') },
      dirs.map((x, i) => h('button', { type: 'button', role: 'tab', class: i === di ? 'ab-tab on' : 'ab-tab', 'aria-selected': i === di ? 'true' : 'false',
        onclick: () => { state.dir = i; state.stop = null; rerender(); } }, x.label)));
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
        h('span', { class: 'ab-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'ab-name' }, s.stopName, me && h('span', { class: 'ab-me' }, t('busRoute.boardHere'))),
        h('span', { class: soon ? 'ab-eta soon' : 'ab-eta', ...(s.status === 0 && s.etaSec != null && { 'data-eta-sec': s.etaSec }) }, s.statusText),
        s.plate && h('span', { class: 'ab-bus', title: t('busRoute.busHere') }, t('busRoute.plate', { plate: s.plate }))),
        open && h('div', { class: 'ab-actions' },
          navButton(host, s.nav),
          host?.ask && h('button', { type: 'button', class: 'ab-btn', onclick: () => host.ask(t('busRoute.ask', { route: d.routeName, stop: s.stopName })) }, t('common.more'))));
    }));
    return h('div', { class: 'ab-body' }, f && focusBlock(d, f, { host, t, rerender }), tabs, list);
  },
};
