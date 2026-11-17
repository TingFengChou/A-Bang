// timetable（thsr_timetable、tra_timetable、intercity_bus）：車次、出發、抵達、行車時間；塞車延誤、隔日、排除；訂票（L2）
import { h } from '../dom.js';
import { bookButton } from '../actions.js';

const MAX_ROWS = 8;

export default {
  title: (d, { t }) => t(`timetable.title.${d.system}`, { from: d.from, to: d.to }),
  body(d, { host, t, state, rerender }) {
    if (!d.trains?.length) return h('div', { class: 'ab-body' }, h('p', { class: 'ab-empty' }, t('timetable.empty', { date: d.date })));
    const rows = state.all ? d.trains : d.trains.slice(0, MAX_ROWS);
    const onError = (msg) => { state.err = msg; rerender(); };
    return h('div', { class: 'ab-body' },
      state.err && h('p', { class: 'ab-fail', role: 'alert' }, state.err),
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
          x.estimated && ` （${t('common.estimated')}）`),
        !x.excluded && bookButton(host, { system: d.system, trainNo: x.trainNo, date: d.date, from: d.from, to: d.to }, onError)))),
      d.trains.length > MAX_ROWS && h('button', { type: 'button', class: 'ab-btn ab-link', onclick: () => { state.all = !state.all; rerender(); } }, state.all ? t('common.less') : t('common.more')));
  },
};
