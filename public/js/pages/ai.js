// 阿幫的腦袋（#/ai，2026-11-21，Austin：「做一個以 edge AI 為腦袋的視覺，讓用戶知道所有的 edge AI 模型資訊」）。
// 主視覺：App 圖示的「發光核心＋軌道＋Λ」——核心就是手機上的 AI。待機呼吸；判斷時脈動、訊號沿線流到「意圖」「狀態」並點亮結果。
// 誠實原則：只顯示系統真的回報的模型資訊（ai-info.js 整理；沒有的欄位不顯示）；沒有裝置端模型時核心不點亮，照實說判斷在伺服器做。
// 動畫只是另一種呈現：同樣的資訊都在 role=status 的那一句（讀屏、reduced motion 拿到的一樣多）。樣式：css/ai.css。
import { esc } from '../ui.js';
import { api } from '../api.js';
import { edgeEnabled, edgeStatus, edgeJudge, edgePrewarm, edgeStats, setEdgeEnabled, edgeSuggest, edgeCanSuggest, judgeContext } from '../edge-judge.js';
import { ENGINE_NAME, normalizeEdgeInfo, normalizeServerInfo, lastAgentStatus, languageNames, nodeText, judgedText } from '../ai-info.js';
import { aiT, pageLang } from './ai-i18n.js';
import { visionStatus, visionEnabled } from '../vision.js';
import { voiceStatus, voiceEnabled } from '../voice.js';
import { voiceT, whyText } from '../voice-i18n.js';
import { edgeWriteEnabled, edgeWriteStats, edgeWrite } from '../edge-write.js';
import { runAgent } from '../agent/client.js';
import { mountThinking } from '../agent/thinking.js';
import { SUGGEST_WAIT_MS } from '../agent/suggest.js';
import { runTrial, trialSuggest, reportJson, TRIAL_SECTIONS, TRIAL_PRESETS } from '../ai-trial.js';
import { API_BASE } from '../base.js';
import { roleEn } from '../../ui/agent/decision-graph.js';

/** 「試試看」等久一點（使用者正看著；平常問阿幫只等 1.8 秒就交給伺服器） */
const TRY_TIMEOUT_MS = 6000;
/** 建一個元素、只用 textContent 放字（試判斷的結果含使用者的句子與伺服器資料：不用 innerHTML） */
const h = (tag, cls = '', text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
/** 動態建議的驗證（只送句子，跟問阿幫頁同一個端點）；時間到就當驗證不了 */
async function checkRemote(asks, ms = 1500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(0, ms));
  try {
    const r = await fetch(`${API_BASE}/api/v1/suggest/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asks }), signal: ctl.signal });
    return r.ok ? (await r.json()).data : [];
  } finally { clearTimeout(timer); }
}
/** 只複製到剪貼簿（不上傳）；沒有 Clipboard API（舊 WebView）就用隱藏的 textarea */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 退回舊做法 */ }
  try {
    const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
/** 有模型可談的狀態（其餘：這台不能用、網頁版） */
const HAS_MODEL = ['ready', 'off', 'downloading', 'downloadable'];
const LOCK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

/** 三次貝茲曲線上的點 */
const bez = (p, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]); };
// 訊號＝沿線一串小光點依序亮起（只動 opacity，手機上順；不用 stroke-dashoffset）
const dot = (cls, [x, y], i) => `<circle class="ai-dot ${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" style="--i:${i}"/>`;
const SIGNAL_DOTS = [
  ...[50, 66, 82, 98, 114, 130].map((y, i) => dot('ai-dot-in', [180, y], i)),
  ...[[[180, 177], [180, 218], [100, 196], [86, 234]], [[180, 177], [180, 218], [260, 196], [274, 234]]].flatMap((p) => [0.12, 0.3, 0.48, 0.66, 0.84].map((t, i) => dot('ai-dot-out', bez(p, t), i))),
].join('');
/** 「試試看」的動畫至少播這麼久（毫秒；Gemini Nano 約 0.4 秒就判斷完，不然一閃就過）。結果文字不等它，立刻寫進 role=status */
export const MIN_PLAY_MS = 1200;
/** 其中「訊號流到意圖、狀態，節點點亮」這一段 */
const FLOW_MS = 550;

/** 主視覺（座標沿用 App 圖示的比例：軌道圓心在上、Λ 的開口朝下、核心在 Λ 裡面偏下） */
const coreSvg = (t) => `
<svg class="ai-svg" viewBox="0 0 360 292" focusable="false">
  <defs>
    <linearGradient id="ai-lam" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#CCFBF1"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>
    <radialGradient id="ai-halo-g"><stop offset="0" stop-color="#FBBF24" stop-opacity=".8"/><stop offset=".45" stop-color="#FBBF24" stop-opacity=".24"/><stop offset="1" stop-color="#FBBF24" stop-opacity="0"/></radialGradient>
    <radialGradient id="ai-glow-g"><stop offset="0" stop-color="#5EEAD4" stop-opacity=".38"/><stop offset="1" stop-color="#5EEAD4" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="180" cy="134" r="130" fill="url(#ai-glow-g)"/>
  <circle class="ai-ring2" cx="180" cy="128" r="106"/>
  <circle class="ai-ring" cx="180" cy="128" r="86"/>
  <g class="ai-orbit"><circle class="ai-arc" cx="180" cy="128" r="86"/><circle class="ai-sat" cx="266" cy="128" r="4"/></g>
  <path class="ai-wire" d="M180 38V146" pathLength="1"/>
  <path class="ai-wire" d="M180 177C180 218 100 196 86 234" pathLength="1"/>
  <path class="ai-wire" d="M180 177C180 218 260 196 274 234" pathLength="1"/>
  <path class="ai-lambda" d="M130 190L180 68L230 190"/>
${SIGNAL_DOTS}
  <circle class="ai-halo" cx="180" cy="160" r="46" fill="url(#ai-halo-g)"/>
  <circle class="ai-pulse" cx="180" cy="160" r="18"/>
  <circle class="ai-core-ring" cx="180" cy="160" r="25"/>
  <circle class="ai-core" cx="180" cy="160" r="15"/>
  <g class="ai-node"><rect x="112" y="6" width="136" height="32" rx="16"/><text x="180" y="27">${esc(t('node.input'))}</text></g>
  <g class="ai-node ai-out"><rect x="14" y="234" width="144" height="52" rx="14"/><rect class="ai-glow" x="14" y="234" width="144" height="52" rx="14"/><text class="ai-k" x="86" y="253">${esc(t('node.intent'))}</text><text class="ai-v" data-v="intent" x="86" y="275">—</text></g>
  <g class="ai-node ai-out"><rect x="202" y="234" width="144" height="52" rx="14"/><rect class="ai-glow" x="202" y="234" width="144" height="52" rx="14"/><text class="ai-k" x="274" y="253">${esc(t('node.states'))}</text><text class="ai-v" data-v="states" x="274" y="275">—</text></g>
</svg>`;

export default {
  title: '阿幫的腦袋',
  async render({ main, query, toast, setTitle, onCleanup }) {
    const lang = pageLang(query);
    const t = aiT(lang);
    if (lang) setTitle(t('title'));
    let alive = true;
    onCleanup?.(() => { alive = false; });

    main.innerHTML = `
      <div class="ai-page"${lang ? ' lang="en"' : ''}>
        <section class="ai-hero" data-stage="idle" data-core="off" aria-labelledby="ai-engine">
          <p class="ai-eyebrow">${esc(t('hero.eyebrow'))}</p>
          <h2 class="ai-engine" id="ai-engine">${esc(t('hero.checking'))}</h2>
          <p class="ai-sub" id="ai-sub"></p>
          <p class="ai-chip" id="ai-chip" hidden></p>
          <div class="ai-stage" id="ai-stage" aria-hidden="true">${coreSvg(t)}</div>
          <p class="ai-live" id="ai-live" role="status"></p>
        </section>
        <section class="card ai-card" id="ai-try" aria-labelledby="ai-try-h"><h2 id="ai-try-h">${esc(t('try.title'))}</h2><div id="ai-try-body"></div></section>
        <section class="card ai-card" id="ai-model" aria-labelledby="ai-model-h"><h2 id="ai-model-h">${esc(t('model.title'))}</h2><div id="ai-model-body"></div></section>
        <section class="card ai-card" id="ai-write" aria-labelledby="ai-write-h"><h2 id="ai-write-h">${esc(t('write.title'))}</h2><div id="ai-write-body"></div></section>
        <section class="card ai-card" id="ai-vision" aria-labelledby="ai-vision-h"><h2 id="ai-vision-h">${esc(t('vision.title'))}</h2><div id="ai-vision-body"></div></section>
        <section class="card ai-card" id="ai-ear" aria-labelledby="ai-ear-h"><h2 id="ai-ear-h">${esc(t('ear.title'))}</h2><div id="ai-ear-body"><p class="note">${esc(t('hero.checking'))}</p></div></section>
        <section class="card ai-card" id="ai-server" aria-labelledby="ai-server-h"><h2 id="ai-server-h">${esc(t('server.title'))}</h2><div id="ai-server-body"></div></section>
        <section class="card ai-card" id="ai-flow" aria-labelledby="ai-flow-h"><h2 id="ai-flow-h">${esc(t('flow.title'))}</h2><div id="ai-flow-body"></div></section>
        <p class="updated"><a class="linkish" href="#/settings">${esc(t('links.settings'))}</a>・<a class="linkish" href="#/privacy">${esc(t('links.privacy'))}</a></p>
      </div>`;

    const $ = (sel) => main.querySelector(sel);
    const hero = $('.ai-hero');
    const live = $('#ai-live');
    const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('lite-motion');
    const stage = (s) => { hero.dataset.stage = s; };
    /** 節點上的字（太長縮小；完整內容在下面那一句） */
    const setNode = (key, text) => {
      const el = $(`.ai-v[data-v="${key}"]`);
      el.textContent = text;
      el.classList.toggle('long', [...text].reduce((n, ch) => n + (/[⺀-￿]/.test(ch) ? 2 : 1), 0) > 12);
    };
    const statusLabel = (info) => (info.state === 'downloading' && info.download ? t('status.downloadingPct', { pct: info.download.pct })
      : info.state === 'unsupported' ? t('status.unsupported', { reason: t(`reason.${info.reason}`) }) : t(`status.${info.state}`));
    const engineName = (info) => ENGINE_NAME[info.engine] || '';

    let raw = { available: false, reason: 'web' };
    let info = normalizeEdgeInfo(raw, { enabled: edgeEnabled() });
    let server = normalizeServerInfo(null, lastAgentStatus());
    let busy = false;

    function paintHero() {
      const has = HAS_MODEL.includes(info.state) && info.engine;
      hero.dataset.core = info.active ? 'on' : 'off';
      stage('idle');
      $('#ai-engine').textContent = has ? `${engineName(info)}${info.state === 'off' ? t('hero.offSuffix') : ''}` : t('hero.serverTitle');
      $('#ai-sub').textContent = t(`hero.sub.${info.state}`, { reason: t(`reason.${info.reason}`) });
      const chip = $('#ai-chip');
      chip.textContent = statusLabel(info);
      chip.classList.toggle('on', info.active);
      chip.hidden = false;
      // 沒有手機上的模型：節點照實寫「由伺服器判斷」
      setNode('intent', info.active ? '—' : t('node.server'));
      setNode('states', info.active ? '—' : t('node.server'));
      live.textContent = info.active ? t('live.idle') : t('live.dark');
    }

    // ───── 現場試判斷（ai-trial.js）：按一次看四段——意圖與狀態、資料夠不夠、預計回答、下一個預計問你 ─────
    let trialCtl = null;
    onCleanup?.(() => trialCtl?.abort());
    const intentName = (x) => { const v = t(`intent.${x}`); return v === `intent.${x}` ? String(x) : v; };
    const stateNames = (list) => (list?.length ? list.map((k) => { const v = t(`state.${k}`); return v === `state.${k}` ? k : v; }).join(t('sep')) : t('trial.states.none'));
    /** 一段的外框：編號、標題、來源、耗時、有沒有用網路、原始 JSON（textContent，不用 innerHTML） */
    function section(key, sec, src) {
      const li = h('li', 'ai-sec');
      li.dataset.sec = key;
      const head = h('div', 'ai-sec-head');
      head.append(h('span', 'ai-sec-n', String(TRIAL_SECTIONS.indexOf(key) + 1)), h('h3', '', t(`trial.sec.${key}`)));
      const meta = h('p', 'ai-meta');
      if (src) meta.append(h('span', 'ai-by', src));
      if (Number.isFinite(sec.ms)) meta.append(h('span', 'ai-ms', t('trial.ms', { ms: Math.round(sec.ms) })));
      meta.append(h('span', `ai-netb ${sec.network ? 'yes' : 'no'}`, t(sec.network ? 'trial.net.yes' : 'trial.net.no')));
      const body = h('div', 'ai-sec-body');
      const raw = h('details', 'ai-raw');
      raw.append(h('summary', '', t('trial.json')), h('pre', '', JSON.stringify(sec, null, 2)));
      li.append(head, meta, body, raw);
      return { li, body };
    }
    const byLabel = (s) => (s.by === 'device' ? t('trial.by.device', { engine: ENGINE_NAME[s.engine] || s.engine || '' }) : t(`trial.by.${s.source === 'embed' || s.source === 'llm' ? s.source : s.source === 'device' ? 'mixed' : 'rules'}`));
    const SRC = {
      judge: byLabel,
      data: () => t('trial.by.program'),
      answer: (s) => (s.rewrite?.ok ? t('trial.by.mixed') : t('trial.by.program')),
      next: (s) => (s.suggest?.source === 'edge' || s.asker?.by === 'device' ? t('trial.by.mixed') : t('trial.by.rules')), // 題目或建議有手機上的 AI 參與（ADR-0020）
    };
    const row = (k, v) => { const d = h('div'); d.append(h('dt', '', k), h('dd', '', v)); return d; };

    function paintJudge(body, s) {
      const dl = h('dl', 'ai-dl');
      dl.append(row(t('trial.intent'), intentName(s.intent)), row(t('trial.states'), stateNames(s.states)));
      body.append(dl);
      if (s.by === 'server' && s.why) body.append(h('p', 'note', t(`trial.why.${s.why}`)));
      if (s.server) body.append(h('p', 'note', s.server.source === 'device' ? t('trial.server.device') : t('trial.server.own', { intent: intentName(s.server.intent) })));
    }
    function paintData(body, s) {
      if (s.error) { body.append(h('p', 'note', t('trial.error', { msg: s.error }))); return; }
      const miss = (s.missing || []).map((k) => t(`slot.${k}`)).join(t('trial.sep'));
      const verdict = s.safety ? t('trial.safety') : s.blocked ? t(`trial.enough.${s.blocked}`) : s.intent === 'savedMissing' ? t('trial.enough.saved', { saved: s.slots?.[0]?.value || '' })
        : s.fixed ? t('trial.enough.fixed') : s.target !== s.intent && s.missing?.length ? t('trial.enough.judgedOnly', { intent: intentName(s.target), missing: miss })
          : s.target !== s.intent ? t('trial.enough.unknown') : s.missing?.length ? t('trial.enough.no', { missing: miss }) : s.enough ? t('trial.enough.yes') : t('trial.enough.unknown');
      body.append(h('p', `ai-verdict ${s.enough ? 'ok' : 'no'}`, verdict));
      if (s.slots?.length) {
        const ul = h('ul', 'ai-slots');
        for (const x of s.slots) {
          const li = h('li', x.have ? 'have' : x.required ? 'miss' : 'fill');
          li.append(h('b', '', t(`slot.${x.key}`)), h('span', '', x.have ? x.value : x.required ? t('trial.slot.missing') : `${t('trial.slot.empty')}・${t(`fill.${x.fill}`)}`));
          ul.append(li);
        }
        body.append(ul);
      }
      const heard = [...(s.heard?.places || []), ...(s.heard?.states || []).map((k) => stateNames([k])), s.heard?.arriveBy, s.heard?.departTime].filter(Boolean);
      if (!s.slots?.length && heard.length) body.append(h('p', 'note', t('trial.heard', { x: heard.join(t('trial.sep')) })));
      if (s.safety) return;
      body.append(h('h4', '', t(s.target !== s.intent ? 'trial.sources.if' : 'trial.sources'))); // 規則聽不懂：這些是「如果聽懂會查」的
      if (!s.sources?.length) { body.append(h('p', 'note', t('trial.sources.none'))); return; }
      const ul = h('ul', 'ai-sources');
      for (const x of s.sources) {
        const li = h('li', x.mode === 'live' ? 'live' : 'demo');
        li.append(h('b', '', t(`src.${x.id}`)), h('span', '', t(`srcmode.${x.reason}`, { n: x.minutesAgo ?? 0 })));
        ul.append(li);
      }
      body.append(ul);
    }
    function paintAnswer(body, s) {
      if (s.askedLocation) body.append(h('p', 'note ai-locnote', t('trial.location')));
      body.append(h('h4', '', t('trial.tools')));
      if (s.tools?.length) {
        const ul = h('ul', 'ai-tools');
        for (const x of s.tools) {
          const li = h('li', x.ok ? '' : 'fail');
          li.append(h('b', '', (lang && x.role ? roleEn(x.role) : x.role) || x.title || x.name), h('span', '', x.ok ? x.speak || '' : t('trial.tool.fail', { error: x.error || '' })));
          if (x.ok && x.mode === 'demo') li.append(h('small', 'ai-tag', t('trial.tool.demo')));
          ul.append(li);
        }
        body.append(ul);
      } else body.append(h('p', 'note', t('trial.tools.none')));
      if (s.best) body.append(h('p', 'note ai-best', t('trial.best', { best: s.best }))); // 方案名稱是資料（照原文）
      if (s.error) body.append(h('p', 'note', t('trial.error', { msg: s.error })));
      if (s.draft) {
        const d = h('div', 'ai-draft');
        d.append(h('h4', '', t(s.direct ? 'trial.direct' : 'trial.draft')), h('p', 'ai-say', s.draft));
        body.append(d);
      }
      const r = s.rewrite || {};
      const w = h('div', `ai-rewrite ${r.ok ? 'ok' : r.by === 'none' ? 'none' : 'no'}`);
      if (r.by === 'none') w.append(h('p', 'note', t(`trial.rewrite.${r.reason}`)));
      else {
        w.append(h('h4', '', t('trial.rewrite', { engine: ENGINE_NAME[r.engine] || ENGINE_NAME[info.engine] || '' })));
        if (r.text) w.append(h('p', 'ai-say', r.text));
        const why = r.reason === 'check' ? `${t(`chk.${r.check}`)}${r.why ? `「${r.why}」` : ''}` : t(`rw.${r.reason}`);
        w.append(h('p', `ai-check ${r.ok ? 'ok' : 'no'}`, r.ok ? t('trial.rewrite.ok') : t(r.reason === 'check' ? 'trial.rewrite.fail' : 'trial.rewrite.reason', { why })));
      }
      body.append(w);
    }
    /** 這題誰決定的（ADR-0020）：手機上的 AI 決定／規則保底；手機提議但被擋下的題目照列（含原因） */
    function paintAsker(body, a) {
      if (!a) return;
      const engine = ENGINE_NAME[a.engine] || a.engine || '';
      const line = a.by === 'device' ? t('trial.asker.device', { engine }) : a.by === 'rule' ? (a.proposed ? t('trial.asker.rule') : a.engine ? t('trial.asker.ruleOnly') : t('trial.asker.rule')) : a.engine && !a.proposed ? t('trial.asker.noneDevice') : '';
      if (line) { const p = h('p', `note ai-asker ${a.by}`, line); p.dataset.by = a.by; body.append(p); }
      if (!a.blocked || !a.proposed) return;
      const box = h('div', 'ai-ask ai-ask-blocked');
      box.dataset.where = a.blocked.where;
      box.append(h('p', 'note', t('trial.asker.proposed')), h('p', 'ai-dq', a.proposed.question || '—'));
      if (a.proposed.options?.length) { const ul = h('ul', 'ai-ask-opts'); for (const o of a.proposed.options) ul.append(h('li', '', o)); box.append(ul); }
      const why = t(`askwhy.${a.blocked.reason}`);
      box.append(h('p', 'ai-check no', t(`trial.asker.blocked.${a.blocked.where}`, { why: why === `askwhy.${a.blocked.reason}` ? a.blocked.reason : why })));
      body.append(box);
    }
    function paintNext(body, s) {
      body.append(h('h4', '', t('trial.ask')));
      if (s.ask) {
        const box = h('div', 'ai-ask');
        box.append(h('p', 'ai-ask-q', s.ask.question));
        const ul = h('ul', 'ai-ask-opts');
        for (const o of s.ask.options || []) {
          const li = h('li');
          li.append(h('b', '', o.label), h('span', '', `${t(`kind.${o.kind}`)}${o.guess ? `・${t('trial.ask.guess')}` : ''}${o.saved ? `・${t('trial.ask.saved')}` : ''}`));
          ul.append(li);
        }
        box.append(ul);
        if (s.ask.why) box.append(h('p', 'note', s.ask.why));
        body.append(box);
      } else body.append(h('p', 'note', t('trial.ask.none')));
      paintAsker(body, s.asker);
      if (s.missing?.length && !s.missing.some((k) => s.ask?.about === `slot:${k}`)) body.append(h('p', 'note ai-gap', t('trial.ask.missing', { missing: s.missing.map((k) => t(`slot.${k}`)).join(t('trial.sep')) })));
      if (s.location) body.append(h('p', 'note', t('trial.ask.location')));
      body.append(h('h4', '', t('trial.suggest')));
      const sug = s.suggest || {};
      if (sug.asks?.length) {
        const ol = h('ol', 'ai-suggest');
        for (const a of sug.asks) { const li = h('li'); li.dataset.src = a.src; li.append(h('span', '', a.q), h('small', 'ai-tag', t(`trial.suggest.${a.src}`))); ol.append(li); }
        body.append(ol);
      } else body.append(h('p', 'note', t('trial.suggest.none')));
      body.append(h('p', 'note ai-foot', sug.source === 'edge' ? t('trial.suggest.from.edge', { n: sug.asks.filter((a) => a.src === 'edge').length }) : t('trial.suggest.from.rules')));
    }
    const PAINT = { judge: paintJudge, data: paintData, answer: paintAnswer, next: paintNext };

    function paintTry() {
      // 重畫（例：切了開關）：舊的一輪先停掉，它晚到的結果不會寫進新畫面
      trialCtl?.abort();
      trialCtl = null;
      busy = false;
      const body = $('#ai-try-body');
      const presets = TRIAL_PRESETS.map((k) => `<button type="button" class="chip" data-q="${esc(t(k))}">${esc(t(k))}${k === 'trial.p2' ? `<small>${esc(t('trial.p.note'))}</small>` : ''}</button>`).join('');
      body.innerHTML = `
        <p class="note">${esc(t('try.lead'))}</p>
        <form class="ai-try-form" id="ai-form">
          <label class="sr-only" for="ai-input">${esc(t('try.label'))}</label>
          <input class="field" id="ai-input" type="text" maxlength="120" autocomplete="off" enterkeyhint="go" placeholder="${esc(t('try.placeholder'))}">
          <button class="btn" type="submit" id="ai-go">${esc(t('try.go'))}</button>
        </form>
        <div class="chips ai-ex" role="group" aria-label="${esc(t('try.examples'))}">${presets}</div>
        <div class="ai-net"><p class="ai-local">${LOCK}<b>${esc(t('trial.net.title'))}</b></p><ul>
          <li>${esc(t(info.active ? 'trial.net.1.device' : 'trial.net.1.server'))}</li><li>${esc(t('trial.net.rest'))}</li><li>${esc(t('trial.net.privacy'))}</li></ul></div>
        <div id="ai-think" class="ai-think"></div>
        <ol class="ai-trial" id="ai-trial" hidden></ol>
        <p class="ai-trial-foot" id="ai-trial-foot" hidden><button type="button" class="btn small ghost" id="ai-copy" disabled>${esc(t('trial.copy'))}</button></p>
        <p class="sr-only" id="ai-trial-live" role="status"></p>`;
      const input = $('#ai-input');
      const go = $('#ai-go');
      const list = $('#ai-trial');
      const tlive = $('#ai-trial-live');
      const foot = $('#ai-trial-foot');
      const copy = $('#ai-copy');
      const thinkBox = $('#ai-think');
      let report = null;
      copy.addEventListener('click', () => { if (report) copyText(reportJson(report)).then((ok) => toast(t(ok ? 'trial.copied' : 'trial.copyFail'))); });

      // 第 1 段在手機上判斷時：主視覺照原本的核心動畫（至少播 MIN_PLAY_MS；結果文字不等動畫，立刻寫進 role=status）
      let heroT0 = 0, heroStill = true;
      const heroStart = () => {
        heroT0 = performance.now();
        heroStill = calm();
        setNode('intent', '…'); setNode('states', '…');
        stage('thinking');
        hero.classList.toggle('playing', !heroStill);
        live.textContent = t('live.thinking');
      };
      const heroEnd = (r) => {
        live.textContent = r ? judgedText(r, edgeStats().lastMs, t) : t('try.fail');
        paintModel(); // 次數與耗時更新
        const finish = () => hero.classList.remove('playing');
        if (!r) { setNode('intent', '—'); setNode('states', '—'); stage('idle'); finish(); return; }
        const light = () => { // 訊號流到意圖、狀態，節點點亮
          setNode('intent', t(`intent.${r.intent}`));
          setNode('states', r.states.length ? nodeText(r.states.map((k) => t(`state.${k}`)), t('sep')) : t('node.none'));
          void hero.offsetWidth; // 連續試：讓「點亮」的動畫重新開始
          stage('done');
        };
        if (heroStill) { light(); finish(); return; }
        const wait = Math.max(0, MIN_PLAY_MS - FLOW_MS - (performance.now() - heroT0));
        setTimeout(() => { if (!alive) return; light(); setTimeout(() => { if (alive) finish(); }, FLOW_MS); }, wait);
      };

      const run = async (text) => {
        const q = String(text || '').trim();
        if (busy) return;
        if (!q) { live.textContent = t('try.empty'); input.focus(); return; }
        busy = true;
        go.disabled = true; go.setAttribute('aria-busy', 'true');
        list.replaceChildren(); list.hidden = true; foot.hidden = true;
        report = null; copy.disabled = true; // 這一輪好了才能複製
        tlive.textContent = t('trial.running');
        if (matchMedia('(pointer: coarse)').matches) input.blur(); // 手機：收鍵盤
        const device = { active: info.active, engine: info.engine || null, write: info.active && raw?.write === true && edgeWriteEnabled(), reason: info.state };
        if (device.active) { heroStart(); $('#ai-stage').scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' }); }
        const think = mountThinking({ lang, roleName: (r) => (lang ? roleEn(r) || r : r) }); // 「阿幫在想」核心動畫：判斷 → 查資料 → 寫 → 猜下一句（真實事件推進）
        thinkBox.replaceChildren(think.el);
        trialCtl?.abort();
        const ctl = new AbortController();
        trialCtl = ctl;
        let askInfo = null;
        const mine = () => alive && trialCtl === ctl && !ctl.signal.aborted; // 這一輪還是目前的那一輪（沒被重畫或離開頁面取代）
        try {
          const rep = await runTrial(q, {
            device,
            judge: (x) => { askInfo = null; return edgeJudge(x, [], { timeout: TRY_TIMEOUT_MS, context: judgeContext({ located: false }), onAsk: (a) => { askInfo = a; } }); }, // 只呼叫手機上的外掛，沒有網路；試判斷不送定位（情境照實說沒有定位）
            askInfo: () => askInfo, // 手機上的 AI 提議的題目與在手機上的檢查結果（ADR-0020）
            judgeMs: () => edgeStats().lastMs,
            agent: (b, onEv, o) => runAgent(b, onEv, o),
            write: (d, o) => edgeWrite(d, o),
            suggest: ({ q: qq, run: r }) => trialSuggest({ q: qq, run: r, canEdge: edgeCanSuggest, edgeSuggest, check: checkRemote, wait: SUGGEST_WAIT_MS }),
            signal: ctl.signal,
          }, (key, sec) => {
            if (!mine()) return;
            const old = list.querySelector(`[data-sec="${key}"]`); // 第 1 段之後補上「伺服器怎麼看」：原地換掉
            if (key === 'judge' && device.active && !old) heroEnd(sec.by === 'device' ? { intent: sec.intent, states: sec.states } : null);
            const { li, body: b } = section(key, sec, SRC[key](sec));
            PAINT[key](b, sec);
            if (old) { li.querySelector('details').open = old.querySelector('details').open; old.replaceWith(li); } else list.append(li);
            list.hidden = false;
          }, (e) => { if (mine()) think.step(e); });
          if (mine()) { report = rep; copy.disabled = false; tlive.textContent = t('trial.done'); foot.hidden = false; }
        } catch (e) {
          if (mine()) tlive.textContent = t('trial.error', { msg: e?.message || '' });
        } finally {
          think.stop();
          // 只動這一輪自己的元素；被重畫取代的舊一輪不改 busy（新畫面已重設）
          if (trialCtl === ctl) { busy = false; trialCtl = null; }
          go.disabled = false; go.removeAttribute('aria-busy');
        }
      };
      $('#ai-form').addEventListener('submit', (e) => { e.preventDefault(); run(input.value); });
      for (const b of body.querySelectorAll('.ai-ex .chip')) b.addEventListener('click', () => { input.value = b.dataset.q; run(b.dataset.q); });
    }

    function paintModel() {
      const has = HAS_MODEL.includes(info.state) && info.engine;
      const stats = edgeStats();
      const rows = [];
      if (has) {
        rows.push([t('model.engine'), engineName(info)], [t('model.provider'), t(`model.provider.${info.engine}`)]);
        if (info.aicoreVersion) rows.push([t('model.aicore'), info.aicoreVersion]);
        rows.push([t('model.where'), info.device ? t('model.where.device', { device: info.device }) : t('model.where.here')]);
      }
      rows.push([t('model.state'), statusLabel(info)]);
      if (has && info.modelName) rows.push([t('model.name'), info.modelName]);
      if (has && info.tokenLimit) rows.push([t('model.tokens'), t('model.tokens.v', { n: info.tokenLimit.toLocaleString('en-US') })]);
      if (has && info.languages) rows.push([t('model.langs'), languageNames(info.languages, lang).join(t('sep'))]);
      if (info.osVersion && info.engine) rows.push([t('model.os'), `${info.engine === 'apple' ? 'iOS' : 'Android'} ${info.osVersion}`]);
      if (has && stats.lastMs != null) rows.push([t('model.last'), t('model.last.v', { ms: stats.lastMs })]);
      if (has && (info.active || stats.today > 0)) rows.push([t('model.today'), t('model.today.v', { n: stats.today })]);
      const lead = info.state === 'web' ? t('model.none.web') : !has ? t('model.none.other') : '';
      $('#ai-model-body').innerHTML = `${lead ? `<p class="note">${esc(lead)}</p>` : ''}<dl class="ai-dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${has ? `<p class="note ai-foot">${esc(t('model.honest'))}</p>` : ''}`;
    }

    /** 寫回答（ADR-0017）：引擎、開關、今天在手機上寫了幾次、上次花多久、改寫通過檢查的比例（只存這支手機） */
    function paintWrite() {
      const can = raw?.write === true && HAS_MODEL.includes(info.state) && info.engine;
      const on = can && info.active && edgeWriteEnabled();
      const w = edgeWriteStats();
      const rows = [];
      if (can) rows.push([t('write.engine'), engineName(info)], [t('write.switch'), t(on ? 'write.on' : 'write.off')]);
      if (can && w.lastMs != null) rows.push([t('write.last'), t('write.last.v', { ms: w.lastMs })]);
      if (can && (on || w.today > 0)) rows.push([t('write.today'), t('write.today.v', { n: w.today })]);
      if (can && w.tried > 0) rows.push([t('write.pass'), t('write.pass.v', { passed: w.passed, tried: w.tried, pct: Math.round((w.passed / w.tried) * 100) })]);
      const lead = info.state === 'web' ? t('write.lead.web') : on ? t('write.lead.on', { engine: engineName(info) }) : can ? t('write.lead.off') : t('write.lead.none');
      $('#ai-write-body').innerHTML = `<p class="note">${esc(lead)}</p>${rows.length ? `<dl class="ai-dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}${can ? `<p class="note ai-foot">${esc(t('write.honest'))}</p>` : ''}`;
    }

    function paintServer() {
      const who = (m, model) => (m === 'claude' || m === 'local' ? t(`server.mode.${m}${model ? '' : 'NoModel'}`, { model }) : t(`server.mode.${m}`));
      const answer = server.mode ? who(server.mode, server.model) : t('server.mode.unknown');
      const tag = (on, yes, no) => (on == null ? '' : `<span class="ai-tag${on ? ' on' : ''}">${esc(on ? yes : no)}</span>`);
      const member = (name, tagHtml, desc) => `<li><div class="ai-m-head"><b>${esc(name)}</b>${tagHtml}</div><p>${esc(desc)}</p></li>`;
      const members = [
        member(t('server.m.device'), tag(info.active, t('server.here.on'), t('server.here.off')), info.active ? t('server.m.device.on', { engine: engineName(info) }) : t('server.m.device.off')),
        member(t('server.m.embed'), tag(server.embed, t('server.on'), t('server.off')), t('server.m.embed.d')),
        member(t('server.m.llm'), tag(server.llm, t('server.on'), t('server.off')), t('server.m.llm.d')),
        member(t('server.m.rules'), `<span class="ai-tag on">${esc(t('server.always'))}</span>`, t('server.m.rules.d')),
      ];
      const l = server.last;
      const lastLine = !l ? '' : l.source
        ? t('server.last', { who: t(`server.who.${l.mode}`), source: t(`server.src.${l.source}`, { engine: ENGINE_NAME[l.engine] || t('server.m.device') }) })
        : t('server.lastNoSource', { who: t(`server.who.${l.mode}`) });
      $('#ai-server-body').innerHTML = `
        <dl class="ai-dl"><div><dt>${esc(t('server.answer'))}</dt><dd id="ai-answer">${esc(answer)}</dd></div></dl>
        ${lastLine ? `<p class="note ai-last">${esc(lastLine)}</p>` : ''}
        <h3>${esc(t('server.judgeTitle'))}</h3>
        <ul class="ai-members">${members.join('')}</ul>
        <p class="note ai-foot">${esc(t('server.rank'))}</p>`;
    }

    function paintFlow() {
      const dev = info.active;
      const steps = [
        ['flow.1', t('flow.1.d'), 'phone', false],
        ['flow.2', dev ? t('flow.2.device', { engine: engineName(info) }) : t('flow.2.server'), dev ? 'phone' : 'server', dev],
        ['flow.3', dev ? t('flow.3.device') : t('flow.3.server'), 'send', false],
        ['flow.4', t('flow.4.d'), 'gov', false],
        ['flow.5', t('flow.5.d'), 'server', false],
        ['flow.6', t('flow.6.d'), 'phone', false],
      ];
      const web = info.state === 'web';
      const privacy = [dev && 'privacy.try', 'privacy.question', !web && 'privacy.three', !web && 'privacy.count', !web && 'privacy.offOk'].filter(Boolean);
      $('#ai-flow-body').innerHTML = `
        <ol class="ai-flow">${steps.map(([k, d, at, core]) => `<li${core ? ' class="core"' : ''}><b>${esc(t(k))}<span class="ai-at">${esc(t(`flow.at.${at}`))}</span></b><p>${esc(d)}</p></li>`).join('')}</ol>
        <h3>${esc(t('privacy.title'))}</h3>
        <ul class="ai-privacy">${privacy.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ul>
        ${web ? `<p class="note">${esc(t('switch.web'))}</p>` : `<label class="switch-row"><span><b>${esc(t('switch.label'))}</b><small>${esc(statusLabel(info))}</small></span>
          <input type="checkbox" id="ai-edge" class="switch" role="switch" ${edgeEnabled() ? 'checked' : ''}></label>`}`;
      // 跟設定頁同一個開關（localStorage abang.edgeAI）：切了整頁照新的狀態重畫，焦點留在開關上
      $('#ai-edge')?.addEventListener('change', (e) => {
        setEdgeEnabled(e.target.checked);
        toast(t(e.target.checked ? 'switch.on' : 'switch.off'));
        info = normalizeEdgeInfo(raw, { enabled: edgeEnabled() });
        paintAll();
        $('#ai-edge')?.focus();
      });
    }

    /** 「聽」：語音問阿幫用哪個語音辨識、是不是在手機上（只顯示系統真的回報的；voice.js normalizeVoiceInfo） */
    function paintEar(v) {
      const rows = [];
      if (v.engine) rows.push([t('ear.engine'), t(`ear.engine.${v.engine}`)]);
      const name = voiceT(lang)(String(v.lang || 'zh-TW').startsWith('en') ? 'lang.en' : 'lang.zh');
      if (v.state === 'none') rows.push([t('ear.ondevice'), t(`ear.reason.${v.reason}`)]);
      else rows.push([t('ear.ondevice'), v.state === 'unsupported' ? t('ear.ondevice.unsupported', { why: whyText(v, lang, v.lang) }) : v.state === 'downloading' && v.progress != null ? t('ear.ondevice.downloadingPct', { pct: v.progress }) : t(`ear.ondevice.${v.state}`, { lang: name })]);
      if (v.lang) rows.push([t('ear.lang'), languageNames([v.lang], lang)[0]]);
      if (v.permission) rows.push([t('ear.perm'), t(`ear.perm.${v.permission}`)]);
      if (v.state !== 'none' && v.state !== 'unsupported') rows.push([t('model.state'), t(voiceEnabled() ? 'status.ready' : 'status.off')]); // 開關
      const lead = v.state === 'ready' ? t('ear.how') : v.state === 'none' ? (v.platform === 'web' ? t('ear.none.web') : t(`ear.reason.${v.reason}`)) : v.state === 'unsupported' ? t('ear.none.app') : t('ear.none.download', { lang: name });
      $('#ai-ear-body').innerHTML = `<p class="note">${esc(lead)}</p><dl class="ai-dl">${rows.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl><p class="note ai-foot">${esc(t('ear.privacy'))}</p>`;
    }

    function paintAll() { paintHero(); paintTry(); paintModel(); paintWrite(); paintServer(); paintFlow(); }

    // 阿幫會看（M14-02）：讀字、條碼、看懂圖片；只列外掛真的回報的（網頁版照實說只有瀏覽器內建的）
    visionStatus().then((v) => {
      if (!alive) return;
      const eng = (e) => (e ? t(`vision.engine.${e}`) : t('vision.none'));
      const rows = [[t('vision.text'), v.text ? eng(v.textEngine) : t('vision.none')], [t('vision.barcode'), v.barcode ? eng(v.barcodeEngine) : t('vision.none')]];
      if (v.describe) rows.push([t('vision.describe'), t(`vision.describe.${v.describe.state}`)]);
      if (v.cameraPermission) rows.push([t('vision.camera'), t(`vision.perm.${v.cameraPermission}`)]);
      if (v.where === 'app' || v.text || v.barcode) rows.push([t('vision.switch'), t(visionEnabled() ? 'vision.on' : 'vision.off')]);
      $('#ai-vision-body').innerHTML = `<p class="note">${esc(t(v.where === 'app' ? 'vision.lead.app' : 'vision.lead.web'))}</p><dl class="ai-dl">${rows.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl><p class="note ai-foot">${esc(t('vision.honest'))}</p>`;
    });
    paintServer(); // 判斷層說明不必等（伺服器資訊到了再補）
    paintWrite();
    voiceStatus().then((v) => { if (alive) paintEar(v); });
    edgeStatus().then((s) => {
      if (!alive) return;
      raw = s;
      info = normalizeEdgeInfo(raw, { enabled: edgeEnabled() });
      paintAll();
      if (info.active) edgePrewarm(); // 先讓系統載入模型，第一次試才不會慢
    });
    api.status().then((d) => {
      if (!alive) return;
      server = normalizeServerInfo(d?.agent, lastAgentStatus());
      paintServer();
    }).catch(() => {});
  },
};
