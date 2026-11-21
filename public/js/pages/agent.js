// 網頁 agent 頁（M5-08，UX.md §3–§4、§8、§10）：對話、小幫手討論串、@點名、建議問題；由真實 NDJSON 事件驅動。
// 卡片用 public/ui/cards（renderCard＋web host）。不加假延遲：只在討論串兩則訊息之間保留最短 300ms 避免閃爍（UX.md §4）。
import { API_BASE, IN_APP } from '../base.js';
import { t as cardT } from '../../ui/cards/i18n/zh-TW.js';
import { runAgent, browserLocation, locationGranted } from '../agent/client.js';
import { locationHelp, openLocationSettings, OPEN_FAILED } from '../location-help.js';
import { edgeJudge, edgePrewarm } from '../edge-judge.js';
import { placesFor } from '../saved-places.js';
import { icons } from '../icons.js';
import { motion } from '../../ui/cards/motion.js';
import { token } from '../../ui/cards/mode-icons.js';
import { nextSteps } from '../agent/next-steps.js';
import { alightWatch } from '../alight.js';
import { renderCard } from '../../ui/cards/index.js';
import { createWebHost } from '../../ui/cards/host-web.js';
import { renderDecision, lite, roleEn } from '../../ui/agent/decision-graph.js';

// 決策圖重算用的同一份 decide.js（伺服器以 /core/decide.js 提供；UX.md §5）
const decideModule = import('/core/decide.js').catch(() => null);

const MIN_GAP_MS = 300;
// 小幫手頭像：每個角色一個線條圖示（public/js/icons.js，與首頁格子同一套）；阿幫用吉祥物
const ROLE_ICON = { 地點: 'pin', 天氣: 'sun', 公車: 'bus', YouBike: 'bike', 高鐵: 'hsr', 台鐵: 'train', 捷運: 'metro', 路況: 'traffic', 客運: 'coach', 票價: 'ticket', 叫車: 'car', 訂票: 'ticket',
  行程: 'route', 車站: 'train', 定位: 'locate', 空品: 'air', 地震: 'quake', 藥局: 'pharmacy', 垃圾車: 'trash', 油價: 'fuel', 發票: 'receipt', 股市: 'chart', 防詐: 'shield', 網址: 'link', 闢謠: 'myth', 號碼: 'phone' };
const ROLE_CLASS = { 防詐: 'bad', 網址: 'bad', 闢謠: 'fare', 號碼: 'tra', 地點: 'place', 天氣: 'place', 公車: 'bus', YouBike: 'bike', 高鐵: 'rail', 台鐵: 'tra', 捷運: 'brand', 路況: 'car', 客運: 'car', 票價: 'fare', 叫車: 'car', 訂票: 'rail', 行程: 'brand', 車站: 'tra', 定位: 'place', 空品: 'place', 地震: 'bad', 藥局: 'bike', 垃圾車: 'car', 油價: 'fare', 發票: 'fare', 股市: 'fare' };
/** 每個 agent 的 @點名、標題與輸入提示（角色名稱與 core/agent/events.js TOOL_ROLES 一致） */
/** 保留對話的鍵：只有生活 agent 保留（防詐貼上的內容離開就清掉，共用手機時不留在畫面上） */
export const keptKey = (id) => (!id || id === 'life' || !AGENTS[id] ? 'agent' : null);
const AGENTS = {
  life: { title: '問阿幫', placeholder: '想去哪裡、想查什麼？例如：去台北 101', mentions: ['地點', '天氣', '路況', '公車', 'YouBike', '捷運', '高鐵', '台鐵', '票價', '叫車', '空品', '地震', '藥局', '垃圾車', '油價', '發票', '股市'] },
  antifraud: { title: '阿幫・防詐', placeholder: '把可疑的簡訊、LINE 訊息或網址貼上來', mentions: ['防詐', '網址', '闢謠', '號碼'] },
};
// 討論串裡認得的點名：可點名的小幫手＋程式自己會點的（定位、行程…）；長的先比（「垃圾車」不被「垃圾」截掉）
const MENTIONS = [...new Set([...Object.values(AGENTS).flatMap((a) => a.mentions), ...Object.keys(ROLE_CLASS)])].sort((a, b) => b.length - a.length);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 安全建立元素（不用 innerHTML，事件內容來自伺服器與上游資料） */
function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

/** 文字中的 @角色 換成色彩 chip */
function withMentions(text, lang = null) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(/@([一-龥A-Za-z]{2,7})/g)) {
    const role = MENTIONS.find((r) => m[1].startsWith(r));
    if (!role) continue;
    out.push(text.slice(last, m.index), el('span', `mention r-${ROLE_CLASS[role] || 'brand'}`, `@${lang === 'en' ? roleEn(role) : role}`)); // 英文那一輪：點名也用英文（S12f）
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
/** 定位結果的一句話（不分行程或附近查詢都通順；沒拿到時說下一步，CLAUDE.md 規則 6；預設起點由總結說明，這裡不先講） */
export function locateSay({ ok, reason }, lang = null) {
  const en = lang === 'en';
  if (ok) return en ? 'Got it, using your location' : '拿到了，用你現在的位置';
  if (reason === 'outside') return en ? "You're outside Taiwan; type a place instead" : '你的位置不在台灣，阿幫查不到附近資料；可以直接打地點';
  if (reason === 'denied') return en ? "Location permission is off; type a place or allow location in Settings" : '定位權限沒有打開；可以直接打地點，或到設定允許定位';
  if (reason === 'off') return en ? 'Location services are off; type a place or turn them on' : '手機的定位服務是關的；可以直接打地點，或打開定位服務';
  if (reason === 'timeout') return en ? 'Location took too long; type a place or try again' : '定位太久沒有回應；可以直接打地點，或稍後再試';
  return en ? "Couldn't get your location; type a place or turn on location" : '沒拿到你的位置；可以直接打地點，或到手機設定打開定位';
}

/** 天氣、空品、出門建議卡片：{ 鍵（工具＋測站）, 值（主要數字）, 收合時的說明 }；其他卡片不收合 */
function cardFacts(e, lang) {
  const d = e.data || {};
  const en = lang === 'en';
  if (e.tool === 'weather_now') return { key: `w|${d.station}`, val: `${d.tempC}|${d.raining}|${d.pop3h}`, say: en ? `Weather same as above (${d.tempC ?? '—'}°C${d.pop3h != null ? `, rain ${d.pop3h}%` : ''})` : `天氣同上（${d.station} ${d.tempC ?? '—'}°C${d.pop3h != null ? `、降雨 ${d.pop3h}%` : ''}）` };
  if (e.tool === 'aqi_nearby' && d.nearest) return { key: `a|${d.nearest.site}`, val: `${d.nearest.aqi}`, say: en ? `Air same as above (AQI ${d.nearest.aqi})` : `空品同上（${d.nearest.site} AQI ${d.nearest.aqi}）` };
  if (e.tool === 'outing_advice' && d.items) return { key: `o|${d.weather?.station}|${d.air?.site}`, val: `${d.weather?.tempC}|${d.weather?.pop3h}|${d.air?.aqi}|${d.items.map((x) => x.kind).join(',')}`, say: en ? 'Outing tips same as above' : `出門建議同上（${d.items.map((x) => x.text.split('，')[0]).join('、').slice(0, 30)}）` };
  return null;
}

function typing(label = '輸入中') {
  const d = el('span', 'dots');
  d.append(el('i'), el('i'), el('i'));
  const sr = el('span', 'sr-only', `${label}…`);
  return [d, sr];
}

/** 頭像；阿幫有表情：think（查詢中，輕輕擺動）、happy（找到答案，跳一下） */
function avatar(role, mood = 'think', lang = null) {
  const a = el('span', `avatar r-${ROLE_CLASS[role] || 'brand'}`);
  a.setAttribute('role', 'img');
  const name = lang === 'en' ? roleEn(role) : role; // 讀屏與提示：英文那一輪用英文
  a.setAttribute('aria-label', name);
  a.title = name;
  if (role === '阿幫') { a.classList.add('mascot', mood); a.append(Object.assign(document.createElement('img'), { src: mood === 'happy' ? '/brand/abang-happy.svg' : '/brand/abang-think.svg', alt: '' })); }
  else if (icons[ROLE_ICON[role]]) a.innerHTML = icons[ROLE_ICON[role]]; // 圖示是本機常數 SVG，不含外部資料
  else a.textContent = role.slice(0, 2);
  return a;
}
const metricsText = (m) => (m ? [m.scanned ? `${m.scanned} 筆` : null, m.cacheHit ? '快取' : null, `${m.ms}ms`].filter(Boolean).join(' · ') : '');

export default {
  title: '問阿幫',
  keepAlive: true, // 換頁不清掉對話（app.js、abang-dock.js）；浮動阿幫的底部對話也是這一個
  render({ main, setTitle, onCleanup, params = [], query = {} }) {
    // 手機 App：起點預設是現在位置
    // 已經允許過定位才先定位（不在使用者還沒發問時就跳權限框；第一次在需要位置時才問，審查建議）
    if (IN_APP) locationGranted().then((ok) => { if (ok) browserLocation(); });
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
    let turnNo = 0; // 第幾輪：只有最近兩輪的卡片自動刷新（對話一直保留，舊卡片不再查，省流量與電）
    let pendingQ = null; // 阿幫還在回答時又問（提醒泡泡、首頁帶來的問題）：答完接著問，不丟掉（含這一頁的說明）
    const seenCards = new Map(); // 上一輪的天氣、空品（接著問時沒變就收合「同上」；鍵含測站，同一輪起訖點兩張不互蓋）
    /** 這張卡跟上一輪同一個測站的一樣嗎：一樣回收合說明，否則記下並回 null */
    const sameAs = (e, follow, lang) => {
      const f = cardFacts(e, lang);
      if (!f) return null;
      const same = follow && seenCards.get(f.key) === f.val;
      seenCards.set(f.key, f.val);
      return same ? f.say : null;
    };
    onCleanup(() => cards.forEach((c) => c.destroy()));

    const log = el('div', 'chat');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    const chips = el('div', 'suggest');
    const pageRow = el('div', 'suggest page-ask'); // 浮動阿幫：在這一頁可以問（abang-dock.js setPage）
    pageRow.hidden = true;
    const mention = el('div', 'mention-bar');
    const input = el('input', 'chat-input');
    Object.assign(input, { placeholder: A.placeholder, enterkeyhint: 'send', autocomplete: 'off', maxLength: 500 });
    input.setAttribute('aria-label', A.title);
    const sendBtn = el('button', 'btn chat-send', '送出');
    sendBtn.type = 'submit';
    const form = el('form', 'chat-form', input, sendBtn);
    const disclaimer = el('p', 'updated');
    const modeLine = el('p', 'updated agent-mode');
    modeLine.setAttribute('aria-live', 'polite'); // 換模式或改在手機上判斷時唸出來 // 由誰回答（ADR-0012；Claude 模式說明對話會送 Anthropic，AGENT.md §7）
    // 說明起點是現在位置（第一次需要位置時才跳權限框，先讓使用者知道為什麼）；拒絕定位時阿幫會問從哪出發
    const hereHint = agentId === 'life' && el('p', 'updated here-hint', '沒說起點時，阿幫用你現在的位置當出發點。');
    main.append(log, el('div', 'chat-dock', pageRow, chips, mention, form), ...(hereHint ? [hereHint] : []), disclaimer, modeLine);
    const MODE_TEXT = {
      claude: (m) => `由 Claude（${m}）回答；對話會送 Anthropic 處理。`,
      local: (m) => `由地端模型（${m}）回答；對話只送到本站設定的模型伺服器。`,
      demo: () => '示範模式：規則式回答，不經 AI 模型。',
    };
    // 裝置端 AI（ADR-0014）：在手機上判斷時，說明多一句（判斷不離開手機的模型，只送結果）
    const ENGINE_TEXT = { apple: 'Apple Intelligence', 'gemini-nano': 'Gemini Nano' };
    const modeText = (e) => `${MODE_TEXT[e.mode](e.model || '')}${e.judge?.source === 'device' && ENGINE_TEXT[e.judge.engine] ? `阿幫先在手機上用 ${ENGINE_TEXT[e.judge.engine]} 聽懂你要做什麼。` : ''}`;
    if (agentId === 'life') edgePrewarm();

    let lastTripTo = null; // 最後一次行程的目的地：設定到站提醒時記下（公車一直不來時改其他方式）
    const host = createWebHost({ ask: (q) => send(q), setContext: (c) => { context = c; }, tripContext: () => lastTripTo && { to: lastTripTo } });

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
    let lastView = null;
    // 在卡片或公車頁設定／取消到站提醒後，下一步建議跟著更新（已提醒就不再建議）
    const onWatch = () => { if (lastView && chips.classList.contains('next')) showNext(lastView); };
    window.addEventListener('abang:arrival-watch', onWatch);
    onCleanup(() => window.removeEventListener('abang:arrival-watch', onWatch));
    function showNext(view) {
      lastView = view;
      const steps = nextSteps(view.results, view.decision, { watching: host.arrivalWatch?.(), riding: alightWatch(), lang: view.lang });
      if (!steps.length) { showDefaults(); return; }
      chips.classList.add('next');
      const act = async (s, b) => {
        if (s.kind === 'ask') return send(s.payload);
        if (s.kind === 'navigate') return host.navigate(s.payload);
        if (s.kind === 'state') { // 在這一輪的決策圖加狀態，瀏覽器立即重算
          const add = view.box?.querySelector(`.dg-chip.add[data-state="${s.payload}"]`); // 用狀態鍵對（英文的決策圖文字不同）
          add?.click();
          view.box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          b.remove();
          return undefined;
        }
        if (s.kind === 'remind') {
          await host.watchArrival(s.payload);
          log.append(el('p', 'agent-sys', view.lang === 'en' ? `OK, I'll remind you ${s.payload.minutes} min before bus ${s.payload.routeName} reaches ${s.payload.stop}.` : `好，${s.payload.routeName} 到「${s.payload.stop}」前 ${s.payload.minutes} 分提醒你（${cardT(`busRoute.${host.arrivalNote?.() || 'whenOpenPage'}`)}）。`));
          return showNext(view);
        }
        return undefined;
      };
      const btns = steps.map((s) => { const b = el('button', `chip next-${s.kind}`, s.label); b.type = 'button'; b.onclick = () => act(s, b); return b; });
      const more = el('button', 'chip ghost', view.lang === 'en' ? 'Ask something else' : '其他問題');
      more.type = 'button';
      more.onclick = showDefaults;
      chips.replaceChildren(el('span', 'next-title', view.lang === 'en' ? 'Try next' : '接下來可以'), ...btns, more);
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
    // 從首頁帶問題過來（#/agent?q=…）：直接送出，並把網址換掉，避免重新整理時重送（對話保留時，回來帶的問題接在後面）
    const takeQuery = (qy = {}) => { if (qy.q) { const q0 = qy.q; window.history.replaceState(null, '', agentId === 'life' ? '#/agent' : `#/agent/${agentId}`); queueMicrotask(() => send(q0)); } };
    takeQuery(query);

    async function send(raw, { pageContext = '' } = {}) {
      const q = String(raw || '').trim().slice(0, 500);
      if (!q) return;
      if (busy) { pendingQ = { q, pageContext }; return; }
      turnNo += 1;
      for (const c of cards) if (c.turn < turnNo - 1) c.stop?.();
      busy = true; sendBtn.disabled = true; input.value = ''; mention.replaceChildren();
      pageRow.hidden = true;
      history.push({ role: 'user', content: q });
      log.append(el('div', 'msg user', q));
      const turn = el('div', 'turn');
      log.append(turn);
      const view = turnView(turn, /[A-Za-z]{2,}/.test(q) && !/[一-鿿]/.test(q) ? 'en' : null); // 先猜（第一個畫面用）；伺服器的 status 事件會說這一輪真正的語言
      try {
        // 手機 App：先在裝置上判斷意圖與狀態（最多等 1.8 秒；不可用就不帶，伺服器照常判斷）
        const deviceJudge = agentId === 'life' ? await edgeJudge(q, history.slice(0, -1).filter((m) => m.role === 'user').map((m) => m.content)) : null;
        // 常用地點：只送這段對話提到的（「回家」才送家）
        const savedPlaces = agentId === 'life' ? placesFor(history.slice(-10).filter((m) => m.role === 'user').map((m) => m.content)) : undefined;
        const ctxText = [context, pageContext].filter(Boolean).join('；').slice(0, 200);
        await runAgent({ messages: history.slice(-10), ...(ctxText && { context: ctxText }), ...(deviceJudge && { deviceJudge }), ...(savedPlaces && { savedPlaces }) }, (e) => {
          // 隱私：防詐頁貼上的內容只送給本站伺服器分析，不保存（AGENT_ANTIFRAUD.md §1）
          if (e.type === 'status' && MODE_TEXT[e.mode]) modeLine.textContent = modeText(e);
          view.push(e);
        }, { agentId });
        await view.flush();
        if (view.text) history.push({ role: 'assistant', content: view.text.slice(0, 500) });
        showNext(view);
      } catch {
        turn.append(el('div', 'msg error', '連線中斷了，請再試一次。'));
      } finally {
        busy = false; sendBtn.disabled = false; context = '';
        if (pendingQ) { const p = pendingQ; pendingQ = null; queueMicrotask(() => send(p.q, { pageContext: p.pageContext })); }
        if (!matchMedia('(pointer: coarse)').matches) input.focus(); // 手機不自動聚焦：鍵盤會跳出來蓋住回答
      }
    }

    /** 一輪對話的畫面：事件依序呈現；討論串兩則之間至少 300ms（只為避免閃爍） */
    function turnView(turn, turnLang = null) {
      const thread = el('div', 'thread live');
      thread.setAttribute('aria-label', turnLang === 'en' ? 'Helper thread' : '小幫手討論串');
      // 會議感（原型 transit-discussion.html）：討論中有標題與跳動的點，結束後收合成摘要
      thread.append(el('div', 'thread-head', el('span', 'th-title', turnLang === 'en' ? 'Checking live data…' : '小幫手討論中'), el('span', 'say typing', ...typing(turnLang === 'en' ? 'checking' : '討論中'))));
      const results = el('div', 'results');
      turn.append(thread, results);
      const bubbles = new Map();
      const roles = []; // 本輪回報的小幫手角色（決策圖的資料欄）
      let queue = Promise.resolve();
      let lastShown = 0;
      let textEl = null;
      const view = { text: '', results: [], decision: null, box: null, lang: turnLang }; // results／decision：給「接下來可以…」；lang：英文那一輪
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
          thinking = el('div', 'bubble agent thinking', avatar('阿幫', 'think', turnLang), el('div', 'say typing', el('span', 'th-label', turnLang === 'en' ? 'Abang is thinking' : '阿幫在想'), ...typing(turnLang === 'en' ? 'Abang is thinking' : '阿幫在想')));
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
            if (e.lang) { turnLang = e.lang === 'en' ? 'en' : null; view.lang = turnLang; } // 伺服器說這一輪用哪種語言（S12g）；送出前的猜測只用在「討論中」等第一個畫面
            break;
          case 'agent_note':
            await gap();
            if (/^沿用：/.test(e.text)) turn.dataset.follow = '1'; // 接著改的那一輪：沒變的天氣空品才收合（直接問天氣時卡片就是答案，不收合）
            thread.append(el('div', 'bubble agent', avatar('阿幫', 'think', turnLang), el('div', 'say', withMentions(e.text, turnLang))));
            break;
          case 'context_reset': { // 「重來」：分隔線插在「重來」泡泡前面＋前面的對話與提問變淡（不清空，回得去看）
            if (turn.dataset.reset) break; // 同一輪只處理一次
            turn.dataset.reset = '1';
            const ask = turn.previousElementSibling;
            for (const t of log.querySelectorAll('.turn, .msg.user')) if (t !== turn && t !== ask) t.classList.add('past');
            seenCards.clear();
            const line = el('div', 'thread-reset', el('span', '', '重新開始'));
            line.setAttribute('role', 'separator');
            line.setAttribute('aria-label', '重新開始，前面的對話不再沿用');
            (ask?.classList.contains('user') ? ask : turn).before(line);
            thread.hidden = true; // 「重來」沒有查工具，不顯示空的「小幫手討論中」
            break;
          }
          case 'client_tool_call': {
            const b = el('div', 'bubble tool', avatar('定位', 'think', turnLang), el('div', 'say typing', ...typing(turnLang === 'en' ? 'locating' : '定位中')));
            bubbles.set(`client:${e.id}`, b);
            thread.append(b);
            break;
          }
          case 'client_tool_result': { // 客戶端自己送的（client.js）：定位完成或失敗，把「定位中」換成結果
            const say = bubbles.get(`client:${e.id}`)?.querySelector('.say');
            if (say) {
              say.className = 'say'; say.textContent = locateSay(e, turnLang);
              if (!e.ok && locationHelp(e.reason).canOpen) { // App：權限或定位服務關著 → 一鍵到設定（S1c）
                const b = el('button', 'btn small loc-open', turnLang === 'en' ? 'Open Settings' : '到設定開啟');
                b.type = 'button';
                b.addEventListener('click', async () => { if (!(await openLocationSettings(e.reason))) { b.disabled = true; b.textContent = turnLang === 'en' ? "Couldn't open Settings" : OPEN_FAILED; } });
                say.after(b);
              }
            }
            break;
          }
          case 'tool_start': {
            if (!roles.includes(e.role)) roles.push(e.role);
            const b = el('div', 'bubble tool', avatar(e.role, 'think', turnLang), el('div', 'say typing', ...typing(turnLang === 'en' ? 'checking' : '輸入中')), el('small', 'src', `${e.name} · ${e.server}`));
            bubbles.set(e.id, b);
            thread.append(b);
            break;
          }
          case 'tool_result': {
            await gap();
            if (e.ok && e.tool === 'plan_trip' && e.data?.to?.name) lastTripTo = e.data.to.name;
            const b = bubbles.get(e.id);
            const say = b?.querySelector('.say');
            if (say) {
              say.classList.remove('typing');
              say.textContent = e.ok ? (e.speak || '查好了') : `這次沒查到（${e.error}）`;
              if (!e.ok) b.classList.add('failed');
              if (e.ok && e.metrics) b.querySelector('.src').append(` · ${metricsText(e.metrics)}`);
              if (e.ok && e.mode === 'demo') b.querySelector('.src').append(' · ', el('span', 'src-demo', turnLang === 'en' ? 'Demo data' : '示範資料'));
              // 這筆資料對決策的影響（core/agent/impact.js）：不利／有利／不影響
              if (e.ok && e.impact) say.after(...[e.impact].flat().map((x) => el('div', `impact ${x.tone}`, el('span', 'arrow', '→'), x.text)));
            }
            if (e.ok) view.results.push({ tool: e.tool, card: e.card, data: e.data, args: e.args });
            if (e.ok && e.card) {
              // 接著問的那一輪，天氣、空品跟上一輪一樣：收合成「天氣同上」（點開看完整卡片），畫面不會越拉越長
              const same = sameAs(e, turn.dataset.follow === '1', turnLang);
              const payload = { card: e.card, v: e.v, mode: e.mode, speak: e.speak, data: e.data, tool: e.tool, args: e.args, ...(turnLang === 'en' && { lang: 'en' }) }; // 觀光客用英文問：卡片標籤用英文（S12b）
              if (same) { // 點開才畫卡片（不播進場動畫）
                const slot = el('div', 'card-slot');
                const box = el('details', 'card-same');
                box.append(el('summary', '', el('span', 'same-text', same), el('span', 'same-open', turnLang === 'en' ? 'Show card' : '看完整')), slot);
                box.addEventListener('toggle', () => { if (box.open && !slot.childElementCount) cards.push(Object.assign(renderCard(slot, payload, host), { turn: turnNo })); });
                results.append(box);
              } else {
                const slot = el('div', `card-slot ${results.children.length >= 2 ? 'scroll-in' : 'enter3d'}`); // 前兩張立體進場，後面的捲到才浮現
                results.append(slot);
                cards.push(Object.assign(renderCard(slot, payload, host), { turn: turnNo }));
              }
            }
            break;
          }
          case 'discussion_end': {
            const n = e.tools.length;
            // 摘要：參與的小幫手頭像疊在一起＋工具數；點開再看討論過程
            const stack = el('span', 'av-stack', ...roles.slice(0, 6).map((r) => avatar(r, 'think', turnLang)));
            const sum = el('button', 'thread-sum', stack, el('span', null, turnLang === 'en' ? `Checked ${n} source${n === 1 ? '' : 's'}` : `小幫手討論完成・${n} 個工具・${e.servers.length} 個 MCP`));
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
            box.setAttribute('aria-label', turnLang === 'en' ? 'How Abang decided' : '決策圖');
            if (reducedMotion()) box.classList.add('static');
            results.prepend(box);
            view.decision = e; view.box = box;
            const mod = await decideModule;
            if (mod) renderDecision(box, e, { sources: roles.filter((r) => r !== '行程'), decide: mod.decide, CRITERIA: mod.CRITERIA, lang: turnLang, onPick: (o) => !busy && send(turnLang === 'en' ? `Switch to ${({ walk: 'walking', bike: 'YouBike', bus: 'bus', metro: 'MRT', thsr: 'high speed rail', tra: 'train', intercity: 'intercity bus', ridehail: 'taxi' })[o.role] || o.name} instead` : `改成${o.name}`) }).played.then(() => handoff(box, results, e));
            else box.append(el('p', 'dg-why', e.reason)); // 載不到引擎時至少顯示理由
            break;
          }
          case 'guardrail': // 安全情境（S18）：求助電話做成一鍵撥號，接在回答下面
            if (e.calls?.length) view.calls = e.calls;
            break;
          case 'text':
            if (!textEl) { textEl = el('div', 'bubble agent final', avatar('阿幫', 'happy', turnLang), el('div', 'say')); turn.append(textEl); }
            view.text += e.delta;
            textEl.querySelector('.say').textContent = view.text;
            if (view.calls && !textEl.querySelector('.call-row')) {
              const row = el('div', 'call-row');
              for (const c of view.calls) { const a = el('a', 'btn small call', c.label); a.href = `tel:${String(c.tel).replace(/[^0-9]/g, '')}`; row.append(a); }
              textEl.append(row);
            }
            // 英文回答（觀光客，S12）：讀屏用英文念（頁面是 zh-Hant-TW）
            if (/^[A-Za-z"'(]/.test(view.text)) textEl.querySelector('.say').setAttribute('lang', 'en'); else textEl.querySelector('.say').removeAttribute('lang');
            if (view.text.includes('設定與隱私 → 常用地點') && !textEl.querySelector('.go-settings')) { // 「回家」但沒設定家：給一個直接過去的按鈕
              const a = el('a', 'btn small go-settings', '到常用地點設定');
              a.href = '#/settings';
              textEl.append(a);
            }
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
    // 給 app.js／浮動阿幫用：回到這頁、阿幫主動說一句（提醒）、聚焦輸入框、代問、有沒有對話
    const api = {
      show: (qy) => { api.setPage(null); takeQuery(qy); }, // 整頁：不是從哪一頁打開，拿掉「在這頁可以問」
      say(text, action = null) {
        const p = el('div', 'agent-say');
        p.append(avatar('阿幫', 'happy'), el('p', 'say', text));
        if (action?.ask) { const b = el('button', 'btn small', action.label || '問阿幫'); b.type = 'button'; b.onclick = () => send(action.ask); p.append(b); }
        log.append(p);
      },
      focus: () => input.focus({ preventScroll: true }),
      ask: (q) => send(q),
      hasChat: () => history.length > 0,
      /** 從哪一頁打開（浮動阿幫）：那一頁可以問的問題；點了才把這一頁的說明一起送（自己打的問題不帶）；null＝清掉 */
      setPage(hint) {
        const pc = String(hint?.context || '');
        const qs = (hint?.chips || []).slice(0, 3);
        pageRow.hidden = !qs.length;
        pageRow.replaceChildren(...(qs.length ? [el('span', 'next-title', '在這頁可以問'), ...qs.map((q) => { const b = el('button', 'chip', q); b.type = 'button'; b.onclick = () => send(q, { pageContext: pc }); return b; })] : []));
      },
    };
    return api;
  },
};
