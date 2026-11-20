// 設定與隱私（M11-04、ADR-0014 E8，2026-11-21）：#/settings 設定（裝置端 AI 開關、權限狀態、本機資料）、#/privacy 隱私權政策。
// 上架必要：App Store／Google Play 都要求隱私權政策頁，且 App 內要能找到。內容以「實際怎麼做」寫，不寫做不到的保證。
import { esc } from '../ui.js';
import { edgeEnabled, edgeStatus } from '../edge-judge.js';
import { locationGranted } from '../agent/client.js';

const EDGE_KEY = 'abang.edgeAI';
const ENGINE = { apple: 'Apple Intelligence', 'gemini-nano': 'Gemini Nano' };
const REASON = { ok: '可以使用', unsupported: '這支手機不支援', disabled: '手機沒有開啟 Apple Intelligence', downloading: '模型下載中', 'needs-wifi': '連上 Wi-Fi 後會自動下載模型', 'os-too-old': '系統版本太舊', language: '目前不支援繁體中文', web: '網頁版不使用（只在手機 App）', 'no-plugin': '這個版本沒有裝置端 AI' };

/** 本機資料：存在這支手機的瀏覽器儲存（不上傳） */
const LOCAL = [['favs', '收藏的公車站與路線'], ['invoices', '我的發票'], ['abang.arrivalWatch', '進行中的到站提醒'], [EDGE_KEY, '裝置端 AI 設定']];

async function notifyStatus() {
  const c = globalThis.Capacitor;
  try {
    if (c?.isNativePlatform?.()) return (await c.nativePromise('LocalNotifications', 'checkPermissions', {}))?.display === 'granted';
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch { return false; }
}

export const settings = {
  title: '設定與隱私',
  async render({ main, toast }) {
    main.innerHTML = `
      <section class="card settings">
        <h2>裝置端 AI</h2>
        <label class="switch-row"><span><b>在手機上先聽懂你要做什麼</b><small id="edge-status">檢查中…</small></span>
          <input type="checkbox" id="edge" role="switch" ${edgeEnabled() ? 'checked' : ''}></label>
        <p class="note">開著時，手機內建的模型（iPhone 的 Apple Intelligence、Android 的 Gemini Nano）先判斷你的問題是查交通、天氣或其他，只把判斷結果（例如「行程、趕時間」）一起送出；方案怎麼排一樣由阿幫的程式計算。關掉就全部交給伺服器判斷。</p>
      </section>
      <section class="card settings">
        <h2>權限</h2>
        <p class="perm"><span>定位</span><b id="loc">檢查中…</b></p>
        <p class="perm"><span>通知（到站提醒、出門提醒）</span><b id="notify">檢查中…</b></p>
        <p class="note">要改權限：到手機的「設定 → Abang」。不給定位也能用，只是要自己說從哪出發。</p>
      </section>
      <section class="card settings">
        <h2>存在這支手機的資料</h2>
        <ul class="local">${LOCAL.map(([, name]) => `<li>${esc(name)}</li>`).join('')}</ul>
        <button class="btn danger" id="clear" type="button">清除這些資料</button>
      </section>
      <p class="updated"><a href="#/privacy">隱私權政策</a>・資料來源：交通部 TDX、中央氣象署、環境部、政府資料開放平臺</p>`;

    const edge = main.querySelector('#edge');
    edge.addEventListener('change', () => {
      try { if (edge.checked) localStorage.removeItem(EDGE_KEY); else localStorage.setItem(EDGE_KEY, 'off'); } catch { /* 無痕模式 */ }
      toast(edge.checked ? '已開啟裝置端 AI' : '已關閉裝置端 AI，改由伺服器判斷');
    });
    edgeStatus().then((s) => {
      main.querySelector('#edge-status').textContent = s.available ? `${ENGINE[s.engine] || '手機內建模型'}：可以使用` : REASON[s.reason] || '目前不能使用';
      if (s.reason === 'web') edge.disabled = true; // 網頁版沒有裝置端 AI，開關沒有作用
    });
    locationGranted().then((ok) => { main.querySelector('#loc').textContent = ok ? '已允許' : '還沒允許'; });
    notifyStatus().then((ok) => { main.querySelector('#notify').textContent = ok ? '已允許' : '還沒允許'; });
    main.querySelector('#clear').addEventListener('click', () => {
      if (!window.confirm('要清除收藏、我的發票與提醒嗎？清除後無法復原。')) return;
      try { for (const [k] of LOCAL) localStorage.removeItem(k); } catch { /* 無痕模式 */ }
      edge.checked = true;
      toast('已清除這支手機上的阿幫資料');
    });
  },
};

export const privacy = {
  title: '隱私權政策',
  render({ main }) {
    main.innerHTML = `
      <article class="card privacy">
        <p class="updated">生效日期：2026 年 11 月 21 日（上架前由營運單位確認聯絡方式與法律用語）</p>
        <h2>阿幫不需要你註冊、也不收集可以認出你是誰的資料</h2>
        <p>Abang（阿幫）用政府開放資料回答交通與生活問題。沒有帳號、沒有登入，不追蹤你、不賣資料、不放廣告追蹤器。</p>
        <h3>你問的問題</h3>
        <p>你打的問題會送到阿幫的伺服器，用來查資料和回答。伺服器的紀錄只記「用了哪些工具、花多久」，不記問題內容和你的位置。若阿幫這台伺服器設定由 AI 模型回答，問題會送給該模型處理（例如 Anthropic 的 Claude；頁面下方會寫明由誰回答）。</p>
        <h3>位置</h3>
        <p>你允許定位後，阿幫用現在的位置當出發點、找附近的公車站與 YouBike。位置只用來回答這一題，不寫進紀錄、不保存。不給定位也能用。</p>
        <h3>裝置端 AI</h3>
        <p>手機 App 可以用手機內建的模型（Apple Intelligence、Gemini Nano）先判斷問題類型，只送出判斷結果；可以在「設定與隱私」關掉。</p>
        <h3>通知</h3>
        <p>到站提醒、出門提醒用手機的本機通知，排程在你的手機上，不經過推播伺服器。</p>
        <h3>存在你手機上的資料</h3>
        <p>收藏、我的發票（號碼與日期）、進行中的提醒只存在這支手機，不上傳；可以在「設定與隱私」清除。掃描發票 QR code 時影像只在手機上解讀。</p>
        <h3>防詐檢查</h3>
        <p>貼上的可疑訊息只送到阿幫伺服器比對 165 開放資料與規則，不保存。檢查結果不代表一定安全，有疑問請撥 165。</p>
        <h3>資料來源</h3>
        <p>交通部 TDX、中央氣象署、環境部、健保署、地方政府、台灣中油、財政部、臺灣證券交易所、證券櫃檯買賣中心等開放資料；導航、叫車、訂票只開官方連結，付款在對方的 App 或網站完成。</p>
        <h3>聯絡我們</h3>
        <p>（上架前補上營運單位與聯絡信箱）</p>
      </article>`;
  },
};
