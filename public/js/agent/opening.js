// 問阿幫的開場（2026-11-28 Claude 與 Antigravity 第十四輪排第一）：以前打開問阿幫是一排小建議＋一大片空白，跟首頁「今天」卡斷開。
// 現在還沒問之前，對話區放：
//   1. 阿幫一句話（跟首頁今天卡同一個 todayPlan：日子、時段、天氣的建議）
//   2. 「你可能想問」：今天卡的問題（一兩個大按鈕；時段與天氣的其他建議照舊在輸入框上方的建議列，不重複）
//   3. 「我可以幫你」：交通、天氣空品、看病、去政府辦事、生活小事、防詐，一格一個例句
// 第一個問題送出就收起來（不佔對話）；只有生活阿幫、中文。資料用首頁已經查好的（10 分鐘內），沒有才查一次（同一份 loadNow 快取）。
// 純函式（openingModel）給 node:test 測；畫面在 renderOpening。
import { icons } from '../icons.js';

/** 「我可以幫你」：一格一個領域、一個例句（都是阿幫查得到的；防詐到防詐頁） */
export const CAN_DO = [
  { icon: 'route', c: '#1d4ed8', title: '怎麼去最快', q: '去台北 101 怎麼走最快？' },
  { icon: 'sun', c: '#0284c7', title: '天氣、空品', q: '今天出門要帶傘嗎？' },
  { icon: 'pharmacy', c: '#16a34a', title: '看病、藥局', q: '附近有開的診所嗎' },
  { icon: 'home', c: '#7c3aed', title: '去政府辦事', q: '換身分證要帶什麼？' },
  { icon: 'trash', c: '#b45309', title: '生活小事', q: '垃圾車幾點來？' },
  { icon: 'shield', c: '#b91c1c', title: '可疑訊息', href: '#/agent/antifraud' },
];

/** 問題的圖示：建議有意圖就照意圖（跟首頁範例同一套），今天卡的問題看字 */
const INTENT_ICON = { trip: 'route', bus_route: 'bus', metro: 'metro', youbike: 'bike', nearby_bus: 'bus', rail: 'train', weather: 'sun', aqi: 'air', outing: 'sun', quake: 'quake', pharmacy: 'pharmacy', garbage: 'trash', invoice: 'receipt', fuel: 'fuel', stock: 'chart', gov: 'home' };
export const iconOfQ = (q) => (/診所|藥局/.test(q) ? 'pharmacy' : /捷運/.test(q) ? 'metro' : /公車/.test(q) ? 'bus' : /傘|出門|天氣|下雨/.test(q) ? 'sun' : 'route');
const qOf = (href) => { try { return decodeURIComponent(String(href).split('?q=')[1] || ''); } catch { return ''; } };

/**
 * 開場要顯示什麼（純函式）。
 * @param {{ plan: object, asks?: Array<{ q: string, icon?: string }> }} o  asks：首頁同一套動態建議（homeAsks）
 * @returns {{ say: string, tips: string[], asks: Array<{ q: string, label: string, icon: string, primary?: true }> }}
 */
export function openingModel({ plan, asks = [] }) {
  const say = plan?.show ? `${plan.say}` : '嗨，我是阿幫。交通、天氣、看病、辦事，用一句話問我就好。';
  const tips = plan?.show ? plan.tips.map((t) => t.text).slice(0, 2) : [];
  const out = [];
  const seen = new Set();
  const push = (q, label, icon, primary) => { if (!q || seen.has(q) || out.length >= 4) return; seen.add(q); out.push({ q, label: label || q, icon, ...(primary && { primary: true }) }); };
  for (const a of plan?.show ? plan.acts : []) if (a.href.startsWith('#/agent?q=')) push(qOf(a.href), a.label, iconOfQ(qOf(a.href)), a.primary); // 今天卡的問題（設定頁那個不放）
  for (const a of asks) push(a.q, a.q, INTENT_ICON[a.ask?.intent || a.intent] || iconOfQ(a.q));
  return { say, tips, asks: out };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * 畫開場（回傳元素；呼叫的人放進對話區、第一次送出時移除）。
 * @param {{ model: ReturnType<typeof openingModel>, send: (q: string) => void, go: (href: string) => void }} o
 */
export function renderOpening({ model, send, go }) {
  const box = document.createElement('section');
  box.className = 'agent-opening';
  box.setAttribute('aria-label', '阿幫的開場');
  const paint = (m) => {
    box.innerHTML = `
      <div class="op-hello"><img src="/brand/abang-happy.svg" alt="" width="52" height="52"><p class="op-say">${esc(m.say)}</p></div>
      ${m.tips.length ? `<ul class="op-tips">${m.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${m.asks.length ? `<h3 class="op-h">你可能想問</h3><div class="op-asks">${m.asks.map((a, i) => `<button type="button" class="op-ask${a.primary ? ' primary' : ''}" data-i="${i}"><span aria-hidden="true">${icons[a.icon] || icons.route}</span><b>${esc(a.label)}</b><i aria-hidden="true">›</i></button>`).join('')}</div>` : ''}
      <h3 class="op-h">我可以幫你</h3>
      <div class="op-can">${CAN_DO.map((x, i) => `<button type="button" class="op-can-i" data-c="${i}"><span class="ab-token sm" style="--c:${x.c}" aria-hidden="true">${icons[x.icon]}</span><b>${esc(x.title)}</b><small>${esc(x.q ? `「${x.q}」` : '簡訊、網址貼給我看')}</small></button>`).join('')}</div>`;
    box.querySelectorAll('.op-ask').forEach((b) => b.addEventListener('click', () => send(m.asks[Number(b.dataset.i)].q)));
    box.querySelectorAll('.op-can-i').forEach((b) => b.addEventListener('click', () => { const x = CAN_DO[Number(b.dataset.c)]; if (x.href) go(x.href); else send(x.q); }));
  };
  paint(model);
  return { el: box, update: (m) => { if (box.isConnected && !box.contains(document.activeElement)) paint(m); } }; // 焦點在開場上不重畫（鍵盤、讀屏）
}
