// 「阿幫在想」指示（2026-11-21，Austin：「思考時候一定要有動畫」）：問阿幫送出問題到回答出現前，
// 用「阿幫的腦袋」（#/ai）同一顆核心的小版本（Λ＋琥珀核心＋軌道）表示阿幫正在想，並寫出目前在做什麼。
// 全部由真實事件推進、不加假延遲：送出 → 手機上的 AI 判斷完（或改由伺服器判斷）→ 查資料（tool_start）→ 整理答案 → 第一段回答（text）就收起。
// 狀態機是純函式（test/thinking.test.js）；mountThinking 只負責畫面。動畫只動 transform／opacity（css/agent.css .think-core），
// reduced motion／lite-motion 不動，只顯示文字。讀屏只念兩次：開始想、聽懂了（或改由伺服器判斷）；查資料的過程討論串本來就會念。
import { aiT } from '../pages/ai-i18n.js';
import { EDGE_INTENTS, EDGE_STATES, judgeFromDevice } from '../edge-judge.js';
import { intentLabel } from '../ai-info.js';

/** 會出現在「準備行動」階段的動作（名稱、確認方式；與 ai-actions.js 同一套說法） */
export const THINK_ACTS = {
  addCalendar: { zh: '加到行事曆', en: 'add to calendar', how: 'system' },
  share: { zh: '分享', en: 'share', how: 'system' },
  watchArrival: { zh: '到站提醒', en: 'arrival reminder', how: 'tap' },
  openLink: { zh: '開地圖', en: 'open the map', how: 'tap' },
};
const HOW = { system: { zh: '系統畫面確認', en: 'confirmed on the system screen' }, tap: { zh: '您按一下', en: 'one tap' } };

/** 開始：剛送出 */
export const thinkStart = () => ({ phase: 'think', device: null, pending: [], checked: 0 });

/**
 * 事件 → 下一個狀態。phase：think 剛送出｜device 手機上聽懂了｜server 改由伺服器判斷｜tools 正在查｜compose 查完、整理答案｜act 準備行動（阿幫問你帶動作選項：加到行事曆、分享、到站提醒；2026-11-28）｜write 在手機上寫回答（answer_draft）｜suggest 猜下一句（#/ai 試判斷）｜end 收起
 * @param {ReturnType<typeof thinkStart>} s
 * @param {{ type: string, [k: string]: any }} e agent 事件；另有 { type: 'device', result }（手機上的判斷結果，沒有是 null）、{ type: 'abort' }
 */
export function thinkStep(s, e) {
  if (s.phase === 'end' || !e) return s;
  switch (e.type) {
    case 'device': {
      const r = e.result && EDGE_INTENTS.includes(e.result.intent) ? { intent: e.result.intent, states: (e.result.states || []).filter((k) => EDGE_STATES.includes(k)), engine: e.result.engine, ...(e.result.topic && { topic: e.result.topic }) } : null;
      return { ...s, phase: s.pending.length ? s.phase : r ? 'device' : 'server', device: r };
    }
    case 'tool_start':
    case 'client_tool_call': {
      const id = e.type === 'client_tool_call' ? `client:${e.id}` : e.id;
      const role = e.type === 'client_tool_call' ? '定位' : e.role || '';
      return { ...s, phase: 'tools', pending: [...s.pending.filter((p) => p.id !== id), { id, role }] };
    }
    case 'tool_result':
    case 'client_tool_result': {
      const id = e.type === 'client_tool_result' ? `client:${e.id}` : e.id;
      const pending = s.pending.filter((p) => p.id !== id);
      return { ...s, pending, checked: s.checked + 1, phase: pending.length ? 'tools' : 'compose' };
    }
    case 'ask': { // 阿幫問你帶動作選項：準備好，等你按（產品負責人 2026-11-28：大腦加入 take action）
      const act = (e.options || []).find((o) => o.kind === 'action' && THINK_ACTS[o.action?.name])?.action.name;
      return act ? { ...s, phase: 'act', act } : s;
    }
    case 'answer_draft': // 回答交給手機寫（ADR-0017）：收到程式版總結後、手機改寫完成前
      return { ...s, phase: 'write' };
    case 'suggest': // 「阿幫的腦袋」試判斷的最後一段：猜使用者接下來想問什麼（問阿幫頁不用這個階段）
      return { ...s, phase: 'suggest', pending: [] };
    case 'text': case 'done': case 'error': case 'abort':
      return { ...s, phase: 'end' };
    default:
      return s;
  }
}

/**
 * 畫面上的字：title 大字（「阿幫在想…」）、stage 目前在做什麼、announce 要讓讀屏念的（只有開始與聽懂了；其他階段回 null，不重複念）
 * @param {ReturnType<typeof thinkStart>} s
 * @param {'en'|null} lang
 * @param {(role: string) => string} [roleName] 小幫手角色名稱（英文頁換成英文）
 */
export function thinkText(s, lang = null, roleName = (r) => r) {
  const t = aiT(lang);
  const en = lang === 'en';
  const title = en ? 'Abang is thinking…' : '阿幫在想…';
  const dot = en ? ' · ' : '・';
  let stage = '';
  if (s.phase === 'device' && s.device) {
    const what = [intentLabel(s.device, t), ...s.device.states.map((k) => t(`state.${k}`))].join(dot);
    stage = en ? `Understood on your phone: ${what}` : `手機上聽懂了：${what}`;
  } else if (s.phase === 'server') stage = en ? 'The server is working out what you mean' : '伺服器判斷中';
  else if (s.phase === 'tools') {
    const roles = [...new Set(s.pending.map((p) => p.role).filter(Boolean))];
    const list = roles.slice(0, 3).map(roleName).join(dot);
    stage = list ? `${en ? 'Checking: ' : '正在查：'}${list}${roles.length > 3 ? (en ? '…' : '等') : ''}` : (en ? 'Checking data' : '正在查資料');
  } else if (s.phase === 'compose') stage = en ? 'Putting the answer together' : '整理答案中';
  else if (s.phase === 'write') stage = en ? 'Writing the answer on your phone' : '在手機上寫回答';
  else if (s.phase === 'act' && THINK_ACTS[s.act]) { const a = THINK_ACTS[s.act]; stage = en ? `Getting an action ready: ${a.en} (${HOW[a.how].en})` : `準備行動：${a.zh}（${HOW[a.how].zh}）`; }
  else if (s.phase === 'suggest') stage = t('think.suggest');
  const announce = s.phase === 'think' ? title : s.phase === 'device' || s.phase === 'server' ? stage : null;
  return { title, stage, announce };
}

/**
 * 回答上方那一行：這一輪手機上的 AI 有判斷時照實說伺服器有沒有採用。
 * @param {{ sent?: { engine: string }|null, judge?: { source?: string, engine?: string }|null }} o sent：請求帶的 deviceJudge；judge：status 事件的 judge
 * @param {'en'|null} lang
 * @returns {string|null}
 */
export function deviceLine({ sent = null, judge = null } = {}, lang = null) {
  const NAME = lang === 'en' ? { apple: 'Apple Intelligence', 'gemini-nano': 'Gemini Nano', e5: "Abang's small model" } : { apple: 'Apple Intelligence', 'gemini-nano': 'Gemini Nano', e5: '小模型' }; // e5：手機上的小模型（E3）
  const adopted = judgeFromDevice(judge);
  const name = NAME[(adopted && judge.engine) || sent?.engine];
  if (!name || (!adopted && !sent)) return null;
  const zh = /^[A-Za-z]/.test(name) ? ` ${name} ` : name; // 中文句子裡英文名稱前後空一格
  if (adopted) return lang === 'en' ? `Abang first worked out what you want on your phone with ${name}.` : `阿幫先在手機上用${zh}聽懂您要做什麼。`;
  return lang === 'en' ? `${name} on your phone listened first; this time the server's own judgment was used.` : `手機上的${zh}先聽了一遍；這一輪以伺服器的判斷為準。`;
}

/** 小核心（跟 App 圖示、#/ai 同一套：深青綠底、亮白 Λ、琥珀核心、一圈軌道） */
const MINI = `<svg viewBox="0 0 48 48" width="44" height="44" focusable="false"><defs><linearGradient id="tc-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B3B39"/><stop offset=".6" stop-color="#0F766E"/><stop offset="1" stop-color="#14A396"/></linearGradient></defs>
<rect width="48" height="48" rx="14" fill="url(#tc-bg)"/><circle cx="24" cy="25" r="16" fill="none" stroke="#99F6E4" stroke-opacity=".3" stroke-width="1.5"/>
<g class="tc-orbit"><circle cx="24" cy="25" r="16" fill="none" stroke="#CCFBF1" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="16 85"/><circle cx="40" cy="25" r="1.8" fill="#FDE68A"/></g>
<path d="M14 37L24 12L34 37" fill="none" stroke="#fff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
<circle class="tc-halo" cx="24" cy="31" r="7" fill="#FBBF24" opacity=".35"/><circle class="tc-core" cx="24" cy="31" r="4.4" fill="#FBBF24"/></svg>`;

/**
 * 畫面：放在這一輪最下面（回答會出現的位置），第一段回答來了就拿掉。
 * @param {{ lang?: 'en'|null, roleName?: (r: string) => string }} [o]
 */
export function mountThinking({ lang = null, roleName } = {}) {
  let s = thinkStart();
  let curLang = lang;
  const box = document.createElement('div');
  box.className = 'think-core';
  box.innerHTML = `<span class="tc-orb" aria-hidden="true">${MINI}</span><span class="tc-text" aria-hidden="true"><b></b><small></small></span><span class="sr-only" role="status"></span>`;
  const b = box.querySelector('b'), small = box.querySelector('small'), sr = box.querySelector('[role=status]');
  let said = '';
  const paint = () => {
    const x = thinkText(s, curLang, roleName);
    box.dataset.phase = s.phase;
    b.textContent = x.title;
    if (small.textContent !== x.stage) {
      small.textContent = x.stage;
      small.classList.remove('tc-new'); void small.offsetWidth; small.classList.add('tc-new'); // 換字時淡入（只有 opacity）
    }
    if (x.announce && x.announce !== said) { sr.textContent = x.announce; said = x.announce; }
  };
  paint();
  return {
    el: box,
    /** 收到一個事件（或 { type: 'device', result }） */
    step(e) {
      const prev = s.phase;
      s = thinkStep(s, e);
      if (s.phase === 'end') { box.remove(); return; }
      if (e?.type === 'device' && s.phase === 'device' && prev !== 'device') { box.classList.remove('tc-flash'); void box.offsetWidth; box.classList.add('tc-flash'); } // 聽懂了：核心亮一下
      paint();
    },
    setLang(l) { curLang = l; if (s.phase !== 'end') paint(); },
    stop() { s = thinkStep(s, { type: 'abort' }); box.remove(); },
    get phase() { return s.phase; },
  };
}
