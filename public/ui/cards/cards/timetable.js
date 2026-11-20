// timetable（thsr_timetable、tra_timetable、intercity_bus）：車次、出發、抵達、行車時間；塞車延誤、隔日、排除；訂票（L2）
import { h } from '../dom.js';
import { bookButton } from '../actions.js';

const MAX_ROWS = 8;
const RAIL = ['THSR', 'TRA'];
const toMin = (hhmm) => { const [h0, m] = String(hhmm).split(':').map(Number); return h0 * 60 + m; };

/** 高鐵／台鐵查今天時，預設只顯示還沒開出的班次（「下一班」在最上面）；gone＝已開出幾班 */
export function visibleTrains(d, showGone = false, now = Date.now()) {
  const tw = new Date(now + 8 * 3600e3).toISOString();
  if (showGone || !RAIL.includes(d.system) || d.date !== tw.slice(0, 10)) return { list: d.trains, gone: 0 };
  const cur = toMin(tw.slice(11, 16));
  const list = d.trains.filter((x) => toMin(x.depart) >= cur);
  return { list, gone: d.trains.length - list.length };
}

export default {
  title: (d, { t }) => t(`timetable.title.${d.system}`, { from: d.from, to: d.to }),
  body(d, { host, t, state, rerender }) {
    if (!d.trains?.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('timetable.empty', { date: d.date })));
    const { list, gone } = visibleTrains(d, state.showGone);
    const rows = state.all ? list : list.slice(0, MAX_ROWS);
    const onError = (msg) => { state.err = msg; rerender(); };
    const goneBtn = gone > 0 && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { state.showGone = true; rerender(); } }, t('timetable.showGone', { n: gone }));
    return h('div', { class: 'ab-body' },
      state.err && h('p', { class: 'ab-fail', role: 'alert' }, state.err),
      !list.length && h('p', { class: 'ab-empty' }, t('timetable.allGone')),
      goneBtn,
      h('ul', { class: 'ab-list' }, rows.map((x) => h('li', { class: x.excluded ? 'ab-train off' : 'ab-train' },
        h('div', { class: 'ab-row' },
          h('span', { class: 'ab-route' }, x.trainNo),
          x.type && h('span', { class: 'ab-sub' }, x.type),
          x.nextDay && h('span', { class: 'ab-badge' }, t('timetable.nextDay')),
          h('span', { class: 'ab-time' }, x.depart, ' → ',
            x.arriveWithDelay ? [h('s', {}, x.arrive), ' ', h('b', {}, x.arriveWithDelay)] : x.arrive),
          h('span', { class: 'ab-sub' }, t('timetable.duration', { n: x.minutes })),
          x.fare != null && h('span', { class: 'ab-sub' }, t('common.price', { n: x.fare }))),
        (x.delayMin || x.board || x.excluded || x.estimated) && h('div', { class: 'ab-sub' },
          x.excluded && t('timetable.excluded', { why: x.excluded }),
          x.delayMin && t('timetable.delay', { n: x.delayMin }),
          x.board && ` ${t('timetable.board', { stop: x.board })}`,
          x.estimated && t('common.estimatedTag')),
        !x.excluded && bookButton(host, { system: d.system, trainNo: x.trainNo, date: d.date, from: d.from, to: d.to }, onError)))),
      list.length > MAX_ROWS && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { state.all = !state.all; rerender(); } }, state.all ? t('common.less') : t('common.more')));
  },
};
