// 問阿幫的對話留在手機（2026-11-21 Austin：「阿幫應該是所有資料的擁有者」；App 重開後還接得上）：
// 只存文字（不存卡片、座標、裝置判斷），最近 10 則，12 小時後自動清掉。設定頁「清除這些資料」一起清。
const KEY = 'abang.chat';
export const CHAT_TTL_MS = 12 * 3600e3;
export const CHAT_MAX = 10;

/** 存最近的對話（role＋文字；每則最多 500 字） */
export function saveChat(messages, now = Date.now()) {
  try {
    const list = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-CHAT_MAX).map((m) => ({ role: m.role, content: m.content.slice(0, 500) }));
    if (list.length) localStorage.setItem(KEY, JSON.stringify({ at: now, messages: list }));
    else localStorage.removeItem(KEY);
  } catch { /* 無痕模式或空間不夠：不存 */ }
}

/** 上次的對話（12 小時內）；過期或壞掉回 null 並清掉 */
export function loadChat(now = Date.now()) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    const ok = v && Number.isFinite(v.at) && now - v.at < CHAT_TTL_MS && now >= v.at && Array.isArray(v.messages)
      && v.messages.every((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string');
    if (!ok) { if (v) localStorage.removeItem(KEY); return null; }
    return { at: v.at, messages: v.messages.slice(-CHAT_MAX) };
  } catch { return null; }
}

export function clearChat() { try { localStorage.removeItem(KEY); } catch { /* 無痕模式 */ } }
