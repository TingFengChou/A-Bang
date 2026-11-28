// 短劇（MyDrama，ADR-0019）的句子與連結檢查：純函式、零依賴，伺服器與前端共用（前端以 /core/drama-say.js 載入）。
// 句子放這裡（字典），數字一律由呼叫端傳入真實資料（ADR-0009）；連結格式由環境變數設定，這裡只檢查與代入。

/** 劇的 id：英數、底線、連字號（深層連結只帶這種 id，避免夾帶路徑或參數） */
export const DRAMA_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** 等車多久以上才推一集短劇（分鐘；產品負責人 2026-11-22：≥ 5 分） */
export const WAIT_MIN = 5;
/** 等太久（≥ 40 分）就不推：那時該建議改別的方式，不是看劇 */
export const WAIT_MAX = 40;

// 不能當成「開 App」的協定：會在網頁裡執行程式、讀本機檔案或是一般網頁（一般網頁用 https 商店頁）
const BLOCKED = /^(?:javascript|data|vbscript|file|blob|about|http|ftp|ws|wss|content|intent|chrome|view-source|mailto|tel|sms):/i;
/** 開 App 的連結：自訂 scheme（scheme://…）或 https（universal link／app link）；只允許安全字元 */
export const isAppLink = (u) => typeof u === 'string' && u.length <= 300 && /^[a-z][a-z0-9+.-]{1,30}:\/\/[A-Za-z0-9_\-./?=&%~]+$/i.test(u) && !BLOCKED.test(u);
/** 商店頁：只允許 https */
export const isStoreLink = (u) => typeof u === 'string' && u.length <= 300 && /^https:\/\/[A-Za-z0-9_\-./?=&%~]+$/i.test(u);

/**
 * 連結範本代入 id、集數（範本來自環境變數，例：`<scheme>://…/{id}/…/{ep}`）。id 或集數不合格、結果不是安全的 App 連結都回 null。
 * @param {string|null|undefined} template
 * @param {{ id?: string, ep?: number }} [v]
 */
export function linkFrom(template, { id, ep } = {}) {
  if (typeof template !== 'string' || !template) return null;
  if (/\{id\}/.test(template) && !(typeof id === 'string' && DRAMA_ID.test(id))) return null;
  if (/\{ep\}/.test(template) && !(Number.isInteger(ep) && ep >= 1 && ep <= 9999)) return null;
  const u = template.replace(/\{id\}/g, id ?? '').replace(/\{ep\}/g, String(ep ?? ''));
  return isAppLink(u) ? u : null;
}

const SAY = {
  zh: {
    wait: ({ min, title, ep, free }) => `等車還要 ${min} 分，剛好夠看一集短劇：《${title}》第 ${ep} 集${free ? `（前 ${free} 集免費）` : ''}。`,
    remind: ({ min, title, ep, free }) => `還要等約 ${min} 分，車快到時阿幫會提醒您，不用一直盯著：先看一集《${title}》第 ${ep} 集${free ? `（前 ${free} 集免費）` : ''}？`,
    watch: '看這集', dismiss: '不用了', note: '在 MyDrama 播放；設定裡可以關掉這個提示',
    exercise: '天氣不錯，今天動得比較少，出去走走吧！MyDrama 的活動頁也有跟運動有關的活動。',
    exerciseCta: '看 MyDrama 活動頁',
  },
  en: {
    wait: ({ min, title, ep, free }) => `${min} min until it comes: just enough for one short-drama episode, “${title}” Ep. ${ep}${free ? ` (first ${free} free, in Chinese)` : ' (in Chinese)'}.`,
    remind: ({ min, title, ep, free }) => `About ${min} min to wait. Abang will remind you before it comes, so no need to keep checking: watch “${title}” Ep. ${ep}${free ? ` (first ${free} free, in Chinese)` : ' (in Chinese)'}?`,
    watch: 'Watch it', dismiss: 'No thanks', note: 'Plays in MyDrama; you can turn this tip off in Settings',
    exercise: 'Nice weather and you haven\'t moved much today. Go for a walk! MyDrama\'s activity page has something for that too.',
    exerciseCta: 'MyDrama activity page',
  },
};
const dict = (lang) => (lang === 'en' ? SAY.en : SAY.zh);

/**
 * 等車推劇的一句話（不經模型）。等的時間不在範圍、沒有可推的劇就回 null。
 * @param {{ waitMin: number, pick: { title: string, ep: number, freeEpisodes?: number|null } | null, lang?: 'en'|null }} a
 * @returns {{ text: string, watch: string, dismiss: string, note: string } | null}
 */
export function waitHint({ waitMin, pick, lang = null, remind = false } = {}) {
  if (!pick?.title || !Number.isFinite(waitMin) || waitMin < WAIT_MIN || waitMin >= WAIT_MAX) return null;
  const d = dict(lang);
  return { text: d[remind ? 'remind' : 'wait']({ min: Math.round(waitMin), title: pick.title, ep: pick.ep || 1, free: pick.freeEpisodes || 0 }), watch: d.watch, dismiss: d.dismiss, note: d.note };
}

/**
 * 「天氣好、動得少，建議去運動」時接在後面的一句：提一下合作 App 的活動頁（只提示，阿幫不代替登入或參加活動）。
 * 接線留給運動建議那個功能；這裡只決定說不說、說什麼，連結由伺服器設定提供（drama.exerciseLink()）。
 * @param {{ weatherOk: boolean, movedLittle: boolean, lang?: 'en'|null, link?: string|null }} a
 * @returns {{ text: string, cta: string|null, link: string|null } | null}
 */
export function exerciseNudge({ weatherOk, movedLittle, lang = null, link = null } = {}) {
  if (!weatherOk || !movedLittle) return null;
  const d = dict(lang);
  const ok = isAppLink(link) ? link : null;
  return { text: d.exercise, cta: ok ? d.exerciseCta : null, link: ok };
}
