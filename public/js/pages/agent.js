// 網頁 agent 頁（M5-08，UX.md §3–§4、§8、§10）：對話、小幫手討論串、@點名、建議問題；由真實 NDJSON 事件驅動。
// 卡片用 public/ui/cards（renderCard＋web host）。不加假延遲：只在討論串兩則訊息之間保留最短 300ms 避免閃爍（UX.md §4）。
import { runAgent } from '../agent/client.js';
import { renderCard } from '../../ui/cards/index.js';
import { createWebHost } from '../../ui/cards/host-web.js';
import { renderDecision, lite } from '../../ui/agent/decision-graph.js';

// 決策圖重算用的同一份 decide.js（伺服器以 /core/decide.js 提供；UX.md §5）
const decideModule = import('/core/decide.js').catch(() => null);

const MIN_GAP_MS = 300;
const ROLE_CLASS = { 地點: 'place', 天氣: 'place', 公車: 'bus', YouBike: 'bike', 高鐵: 'rail', 台鐵: 'tra', 捷運: 'brand', 路況: 'car', 客運: 'car', 票價: 'fare', 叫車: 'car', 訂票: 'rail', 行程: 'brand', 車站: 'tra', 定位: 'place' };
const MENTIONS = ['地點', '天氣', '路況', '公車', 'YouBike', '捷運', '高鐵', '台鐵', '票價', '叫車'];
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 安全建立元素（不用 innerHTML，事件內容來自伺服器與上游資料） */
function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

/** 文字中的 @角色 換成色彩 chip */
function withMentions(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(/@([一-龥A-Za-z]{2,7})/g)) {
    const role = MENTIONS.find((r) => m[1].startsWith(r));
    if (!role) continue;
    out.push(text.slice(last, m.index), el('span', `mention r-${ROLE_CLASS[role] || 'brand'}`, `@${role}`));
    last = m.index + 1 + role.length;
  }
  out.push(text.slice(last));
  return out;
}

const avatar = (role) => el('span', `avatar r-${ROLE_CLASS[role] || 'brand'}`, role === '阿幫' ? '幫' : role.slice(0, 2));
const metricsText = (m) => (m ? [m.scanned ? `${m.scanned} 筆` : null, m.cacheHit ? '快取' : null, `${m.ms}ms`].filter(Boolean).join(' · ') : '');

export default {
  title: '問阿幫',
  render({ main, setTitle, onCleanup }) {
    setTitle('問阿幫');
    if (globalThis.__DEMO_SERVICES__) {
      main.append(el('p', 'agent-note-offline', '問阿幫需要連線到阿幫伺服器（npm start），離線 Demo 版只能使用下方的公車、YouBike、高鐵台鐵功能。'));
      return;
    }
    // 輕量 3D（M5-11）：低階裝置或 reduced motion 改為淡入
    document.documentElement.classList.toggle('lite-motion', lite());
    const history = [];
    let context = '';
    let busy = false;
    const cards = [];
    onCleanup(() => cards.forEach((c) => c.destroy()));

    const log = el('div', 'chat');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    const chips = el('div', 'suggest');
    const mention = el('div', 'mention-bar');
    const input = el('input', 'chat-input');
    Object.assign(input, { placeholder: '想去哪裡？例如：從西門町到台北 101', enterkeyhint: 'send', autocomplete: 'off', maxLength: 500 });
    input.setAttribute('aria-label', '問阿幫');
    const sendBtn = el('button', 'btn chat-send', '送出');
    sendBtn.type = 'submit';
    const form = el('form', 'chat-form', input, sendBtn);
    const disclaimer = el('p', 'updated');
    main.append(log, el('div', 'chat-dock', chips, mention, form), disclaimer);

    const host = createWebHost({ ask: (q) => send(q), setContext: (c) => { context = c; } });

    // 建議問題與免責（GET /api/v1/agent/profile）
    fetch('/api/v1/agent/profile').then((r) => r.json()).then(({ data }) => {
      for (const q of data.suggestions) { const b = el('button', 'chip', q); b.type = 'button'; b.onclick = () => send(q); chips.append(b); }
      disclaimer.textContent = data.disclaimer;
    }).catch(() => {});

    // @ 點名：輸入 @ 時顯示可點名的小幫手
    input.addEventListener('input', () => {
      mention.replaceChildren();
      if (!/@$/.test(input.value)) return;
      for (const r of MENTIONS) {
        const b = el('button', `chip r-${ROLE_CLASS[r]}`, `@${r}`);
        b.type = 'button';
        b.onclick = () => { input.value = `${input.value}${r} `; mention.replaceChildren(); input.focus(); };
        mention.append(b);
      }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });

    async function send(raw) {
      const q = String(raw || '').trim().slice(0, 500);
      if (!q || busy) return;
      busy = true; sendBtn.disabled = true; input.value = ''; mention.replaceChildren();
      history.push({ role: 'user', content: q });
      log.append(el('div', 'msg user', q));
      const turn = el('div', 'turn');
      log.append(turn);
      const view = turnView(turn);
      try {
        await runAgent({ messages: history.slice(-10), ...(context && { context }) }, (e) => view.push(e));
        await view.flush();
        if (view.text) history.push({ role: 'assistant', content: view.text.slice(0, 500) });
      } catch {
        turn.append(el('div', 'msg error', '連線中斷了，請再試一次。'));
      } finally {
        busy = false; sendBtn.disabled = false; context = '';
        input.focus();
      }
    }

    /** 一輪對話的畫面：事件依序呈現；討論串兩則之間至少 300ms（只為避免閃爍） */
    function turnView(turn) {
      const thread = el('div', 'thread');
      thread.setAttribute('aria-label', '小幫手討論串');
      const results = el('div', 'results');
      turn.append(thread, results);
      const bubbles = new Map();
      const roles = []; // 本輪回報的小幫手角色（決策圖的資料欄）
      let queue = Promise.resolve();
      let lastShown = 0;
      let textEl = null;
      const view = { text: '' };
      const gap = async () => {
        if (reducedMotion()) return;
        const wait = MIN_GAP_MS - (performance.now() - lastShown);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastShown = performance.now();
      };
      const handle = async (e) => {
        switch (e.type) {
          case 'status':
            turn.dataset.mode = e.mode;
            break;
          case 'agent_note':
            await gap();
            thread.append(el('div', 'bubble agent', avatar('阿幫'), el('div', 'say', withMentions(e.text))));
            break;
          case 'client_tool_call':
            thread.append(el('div', 'bubble tool', avatar('定位'), el('div', 'say typing', '定位中…')));
            break;
          case 'tool_start': {
            if (!roles.includes(e.role)) roles.push(e.role);
            const b = el('div', 'bubble tool', avatar(e.role), el('div', 'say typing', '輸入中…'), el('small', 'src', `${e.name} · ${e.server}`));
            bubbles.set(e.id, b);
            thread.append(b);
            break;
          }
          case 'tool_result': {
            await gap();
            const b = bubbles.get(e.id);
            const say = b?.querySelector('.say');
            if (say) {
              say.classList.remove('typing');
              say.textContent = e.ok ? (e.speak || '查好了') : `這次沒查到（${e.error}）`;
              if (!e.ok) b.classList.add('failed');
              if (e.ok && e.metrics) b.querySelector('.src').append(` · ${metricsText(e.metrics)}`);
            }
            if (e.ok && e.card) {
              const slot = el('div', 'card-slot enter3d');
              results.append(slot);
              cards.push(renderCard(slot, { card: e.card, v: e.v, mode: e.mode, speak: e.speak, data: e.data, tool: e.tool, args: e.args }, host));
            }
            break;
          }
          case 'discussion_end': {
            const n = e.tools.length;
            const sum = el('button', 'thread-sum', `小幫手討論完成・${n} 個工具・${e.servers.length} 個 MCP`);
            sum.type = 'button';
            sum.setAttribute('aria-expanded', 'false');
            sum.onclick = () => { const open = thread.classList.toggle('open'); sum.setAttribute('aria-expanded', String(open)); };
            thread.classList.add('collapsed');
            thread.before(sum);
            break;
          }
          case 'decision': {
            const box = el('section', 'decision enter3d');
            box.setAttribute('aria-label', '決策圖');
            if (reducedMotion()) box.classList.add('static');
            results.prepend(box);
            const mod = await decideModule;
            if (mod) renderDecision(box, e, { sources: roles.filter((r) => r !== '行程'), decide: mod.decide, CRITERIA: mod.CRITERIA });
            else box.append(el('p', 'dg-why', e.reason)); // 載不到引擎時至少顯示理由
            break;
          }
          case 'text':
            if (!textEl) { textEl = el('div', 'bubble agent final', avatar('阿幫'), el('div', 'say')); turn.append(textEl); }
            view.text += e.delta;
            textEl.querySelector('.say').textContent = view.text;
            break;
          case 'error':
            turn.append(el('div', 'msg error', e.retryAfterSec && !/\d+ 秒/.test(e.message) ? `${e.message}（${e.retryAfterSec} 秒後可再試）` : e.message));
            break;
          default:
        }
      };
      view.push = (e) => { queue = queue.then(() => handle(e)); };
      view.flush = () => queue;
      return view;
    }
  },
};
