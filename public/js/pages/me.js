// 我的 #/me（2026-11-21 首頁重新設計）：存在這支手機的東西（收藏、常用地點、我的發票、提醒）、手機上的 AI 狀態與說明、設定與隱私、關於與資料來源。
// 不用註冊登入：這頁只讀手機上的資料算數量，編輯在原本的頁面（#/favs、#/settings、#/s/invoice、#/reminders）。
import { icons } from '../icons.js';
import { esc, chev, favs } from '../ui.js';
import { loadPlaces, SAVED_KEYS } from '../saved-places.js';
import { wallet } from '../invoice-wallet.js';
import { listReminders } from '../reminders.js';
import { alightWatch } from '../alight.js';
import { currentArrivalWatch } from '../../ui/cards/host-web.js';
import { reminderItems } from '../reminder-items.js';
import { edgeEnabled, edgeStatus } from '../edge-judge.js';
import { edgeLine } from '../home-now.js';
import { showOnboarding } from '../onboarding.js';
import { mountHealthSetting } from '../health-ui.js';
import { openMemorySheet } from '../memory-sheet.js';
import { bigTextOn, setBigTextOn } from '../big-text.js';
import { widgetAvailable, pinTodayWidget } from '../today-widget.js';

/** 資料來源（關於） */
const SOURCES = ['交通部 TDX 運輸資料流通服務', '中央氣象署', '環境部', '衛福部健保署', '各縣市環保局', '台灣中油', '財政部', '臺灣證券交易所、證券櫃檯買賣中心', '165 全民防騙網'];

const rowHtml = (href, ic, c, title, sub, id = '') => `<a href="${href}"${id ? ` id="${id}"` : ''}><span class="ab-token sm" style="--c:${c}" aria-hidden="true">${icons[ic]}</span><div class="grow"><div class="title">${esc(title)}</div><div class="sub">${esc(sub)}</div></div>${chev}</a>`;

export default {
  title: '我的',
  shellTitle: 'title.me',
  root: true,
  render({ main, query = {}, toast }) {
    const fav = favs.list().length;
    const places = loadPlaces();
    const set = SAVED_KEYS.filter((k) => places[k]);
    let inv;
    try { inv = wallet.list().length; } catch { inv = 0; }
    const rem = reminderItems({ arrival: currentArrivalWatch(), alight: alightWatch(), leave: listReminders() }).length;
    main.innerHTML = `
      <section class="me-head card">
        <img src="/brand/abang-happy.svg" alt="" width="64" height="64">
        <div><b>不用註冊、不用登入</b><p>你存的東西都只在這支手機上，隨時可以清掉。</p></div>
      </section>
      <section aria-labelledby="me-mine">
        <div class="section-title"><h2 id="me-mine">我存的</h2></div>
        <div class="card list">
          ${rowHtml('#/favs', 'star', '#d97706', '收藏', fav ? `${fav} 個公車站與路線` : '還沒有收藏')}
          ${rowHtml('#/settings', 'home', '#1d4ed8', '常用地點', set.length ? `已設定：${set.join('、')}` : '家、公司、學校還沒設定')}
          ${rowHtml('#/s/invoice', 'receipt', '#7c3aed', '我的發票', inv ? `${inv} 張，開獎後自動對獎` : '存發票，開獎後自動對獎')}
          ${rowHtml('#/reminders', 'bell', '#b45309', '提醒', rem ? `${rem} 個進行中` : '目前沒有提醒')}
          <label class="switch-row me-big"><span class="ab-token sm" style="--c:#b45309" aria-hidden="true">${icons.search}</span><span class="grow"><b>大字模式</b><small>字和按鈕都放大</small></span><input type="checkbox" id="me-big" class="switch" role="switch" ${bigTextOn() ? 'checked' : ''}></label>
          <button type="button" id="me-memory"><span class="ab-token sm" style="--c:#0f766e" aria-hidden="true">${icons.user}</span><div class="grow"><div class="title">阿幫記得你</div><div class="sub">阿幫記得的東西一次看、一項一項忘掉</div></div>${chev}</button>
          ${widgetAvailable() ? `<button type="button" id="me-widget"><span class="ab-token sm" style="--c:#0284c7" aria-hidden="true">${icons.grid}</span><div class="grow"><div class="title">放到主畫面：阿幫・今天</div><div class="sub">不用打開 App，看今天要帶傘嗎、怎麼去公司</div></div>${chev}</button>` : ''}
        </div>
      </section>
      <section aria-labelledby="me-ai" id="ai">
        <div class="section-title"><h2 id="me-ai" tabindex="-1">手機上的 AI</h2></div>
        <div class="card me-ai" data-tone="wait">
          <p class="me-ai-st"><span class="ai-ic" aria-hidden="true">${icons.chip}</span><span><b id="me-ai-label">檢查中…</b><small id="me-ai-text"></small></span></p>
          <details class="me-ai-how"><summary>怎麼運作</summary><p class="note">手機 App 會先用手機內建的模型（iPhone 的 Apple Intelligence、Android 的 Gemini Nano）判斷你要查交通、天氣還是別的，只把判斷結果（例如「行程、趕時間」）跟問題一起送出。方案怎麼排、資料怎麼查，一樣由阿幫的程式計算。手機不支援、網頁版或你關掉時，改由阿幫伺服器判斷，用起來一樣。</p></details>
          <div class="me-ai-acts"><a class="btn small link-btn" href="#/ai">看阿幫的腦袋：模型資訊、現場試試看</a><a class="btn small quiet link-btn" href="#/settings">到設定開關</a></div>
        </div>
      </section>
      <section aria-labelledby="me-health" id="health">
        <div class="section-title"><h2 id="me-health" tabindex="-1">健康與運動</h2></div>
        <div class="card me-health"></div>
      </section>
      <section aria-labelledby="me-set">
        <div class="section-title"><h2 id="me-set">設定與隱私</h2></div>
        <div class="card list">
          ${rowHtml('#/settings', 'gear', '#475569', '設定與隱私', '權限、手機上的 AI、健康與運動、清除本機資料')}
          ${rowHtml('#/privacy', 'shield', '#0f766e', '隱私權政策', '問題、位置、手機上的資料怎麼處理')}
          <button type="button" id="me-guide"><span class="ab-token sm" style="--c:#0e7490" aria-hidden="true">${icons.info}</span><div class="grow"><div class="title">使用說明</div><div class="sub">再看一次阿幫能幫你做什麼</div></div>${chev}</button>
        </div>
      </section>
      <section aria-labelledby="me-about" class="me-about">
        <div class="section-title"><h2 id="me-about">關於與資料來源</h2></div>
        <div class="card">
          <p>Abang（阿幫）用政府開放資料回答交通、生活、消費與防詐的問題。不放廣告、不用第三方追蹤。防詐檢查結果不代表一定安全，有疑問請撥 <a href="tel:165">165</a>。</p>
          <ul>${SOURCES.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>
      </section>`;
    mountHealthSetting(main.querySelector('.me-health'), { toast, prefix: 'me-health-sw' }); // ADR-0018：跟設定頁同一個開關
    { // 約 200 字的說明收進「怎麼運作」，與上面手機上的 AI 那段一致（設計第三輪 #5；aria-describedby 照樣念得到）
      const note = main.querySelector('#me-health-sw-note');
      if (note) { const d = Object.assign(document.createElement('details'), { className: 'me-ai-how' }); d.append(Object.assign(document.createElement('summary'), { textContent: '怎麼運作' })); note.replaceWith(d); d.append(note); }
    }
    main.querySelector('#me-guide').addEventListener('click', () => showOnboarding({ force: true }));
    main.querySelector('#me-memory').addEventListener('click', () => openMemorySheet({ toast }));
    const big = main.querySelector('#me-big');
    big.addEventListener('change', () => { setBigTextOn(big.checked); toast(big.checked ? '已打開大字模式' : '已關掉大字模式'); });
    main.querySelector('#me-widget')?.addEventListener('click', async () => { // 系統畫面上按「新增」才放（ADR-0021：最後一步由系統確認）
      if (!(await pinTodayWidget())) toast('這支手機的桌面不支援從 App 新增：長按桌面空白處 →「小工具」→ 找「阿幫・今天」', 6000);
    });
    const card = main.querySelector('.me-ai');
    edgeStatus().then((st) => {
      const l = edgeLine(st, edgeEnabled());
      card.dataset.tone = l.tone;
      card.querySelector('#me-ai-label').textContent = l.label;
      card.querySelector('#me-ai-text').textContent = l.text;
    }, () => {});
    if (query.sec === 'ai') requestAnimationFrame(() => { const h = main.querySelector('#me-ai'); h?.scrollIntoView({ block: 'start' }); h?.focus({ preventScroll: true }); }); // 首頁「手機上的 AI」點進來
  },
};
