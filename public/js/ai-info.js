// 「阿幫的腦袋」（#/ai）的資料整理（純函式，test/ai-info.test.js）：
// 把原生外掛 AbangEdgeAI.status() 與伺服器 /api/v1/status 回報的資訊整理成畫面要的樣子。
// 原則：只顯示真的拿得到的。欄位不存在、型別不對、長得奇怪 → 那一項就沒有（畫面不顯示），不補預設值、不編造版本或參數。
import { EDGE_ENGINES, EDGE_INTENTS, EDGE_STATES } from './edge-judge.js';

export const ENGINE_NAME = { apple: 'Apple Intelligence', 'gemini-nano': 'Gemini Nano' };
/** 不可用的原因（外掛的 reason；字典鍵 reason.*） */
export const EDGE_REASONS = ['unsupported', 'disabled', 'downloading', 'needs-wifi', 'os-too-old', 'language', 'web', 'no-plugin', 'unavailable'];

// eslint-disable-next-line no-control-regex
const clean = (v, max = 60) => { const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : ''; return s && s.length <= max ? s : undefined; };
const int = (v, max) => (Number.isInteger(v) && v > 0 && v <= max ? v : undefined);
const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

/**
 * 手機上的模型：外掛回報 → 畫面資料。
 * state：ready 可用且開著｜off 可用但使用者關掉｜downloading 下載中｜downloadable 可下載（等 Wi-Fi）｜unsupported 這台不能用（看 reason）｜web 網頁版
 * active：這一刻真的由手機判斷（只有 ready）
 * @param {any} raw AbangEdgeAI.status() 的回傳（網頁版是 { available: false, reason: 'web' }）
 * @param {{ enabled?: boolean }} [o] enabled：使用者的開關（edgeEnabled()）
 */
export function normalizeEdgeInfo(raw, { enabled = true } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const engine = EDGE_ENGINES.includes(r.engine) ? r.engine : undefined;
  const available = r.available === true && !!engine;
  const reason = available ? 'ok' : EDGE_REASONS.includes(r.reason) ? r.reason : engine ? 'unavailable' : 'web';
  const state = available ? (enabled ? 'ready' : 'off') : reason === 'web' ? 'web' : reason === 'downloading' ? 'downloading' : reason === 'needs-wifi' ? 'downloadable' : 'unsupported';
  const out = { state, reason, active: state === 'ready' };
  if (state === 'web') return out; // 網頁版：沒有手機上的模型，其他欄位一律不看
  if (engine) out.engine = engine;
  const modelName = clean(r.modelName);
  if (modelName) out.modelName = modelName;
  const tokenLimit = int(r.tokenLimit ?? r.contextSize, 100_000_000); // Android：getTokenLimit；iOS：contextSize
  if (tokenLimit) out.tokenLimit = tokenLimit;
  const langs = [...new Set((Array.isArray(r.languages) ? r.languages : []).filter((x) => typeof x === 'string' && LANG_TAG.test(x)))].slice(0, 40);
  if (langs.length) out.languages = langs;
  for (const k of ['osVersion', 'device', 'aicoreVersion']) { const v = clean(r[k], k === 'device' ? 60 : 40); if (v) out[k] = v; }
  const total = Number(r.downloadTotalBytes), done = Number(r.downloadedBytes);
  if (state === 'downloading' && Number.isFinite(total) && total > 0 && Number.isFinite(done) && done >= 0) out.download = { total, done: Math.min(done, total), pct: Math.min(100, Math.floor((done / total) * 100)) };
  return out;
}

/** 語言代碼 → 看得懂的名稱（瀏覽器的 Intl.DisplayNames；不認得就照原樣） */
export function languageNames(codes = [], lang = null) {
  let dn = null;
  try { dn = new Intl.DisplayNames([lang === 'en' ? 'en' : 'zh-Hant-TW'], { type: 'language' }); } catch { /* 舊瀏覽器 */ }
  return codes.map((c) => { try { return dn?.of(c) || c; } catch { return c; } });
}

const MODES = ['claude', 'local', 'demo'];
const SOURCES = ['device', 'embed', 'llm', 'rules'];

/**
 * 伺服器用什麼回答、判斷層有哪些成員：/api/v1/status 的 agent 欄位＋這次開 App 最近一輪對話的 status 事件。
 * 兩個都沒有就是空物件（畫面說「還不知道」）。
 * @param {any} agent /api/v1/status → data.agent：{ mode, model?, judge?: { embed, llm } }
 * @param {any} last 最近一輪的 status 事件（noteAgentStatus 記下的）
 */
export function normalizeServerInfo(agent, last = null) {
  const out = {};
  const pick = (a) => {
    if (!a || typeof a !== 'object' || !MODES.includes(a.mode)) return null;
    const model = a.mode === 'demo' ? undefined : clean(a.model, 80);
    return { mode: a.mode, ...(model && { model }) };
  };
  const now = pick(agent);
  if (now) Object.assign(out, now);
  if (agent && typeof agent === 'object' && agent.judge && typeof agent.judge === 'object') {
    if (typeof agent.judge.embed === 'boolean') out.embed = agent.judge.embed;
    if (typeof agent.judge.llm === 'boolean') out.llm = agent.judge.llm;
  }
  // 最近一輪：rules＝這題由內建規則回答（英文、查數字的），也照實顯示
  if (last && typeof last === 'object' && [...MODES, 'rules'].includes(last.mode)) {
    const model = ['claude', 'local'].includes(last.mode) ? clean(last.model, 80) : undefined;
    const source = SOURCES.includes(last.judge?.source) ? last.judge.source : undefined;
    const engine = source === 'device' && EDGE_ENGINES.includes(last.judge?.engine) ? last.judge.engine : undefined;
    out.last = { mode: last.mode, ...(model && { model }), ...(source && { source }), ...(engine && { engine }) };
    if (!out.mode && MODES.includes(last.mode)) Object.assign(out, { mode: last.mode, ...(model && { model }) }); // 沒有 API 資料時用最近一輪的
  }
  return out;
}

// 最近一輪對話的 status 事件（問阿幫頁記下；只留模式、模型名稱、判斷來源，不含對話內容；只在記憶體，關掉 App 就沒了）
let lastStatus = null;
export function noteAgentStatus(e) {
  if (!e || e.type !== 'status' || typeof e.mode !== 'string') return;
  lastStatus = { mode: e.mode, ...(typeof e.model === 'string' && { model: e.model }), ...(e.judge && typeof e.judge === 'object' && { judge: { source: e.judge.source, engine: e.judge.engine } }) };
}
export const lastAgentStatus = () => lastStatus;
/** 測試用 */
export const _resetAgentStatus = () => { lastStatus = null; };

/** 節點上放得下的短字：太長就只留第一個＋「+N」（完整內容在下面的文字與讀屏） */
export function nodeText(labels, sep = '、') {
  const width = (s) => [...s].reduce((n, ch) => n + (/[⺀-￿]/.test(ch) ? 2 : 1), 0);
  const all = labels.join(sep);
  return labels.length <= 1 || width(all) <= 16 ? all : `${labels[0]} +${labels.length - 1}`;
}

/**
 * 一次判斷的結果文字（畫面與讀屏同一句；動畫只是它的另一種呈現）。
 * @param {{ intent: string, states: string[] }} r normalizeJudge 的結果
 * @param {number|null} ms 花多久
 * @param {(key: string, vars?: object) => string} t 字典（pages/ai-i18n.js）
 */
export function judgedText(r, ms, t) {
  const intent = EDGE_INTENTS.includes(r?.intent) ? r.intent : 'unknown';
  const states = (r?.states || []).filter((k) => EDGE_STATES.includes(k));
  return [
    t('judged.intent', { intent: t(`intent.${intent}`) }),
    states.length ? t('judged.states', { states: states.map((k) => t(`state.${k}`)).join(t('sep')) }) : t('judged.noStates'),
    Number.isFinite(ms) ? t('judged.ms', { ms: Math.round(ms) }) : '',
    t('judged.local'),
  ].filter(Boolean).join('');
}
