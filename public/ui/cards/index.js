// 卡片入口（M4-02，CARDS.md）：依 payload.card 分派到各卡片；外框、示範標示、刷新與錯誤狀態在這裡共用。
// 卡片不直接 fetch，只透過 host（CARDS.md §3）。網頁、MCP Apps、App 共用同一份程式。
import { h, hhmm } from './dom.js';
import { t } from './i18n/zh-TW.js';
import busRoute from './cards/bus-route.js';
import busStation from './cards/bus-station.js';
import nearby from './cards/nearby.js';
import youbike from './cards/youbike.js';
import metro from './cards/metro.js';
import timetable from './cards/timetable.js';
import trip from './cards/trip.js';

/** card → { title(data), body(data, ctx), refreshSec? } */
export const CARDS = {
  'bus-route': busRoute, 'bus-station': busStation, nearby, youbike, metro, timetable, trip,
};

/**
 * 在 el 內渲染卡片。
 * @param {HTMLElement} el
 * @param {{ card: string, v?: number, mode: 'live'|'demo', speak?: string, data: any, tool?: string, args?: object }} payload
 * @param {import('./host.js').Host} host
 * @returns {{ update: (p: object) => void, destroy: () => void }}
 */
export function renderCard(el, payload, host) {
  const def = CARDS[payload?.card];
  if (!def) throw new Error(`沒有這種卡片：${payload?.card}`);
  const state = {}; // 卡片內的使用者選擇（方向、排序…），刷新時保留
  let current = payload;
  let timer = null;
  let status = null;

  const draw = () => {
    const ctx = { host, t, state, payload: current, rerender: draw };
    const updated = current.data?.updatedAt ? t('common.updatedAt', { time: hhmm(current.data.updatedAt) }) : null;
    status = h('span', { class: 'ab-status', role: 'status', 'aria-live': 'polite' });
    const card = h('section', { class: 'ab-card', 'data-card': current.card, 'aria-label': def.title(current.data, ctx) },
      h('header', { class: 'ab-head' },
        h('h3', { class: 'ab-title' }, def.title(current.data, ctx)),
        current.mode === 'demo' && h('span', { class: 'ab-badge ab-demo' }, t('common.demo')),
        updated && h('span', { class: 'ab-updated' }, updated),
        status),
      def.body(current.data, ctx));
    el.replaceChildren(card);
  };

  const refresh = async () => {
    if (!current.tool || !host?.callTool) return;
    status?.replaceChildren(t('common.loading'));
    try {
      const next = await host.callTool(current.tool, current.args || {});
      if (next?.card === current.card) { current = next; draw(); }
    } catch {
      const at = hhmm(current.data?.updatedAt || new Date().toISOString());
      status?.replaceChildren(h('span', { class: 'ab-fail' }, t('common.refreshFailed', { time: at })));
    }
  };

  draw();
  if (def.refreshSec && current.tool && host?.callTool) timer = setInterval(refresh, def.refreshSec * 1000);
  return {
    update(p) { current = p; draw(); },
    refresh,
    destroy() { clearInterval(timer); el.replaceChildren(); },
  };
}

export { t };
