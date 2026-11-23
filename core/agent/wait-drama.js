// 等車推短劇（ADR-0019，產品負責人 2026-11-22）：公車／捷運還要等一段時間時，在到站卡片下方輕輕提一句 MyDrama 的一集。
// 由程式決定（不經模型）：等車時間來自到站資料，劇來自 MyDrama 熱門排行；一輪最多一次、使用者可以在設定關掉。
// 交通資訊是主角：這句不進回答文字，只是卡片下方的小提示；查不到劇或逾時就不說，不影響交通結果。
import { walkMinutes } from '../nav.js';
import { waitHint, WAIT_MIN } from '../drama-say.js';

/** 最多等 MyDrama 多久（毫秒）：逾時就這一輪不提，交通結果照常 */
export const PICK_TIMEOUT_MS = 1500;

/**
 * 到站結果 → 在站牌還要等幾分鐘（不知道就回 null）。
 * - 公車：盯的上車站（focus）正常行駛時的到站秒數；有「離你多遠」時扣掉走過去的時間（行程裡選公車時另扣 walkMin）
 * - 捷運到站看板：不知道使用者往哪個方向 → 各方向最快的那班（取最小＝保守：每個方向都要等夠久才推）
 * - 捷運怎麼坐（metro_route）：知道方向 → 第一段往這個方向的下一班（2026-11-23，原本可能抓到反方向的車）
 * @param {string} tool
 * @param {any} data
 * @param {{ walkMin?: number|null }} [opts]
 */
export function waitMinutes(tool, data, { walkMin = null } = {}) {
  if (tool === 'bus_route_eta') {
    const f = data?.focus;
    if (!f || f.status !== 0 || !Number.isFinite(f.etaSec)) return null;
    const walk = Number.isFinite(walkMin) ? walkMin : Number.isFinite(f.distanceM) && f.distanceM > 100 ? walkMinutes(f.distanceM) : 0;
    return f.etaSec / 60 - walk;
  }
  if (tool === 'metro_route') {
    const n = data?.next;
    return Number.isFinite(n?.etaMin) ? n.etaMin : null; // 台中捷運只有班距（headway）：不知道下一班幾分到，不推
  }
  if (tool === 'metro_live_board') {
    const mins = (data?.trains || []).map((t) => t?.etaMin).filter((m) => Number.isFinite(m));
    return mins.length ? Math.min(...mins) : null;
  }
  return null;
}

/**
 * 這一輪要不要推、推什麼：回傳 aside 事件的內容或 null。
 * @param {object} svc
 * @param {{ tool: string, data: any, parent: string, walkMin?: number|null, lang?: 'en'|null }} a
 * @param {{ on: boolean, done: boolean, turn?: number, now?: number, pick?: Promise<object|null>|null }} state 這一輪的狀態（on＝使用者沒關掉；done＝這一輪已經推過；turn、now＝推哪一部的輪替依據）
 */
export async function waitDrama(svc, { tool, data, parent, walkMin = null, lang = null }, state) {
  if (!state?.on || state.done || lang === 'en' || !svc?.drama?.waitPick) return null; // 英文（觀光客）不推：片庫是中文
  const min = waitMinutes(tool, data, { walkMin });
  if (min == null || min < WAIT_MIN) return null;
  state.done = true; // 有機會推就算這一輪的那一次（就算這次沒推成，也不在同一輪再試）
  let timer;
  const pick = await Promise.race([
    state.pick || svc.drama.waitPick({ turn: state.turn, now: state.now }).catch(() => null), // 通常一輪開始時就拿好了（asideState）
    new Promise((r) => { timer = setTimeout(() => r(null), PICK_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
  const hint = pick && waitHint({ waitMin: min, pick, lang });
  if (!hint) return null;
  const store = svc.drama.store?.() || null; // 沒設定連結（示範）時前端改給「在演什麼」（問阿幫），不給打不開的按鈕
  return {
    parent, kind: 'drama', text: hint.text, waitMin: Math.round(min), mode: svc.dramaMode || 'demo', // 分鐘跟公車回報「約 N 分」一樣四捨五入
    data: { id: pick.id, title: pick.title, ep: pick.ep, freeEpisodes: pick.freeEpisodes ?? null, appLink: pick.appLink ?? null, store },
    labels: { watch: hint.watch, dismiss: hint.dismiss, note: hint.note },
  };
}

/**
 * 設了到站提醒、還要等一段時間（產品負責人 2026-11-22「到站提醒的時候出現，代表他想等，但是不要一直盯著看」）：
 * 提醒列下方推一集短劇（句子說「車快到時會提醒你」）。跟對話裡的提示同一套規則（WAIT_MIN～WAIT_MAX、英文不推、查不到或逾時不說）。
 * @param {object} svc
 * @param {{ waitMin: number, lang?: 'en'|null, now?: number }} a
 * @returns {Promise<object|null>} aside 事件的內容（沒有 parent）或 null
 */
export async function remindAside(svc, { waitMin, lang = null, now = Date.now() } = {}) {
  if (lang === 'en' || !svc?.drama?.waitPick || !Number.isFinite(waitMin)) return null;
  let timer;
  const pick = await Promise.race([
    svc.drama.waitPick({ turn: 0, now }).catch(() => null),
    new Promise((r) => { timer = setTimeout(() => r(null), PICK_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
  const hint = pick && waitHint({ waitMin, pick, lang, remind: true });
  if (!hint) return null;
  return {
    kind: 'drama', text: hint.text, waitMin: Math.round(waitMin), mode: svc.dramaMode || 'demo',
    data: { id: pick.id, title: pick.title, ep: pick.ep, freeEpisodes: pick.freeEpisodes ?? null, appLink: pick.appLink ?? null, store: svc.drama.store?.() || null },
    labels: { watch: hint.watch, dismiss: hint.dismiss, note: hint.note },
  };
}
