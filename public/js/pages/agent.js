// 網頁 agent 頁（M5-08，UX.md §3–§4、§8、§10）：對話、小幫手討論串、@點名、建議問題；由真實 NDJSON 事件驅動。
// 卡片用 public/ui/cards（renderCard＋web host）。不加假延遲：只在討論串兩則訊息之間保留最短 300ms 避免閃爍（UX.md §4）。
import { API_BASE, IN_APP } from '../base.js';
import { t as cardT } from '../../ui/cards/i18n/zh-TW.js';
import { runAgent, browserLocation, locationGranted } from '../agent/client.js';
import { locationHelp, openLocationSettings, OPEN_FAILED } from '../location-help.js';
import { edgeJudge, edgePrewarm, edgeSuggest, edgeCanSuggest, edgeJudgeReady, judgeContext } from '../edge-judge.js';
import { edgeWrite, edgeWriteCaps, writeLine, writeModeText } from '../edge-write.js';
import { noteAgentStatus } from '../ai-info.js';
import { mountThinking, deviceLine } from '../agent/thinking.js';
import { mountVoiceUI } from '../agent/voice-ui.js';
import { placesFor, loadPlaces } from '../saved-places.js';
import { icons } from '../icons.js';
import { motion } from '../../ui/cards/motion.js';
import { token } from '../../ui/cards/mode-icons.js';
import { nextSteps } from '../agent/next-steps.js';
import { suggestContext, contextText, ruleAsks, pickSuggestions, validateAsks, pruneAfterSend, SUGGEST_WAIT_MS } from '../agent/suggest.js';
import { busT } from './bus-i18n.js';
import { peekNow } from '../home-now.js';
import { alightWatch } from '../alight.js';
import { loadChat, saveChat, clearChat } from '../chat-store.js';
import { habitRequest, noteDecision, applyStore, markAsked, questionAskedRecently, markQuestion } from '../habits.js';
import { mountAsk, matchAnswer } from '../../ui/agent/ask.js';
import { renderCard } from '../../ui/cards/index.js';
import { createWebHost } from '../../ui/cards/host-web.js';
import { renderDecision, lite, roleEn } from '../../ui/agent/decision-graph.js';
import { mountVisionButton, handOff, takeHandoff } from '../vision.js';
import { mountDramaHint, dramaHintOn } from '../drama-hint.js';
import { createRounds } from '../agent/collapse.js';
import { linkReminders } from '../agent/chat-links.js';

// 決策圖重算用的同一份 decide.js（伺服器以 /core/decide.js 提供；UX.md §5）
const decideModule = import('/core/decide.js').catch(() => null);

const MIN_GAP_MS = 300;
// 小幫手頭像：每個角色一個線條圖示（public/js/icons.js，與首頁格子同一套）；阿幫用吉祥物
const ROLE_ICON = { 地點: 'pin', 天氣: 'sun', 公車: 'bus', YouBike: 'bike', 高鐵: 'hsr', 台鐵: 'train', 捷運: 'metro', 路況: 'traffic', 客運: 'coach', 票價: 'ticket', 叫車: 'car', 訂票: 'ticket',
  行程: 'route', 車站: 'train', 定位: 'locate', 空品: 'air', 地震: 'quake', 藥局: 'pharmacy', 垃圾車: 'trash', 油價: 'fuel', 發票: 'receipt', 股市: 'chart', 防詐: 'shield', 網址: 'link', 闢謠: 'myth', 號碼: 'phone', 短劇: 'play' };
const ROLE_CLASS = { 防詐: 'bad', 網址: 'bad', 闢謠: 'fare', 號碼: 'tra', 地點: 'place', 天氣: 'place', 公車: 'bus', YouBike: 'bike', 高鐵: 'rail', 台鐵: 'tra', 捷運: 'brand', 路況: 'car', 客運: 'car', 票價: 'fare', 叫車: 'car', 訂票: 'rail', 行程: 'brand', 車站: 'tra', 定位: 'place', 空品: 'place', 地震: 'bad', 藥局: 'bike', 垃圾車: 'car', 油價: 'fare', 發票: 'fare', 股市: 'fare', 短劇: 'drama' };
/** 每個 agent 的 @點名、標題與輸入提示（角色名稱與 core/agent/events.js TOOL_ROLES 一致） */
/** 保留對話的鍵：只有生活 agent 保留（防詐貼上的內容離開就清掉，共用手機時不留在畫面上） */
export const keptKey = (id) => (!id || id === 'life' || !AGENTS[id] ? 'agent' : null);
const AGENTS = {
  life: { title: '問阿幫', placeholder: '想去哪裡、想查什麼？例如：去台北 101', mentions: ['地點', '天氣', '路況', '公車', 'YouBike', '捷運', '高鐵', '台鐵', '票價', '叫車', '空品', '地震', '藥局', '垃圾車', '油價', '發票', '股市', '短劇'] },
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
    let openAsk = null; // 阿幫問你（ADR-0016）：目前開著的問題；下一句對得上就是答案，對不上＝略過
    let askedLast = []; // 上一輪問過的題（about）：手機上的 AI 出題時不再問同一題（ADR-0020）
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
    // 長對話：舊的輪收成一行、換話題分段、「這次問過」目錄（agent/collapse.js）；收起的輪卡片停止刷新，展開時還在最近兩輪才恢復
    const rounds = createRounds({ log, onFold: (round, folded) => { for (const c of cards) if (c.slot && round.contains(c.slot)) { if (folded) c.stop?.(); else if (c.turn >= turnNo - 1) c.resume?.(); } } });
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
    // 阿幫會看（M14-02）：相機鍵。讀出來的字確認後才送；生活頁讀到可疑訊息先問，再轉到防詐頁（文字只在記憶體交過去）
    mountVisionButton(form, { profile: agentId, lang: () => lastView?.lang || null, callTool: (n, a) => host.callTool(n, a), ask: (q) => send(q),
      fill: (t) => { input.value = t; input.focus(); },
      scam: (t) => { if (agentId === 'antifraud') send(t); else { handOff('antifraud', t); location.hash = '#/agent/antifraud'; } } });
    const disclaimer = el('p', 'updated');
    const modeLine = el('p', 'updated agent-mode');
    modeLine.setAttribute('aria-live', 'polite'); // 換模式或改在手機上判斷時唸出來 // 由誰回答（ADR-0012；Claude 模式說明對話會送 Anthropic，AGENT.md §7）
    // 說明起點是現在位置（第一次需要位置時才跳權限框，先讓使用者知道為什麼）；拒絕定位時阿幫會問從哪出發
    const hereHint = agentId === 'life' && el('p', 'updated here-hint', '沒說起點時，阿幫用你現在的位置當出發點。');
    const dock = el('div', 'chat-dock', rounds.toLatest, pageRow, chips, mention, form);
    main.append(rounds.nav, log, dock, ...(hereHint ? [hereHint] : []), disclaimer, modeLine);
    // 語音問阿幫（M14-01）：麥克風鍵與在聽的面板（agent/voice-ui.js）；只有生活 agent（防詐是貼上訊息）
    const voice = agentId === 'life' ? mountVoiceUI({ form, sendBtn, dock, send: (q, o) => send(q, o) }) : null;
    // 上次的對話（只有文字、最後一次對話 12 小時內）：只顯示；按「接著上次問」才當成前文跟下一個問題一起送（隱私：沒按就不送，常用地點也不會因為昨天說過「回家」又送出）
    // 只有生活 agent（防詐不留）
    const past = agentId === 'life' ? loadChat() : null;
    let pastWrap = null;
    let gen = 0; // 清除本機資料時加一：還在回答的那一輪不再寫回對話或存起來
    if (past) {
      const d = new Date(past.at);
      const day = d.toDateString() === new Date().toDateString() ? '今天' : '昨天';
      const when = `${day} ${d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      const box = el('details', 'chat-past');
      box.append(el('summary', '', `上次的對話（${when}，${past.messages.length} 則）`), ...past.messages.map((m) => el('div', `msg ${m.role === 'user' ? 'user' : 'past-answer'}`, m.content)));
      const cont = el('button', 'btn small', '接著上次問');
      const fresh = el('button', 'btn small quiet', '不用了，重新開始');
      cont.type = 'button'; fresh.type = 'button';
      const acts = el('div', 'past-acts', cont, fresh);
      cont.onclick = () => { if (!history.length) history.push(...past.messages); acts.replaceChildren(el('span', 'past-note', '好，接下來的問題會接著上次的話問')); };
      fresh.onclick = () => { clearChat(); pastWrap.remove(); pastWrap = null; };
      pastWrap = el('div', 'chat-past-wrap', box, acts);
      log.append(pastWrap);
    }
    const MODE_TEXT = {
      claude: (m) => `由 Claude（${m}）回答；對話會送 Anthropic 處理。`,
      local: (m) => `由地端模型（${m}）回答；對話只送到本站設定的模型伺服器。`,
      demo: () => '示範模式：規則式回答，不經 AI 模型。',
      rules: () => '這題由內建規則回答（英文提問、油價發票股市地震這類查數字的，地端模型還不穩）；資料照常是即時的。',
      edge: () => '回答在手機上寫；伺服器只查資料、用程式排序，不經伺服器的 AI 模型。', // ADR-0017
    };
    // 裝置端 AI（ADR-0014）：在手機上判斷時，說明多一句（判斷不離開手機的模型，只送結果）
    // 頁底只說由誰回答；手機上的 AI 有沒有被採用寫在那一輪的回答上方（deviceLine，跟著那一輪的語言；不在兩處重複）
    const modeText = (e) => MODE_TEXT[e.mode](e.model || '');
    if (agentId === 'life') edgePrewarm();

    let lastTripTo = null; // 最後一次行程的目的地：設定到站提醒時記下（公車一直不來時改其他方式）
    const host = createWebHost({ ask: (q) => send(q), setContext: (c) => { context = c; }, tripContext: () => lastTripTo && { to: lastTripTo } });
    const clearLinks = agentId === 'life' ? linkReminders(host, rounds) : () => {}; // 提醒頁「看當時的對話」（只有保留的生活對話）

    // 建議問題與免責（GET /api/v1/agent/profile）。生活阿幫：輸入框上方與 placeholder 是動態的「下一句」（agent/suggest.js：情境規則，
    // App 裡手機上的 AI 先猜、伺服器規則驗證）；「更多例子／其他問題」才列 profile 的固定範例。防詐：固定建議＋回答後的下一步（next-steps.js）
    let defaults = [];
    const dynamic = agentId === 'life';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', '建議問題');
    let pinnedDefaults = false; // 按了「更多例子／其他問題」：固定範例留著，到下一輪或換頁才換回動態的
    const showDefaults = () => {
      pinnedDefaults = dynamic;
      chips.classList.remove('next');
      chips.dataset.sig = '';
      chips.replaceChildren(...defaults.map((q) => { const b = el('button', 'chip', q); b.type = 'button'; b.onclick = () => send(q); return b; }));
    };
    fetch(`${API_BASE}/api/v1/agent/profile?id=${agentId}`).then((r) => r.json()).then(({ data }) => {
      defaults = data.suggestions;
      if (!dynamic && !chips.classList.contains('next')) showDefaults();
      disclaimer.textContent = data.disclaimer;
    }).catch(() => {});
    let lastView = null;
    // 在卡片或公車頁設定／取消到站提醒後，下一步建議跟著更新（已提醒就不再建議）
    const onWatch = () => { if (busy) return; if (lastView && (dynamic ? !pinnedDefaults : chips.classList.contains('next'))) showNext(lastView); }; // 送出中不換（答完會依新的一輪重算）
    window.addEventListener('abang:arrival-watch', onWatch);
    onCleanup(() => window.removeEventListener('abang:arrival-watch', onWatch));
    const act = async (s, b, view) => {
      rounds.touch(view?.round); // 長對話：操作過的輪（提醒頁連回當時的對話）
      if (s.kind === 'ask') return send(s.q || s.payload, { follow: s.follow ?? s.src !== 'rule' }); // 接著這一輪問：不算換話題（動態建議的 follow 見 suggest.js isFollow）
      if (s.kind === 'navigate') return host.navigate(s.payload);
      if (s.kind === 'state') { // 在這一輪的決策圖加狀態，瀏覽器立即重算
        const add = view?.box?.querySelector(`.dg-chip.add[data-state="${s.payload}"]`); // 用狀態鍵對（英文的決策圖文字不同）
        add?.click();
        view?.box?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        b.remove();
        return undefined;
      }
      if (s.kind === 'remind') {
        await host.watchArrival(s.payload);
        (view?.round || log).append(el('p', 'agent-sys', view?.lang === 'en' ? `OK, I'll remind you ${s.payload.minutes} min before bus ${s.payload.routeName} reaches ${s.payload.stop}.` : `好，${s.payload.routeName} 到「${s.payload.stop}」前 ${s.payload.minutes} 分提醒你（${cardT(`busRoute.${host.arrivalNote?.() || 'whenOpenPage'}`)}）。`));
        return showNext(view);
      }
      return undefined;
    };
    function showNext(view) {
      lastView = view;
      if (dynamic) { pinnedDefaults = false; refreshSuggest(); return; }
      const steps = nextSteps(view.results, view.decision, { watching: host.arrivalWatch?.(), riding: alightWatch(), lang: view.lang });
      if (!steps.length) { showDefaults(); return; }
      chips.classList.add('next');
      const btns = steps.map((s) => { const b = el('button', `chip next-${s.kind}`, s.label); b.type = 'button'; b.onclick = () => act(s, b, view); return b; });
      const more = el('button', 'chip ghost', view.lang === 'en' ? 'Ask something else' : '其他問題');
      more.type = 'button';
      more.onclick = showDefaults;
      chips.replaceChildren(el('span', 'next-title', view.lang === 'en' ? 'Try next' : '接下來可以'), ...btns, more);
    }

    // ── 動態「下一句」（生活阿幫）：情境只在這支手機上組；產生中保留舊的建議，好了再換（淡入；reduced motion 不淡入） ──
    const turnsLog = []; // 最近幾輪：問題＋結果（只在記憶體，給情境用）
    let curPage = null; // 浮動阿幫：從哪一頁打開（setPage）
    let sugSeq = 0;
    let edgeMemo = { text: '', asks: null }; // 同一個情境不重問手機上的 AI
    let holdEdge = false; // 帶問題進來（?q=、阿幫會看交過來的）：馬上要送出，先不請手機猜（judge 優先）
    const checkRemote = async (asks, ms = 1500) => { // 只送句子（不送情境）；跟手機猜共用 1.5 秒（SUGGEST_WAIT_MS），時間到就當驗證不了
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), Math.max(0, ms));
      try {
        const r = await fetch(`${API_BASE}/api/v1/suggest/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asks }), signal: ctl.signal });
        return r.ok ? (await r.json()).data : [];
      } finally { clearTimeout(t); }
    };
    const suggestCtx = () => suggestContext({ turns: turnsLog, page: curPage, saved: Object.keys(loadPlaces()), watching: host.arrivalWatch?.() || null, riding: alightWatch(), nowData: peekNow() });
    async function refreshSuggest() {
      if (!dynamic) return;
      const seq = ++sugSeq;
      const view = lastView;
      const ctx = suggestCtx();
      const steps = view ? nextSteps(view.results, view.decision, { watching: host.arrivalWatch?.(), riding: alightWatch(), lang: view.lang }) : [];
      const pageActs = curPage?.kind === 'bus' && curPage.stop && curPage.href && !alightWatch() && !view ? [{ label: curPage.lang === 'en' ? busT('en')('alightGo') : '下車前提醒我', kind: 'navigate', payload: `${curPage.href}${curPage.href.includes('?') ? '&' : '?'}alight=1` }] : []; // 英文公車頁：英文字典
      const rules = [...steps.filter((x) => x.kind === 'ask').map((x) => ({ label: x.label, q: x.payload, ask: x.ask, src: 'next', rel: 2, ...(x.pin && { pin: true }) })), ...ruleAsks(ctx)];
      const draw = (edge) => paintSuggest(pickSuggestions({ actions: [...pageActs, ...steps.filter((x) => x.kind !== 'ask')], edge, rules, ctx, pageChips: curPage?.chips || [] }), view, ctx.lang);
      if (holdEdge || !edgeCanSuggest()) { draw(null); return; } // 網頁版、關掉、外掛不可用、馬上要送出：只用規則
      const text = contextText(ctx);
      if (edgeMemo.text === text) { draw(edgeMemo.asks); return; }
      if (!chips.childElementCount) draw(null); // 第一次：先放規則（沒有舊的可以保留）
      const t0 = Date.now();
      const r = await edgeSuggest(text, { lang: ctx.lang, timeout: SUGGEST_WAIT_MS });
      if (seq !== sugSeq) return;
      const left = SUGGEST_WAIT_MS - (Date.now() - t0); // 猜＋驗證總共最多 1.5 秒（AGENT.md §5.5）
      const asks = r && left > 50 ? await validateAsks(r.asks, { check: (a) => checkRemote(a, left), saved: ctx.saved }) : [];
      if (seq !== sugSeq) return;
      if (r) edgeMemo = { text, asks: asks.length ? asks : null }; // 沒拿到（逾時、上一次還在跑）不記，下次再試
      draw(asks.length ? asks : null);
    }
    /** 畫建議 chips 與 placeholder；內容一樣就不動（不閃、讀屏不重唸） */
    function paintSuggest({ asks, items }, view, lang) {
      if (pinnedDefaults) return; // 正在看固定範例：不換掉
      const en = lang === 'en';
      const top = asks[0]?.label;
      input.placeholder = top ? (en ? `e.g. ${top}` : `例如：${top}`) : A.placeholder;
      // 順序（suggest.js orderSuggest）：公車、捷運情境提醒類動作排第一，其他情境猜的問句在前；placeholder 一律是最可能的那一句問句
      const sig = JSON.stringify([!!view, items.map((x) => [x.kind || 'ask', x.label])]);
      if (chips.dataset.sig === sig) return;
      const had = chips.contains(document.activeElement) && document.activeElement.matches(':focus-visible'); // 用鍵盤停在建議上
      chips.dataset.sig = sig;
      chips.classList.toggle('next', !!view);
      const title = view ? (en ? 'Try next' : '接下來可以') : (en ? 'Try asking' : '建議問題');
      chips.setAttribute('aria-label', title);
      const btns = items.map((s) => {
        const b = el('button', `chip next-${s.kind || 'ask'}`, s.label);
        b.type = 'button';
        b.dataset.src = s.src || s.kind;
        b.dataset.kind = s.kind || 'ask';
        if (s.q || s.payload) b.dataset.q = typeof (s.q || s.payload) === 'string' ? (s.q || s.payload) : '';
        b.onclick = () => act(s.kind ? s : { ...s, kind: 'ask' }, b, view);
        return b;
      });
      const more = el('button', 'chip ghost', view ? (en ? 'Ask something else' : '其他問題') : (en ? 'More examples' : '更多例子'));
      more.type = 'button';
      more.onclick = showDefaults;
      const head = el('span', 'next-title', title);
      head.setAttribute('aria-hidden', 'true'); // 群組已用同一句命名：讀屏不重複唸
      chips.replaceChildren(...(view ? [head] : []), ...btns, more);
      if (had) (btns[0] || more).focus({ preventScroll: true }); // 焦點不跳回頁首：留在建議群組的第一個
      if (!reducedMotion()) { chips.classList.remove('fade-in'); void chips.offsetWidth; chips.classList.add('fade-in'); }
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
    const here = agentId === 'life' ? '#/agent' : `#/agent/${agentId}`;
    const takeQuery = (qy = {}) => { if (qy.turn != null) { window.history.replaceState(null, '', here); const n = /^\d{1,4}$/.test(qy.turn) ? Number(qy.turn) : 0; if (n) requestAnimationFrame(() => requestAnimationFrame(() => rounds.reveal(n))); } const seen = takeHandoff(agentId); if (seen) queueMicrotask(() => send(seen)); if (qy.q) { const q0 = qy.q; window.history.replaceState(null, '', agentId === 'life' ? '#/agent' : `#/agent/${agentId}`); queueMicrotask(() => send(q0)); } if (seen || qy.q) holdEdge = true; return !!(seen || qy.q); };
    takeQuery(query);
    if (dynamic) refreshSuggest(); // 帶問題進來時只放規則（holdEdge），不請手機猜

    async function send(raw, { pageContext = '', voice: spoken = false, follow = false } = {}) {
      const q = String(raw || '').trim().slice(0, 500);
      if (!q) return;
      let pendingAsk = null;
      if (openAsk?.open()) { // 用打的或說的回答「阿幫問你」：對得上按鈕就是答案（不送伺服器）；對不上就略過，照常問（帶 pending，伺服器看得懂短答）
        const a = openAsk, hit = matchAnswer(a.ask, q);
        openAsk = null;
        if (hit) { input.value = ''; if (hit.kind !== 'reply') (a.el?.closest('.round') || log).append(el('div', 'msg user', q)); a.answer(hit); return; } // 答案接在問題那一輪裡（長對話收起時一起收）
        if (a.ask.pending?.slot) pendingAsk = { id: a.ask.id, ...a.ask.pending };
        a.skip();
      }
      if (busy) { pendingQ = { q, pageContext, voice: spoken, follow }; return; }
      turnNo += 1;
      pastWrap?.querySelector('.past-acts button') && pastWrap.querySelector('.past-acts').replaceChildren(el('span', 'past-note', history.length ? '接著上次的話問' : '這次重新問（上次的對話只留著看）'));
      const myGen = gen;
      for (const c of cards) if (c.turn < turnNo - 1) c.stop?.();
      busy = true; sendBtn.disabled = true; input.value = ''; mention.replaceChildren();
      sugSeq++; // 還在猜的下一句作廢（答完會依新的情境再猜；edgeJudge 也會請手機取消）
      holdEdge = false;
      if (dynamic) pruneAfterSend(chips, q); // 先拿掉跟這句相同的建議、綁上一輪的動作（答完再換新的）
      pageRow.hidden = true;
      history.push({ role: 'user', content: q });
      const turn = el('div', 'turn');
      const round = el('div', 'round', el('div', `msg user${spoken ? ' spoken' : ''}`, q), turn); // 一輪＝提問＋回答（用說的：泡泡上一個小麥克風）
      log.append(round);
      const view = turnView(turn, /[A-Za-z]{2,}/.test(q) && !/[一-鿿]/.test(q) ? 'en' : null, (e) => rounds.progress(round, e)); // 先猜（第一個畫面用）；伺服器的 status 事件會說這一輪真正的語言
      view.round = round;
      rounds.start(round, { q, view, follow, keepPrev: !!pendingAsk }); // 可能在回答「阿幫問你」（對不上按鈕）：上一輪先留著（collapse.js 答完再看）
      try {
        // 手機 App：先在裝置上判斷意圖與狀態（最多等 1.8 秒；不可用就不帶，伺服器照常判斷）
        // 同一次呼叫也決定要不要先問一題（ADR-0020）：情境只在手機上組、只給手機上的模型看（不含座標、地址、健康資料）
        const asked = askedLast;
        askedLast = [];
        const judgeOpts = agentId === 'life' && edgeJudgeReady() ? { context: judgeContext({ summary: contextText(suggestCtx()), located: await locationGranted().catch(() => null), saved: Object.keys(loadPlaces()), asked }), asked } : {};
        const deviceJudge = agentId === 'life' ? await edgeJudge(q, history.slice(0, -1).filter((m) => m.role === 'user').map((m) => m.content), judgeOpts) : null;
        const clientCaps = agentId === 'life' ? await edgeWriteCaps() : null; // 回答也在手機上寫（ADR-0017）：伺服器不呼叫模型
        view.writeEngine = clientCaps?.engine;
        view.device(deviceJudge); // 「阿幫在想」：手機上聽懂了什麼（沒有就改由伺服器判斷）
        // 常用地點：只送這段對話提到的（「回家」才送家）
        const savedPlaces = agentId === 'life' ? placesFor(history.slice(-10).filter((m) => m.role === 'user').map((m) => m.content)) : undefined;
        const ctxText = [context, pageContext].filter(Boolean).join('；').slice(0, 200);
        const habitState = agentId === 'life' ? habitRequest() : null; // 同意過的偏好比例、說過的預設狀況、可以問的候選（只有方式與次數；habits.js）
        const userState = agentId === 'life' && !dramaHintOn() ? { ...habitState, dramaHint: false } : habitState; // 設定關掉等車推短劇：伺服器就不查也不推（ADR-0019）
        await runAgent({ messages: history.slice(-10), ...(ctxText && { context: ctxText }), ...(deviceJudge && { deviceJudge }), ...(clientCaps && { clientCaps }), ...(savedPlaces && { savedPlaces }), ...(userState && { userState }), ...(pendingAsk && { pendingAsk }), ...(agentId === 'life' && { turn: turnNo }) }, (e) => { // turn：這段對話第幾輪（等車推劇輪替用）
          // 隱私：防詐頁貼上的內容只送給本站伺服器分析，不保存（AGENT_ANTIFRAUD.md §1）
          if (e.type === 'status' && MODE_TEXT[e.mode]) modeLine.textContent = modeText(e);
          if (e.type === 'status' && agentId === 'life') noteAgentStatus(e); // 「阿幫的腦袋」（#/ai）顯示最近一輪由誰回答、誰先聽懂（只記模式與來源，不含內容）
          view.push(e);
        }, { agentId });
        await view.flush();
        view.finish(); // 沒查工具的一輪（只問你一題…）：收掉「小幫手討論中」
        if (myGen !== gen) return; // 回答途中按了清除本機資料：不寫回、不存
        if (view.text) history.push({ role: 'assistant', content: (view.draft ?? view.text).slice(0, 500) }); // 手機改寫的那一輪：前文用程式版（規則路徑讀得到「剛剛那班」「沒拿到你的位置」），畫面顯示改寫
        turnsLog.push({ q, results: view.results, decision: view.decision, lang: view.lang, round }); // round：建議跟著最新一輪（展開舊輪時也一樣）
        if (turnsLog.length > 3) turnsLog.shift();
        if (agentId === 'life') saveChat(history); // 只存文字（chat-store.js）
        showNext(view);
      } catch {
        view.stop();
        turn.append(el('div', 'msg error', '連線中斷了，請再試一次。'));
      } finally {
        view.stop(); // 沒有回答（只有卡片、或中斷）也收起「阿幫在想」
        view.finish?.();
        busy = false; sendBtn.disabled = false; context = '';
        if (pendingQ) { const p = pendingQ; pendingQ = null; queueMicrotask(() => send(p.q, { pageContext: p.pageContext, voice: p.voice, follow: p.follow })); }
        if (!matchMedia('(pointer: coarse)').matches) input.focus(); // 手機不自動聚焦：鍵盤會跳出來蓋住回答
        if (myGen === gen) rounds.end(round); // 摘要、目錄（清除本機資料後不再寫）
      }
    }

    /** 一輪對話的畫面：事件依序呈現；討論串兩則之間至少 300ms（只為避免閃爍） */
    function turnView(turn, turnLang = null, onData = null) {
      const thread = el('div', 'thread live');
      thread.setAttribute('aria-label', turnLang === 'en' ? 'Helper thread' : '小幫手討論串');
      // 會議感（原型 transit-discussion.html）：討論中有標題與跳動的點，結束後收合成摘要
      thread.append(el('div', 'thread-head', el('span', 'th-title', turnLang === 'en' ? 'Checking live data…' : '小幫手討論中'), el('span', 'say typing', ...typing(turnLang === 'en' ? 'checking' : '討論中'))));
      const results = el('div', 'results');
      // 「阿幫在想」（agent/thinking.js）：送出就出現在回答的位置，跟著真實事件換字，第一段回答來了就拿掉
      const think = mountThinking({ lang: turnLang, roleName: (r) => (turnLang === 'en' ? roleEn(r) || r : r) });
      turn.append(thread, results, think.el);
      const bubbles = new Map();
      const slots = new Map(); // 工具呼叫 id → 卡片（等車推短劇接在那張卡片下面）
      const roles = []; // 本輪回報的小幫手角色（決策圖的資料欄）
      const reported = new Set(); // 本輪已經點名過的工具角色（示範模式另外查了天氣、空品、路況：data_note 不重複）。tool_start 就記：工具平行，weather_now 可能比 plan_trip 晚完成
      let queue = Promise.resolve();
      let lastShown = 0;
      let textEl = null;
      const view = { text: '', results: [], decision: null, box: null, dg: null, lang: turnLang, sent: null, judge: null, profile: agentId }; // results／decision：給「接下來可以…」；lang：英文那一輪
      const gap = async () => {
        if (reducedMotion()) return;
        const wait = MIN_GAP_MS - (performance.now() - lastShown);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastShown = performance.now();
      };
      const handle = async (e) => {
        think.step(e); // 「阿幫在想」換到這個階段（text／done／error 就收起）
        await handleEvent(e);
        if (['status', 'agent_note', 'context_reset', 'tool_start', 'tool_result', 'client_tool_call'].includes(e.type)) onData?.(e); // 長對話：status 記候選話題，之後第一個事件定案要不要分段
      };
      const handleEvent = async (e) => {
        switch (e.type) {
          case 'status':
            turn.dataset.mode = e.mode;
            view.judge = e.judge || null;
            if (e.lang) {
              turnLang = e.lang === 'en' ? 'en' : null; view.lang = turnLang; think.setLang(turnLang); // 伺服器說這一輪用哪種語言（S12g）；送出前的猜測只用在「討論中」等第一個畫面
              if (agentId === 'life') window.dispatchEvent(new CustomEvent('abang:agent-lang', { detail: { lang: turnLang } })); // 外殼（分頁列、浮動阿幫、<html lang>）跟著最近一輪的語言（app.js）
            }
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
            b.dataset.role = e.role;
            if (e.name !== 'plan_trip') reported.add(e.role); // tool_start 一定比 data_note 早送
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
            if (e.ok) view.results.push({ tool: e.tool, card: e.card, data: e.data, args: e.args, speak: e.speak });
            if (e.ok && e.card) {
              // 接著問的那一輪，天氣、空品跟上一輪一樣：收合成「天氣同上」（點開看完整卡片），畫面不會越拉越長
              const same = sameAs(e, turn.dataset.follow === '1', turnLang);
              const payload = { card: e.card, v: e.v, mode: e.mode, speak: e.speak, data: e.data, tool: e.tool, args: e.args, ...(turnLang === 'en' && { lang: 'en' }) }; // 觀光客用英文問：卡片標籤用英文（S12b）
              if (same) { // 點開才畫卡片（不播進場動畫）
                const slot = el('div', 'card-slot');
                const box = el('details', 'card-same');
                box.append(el('summary', '', el('span', 'same-text', same), el('span', 'same-open', turnLang === 'en' ? 'Show card' : '看完整')), slot);
                box.addEventListener('toggle', () => { if (box.open && !slot.childElementCount) cards.push(Object.assign(renderCard(slot, payload, host), { turn: turnNo, slot })); });
                results.append(box);
                slots.set(e.id, box);
              } else {
                const slot = el('div', `card-slot ${results.children.length >= 2 ? 'scroll-in' : 'enter3d'}`); // 前兩張立體進場，後面的捲到才浮現
                results.append(slot);
                slots.set(e.id, slot);
                cards.push(Object.assign(renderCard(slot, payload, host), { turn: turnNo, slot }));
              }
            }
            break;
          }
          case 'data_note': { // 行程比較內部用到的資料（天氣、空品、路況）＋影響：工具發言樣式，排在行程結論前面（AGENT.md §3.1）
            if (!roles.includes(e.role)) roles.push(e.role);
            if (reported.has(e.role)) break; // 這一輪已經有這位小幫手的發言（示範模式另外查過），不重複
            await gap();
            const src = el('small', 'src', turnLang === 'en' ? 'used in trip comparison' : '行程比較用到的資料');
            if (e.mode === 'demo') src.append(' · ', el('span', 'src-demo', turnLang === 'en' ? 'Demo data' : '示範資料'));
            const say = el('div', 'say', e.text);
            const b = el('div', `bubble tool data-note${e.available === false ? ' missing' : ''}`, avatar(e.role, 'think', turnLang), say, src);
            b.dataset.role = e.role;
            if (e.impact?.text) say.after(el('div', `impact ${e.impact.tone || 'neutral'}`, el('span', 'arrow', '→'), e.impact.text));
            const parent = bubbles.get(e.parent);
            if (parent?.parentNode === thread) parent.before(b); else thread.append(b);
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
            noteDecision(e); // 指定方式（改成 X、點決策圖的方案）＝選了這種方式（habits.js，只記方式）
            const mod = await decideModule;
            if (mod) { view.dg = renderDecision(box, e, { sources: roles.filter((r) => r !== '行程'), decide: mod.decide, CRITERIA: mod.CRITERIA, lang: turnLang, onPick: (o) => !busy && send(turnLang === 'en' ? `Switch to ${({ walk: 'walking', bike: 'YouBike', bus: 'bus', metro: 'MRT', thsr: 'high speed rail', tra: 'train', intercity: 'intercity bus', ridehail: 'taxi' })[o.role] || o.name} instead` : `改成${o.name}`) }); view.dg.played.then(() => handoff(box, results, e)); }
            else box.append(el('p', 'dg-why', e.reason)); // 載不到引擎時至少顯示理由
            break;
          }
          case 'ask': { // 阿幫問你（ADR-0016）：一輪最多一個；有決策圖就放在它上方，否則接在後面
            if (e.about) askedLast.push(e.about);
            if (e.key && questionAskedRecently(e.key)) break; // 同一段起訖同一題，24 小時內問過（手機上只存雜湊）
            if (e.key) markQuestion(e.key);
            openAsk?.skip();
            const mine = loadPlaces(); // 常用地點的選項（回家、從公司出發）：這支手機有設定才顯示
            const shown = { ...e, options: (e.options || []).filter((o) => !o.saved || mine[o.saved]) };
            const ctl = mountAsk(shown, { lang: turnLang, onAnswer: (o) => answerAsk(o, view, turnLang) });
            openAsk = ctl;
            view.askOpen = () => ctl.open(); // 長對話：問題還開著，這一輪先不收
            if (/^habit:/.test(e.about || '')) markAsked(e.about.slice(6)); // 問過了（沒回答也 3 天內不再問）
            if (view.box?.isConnected) view.box.before(ctl.el); else results.append(ctl.el);
            break;
          }
          case 'aside': { // 等車推短劇（ADR-0019）：接在那張到站卡片下面，一行小字；設定關掉就不顯示
            if (e.kind !== 'drama' || !dramaHintOn()) break;
            const hint = mountDramaHint(e, { host, ask: (q) => send(q), lang: turnLang });
            const slot = slots.get(e.parent);
            if (slot?.isConnected) slot.after(hint); else results.append(hint);
            break;
          }
          case 'guardrail': // 安全情境（S18）：求助電話做成一鍵撥號，接在回答下面
            if (e.calls?.length) view.calls = e.calls;
            break;
          case 'answer_draft': { // 回答交給手機寫（ADR-0017）：改寫、程式護欄檢查；不過或逾時用程式版，回答上方照實說是誰寫的
            const r = await edgeWrite(e, { engine: view.writeEngine, agent: agentId });
            view.writeLine = writeLine(r, turnLang, { judged: view.judge?.source === 'device', judgeEngine: view.judge?.engine }); // 手機判斷與寫回答合成一行
            view.draft = e.text;
            modeLine.textContent = writeModeText(r);
            turn.dataset.writer = r.by;
            await handle({ type: 'text', delta: r.text });
            break;
          }
          case 'text':
            if (!textEl) {
              // 這一輪手機上的 AI 有判斷：回答上方照實說伺服器有沒有採用；回答是手機寫的就說是誰寫的
              const line = view.writeLine || deviceLine({ sent: view.sent, judge: view.judge }, turnLang);
              if (line) turn.append(el('p', 'device-line', line));
              textEl = el('div', 'bubble agent final', avatar('阿幫', 'happy', turnLang), el('div', 'say')); turn.append(textEl);
            }
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
      view.device = (r) => { view.sent = r || null; think.step({ type: 'device', result: r || null }); };
      view.stop = () => think.stop();
      view.flush = () => queue;
      /**
       * 這一輪結束（伺服器的串流跑完，含請定位後的重送）：沒有查任何工具的一輪（只問你一題、道謝、安全情境…）不會有 discussion_end，
       * 「小幫手討論中 •••」不能一直留著——討論串只剩標題就整個拿掉；有阿幫的說明（agent_note）就留著說明、拿掉「討論中」與虛線。
       */
      view.finish = () => {
        if (!thread.classList.contains('live')) return;
        thread.classList.remove('live');
        thread.querySelector('.thread-head')?.remove();
        if (!thread.querySelector('.bubble, .thread-reset')) thread.remove();
      };
      return view;
    }
    /** 「阿幫問你」的答案（ADR-0016）：state＝加狀態即時重算、reply＝送出完整的一句、store＝存手機並套到這一輪、action＝手機做事、dismiss＝照原本；回傳顯示在問題區塊的一句 */
    function answerAsk(o, view, lang) {
      const en = lang === 'en';
      if (o.kind === 'state') {
        if (view.dg) { view.dg.addState(o.state, o.source === 'usual' ? 'usual' : 'picked'); return en ? `Recalculated: ${o.label}.` : `好，照「${o.label}」重算了。`; } // 「這次也帶東西嗎？」→ 是＝你說過：常帶東西
        if (o.say) queueMicrotask(() => send(o.say)); // 沒有決策圖可以即時重算：說成一句送出
        return '';
      }
      if (o.kind === 'reply') { queueMicrotask(() => send(o.say)); return ''; }
      if (o.kind === 'action') { // 沿用卡片的 host 動作；連結類由 host 先確認（ADR-0011）
        const a = o.action || {};
        if (a.name === 'openLink') host.openLink(a.url, a.confirm ? { confirm: a.confirm } : {});
        else if (a.name === 'watchArrival') host.watchArrival(a).catch(() => {});
        else if (a.name === 'remind') host.remind(a.at, a.text, a.meta).catch(() => {});
        else if (a.name === 'navigate' && /^#\/[a-z0-9/_-]{1,40}$/.test(String(a.to))) { host.navigate(a.to); return ''; } // App 內的頁面（到防詐貼上、發票對獎）
        else if (a.name === 'focusInput') { input.focus(); return en ? 'Paste it in the box below.' : '貼在下面的輸入框就好。'; } // 請他貼上訊息（防詐）
        return en ? 'Done.' : '好了。';
      }
      if (o.kind === 'store') {
        const r = applyStore(o.value);
        if (r.habit) view.dg?.setHabit(r.habit);
        return en ? 'Saved on this phone. You can change it in Settings.' : r.say;
      }
      return en ? 'OK, keeping this plan.' : '好，照原本的建議。';
    }
    // 給 app.js／浮動阿幫用：回到這頁、阿幫主動說一句（提醒）、聚焦輸入框、代問、有沒有對話
    const api = {
      show: (qy) => { takeQuery(qy); api.setPage(null); }, // 整頁：拿掉「在這頁可以問」；先看有沒有帶問題（有就先不請手機猜）
      say(text, action = null) {
        const p = el('div', 'agent-say');
        p.append(avatar('阿幫', 'happy'), el('p', 'say', text));
        if (action?.ask) { const b = el('button', 'btn small', action.label || '問阿幫'); b.type = 'button'; b.onclick = () => send(action.ask); p.append(b); }
        log.append(p);
      },
      focus: () => input.focus({ preventScroll: true }),
      ask: (q) => send(q),
      hasChat: () => history.length > 0,
      /** 長按中央鍵用說的（abang-dock.js）：voiceReady 能不能用、voiceHold 開始、voiceRelease 放開送出、voiceCancel 收起時取消 */
      voiceReady: () => !!voice?.ready(),
      voiceHold: () => voice?.hold(),
      voiceRelease: () => voice?.release(),
      voiceCancel: () => voice?.cancel(),
      /** 設定頁清除本機資料：畫面上的對話也一起清掉 */
      clear() { gen++; clearChat(); history.length = 0; pendingQ = null; openAsk = null; askedLast = []; turnNo = 0; seenCards.clear(); context = ''; lastTripTo = null; pastWrap = null; cards.forEach((c) => c.destroy?.()); cards.length = 0; log.replaceChildren(); rounds.clear(); clearLinks(); turnsLog.length = 0; lastView = null; edgeMemo = { text: '', asks: null }; pinnedDefaults = false; if (dynamic) refreshSuggest(); else showDefaults(); },
      /** 從哪一頁打開（浮動阿幫）：那一頁可以問的問題；點了才把這一頁的說明一起送（自己打的問題不帶）；null＝清掉 */
      setPage(hint) {
        const pc = String(hint?.context || '');
        const qs = (hint?.chips || []).slice(0, 3);
        curPage = hint ? { ...hint, href: location.hash } : null; // 動態建議也知道你在哪一頁（只在手機上）
        pinnedDefaults = false;
        if (!busy) refreshSuggest(); // 送出中不換（答完 showNext 會依這一頁重算）
        pageRow.hidden = !qs.length;
        pageRow.replaceChildren(...(qs.length ? [el('span', 'next-title', '在這頁可以問'), ...qs.map((q) => { const b = el('button', 'chip', q); b.type = 'button'; b.onclick = () => send(q, { pageContext: pc }); return b; })] : []));
      },
    };
    return api;
  },
};
