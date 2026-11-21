// 阿幫的腦袋（#/ai，2026-11-21，Austin：「做一個以 edge AI 為腦袋的視覺，讓用戶知道所有的 edge AI 模型資訊」）。
// 主視覺：App 圖示的「發光核心＋軌道＋Λ」——核心就是手機上的 AI。待機呼吸；判斷時脈動、訊號沿線流到「意圖」「狀態」並點亮結果。
// 誠實原則：只顯示系統真的回報的模型資訊（ai-info.js 整理；沒有的欄位不顯示）；沒有裝置端模型時核心不點亮，照實說判斷在伺服器做。
// 動畫只是另一種呈現：同樣的資訊都在 role=status 的那一句（讀屏、reduced motion 拿到的一樣多）。樣式：css/ai.css。
import { esc } from '../ui.js';
import { api } from '../api.js';
import { edgeEnabled, edgeStatus, edgeJudge, edgePrewarm, edgeStats, setEdgeEnabled } from '../edge-judge.js';
import { ENGINE_NAME, normalizeEdgeInfo, normalizeServerInfo, lastAgentStatus, languageNames, nodeText, judgedText } from '../ai-info.js';
import { aiT, pageLang } from './ai-i18n.js';
import { voiceStatus, voiceEnabled } from '../voice.js';

/** 「試試看」等久一點（使用者正看著；平常問阿幫只等 1.8 秒就交給伺服器） */
const TRY_TIMEOUT_MS = 6000;
const EXAMPLES = ['try.ex1', 'try.ex2', 'try.ex3', 'try.ex4'];
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

    function paintTry() {
      const body = $('#ai-try-body');
      if (!info.active) {
        const key = info.state === 'downloadable' ? 'downloading' : info.state;
        body.innerHTML = `<p class="note">${esc(t(`try.no.${key}`, { reason: t(`reason.${info.reason}`) }))}</p>${info.state === 'web' || info.state === 'unsupported' ? `<a class="btn small" href="#/agent${lang ? '?lang=en' : ''}">${esc(t('try.ask'))}</a>` : ''}`;
        return;
      }
      body.innerHTML = `
        <p class="note">${esc(t('try.lead', { engine: engineName(info) }))}</p>
        <form class="ai-try-form" id="ai-form">
          <label class="sr-only" for="ai-input">${esc(t('try.label'))}</label>
          <input class="field" id="ai-input" type="text" maxlength="120" autocomplete="off" enterkeyhint="go" placeholder="${esc(t('try.placeholder'))}">
          <button class="btn" type="submit" id="ai-go">${esc(t('try.go'))}</button>
        </form>
        <div class="chips ai-ex" role="group" aria-label="${esc(t('try.examples'))}">${EXAMPLES.map((k) => `<button type="button" class="chip">${esc(t(k))}</button>`).join('')}</div>
        <p class="ai-local">${LOCK}<span>${esc(t('try.local'))}</span></p>`;
      const input = $('#ai-input');
      const go = $('#ai-go');
      const run = async (text) => {
        const q = String(text || '').trim();
        if (busy) return;
        if (!q) { live.textContent = t('try.empty'); input.focus(); return; }
        busy = true;
        go.disabled = true; go.setAttribute('aria-busy', 'true');
        const t0 = performance.now();
        const still = calm();
        setNode('intent', '…'); setNode('states', '…');
        stage('thinking');
        hero.classList.toggle('playing', !still); // 動畫播放中（至少 MIN_PLAY_MS）
        live.textContent = t('live.thinking');
        if (matchMedia('(pointer: coarse)').matches) input.blur(); // 手機：收鍵盤，核心才看得到
        $('#ai-stage').scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
        const r = await edgeJudge(q, [], { timeout: TRY_TIMEOUT_MS }); // 只呼叫手機上的外掛，沒有任何網路請求
        if (!alive) return;
        // 資料不等動畫：結果文字與次數立刻更新（讀屏、reduced motion 拿到的一樣多、一樣快）
        live.textContent = r ? judgedText(r, edgeStats().lastMs, t) : t('try.fail');
        paintModel(); // 次數與耗時更新
        const finish = () => { hero.classList.remove('playing'); busy = false; go.disabled = false; go.removeAttribute('aria-busy'); };
        if (!r) { setNode('intent', '—'); setNode('states', '—'); stage('idle'); finish(); return; }
        const light = () => { // 訊號流到意圖、狀態，節點點亮
          setNode('intent', t(`intent.${r.intent}`));
          setNode('states', r.states.length ? nodeText(r.states.map((k) => t(`state.${k}`)), t('sep')) : t('node.none'));
          void hero.offsetWidth; // 連續試：讓「點亮」的動畫重新開始
          stage('done');
        };
        if (still) { light(); finish(); return; }
        // 思考動畫（核心脈動、訊號流進核心）至少播到 MIN_PLAY_MS − FLOW_MS；判斷比這久就一直播到結果回來
        const wait = Math.max(0, MIN_PLAY_MS - FLOW_MS - (performance.now() - t0));
        setTimeout(() => {
          if (!alive) return;
          light();
          setTimeout(() => { if (alive) finish(); }, FLOW_MS);
        }, wait);
      };
      $('#ai-form').addEventListener('submit', (e) => { e.preventDefault(); run(input.value); });
      for (const b of body.querySelectorAll('.ai-ex .chip')) b.addEventListener('click', () => { input.value = b.textContent; run(b.textContent); });
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
      if (typeof v.onDevice === 'boolean') rows.push([t('ear.where'), t(v.onDevice ? 'ear.where.device' : 'ear.where.system')]);
      if (v.lang) rows.push([t('ear.lang'), languageNames([v.lang], lang)[0]]);
      if (v.permission) rows.push([t('ear.perm'), t(`ear.perm.${v.permission}`)]);
      rows.push([t('model.state'), v.available ? t(voiceEnabled() ? 'status.ready' : 'status.off') : t(`ear.reason.${v.reason}`)]);
      const lead = v.available ? t('ear.how') : v.platform === 'web' ? t('ear.none.web') : t('ear.none.app');
      $('#ai-ear-body').innerHTML = `<p class="note">${esc(lead)}</p><dl class="ai-dl">${rows.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl><p class="note ai-foot">${esc(t('ear.privacy'))}</p>`;
    }

    function paintAll() { paintHero(); paintTry(); paintModel(); paintServer(); paintFlow(); }

    paintServer(); // 判斷層說明不必等（伺服器資訊到了再補）
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
