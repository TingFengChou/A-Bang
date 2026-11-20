// 卡片入口（M4-02，CARDS.md）：依 payload.card 分派到各卡片；外框、示範標示、刷新與錯誤狀態在這裡共用。
// 卡片不直接 fetch，只透過 host（CARDS.md §3）。網頁、MCP Apps、App 共用同一份程式。
import { snapshot, slide } from './slide.js';
import { h, hhmm } from './dom.js';
import { t } from './i18n/zh-TW.js';
import { startCountdown } from './countdown.js';
import busRoute from './cards/bus-route.js';
import busStation from './cards/bus-station.js';
import nearby from './cards/nearby.js';
import youbike from './cards/youbike.js';
import metro from './cards/metro.js';
import timetable from './cards/timetable.js';
import trip from './cards/trip.js';
import scamRisk from './cards/scam-risk.js';
import weather from './cards/weather.js';
import aqi from './cards/aqi.js';
import quake from './cards/quake.js';
import pharmacy from './cards/pharmacy.js';
import garbage from './cards/garbage.js';
import fuel from './cards/fuel.js';
import invoice from './cards/invoice.js';
import stock from './cards/stock.js';
import outing from './cards/outing.js';

/** card → { title(data), body(data, ctx), refreshSec?, announce?(data, { t, state }) → 刷新後要念的一句話 } */
export const CARDS = {
  'bus-route': busRoute, 'bus-station': busStation, nearby, youbike, metro, timetable, trip, 'scam-risk': scamRisk, weather, aqi, quake, pharmacy, garbage, fuel, invoice, stock, outing,
};

/**
 * 在 el 內渲染卡片。
 * @param {HTMLElement} el
 * @param {{ card: string, v?: number, mode: 'live'|'demo', speak?: string, data: any, tool?: string, args?: object }} payload
 * @param {import('./host.js').Host} host
 * @returns {{ update: (p: object) => void, refresh: () => Promise<void>, destroy: () => void }}
 */
export function renderCard(el, payload, host) {
  const def = CARDS[payload?.card];
  if (!def) throw new Error(`沒有這種卡片：${payload?.card}`);
  const state = {}; // 卡片內的使用者選擇（方向、排序…），刷新時保留
  let current = payload;
  let timer = null;
  let status = null;
  // 播報到站（M6-04）：live region 要一直在畫面上，內容變了才會被念出；卡片重畫只換 slot
  const slot = h('div');
  const live = h('p', { class: 'ab-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  el.replaceChildren(slot, live);
  let said = null;
  const announce = (speak) => {
    const text = def.announce?.(current.data, { t, state }) || null;
    if (speak && text && text !== said) live.textContent = text;
    said = text;
  };

  const draw = ({ fresh = false } = {}) => {
    const say = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };
    const ctx = { host, t, state, payload: current, rerender: draw, say };
    const updated = current.data?.updatedAt ? t('common.updatedAt', { time: hhmm(current.data.updatedAt) }) : null;
    status = h('span', { class: 'ab-status', role: 'status', 'aria-live': 'polite' });
    const card = h('section', { class: 'ab-card', 'data-card': current.card, 'aria-label': def.title(current.data, ctx) },
      h('header', { class: 'ab-head' },
        h('h3', { class: 'ab-title' }, def.title(current.data, ctx)),
        // 資料來源標示：示範（灰）或真實（品牌色）；兩種都標，使用者不必從「沒有標籤」反推
        current.mode === 'demo' ? h('span', { class: 'ab-badge ab-demo', title: t('common.demoHint') }, t('common.demo'))
          : current.mode === 'live' && h('span', { class: 'ab-badge ab-live', title: t('common.liveHint') }, t('common.live')),
        updated && h('span', { class: 'ab-updated' }, updated),
        status),
      def.body(current.data, ctx));
    card.dataset.drawnAt = String(Date.now()); // 倒數的基準時間（每次重畫＝收到新資料）
    const before = fresh ? snapshot(slot) : null; // 刷新：公車從舊位置滑到新位置
    slot.replaceChildren(card);
    if (before) slide(slot, before);
  };

  // REST 回傳 name 而不是 tool；刷新結果缺 tool／args 時沿用原本的，避免只刷新一次就停
  const merge = (next) => ({ ...next, tool: next.tool ?? next.name ?? current.tool, args: next.args ?? current.args });
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const refresh = async () => {
    if (!current.tool || !host?.callTool || hidden()) return; // 分頁在背景時不刷新
    status?.replaceChildren(t('common.loading'));
    try {
      const next = await host.callTool(current.tool, current.args || {});
      if (next?.card === current.card) { current = merge(next); draw({ fresh: true }); announce(true); }
    } catch {
      const at = hhmm(current.data?.updatedAt || new Date().toISOString());
      status?.replaceChildren(h('span', { class: 'ab-fail' }, t('common.refreshFailed', { time: at })));
    }
  };

  draw();
  announce(false); // 第一次不念（內容本身就會被讀到），之後刷新有變化才念
  const stopCountdown = startCountdown(el);
  if (def.refreshSec && current.tool && host?.callTool) timer = setInterval(refresh, def.refreshSec * 1000);
  return {
    update(p) { current = merge(p); draw({ fresh: true }); announce(true); },
    refresh,
    destroy() { clearInterval(timer); stopCountdown(); el.replaceChildren(); },
  };
}

export { t };
