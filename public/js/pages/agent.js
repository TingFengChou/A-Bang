// 網頁 agent 頁（M5-08，UX.md §3–§4、§8、§10）：對話、小幫手討論串、@點名、建議問題；由真實 NDJSON 事件驅動。
// 卡片用 public/ui/cards（renderCard＋web host）。不加假延遲：只在討論串兩則訊息之間保留最短 300ms 避免閃爍（UX.md §4）。
import { API_BASE, IN_APP } from '../base.js';
import { runAgent, browserLocation } from '../agent/client.js';
import { icons } from '../icons.js';
import { motion } from '../../ui/cards/motion.js';
import { token } from '../../ui/cards/mode-icons.js';
import { nextSteps } from '../agent/next-steps.js';
import { renderCard } from '../../ui/cards/index.js';
import { createWebHost } from '../../ui/cards/host-web.js';
import { renderDecision, lite } from '../../ui/agent/decision-graph.js';

// 決策圖重算用的同一份 decide.js（伺服器以 /core/decide.js 提供；UX.md §5）
const decideModule = import('/core/decide.js').catch(() => null);

const MIN_GAP_MS = 300;
// 小幫手頭像：每個角色一個線條圖示（public/js/icons.js，與首頁格子同一套）；阿幫用吉祥物
const ROLE_ICON = { 地點: 'pin', 天氣: 'sun', 公車: 'bus', YouBike: 'bike', 高鐵: 'hsr', 台鐵: 'train', 捷運: 'metro', 路況: 'traffic', 客運: 'coach', 票價: 'ticket', 叫車: 'car', 訂票: 'ticket',
  行程: 'route', 車站: 'train', 定位: 'locate', 空品: 'air', 地震: 'quake', 藥局: 'pharmacy', 垃圾車: 'trash', 油價: 'fuel', 發票: 'receipt', 股市: 'chart', 防詐: 'shield', 網址: 'link', 闢謠: 'myth', 號碼: 'phone' };
const ROLE_CLASS = { 防詐: 'bad', 網址: 'bad', 闢謠: 'fare', 號碼: 'tra', 地點: 'place', 天氣: 'place', 公車: 'bus', YouBike: 'bike', 高鐵: 'rail', 台鐵: 'tra', 捷運: 'brand', 路況: 'car', 客運: 'car', 票價: 'fare', 叫車: 'car', 訂票: 'rail', 行程: 'brand', 車站: 'tra', 定位: 'place', 空品: 'place', 地震: 'bad', 藥局: 'bike', 垃圾車: 'car', 油價: 'fare', 發票: 'fare', 股市: 'fare' };
/** 每個 agent 的 @點名、標題與輸入提示（角色名稱與 core/agent/events.js TOOL_ROLES 一致） */
const AGENTS = {
  life: { title: '問阿幫', placeholder: '想去哪裡、想查什麼？例如：去台北 101', mentions: ['地點', '天氣', '路況', '公車', 'YouBike', '捷運', '高鐵', '台鐵', '票價', '叫車', '空品', '地震', '藥局', '垃圾車', '油價', '發票', '股市'] },
  antifraud: { title: '阿幫・防詐', placeholder: '把可疑的簡訊、LINE 訊息或網址貼上來', mentions: ['防詐', '網址', '闢謠', '號碼'] },
};
const MENTIONS = [...new Set(Object.values(AGENTS).flatMap((a) => a.mentions))];
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

/**
 * 交棒（設計 review 建議 10）：決策圖播完後，勝出方案的代幣沿弧線飛進行程卡的建議方案，目標代幣彈一下。
 * 目標不在畫面內、沒有 GSAP 或精簡模式時不飛（純裝飾，不影響內容）。
 */
function handoff(box, results, decision) {
  const g = motion();
  if (!g || !globalThis.MotionPathPlugin) return;
  const from = box.querySelector('.dg-best');
  const to = results.querySelector('[data-card="trip"] .ab-option.best .ab-token');
  if (!from || !to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  if (b.top > innerHeight || b.bottom < 0 || a.bottom < 0 || a.top > innerHeight) return;
  const role = decision.options?.find((o) => o.id === decision.best)?.role;
  const fly = token(role, { size: 'md' });
  const x0 = a.left + 6, y0 = a.top + a.height / 2 - 15;
  fly.style.cssText = `position:fixed;left:${x0}px;top:${y0}px;z-index:50;pointer-events:none`;
  document.body.append(fly);
  const dx = b.left + b.width / 2 - (x0 + 15), dy = b.top + b.height / 2 - (y0 + 15);
  g.timeline()
    .to(fly, { duration: 0.6, ease: 'power2.inOut', scale: 1.3, motionPath: { path: [{ x: 0, y: 0 }, { x: dx * 0.5, y: dy * 0.5 - 70 }, { x: dx, y: dy }], curviness: 1.25 } })
    .to(fly, { opacity: 0, duration: 0.15 })
    .fromTo(to, { scale: 1.3 }, { scale: 1, duration: 0.45, ease: 'back.out(3)', clearProps: 'transform' }, '<')
    .add(() => fly.remove());
}

/** 打字中：三個跳動的點（螢幕閱讀器念「輸入中」） */
function typing(label = '輸入中') {
  const d = el('span', 'dots');
  d.append(el('i'), el('i'), el('i'));
  const sr = el('span', 'sr-only', `${label}…`);
  return [d, sr];
}

/** 頭像；阿幫有表情：think（查詢中，輕輕擺動）、happy（找到答案，跳一下） */
function avatar(role, mood = 'think') {
  const a = el('span', `avatar r-${ROLE_CLASS[role] || 'brand'}`);
  a.setAttribute('role', 'img');
  a.setAttribute('aria-label', role);
  a.title = role;
  if (role === '阿幫') { a.classList.add('mascot', mood); a.append(Object.assign(document.createElement('img'), { src: mood === 'happy' ? '/brand/abang-happy.svg' : '/brand/abang-think.svg', alt: '' })); }
  else if (icons[ROLE_ICON[role]]) a.innerHTML = icons[ROLE_ICON[role]]; // 圖示是本機常數 SVG，不含外部資料
  else a.textContent = role.slice(0, 2);
  return a;
}
const metricsText = (m) => (m ? [m.scanned ? `${m.scanned} 筆` : null, m.cacheHit ? '快取' : null, `${m.ms}ms`].filter(Boolean).join(' · ') : '');

export default {
  title: '問阿幫',
  render({ main, setTitle, onCleanup, params = [], query = {} }) {
    // 手機 App：起點預設是現在位置，打開問阿幫就先定位（第一次會問權限），之後問「去台北 101」不用等
    if (IN_APP) browserLocation().catch(() => {});
    const agentId = params[0] && AGENTS[params[0]] ? params[0] : 'life';
    const A = AGENTS[agentId];
    setTitle(A.title);
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
    Object.assign(input, { placeholder: A.placeholder, enterkeyhint: 'send', autocomplete: 'off', maxLength: 500 });
    input.setAttribute('aria-label', A.title);
    const sendBtn = el('button', 'btn chat-send', '送出');
    sendBtn.type = 'submit';
    const form = el('form', 'chat-form', input, sendBtn);
    const disclaimer = el('p', 'updated');
    const modeLine = el('p', 'updated agent-mode'); // 由誰回答（ADR-0012；Claude 模式說明對話會送 Anthropic，AGENT.md §7）
    main.append(log, el('div', 'chat-dock', chips, mention, form), disclaimer, modeLine);
    const MODE_TEXT = {
      claude: (m) => `由 Claude（${m}）回答；對話會送 Anthropic 處理。`,
      local: (m) => `由地端模型（${m}）回答；對話只送到本站設定的模型伺服器。`,
      demo: () => '示範模式：規則式回答，不經 AI 模型。',
    };

    const host = createWebHost({ ask: (q) => send(q), setContext: (c) => { context = c; } });

    // 建議問題與免責（GET /api/v1/agent/profile）；回答後換成「接下來可以…」（依這一輪結果，next-steps.js）
    let defaults = [];
    const showDefaults = () => {
      chips.classList.remove('next');
      chips.replaceChildren(...defaults.map((q) => { const b = el('button', 'chip', q); b.type = 'button'; b.onclick = () => send(q); return b; }));
    };
    fetch(`${API_BASE}/api/v1/agent/profile?id=${agentId}`).then((r) => r.json()).then(({ data }) => {
      defaults = data.suggestions;
      if (!chips.classList.contains('next')) showDefaults();
      disclaimer.textContent = data.disclaimer;
    }).catch(() => {});
    const STATE_CHIP = { rush: '趕時間', budget: '想省錢', lessWalk: '少走路', luggage: '帶行李' };
    let lastView = null;
    // 在卡片或公車頁設定／取消到站提醒後，下一步建議跟著更新（已提醒就不再建議）
    const onWatch = () => { if (lastView && chips.classList.contains('next')) showNext(lastView); };
    window.addEventListener('abang:arrival-watch', onWatch);
    onCleanup(() => window.removeEventListener('abang:arrival-watch', onWatch));
    function showNext(view) {
      lastView = view;
      const steps = nextSteps(view.results, view.decision, { watching: host.arrivalWatch?.() });
      if (!steps.length) { showDefaults(); return; }
      chips.classList.add('next');
      const act = async (s, b) => {
        if (s.kind === 'ask') return send(s.payload);
        if (s.kind === 'navigate') return host.navigate(s.payload);
        if (s.kind === 'state') { // 在這一輪的決策圖加狀態，瀏覽器立即重算
          const add = [...(view.box?.querySelectorAll('.dg-chip.add') || [])].find((x) => x.textContent.includes(STATE_CHIP[s.payload]));
          add?.click();
          view.box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          b.remove();
          return undefined;
        }
        if (s.kind === 'remind') {
          await host.watchArrival(s.payload);
          log.append(el('p', 'agent-sys', `好，${s.payload.routeName} 到「${s.payload.stop}」前 ${s.payload.minutes} 分提醒你（${host.background ? 'App 關著也會提醒' : 'App 開著時'}）。`));
          return showNext(view);
        }
        return undefined;
      };
      const btns = steps.map((s) => { const b = el('button', `chip next-${s.kind}`, s.label); b.type = 'button'; b.onclick = () => act(s, b); return b; });
      const more = el('button', 'chip ghost', '其他問題');
      more.type = 'button';
      more.onclick = showDefaults;
      chips.replaceChildren(el('span', 'next-title', '接下來可以'), ...btns, more);
    }

    // @ 點名：輸入 @ 時顯示可點名的小幫手
    input.addEventListener('input', () => {
      mention.replaceChildren();
      if (!/@$/.test(input.value)) return;
      for (const r of A.mentions) {
        const b = el('button', `chip r-${ROLE_CLASS[r]}`, `@${r}`);
        b.type = 'button';
        b.onclick = () => { input.value = `${input.value}${r} `; mention.replaceChildren(); input.focus(); };
        mention.append(b);
      }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
    // 從首頁帶問題過來（#/agent?q=…）：直接送出，並把網址換掉，避免重新整理時重送
    if (query.q) { const q0 = query.q; window.history.replaceState(null, '', agentId === 'life' ? '#/agent' : `#/agent/${agentId}`); queueMicrotask(() => send(q0)); }

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
        await runAgent({ messages: history.slice(-10), ...(context && { context }) }, (e) => {
          // 隱私：防詐頁貼上的內容只送給本站伺服器分析，不保存（AGENT_ANTIFRAUD.md §1）
          if (e.type === 'status' && MODE_TEXT[e.mode]) modeLine.textContent = MODE_TEXT[e.mode](e.model || '');
          view.push(e);
        }, { agentId });
        await view.flush();
        if (view.text) history.push({ role: 'assistant', content: view.text.slice(0, 500) });
        showNext(view);
      } catch {
        turn.append(el('div', 'msg error', '連線中斷了，請再試一次。'));
      } finally {
        busy = false; sendBtn.disabled = false; context = '';
        if (!matchMedia('(pointer: coarse)').matches) input.focus(); // 手機不自動聚焦：鍵盤會跳出來蓋住回答
      }
    }

    /** 一輪對話的畫面：事件依序呈現；討論串兩則之間至少 300ms（只為避免閃爍） */
    function turnView(turn) {
      const thread = el('div', 'thread live');
      thread.setAttribute('aria-label', '小幫手討論串');
      // 會議感（原型 transit-discussion.html）：討論中有標題與跳動的點，結束後收合成摘要
      thread.append(el('div', 'thread-head', el('span', 'th-title', '小幫手討論中'), el('span', 'say typing', ...typing('討論中'))));
      const results = el('div', 'results');
      turn.append(thread, results);
      const bubbles = new Map();
      const roles = []; // 本輪回報的小幫手角色（決策圖的資料欄）
      let queue = Promise.resolve();
      let lastShown = 0;
      let textEl = null;
      const view = { text: '', results: [], decision: null, box: null }; // results／decision：給「接下來可以…」
      const gap = async () => {
        if (reducedMotion()) return;
        const wait = MIN_GAP_MS - (performance.now() - lastShown);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastShown = performance.now();
      };
      // 等模型時（真實的等待，不是假延遲）：超過 0.6 秒沒有新事件就顯示「阿幫在想…」，有事件就收起
      let thinking = null, thinkTimer = null, ended = false;
      const stopThinking = () => { clearTimeout(thinkTimer); thinking?.remove(); thinking = null; };
      const armThinking = () => {
        stopThinking();
        if (ended) return;
        thinkTimer = setTimeout(() => {
          if (ended) return;
          thinking = el('div', 'bubble agent thinking', avatar('阿幫'), el('div', 'say typing', el('span', 'th-label', '阿幫在想'), ...typing('阿幫在想')));
          (thread.classList.contains('collapsed') ? turn : thread).append(thinking); // 討論收合後（等最後回答）改放在卡片下面
        }, 600);
      };
      const handle = async (e) => {
        stopThinking();
        if (e.type === 'done' || e.type === 'error' || e.type === 'text') ended = true;
        try { await handleEvent(e); } finally { armThinking(); }
      };
      const handleEvent = async (e) => {
        switch (e.type) {
          case 'status':
            turn.dataset.mode = e.mode;
            break;
          case 'agent_note':
            await gap();
            thread.append(el('div', 'bubble agent', avatar('阿幫'), el('div', 'say', withMentions(e.text))));
            break;
          case 'client_tool_call':
            thread.append(el('div', 'bubble tool', avatar('定位'), el('div', 'say typing', ...typing('定位中'))));
            break;
          case 'tool_start': {
            if (!roles.includes(e.role)) roles.push(e.role);
            const b = el('div', 'bubble tool', avatar(e.role), el('div', 'say typing', ...typing()), el('small', 'src', `${e.name} · ${e.server}`));
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
              if (e.ok && e.mode === 'demo') b.querySelector('.src').append(' · ', el('span', 'src-demo', '示範資料'));
              // 這筆資料對決策的影響（core/agent/impact.js）：不利／有利／不影響
              if (e.ok && e.impact) say.after(el('div', `impact ${e.impact.tone}`, el('span', 'arrow', '→'), e.impact.text));
            }
            if (e.ok) view.results.push({ tool: e.tool, card: e.card, data: e.data, args: e.args });
            if (e.ok && e.card) {
              const slot = el('div', `card-slot ${results.children.length >= 2 ? 'scroll-in' : 'enter3d'}`); // 前兩張立體進場，後面的捲到才浮現
              results.append(slot);
              cards.push(renderCard(slot, { card: e.card, v: e.v, mode: e.mode, speak: e.speak, data: e.data, tool: e.tool, args: e.args }, host));
            }
            break;
          }
          case 'discussion_end': {
            const n = e.tools.length;
            // 摘要：參與的小幫手頭像疊在一起＋工具數；點開再看討論過程
            const stack = el('span', 'av-stack', ...roles.slice(0, 6).map((r) => avatar(r)));
            const sum = el('button', 'thread-sum', stack, el('span', null, `小幫手討論完成・${n} 個工具・${e.servers.length} 個 MCP`));
            sum.type = 'button';
            sum.setAttribute('aria-expanded', 'false');
            sum.onclick = () => {
              const open = thread.classList.toggle('open');
              sum.setAttribute('aria-expanded', String(open));
              if (open) motion()?.fromTo(thread, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.3, ease: 'power2.out', clearProps: 'height,opacity' });
            };
            thread.classList.remove('live');
            thread.querySelector('.thread-head')?.remove();
            const g = motion();
            const collapse = () => { thread.classList.add('collapsed'); thread.before(sum); };
            if (g) g.to(thread, { height: 0, opacity: 0, marginTop: 0, duration: 0.35, ease: 'power2.inOut', onComplete: () => { g.set(thread, { clearProps: 'height,opacity,marginTop' }); collapse(); g.from(sum.querySelectorAll('.avatar'), { scale: 0, duration: 0.25, stagger: 0.05, ease: 'back.out(2.5)', clearProps: 'transform' }); } });
            else collapse();
            break;
          }
          case 'decision': {
            const box = el('section', 'decision enter3d');
            box.setAttribute('aria-label', '決策圖');
            if (reducedMotion()) box.classList.add('static');
            results.prepend(box);
            view.decision = e; view.box = box;
            const mod = await decideModule;
            if (mod) renderDecision(box, e, { sources: roles.filter((r) => r !== '行程'), decide: mod.decide, CRITERIA: mod.CRITERIA, onPick: (o) => !busy && send(`改成${o.name}`) }).played.then(() => handoff(box, results, e));
            else box.append(el('p', 'dg-why', e.reason)); // 載不到引擎時至少顯示理由
            break;
          }
          case 'text':
            if (!textEl) { textEl = el('div', 'bubble agent final', avatar('阿幫', 'happy'), el('div', 'say')); turn.append(textEl); }
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
