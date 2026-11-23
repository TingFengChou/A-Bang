// 到站提醒＋短劇（ADR-0019，產品負責人 2026-11-22「到站提醒的時候出現，代表他想等，但是不要一直盯著看」）：
// 設了到站提醒、還要等 5～40 分時，在提醒列下方（每一頁，含公車頁）推一集 MyDrama；句子由伺服器程式產生（/api/v1/drama/wait，不經模型）。
// 每個提醒最多推一次；按「不用了」就這個提醒不再出現；設定關掉「等車推短劇」、英文、離線示範版都不推。
import { API_BASE } from './base.js';
import { currentArrivalWatch, openApp } from '../ui/cards/host-web.js';
import { mountDramaHint, dramaHintOn } from './drama-hint.js';

/** 這個提醒的識別（同一路線、上車站、到期時間＝同一個提醒） */
export const watchKey = (w) => (w ? `${w.city}|${w.routeName}|${w.stop}|${w.direction ?? ''}` : '');

/** 還要等幾分（查到過到站時間才知道；扣掉經過的時間）；不知道回 null */
export function waitLeft(w, now = Date.now()) {
  if (!w?.last || !Number.isFinite(w.last.etaSec) || w.skip) return null;
  return Math.round((w.last.etaSec - (now - w.last.at) / 1000) / 60);
}

/**
 * 要不要去拿短劇（純函式，測試用）
 * @param {{ w: object|null, on: boolean, seen: string|null, demo?: boolean, now?: number }} a seen：這個提醒已經推過或按過「不用了」
 */
export function shouldFetch({ w, on, seen, demo = false, now = Date.now() }) {
  if (!w || !on || demo || w.lang === 'en') return false;
  if (seen === watchKey(w)) return false;
  const left = waitLeft(w, now);
  return left != null && left >= 5 && left < 40;
}

/** 掛在外殼上（app.js）：提醒開始、更新、結束時檢查 */
export function mountWaitDrama(el, { ask = (q) => { location.hash = `#/agent?q=${encodeURIComponent(q)}`; }, fetchImpl = (u) => fetch(u) } = {}) {
  let seen = null, busy = false, shownFor = '';
  const clear = () => { el.hidden = true; el.replaceChildren(); shownFor = ''; };
  const check = async () => {
    const w = currentArrivalWatch();
    if (!w || (shownFor && shownFor !== watchKey(w))) clear(); // 提醒結束或換了一個：收掉
    if (!shouldFetch({ w, on: dramaHintOn(), seen, demo: !!globalThis.__DEMO_SERVICES__ }) || busy) return;
    busy = true;
    seen = watchKey(w); // 這個提醒只試一次（沒拿到也不再試）
    try {
      const res = await fetchImpl(`${API_BASE}/api/v1/drama/wait?min=${waitLeft(w)}`);
      const aside = res.ok ? (await res.json())?.aside : null;
      if (!aside || watchKey(currentArrivalWatch()) !== seen) return;
      const box = mountDramaHint(aside, { host: { openApp }, ask });
      box.querySelector('.dh-acts .quiet')?.addEventListener('click', () => setTimeout(clear, 220)); // 不用了：這個提醒不再出現
      el.replaceChildren(box);
      el.hidden = false;
      shownFor = seen;
    } catch { /* 提示失敗不影響提醒 */ } finally { busy = false; }
  };
  addEventListener('abang:arrival-watch', check);
  check();
  return check;
}
