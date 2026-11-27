// 「阿幫的腦袋」的「行動」（產品負責人 2026-11-28：大腦示意圖加入 take action；PM 與設計討論後的第一版）：
// 從這一輪已經有的事件推出「阿幫可以幫你做的事」，每件標確認方式與在哪裡發生。純函式，不碰畫面。
// 試判斷永遠不執行行動：只列「準備好，等你按」。L2 用白名單（防詐工具也標 L2，但不是行動；ADR-0011）。
// 行事曆、分享由系統畫面確認（ADR-0021）；導航、撥號、提醒是你按一下；叫車、訂票、官方入口要你按確認才開。

/** 確認方式：tap 你按一下就好、confirm 你按確認才開（L2）、system 系統畫面確認 */
export const CONFIRMS = ['tap', 'confirm', 'system'];
/** 行動的顯示順序（同時有好幾個時） */
export const ACTION_ORDER = ['call', 'nav', 'remind', 'calendar', 'share', 'ride', 'book', 'gov'];
const META = {
  nav: { confirm: 'tap', at: 'phone' },
  call: { confirm: 'tap', at: 'phone' },
  remind: { confirm: 'tap', at: 'phone' },
  calendar: { confirm: 'system', at: 'calendar' },
  share: { confirm: 'system', at: 'phone' },
  ride: { confirm: 'confirm', at: 'official' },
  book: { confirm: 'confirm', at: 'official' },
  gov: { confirm: 'confirm', at: 'official' },
};
/** 會產生行動的 L2 工具（白名單） */
const L2_TOOLS = { ridehail_link: 'ride', rail_booking_link: 'book', gov_official_link: 'gov' };
/** 卡片上有導航按鈕的 */
const NAV_CARDS = new Set(['trip', 'clinic', 'pharmacy', 'gov-office']);
/** 卡片上有撥號按鈕的 */
const CALL_CARDS = new Set(['clinic', 'pharmacy', 'gov-office']);
/** 「阿幫問你」的動作選項 → 行動 */
const ASK_ACTIONS = { addCalendar: 'calendar', share: 'share', watchArrival: 'remind', openLink: 'nav' };
/** 安全情境：一鍵撥號 */
const SAFETY_CALL = new Set(['selfHarm', 'emergency', 'medical']);

/**
 * @param {{ results?: Array<{ tool: string, card?: string, data?: any }>, ask?: { options?: Array<{ kind: string, action?: string }> }|null, safety?: string|null }} run
 *   summarizeRun（ai-trial.js）的結果
 * @returns {Array<{ id: string, confirm: 'tap'|'confirm'|'system', at: 'phone'|'calendar'|'official' }>}
 */
export function actionsOf(run = {}) {
  const ids = new Set();
  if (run.safety && SAFETY_CALL.has(run.safety)) ids.add('call');
  for (const r of run.results || []) {
    if (L2_TOOLS[r.tool] && (r.tool !== 'gov_official_link' || r.data?.links?.length)) ids.add(L2_TOOLS[r.tool]);
    if (NAV_CARDS.has(r.card)) ids.add('nav');
    if (CALL_CARDS.has(r.card) && listOf(r).some((x) => x.phone || x.tel)) ids.add('call');
    if (r.card === 'trip') {
      ids.add('calendar'); ids.add('share'); // 行程卡片的加到行事曆、分享（ADR-0021）
      if ((r.data?.options || []).some((o) => o.role === 'ridehail')) ids.add('ride');
    }
  }
  for (const o of run.ask?.options || []) if (o.kind === 'action' && ASK_ACTIONS[o.action]) ids.add(ASK_ACTIONS[o.action]);
  return ACTION_ORDER.filter((id) => ids.has(id)).map((id) => ({ id, ...META[id] }));
}
const listOf = (r) => r.data?.clinics || r.data?.pharmacies || r.data?.offices || [];

/** 主視覺節點的一句話：幾個行動、幾個要你確認（含系統畫面） */
export function actSummary(actions) {
  const n = actions.length;
  const confirm = actions.filter((a) => a.confirm !== 'tap').length;
  return { n, confirm };
}
