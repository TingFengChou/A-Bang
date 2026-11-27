// 阿幫動手做（ADR-0021）：使用者說「加到行事曆」「傳給我媽」時怎麼回。
// 伺服器不產生事件內容、不執行任何動作：只回「阿幫問你」的動作選項（addCalendar／share，ADR-0016），
// 手機用畫面上最近一張行程卡片的資料產生內容（core/device-actions.js），再開系統畫面讓使用者確認。
import { ACTION_OF_INTENT } from '../device-actions.js';
import { CALENDAR_ASK, SHARE_ASK, SHARE_ASK_EN } from './demo-intent.js';

export const DEVICE_ACTION_INTENTS = Object.keys(ACTION_OF_INTENT);

const SAY = {
  zh: {
    calendar: { q: '要把剛剛的行程加到行事曆嗎？', why: '會打開手機的行事曆，你確認後才加入。', btn: '加到行事曆', ok: '好，按「加到行事曆」，會打開手機的行事曆，你確認後才加入。', noTrip: '先告訴我要去哪裡，排好行程後就能加到行事曆（會打開手機的行事曆讓你確認）。', cant: '這裡沒辦法直接加到行事曆；在阿幫的 App 或網頁排好行程後，按卡片上的「加到行事曆」。' },
    share: { q: '要把剛剛的行程分享出去嗎？', why: '會打開手機的分享選單，由你選要傳給誰。', btn: '分享行程', ok: '好，按「分享行程」，會打開手機的分享選單，由你選要傳給誰。', noTrip: '先告訴我要去哪裡，排好行程後就能分享出去（會打開手機的分享選單，由你選要傳給誰）。', cant: '這裡沒辦法直接分享；在阿幫的 App 或網頁排好行程後，按卡片上的「分享」。' },
    no: '不用了',
  },
  en: {
    calendar: { q: 'Add this trip to your calendar?', why: "Your phone's calendar opens; nothing is saved until you confirm.", btn: 'Add to calendar', ok: "Tap “Add to calendar”. Your phone's calendar opens so you can check it before saving.", noTrip: 'Tell me where you are going first; once the trip is planned I can add it to your calendar.', cant: "I can't add it to a calendar here. Plan the trip in the A-Bang app or website, then tap “Add to calendar” on the card." },
    share: { q: 'Share this trip?', why: "Your phone's share menu opens and you pick who gets it.", btn: 'Share trip', ok: "Tap “Share trip”. Your phone's share menu opens and you pick who gets it.", noTrip: 'Tell me where you are going first; once the trip is planned you can share it.', cant: "I can't share from here. Plan the trip in the A-Bang app or website, then tap “Share” on the card." },
    no: 'No thanks',
  },
};

/** 這一輪要的裝置動作意圖（calendar／share）；不是就 null */
export const deviceIntent = (it) => (DEVICE_ACTION_INTENTS.includes(it?.intent) ? it.intent : null);

/** 「阿幫問你」的動作題（行程已經在畫面上時用） */
export function deviceActionAsk(intent, lang = null) {
  const L = SAY[lang === 'en' ? 'en' : 'zh'];
  const s = L[intent];
  if (!s) return null;
  return { question: s.q, why: s.why, about: `device:${intent}`, options: [{ label: s.btn, kind: 'action', action: { name: ACTION_OF_INTENT[intent] } }, { label: L.no, kind: 'dismiss' }] };
}

/**
 * 使用者要加行事曆／分享：客戶端說它做得到（deviceActions.can）而且畫面上有行程（deviceActions.trip）才給動作按鈕；
 * 做不到（MCP、REST、舊版 App）或還沒有行程時照實說。
 * @returns {{ ask?: object, text: string }}
 */
export function deviceActionReply(intent, req, lang = null) {
  const L = SAY[lang === 'en' ? 'en' : 'zh'][intent];
  const can = req?.deviceActions?.can?.includes(ACTION_OF_INTENT[intent]);
  if (!can) return { text: L.cant };
  if (!req.deviceActions.trip) return { text: L.noTrip };
  return { ask: deviceActionAsk(intent, lang), text: L.ok };
}

/** 一句話同時排行程又要加行事曆／分享（「排去高雄的車，傳給我媽」）：行程排好後再問（一輪最多一個問題） */
export function thenAction(text) {
  const s = String(text || '');
  return CALENDAR_ASK.test(s) ? 'calendar' : (SHARE_ASK.test(s) || SHARE_ASK_EN.test(s) || /(?:分享|轉傳|傳)給/.test(s)) ? 'share' : null;
}
