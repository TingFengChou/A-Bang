// 設定與隱私（M11-04、ADR-0014 E8，2026-11-21）：#/settings 設定（裝置端 AI 開關、權限狀態、本機資料）、#/privacy 隱私權政策。
// 上架必要：App Store／Google Play 都要求隱私權政策頁，且 App 內要能找到。內容以「實際怎麼做」寫，不寫做不到的保證。
import { esc } from '../ui.js';
import { edgeEnabled, edgeStatus, setEdgeEnabled, EDGE_STATS_KEY, EDGE_ENGINE_NAME as ENGINE, EDGE_REASON as REASON } from '../edge-judge.js';
import { locationGranted, browserLocation, inTaiwan } from '../agent/client.js';
import { locationHelp, openLocationSettings, OPEN_FAILED } from '../location-help.js';
import { cancelNotify, NOTIFY_ID } from '../native-notify.js';
import { loadPlaces, savePlace, SAVED_KEYS } from '../saved-places.js';
import { showOnboarding } from '../onboarding.js';
import { cancelAllReminders } from '../reminders.js';
import { createWebHost } from '../../ui/cards/host-web.js';
import { visionEnabled, setVisionEnabled, visionStatus, VISION_KEY } from '../vision.js';
import { voiceEnabled, setVoiceEnabled, voiceStatus, VOICE_KEY } from '../voice.js';
import { whyText } from '../voice-i18n.js';

const EDGE_KEY = 'abang.edgeAI';

/** 本機資料：存在這支手機的瀏覽器儲存（不上傳） */
const LOCAL = [['abang.places', '常用地點（家、公司、學校）'], ['favs', '收藏的公車站與路線'], ['invoices', '我的發票'], ['abang.arrivalWatch', '進行中的到站提醒'], ['abang.alightWatch', '進行中的下車提醒'], ['abang.reminders', '出門提醒'], ['pref:', '常用的縣市、藥局地區、股票、最近查過的公車路線等偏好（pref:*）'], [EDGE_KEY, '裝置端 AI 設定'], [VOICE_KEY, '語音問阿幫的開關'], [VISION_KEY, '「讓阿幫看照片」設定'], [EDGE_STATS_KEY, '今天在手機上判斷了幾次、上次花多久（只有數字）'], ['abang.onboarded', '看過使用說明（清除後下次會再顯示）'], ['abang.offline', '離線時顯示的上次資料（看過的路線、站牌、時刻表；不含座標）'], ['abang.chat', '問阿幫的對話（只有文字，最近 10 則，最後一次對話 12 小時後自動清掉）']];

/** 權限狀態文字：已允許／已拒絕（到手機設定開）／還沒問過 */
const PERM_SAY = { granted: '已允許', denied: '已拒絕', prompt: '還沒問過', rationale: '拒絕過一次（下次用到會再問）', off: '手機定位服務關閉' };
async function notifyState() {
  const c = globalThis.Capacitor;
  try {
    if (c?.isNativePlatform?.()) { const d = (await c.nativePromise('LocalNotifications', 'checkPermissions', {}))?.display; return d === 'granted' ? 'granted' : d === 'denied' ? 'denied' : 'prompt'; }
    if (typeof Notification === 'undefined') return 'prompt';
    return Notification.permission === 'default' ? 'prompt' : Notification.permission;
  } catch (e) { return e?.code === 'OS-PLUG-GLOC-0007' ? 'off' : 'prompt'; } // 定位服務關閉時 checkPermissions 會丟 0007
}
async function locationState() {
  const c = globalThis.Capacitor;
  try {
    if (c?.isNativePlatform?.() && c.isPluginAvailable?.('Geolocation')) {
      const r = await c.nativePromise('Geolocation', 'checkPermissions', {});
      return [r?.location, r?.coarseLocation].includes('granted') ? 'granted' : r?.location === 'denied' ? 'denied' : r?.location === 'prompt-with-rationale' ? 'rationale' : 'prompt'; // Android：拒絕過一次
    }
    const st = (await navigator.permissions?.query({ name: 'geolocation' }))?.state;
    return st || ((await locationGranted()) ? 'granted' : 'prompt');
  } catch { return 'prompt'; }
}

export const settings = {
  title: '設定與隱私',
  async render({ main, toast, onCleanup }) {
    main.innerHTML = `
      <section class="card settings">
        <h2>裝置端 AI</h2>
        <label class="switch-row"><span><b>在手機上先聽懂你要做什麼</b><small id="edge-status">檢查中…</small></span>
          <input type="checkbox" id="edge" class="switch" role="switch" aria-describedby="edge-note" ${edgeEnabled() ? 'checked' : ''}></label>
        <p class="note" id="edge-note">開著時，手機內建的模型（iPhone 的 Apple Intelligence、Android 的 Gemini Nano）先判斷你的問題是查交通、天氣或其他，只把判斷結果（例如「行程、趕時間」）一起送出；方案怎麼排一樣由阿幫的程式計算。關掉就全部交給伺服器判斷。</p>
        <a class="btn small quiet ai-link" href="#/ai">看阿幫的腦袋：模型資訊、現場試試看</a>
      </section>
      <section class="card settings" id="vision-card">
        <h2>阿幫會看</h2>
        <label class="switch-row"><span><b>讓阿幫看照片</b><small id="vision-status">檢查中…</small></span>
          <input type="checkbox" id="vision" class="switch" role="switch" aria-describedby="vision-note" ${visionEnabled() ? 'checked' : ''}></label>
        <p class="note" id="vision-note">開著時，問阿幫的輸入列有相機鍵：拍可疑簡訊、站牌或發票，阿幫在手機上讀出上面的字（手機內建的文字辨識），你確認後才拿去查詐騙、問路或對獎。照片不上傳、不保存；選截圖用系統的相片選擇器，阿幫看不到整個相簿。相機權限在第一次拍照時才問。</p>
      </section>
      <section class="card settings" id="voice-card">
        <h2>語音</h2>
        <label class="switch-row"><span><b>用語音問阿幫</b><small id="voice-status">檢查中…</small></span>
          <input type="checkbox" id="voice" class="switch" role="switch" aria-describedby="voice-note" ${voiceEnabled() ? 'checked' : ''}></label>
        <p class="note" id="voice-note">開著時，問阿幫的輸入列有麥克風鍵，也可以長按中央「問阿幫」鍵說話（放開就送出）。語音只在手機上轉成文字，不錄音、不上傳；轉好的文字跟打字一樣送出。手機還沒有中文語音包時，第一次按麥克風會協助下載；手機不支援在手機上辨識時麥克風會反白，阿幫不改用網路上的語音辨識。第一次按麥克風才會問麥克風權限。</p>
      </section>
      <section class="card settings">
        <h2>常用地點</h2>
        <p class="note">在家、公司或學校時按「設成現在位置」，或按「輸入地點」打地名設定。設好以後說「回家」「去公司」就能直接規劃。位置只存在這支手機，只有你提到時才跟問題一起送出。</p>
        <div id="saved" role="list"></div>
      </section>
      <section class="card settings" id="reminders-card">
        <h2>提醒</h2>
        <p class="note">到站、下車、出門提醒都在「提醒」分頁，可以一筆一筆取消。</p>
        <a class="btn small quiet link-btn" href="#/reminders">看進行中的提醒</a>
      </section>
      <section class="card settings">
        <h2>權限</h2>
        <p class="perm"><span>定位</span><b id="loc">檢查中…</b></p>
        <p class="perm"><span>通知（到站提醒、出門提醒）</span><b id="notify">檢查中…</b></p>
        <p class="perm" id="mic-row" hidden><span>麥克風（語音問阿幫）</span><b id="mic">檢查中…</b></p>
        <p class="note">要改權限：到手機的「設定 → Abang」。不給定位也能用，只是要自己說從哪出發。</p>
      </section>
      <section class="card settings">
        <h2>存在這支手機的資料</h2>
        <ul class="local">${LOCAL.map(([, name]) => `<li>${esc(name)}</li>`).join('')}</ul>
        <button class="btn danger" id="clear" type="button">清除這些資料</button>
      </section>
      <p class="updated"><button type="button" class="linkish" id="guide">再看一次使用說明</button>・<a href="#/privacy">隱私權政策</a>・資料來源：交通部 TDX、中央氣象署、環境部、政府資料開放平臺</p>`;

    const host = createWebHost(); // 輸入地點時查找地點（find_place）
    // 每個地點一列：更新時只換文字與按鈕狀態（不重建，鍵盤與讀屏的焦點留在原處）
    const rows = {};
    const box = main.querySelector('#saved');
    for (const k of SAVED_KEYS) {
      const row = document.createElement('div');
      row.className = 'saved-row';
      row.setAttribute('role', 'listitem');
      row.innerHTML = `<span><b>${esc(k)}</b><small></small></span>`;
      const set = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small' });
      const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small quiet', textContent: '清除' });
      del.setAttribute('aria-label', `清除「${k}」`);
      set.addEventListener('click', async () => {
        if (loadPlaces()[k] && !window.confirm(`要把「${k}」改成你現在的位置嗎？`)) return;
        set.disabled = true; set.textContent = '定位中…'; set.setAttribute('aria-busy', 'true');
        const p = await browserLocation(8000, { highAccuracy: true, fresh: true, withAccuracy: true });
        set.disabled = false; set.removeAttribute('aria-busy');
        if (!p) {
          toast(locationHelp().text, 6000); // 說原因（權限、定位服務、逾時）；App 的「到設定開啟」在權限區（S1c）
          refreshPerms();
        } else if (!inTaiwan(p)) toast(`現在位置不在台灣，不能設成「${k}」`, 5000);
        else if (p.accuracy > 300) toast(`手機只給了大概位置（誤差約 ${p.accuracy >= 1000 ? `${Math.round(p.accuracy / 100) / 10} 公里` : `${Math.round(p.accuracy)} 公尺`}），設成「${k}」會不準。請打開「精確位置」或到窗邊再試一次`, 6000);
        else if (savePlace(k, { lat: p.lat, lon: p.lon, name: '現在位置' })) toast(`已把現在位置設成「${k}」`);
        else toast('這個瀏覽器不能存資料（無痕模式？）', 5000);
        update(k);
      });
      del.addEventListener('click', () => {
        if (!window.confirm(`要清除「${k}」嗎？`)) return;
        savePlace(k, null);
        toast(`已清除「${k}」`);
        update(k);
        set.focus(); // 「清除」按鈕會隱藏，焦點移到同一列的主要按鈕
      });
      // 輸入地點（S1b）：不必人在那裡；用阿幫的找地點查（只送打的地名，不送位置），選一個結果存起來
      const find = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small quiet', textContent: '輸入地點' });
      find.setAttribute('aria-label', `輸入地點設成「${k}」`);
      find.setAttribute('aria-expanded', 'false');
      const panel = document.createElement('div');
      panel.className = 'saved-find';
      panel.id = `saved-find-${SAVED_KEYS.indexOf(k)}`;
      find.setAttribute('aria-controls', panel.id);
      panel.hidden = true;
      panel.innerHTML = `<label><span class="sr-only">「${esc(k)}」的地點</span><input type="search" maxlength="30" placeholder="車站、捷運站或地標，例如：板橋車站" autocomplete="off"></label><button type="button" class="btn small">搜尋</button><small class="saved-hint">目前查不到門牌地址，請選離那裡最近的車站或地標。</small><p class="saved-status" aria-live="polite"></p><div class="saved-results" role="list"></div>`;
      const input = panel.querySelector('input');
      const results = panel.querySelector('.saved-results');
      const status = panel.querySelector('.saved-status');
      const go = panel.querySelector('button');
      const close = () => { panel.hidden = true; find.setAttribute('aria-expanded', 'false'); };
      let seq = 0; // 只採用最後一次搜尋的結果（慢的舊回應不蓋掉新的）
      const search = async () => {
        const q = input.value.trim();
        if (!q) { input.focus(); return; }
        const my = ++seq;
        go.disabled = true;
        status.textContent = '搜尋中…';
        results.replaceChildren();
        try {
          const r = await host.callTool('find_place', { query: q });
          if (my !== seq) return;
          const list = (r.data || []).filter((x) => inTaiwan(x)).slice(0, 5);
          status.textContent = list.length ? `找到 ${list.length} 個，選一個：` : `找不到「${q}」。試試附近的車站或地標名稱`;
          for (const x of list) {
            const label = x.cityName ? `${x.name}（${x.cityName}）` : x.name; // 同名地點分得出來
            const li = document.createElement('div');
            li.setAttribute('role', 'listitem');
            const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small quiet', textContent: label });
            b.setAttribute('aria-label', `把「${k}」設成 ${label}`);
            b.addEventListener('click', () => {
              if (loadPlaces()[k] && !window.confirm(`要把「${k}」改成「${x.name}」嗎？`)) return;
              if (!savePlace(k, { lat: x.lat, lon: x.lon, name: x.name })) { toast('這個瀏覽器不能存資料（無痕模式？）', 5000); return; }
              toast(`已把「${k}」設成 ${x.name}`);
              close();
              update(k);
              find.focus();
            });
            li.append(b);
            results.append(li);
          }
        } catch (e) {
          if (my === seq) status.textContent = /^HTTP |^[A-Za-z]/.test(e.message || '') || !e.message ? '暫時查不到，稍後再試' : e.message; // 伺服器英文錯誤不直接給人看
        } finally { if (my === seq) go.disabled = false; }
      };
      go.addEventListener('click', search);
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); find.focus(); } });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      find.addEventListener('click', () => {
        if (panel.hidden) for (const o of box.querySelectorAll('.saved-find:not([hidden])')) { o.hidden = true; box.querySelector(`[aria-controls="${o.id}"]`)?.setAttribute('aria-expanded', 'false'); } // 一次只開一個
        panel.hidden = !panel.hidden;
        find.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) input.focus();
      });
      const acts = document.createElement('div');
      acts.className = 'saved-acts'; // 按鈕一組：放不下時整組換到下一行，地點名稱不會被擠成直排
      acts.append(set, find, del);
      row.append(acts, panel); // 搜尋框放在同一列裡（列表的每一項只有 listitem）
      box.append(row);
      rows[k] = { row, set, del };
    }
    const update = (k) => {
      const has = !!loadPlaces()[k];
      const { row, set, del } = rows[k];
      const saved = loadPlaces()[k];
      row.querySelector('small').textContent = !has ? '還沒設定' : saved.name && saved.name !== k && saved.name !== '現在位置' ? `已設定：${saved.name}` : '已設定（用當時的位置）'; // 讓人確認設對了
      set.textContent = has ? '重設' : '設成現在位置';
      set.className = `btn small${has ? ' quiet' : ''}`; // 已設定時降為次要（避免不小心蓋掉）
      set.setAttribute('aria-label', has ? `把「${k}」重設成現在位置` : `把現在位置設成「${k}」`);
      del.hidden = !has;
    };
    const renderSaved = () => SAVED_KEYS.forEach(update);
    renderSaved();

    main.querySelector('#guide').addEventListener('click', () => showOnboarding({ force: true }));
    const edge = main.querySelector('#edge');
    edge.addEventListener('change', () => {
      setEdgeEnabled(edge.checked);
      toast(edge.checked ? '已開啟裝置端 AI' : '已關閉裝置端 AI，改由伺服器判斷');
    });
    const vision = main.querySelector('#vision');
    vision.addEventListener('change', () => {
      setVisionEnabled(vision.checked);
      toast(vision.checked ? '已開啟：讓阿幫看照片' : '已關閉：輸入列不再顯示相機鍵');
    });
    visionStatus().then((s) => {
      const say = s.where === 'app' ? `在手機上讀字：${s.textEngine === 'apple-vision' ? 'Apple Vision' : 'ML Kit 文字辨識（中文）'}` : s.text ? '這個瀏覽器可以在本機讀字' : s.barcode ? '網頁版只能讀發票 QR code；讀簡訊、站牌請用手機 App' : '這個瀏覽器不能在本機讀字，請用手機 App';
      main.querySelector('#vision-status').textContent = say;
    });
    edgeStatus().then((s) => {
      main.querySelector('#edge-status').textContent = s.available ? `${ENGINE[s.engine] || '手機內建模型'}：可以使用` : REASON[s.reason] || '目前不能使用';
      if (s.reason === 'web') edge.closest('.switch-row').querySelector('input').hidden = true; // 網頁版沒有裝置端 AI：不顯示開關（灰色已勾選會讓人誤會）
    });
    // 語音問阿幫（M14-01）：能不能用、是不是在手機上辨識；網頁版不能在本機辨識就不顯示開關
    const voice = main.querySelector('#voice');
    voice.addEventListener('change', () => {
      setVoiceEnabled(voice.checked);
      toast(voice.checked ? '已開啟語音問阿幫' : '已關閉語音問阿幫');
    });
    const VOICE_WHY = { 'web-unsupported': '這個瀏覽器不能在本機辨識語音（不把聲音送到瀏覽器廠商的伺服器，所以不提供）', 'web-download': '瀏覽器的本機語音辨識還沒下載', 'no-plugin': '這個版本沒有語音問阿幫' };
    const VOICE_SAY = { ready: '可以使用：在手機上轉成文字', download: '可以使用：第一次按麥克風會先下載中文語音包', downloading: v => `中文語音包下載中${v.progress != null ? `（${v.progress}%）` : ''}` };
    const MIC_SAY = { granted: '已允許', denied: '已拒絕', prompt: '還沒問過', 'prompt-with-rationale': '拒絕過一次（下次用到會再問）' };
    const refreshVoice = () => voiceStatus().then((v) => {
      const say = VOICE_SAY[v.state];
      main.querySelector('#voice-status').textContent = say ? (typeof say === 'function' ? say(v) : say) : v.state === 'unsupported' ? `不能使用：${whyText(v)}` : VOICE_WHY[v.reason] || '目前不能使用';
      voice.hidden = v.state === 'none' || v.state === 'unsupported'; // 不能用：不顯示開關（灰色已勾選會讓人誤會）
      const row = main.querySelector('#mic-row');
      row.hidden = !v.permission;
      if (v.permission) main.querySelector('#mic').textContent = MIC_SAY[v.permission] || '還沒問過';
    });
    refreshVoice();
    // 權限狀態；App 裡定位被拒絕時給「到設定開啟」（S1c）。從設定回來（畫面再出現）時重新檢查
    const openLoc = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: '到設定開啟', hidden: true });
    openLoc.addEventListener('click', async () => { if (!(await openLocationSettings(openLoc.dataset.reason || 'denied'))) toast(OPEN_FAILED, 5000); });
    main.querySelector('#loc').closest('.perm').after(openLoc);
    function refreshPerms() {
      locationState().then((st) => {
        main.querySelector('#loc').textContent = PERM_SAY[st] || '還沒問過';
        openLoc.hidden = !((st === 'denied' || st === 'off') && locationHelp(st).canOpen); // iOS 定位服務關閉開設定也沒用：不給
        openLoc.dataset.reason = st;
        openLoc.setAttribute('aria-label', st === 'off' ? '到手機設定打開定位服務' : '到手機設定開啟定位權限');
      });
      notifyState().then((st) => { main.querySelector('#notify').textContent = PERM_SAY[st] || '還沒問過'; });
    }
    refreshPerms();
    const onVisible = () => { if (document.visibilityState === 'visible') { refreshPerms(); refreshVoice(); } };
    document.addEventListener('visibilitychange', onVisible);
    onCleanup?.(() => document.removeEventListener('visibilitychange', onVisible));
    main.querySelector('#clear').addEventListener('click', () => {
      if (!window.confirm('要清除常用地點、收藏、我的發票、提醒與問阿幫的對話嗎？清除後無法復原。')) return;
      try {
        for (const [k] of LOCAL) {
          if (k.endsWith(':')) for (const key of Object.keys(localStorage)) { if (key.startsWith(k)) localStorage.removeItem(key); }
          else localStorage.removeItem(k);
        }
      } catch { /* 無痕模式 */ }
      cancelNotify(NOTIFY_ID.arrival); cancelNotify(NOTIFY_ID.leave); cancelNotify(NOTIFY_ID.alight); cancelAllReminders(); // 已排好的提醒一起取消
      dispatchEvent(new CustomEvent('abang:clear-local')); // 開著的問阿幫對話也清掉（abang-dock.js）
      renderSaved();
      edge.checked = true;
      vision.checked = true; setVisionEnabled(true);
      voice.checked = true;
      dispatchEvent(new CustomEvent('abang:voice-setting', { detail: { on: true } })); // 麥克風鍵跟著回來
      toast('已清除這支手機上的阿幫資料');
    });
  },
};

export const privacy = {
  title: '隱私權政策',
  render({ main }) {
    main.innerHTML = `
      <article class="card privacy">
        <p class="updated">生效日期：2026 年 11 月 21 日。以下〔待補〕的欄位由營運單位在上架前填寫並經法務確認。</p>
        <h2>摘要</h2>
        <p>Abang（阿幫）用政府開放資料回答交通與生活問題。不需要註冊或登入，不放廣告、不用第三方追蹤工具、不把資料賣給任何人。為了回答問題，會處理你打的問題、你允許時的位置、以及連線用的 IP 位址，說明如下。</p>
        <h3>1. 蒐集者</h3>
        <p>〔待補：營運單位名稱、地址〕</p>
        <h3>2. 蒐集目的</h3>
        <p>提供交通、天氣與生活資訊查詢與建議（含防詐訊息檢查）、防止服務被濫用（限流）、維持服務運作與除錯。〔待補：個資法特定目的代號，由法務確認〕</p>
        <h3>3. 處理哪些資料、怎麼用</h3>
        <p><b>你打的問題：</b>送到阿幫伺服器查資料和回答。伺服器紀錄只記「用了哪些工具、花多久、判斷來源」，不記問題內容。若這台伺服器設定由 AI 模型回答，問題（含防詐頁貼上的訊息）會送給該模型處理：Claude 模式送到 Anthropic, PBC（美國），依 Anthropic 的資料政策處理與保存；地端模型模式只送到本服務自架的模型。問阿幫頁底部會寫明目前由誰回答。</p>
        <p><b>位置（你允許時）：</b>用來當出發點、找附近的站與天氣。位置會送到阿幫伺服器，伺服器再拿去向資料來源（例如交通部 TDX、中央氣象署）查詢；Claude 模式下也會寫進給模型的提示。伺服器不把位置寫進紀錄；為了加快查詢，查詢結果會在記憶體中短暫快取後自動清除。不給定位也能用。</p>
        <p><b>IP 位址：</b>用來限制同一來源的請求次數（只存在伺服器記憶體、數分鐘到一天內清除），主機服務商的存取紀錄也可能記錄 IP〔待補：主機服務商與保存期間〕。</p>
        <p><b>裝置端 AI：</b>手機 App 可用手機內建的模型（Apple Intelligence、Gemini Nano）先判斷問題類型，只送出判斷結果（例如「行程、趕時間」）；今天判斷了幾次、上次花多久只記在手機上（只有數字，不上傳）；「阿幫的腦袋」頁的「現場試試看」只在手機上判斷，句子不送出；可在「設定與隱私」關閉。</p>
        <p><b>相機與照片（掃發票、讓阿幫看）：</b>拍的照片或選的截圖只在手機上讀出文字與條碼（手機內建的文字辨識），照片不上傳、不保存；讀出來的文字先給你看，你確認（可以改、可以遮住號碼）後才送出，送出的只有文字（例如拿去檢查詐騙、問公車），發票只送號碼與日期去對獎。選截圖用系統的相片選擇器，阿幫看不到你的整個相簿；相機權限在第一次拍照時才問。可在「設定與隱私」關閉。</p>
        <p><b>語音問阿幫（你按麥克風或長按「問阿幫」鍵時）：</b>語音只在手機上轉成文字（Android 的手機上語音辨識、iPhone 的語音辨識設定為只在手機上），不錄音、不上傳；轉好的文字跟打字的問題一樣送出。手機還沒有該語言的語音包時，第一次按麥克風會請手機系統下載（由 Google 或 Apple 提供的語音包，只下載、不送出你的聲音）。手機不支援在手機上辨識時不提供語音（麥克風反白），不改用網路上的語音辨識。網頁版只有瀏覽器能在本機辨識時才提供。第一次使用才會問麥克風權限；可在「設定與隱私」關閉。</p>
        <p><b>通知：</b>到站與出門提醒是手機上的本機通知，不經過推播伺服器。</p>
        <p><b>存在你手機上的資料：</b>收藏、我的發票（號碼與日期）、偏好、進行中的提醒、常用地點（家、公司、學校的座標）、離線時顯示的上次查詢結果（公車到站 10 分鐘內、路線與時刻表 24 小時內；不含座標，但看得出你查過哪些路線與站牌）只存在這支手機；常用地點只有在你提到（例如「回家」）時，那一個的座標與名稱才跟問題一起送出用來規劃；用「輸入地點」設定時，打的地名會送到阿幫伺服器查座標（不送你的位置）；問阿幫的對話文字（最近 10 則，不含卡片與座標，最後一次對話 12 小時後自動清掉）也存在這支手機；下次打開只顯示，按「接著上次問」才會跟下一個問題一起送出；從浮動阿幫點「在這頁可以問」的問題時，會一起送出你正在看的頁面（例如哪一條公車路線與上車站），自己打的問題不會帶；Claude 模式下，座標不給模型，但依座標查到的站名、路線、天氣等結果會給模型轉述。可在「設定與隱私」清除。</p>
        <h3>4. 利用期間、地區、對象、方式</h3>
        <p>期間：回答當下處理；記憶體快取與限流資料自動清除；不建立使用者檔案。地區：〔待補：伺服器所在地〕；Claude 模式另有美國。對象：營運單位、上述資料來源（只送查詢需要的座標或地名）、Claude 模式下的 Anthropic。方式：以電腦自動處理。</p>
        <h3>5. 你的權利</h3>
        <p>依個人資料保護法，你可以請求查詢、閱覽、複製、補充或更正、停止蒐集處理利用、刪除你的個人資料。阿幫不建立使用者檔案、不保存問題與位置，手機上的資料可自行清除；其他請求請洽下方聯絡方式。</p>
        <h3>6. 不提供的影響</h3>
        <p>不允許定位：要自己說從哪出發。不允許麥克風：用打字問阿幫。不允許通知：提醒只在 App 開著時顯示。不使用 Claude 模式的伺服器不會把問題送給 Anthropic。</p>
        <h3>7. 資料來源與外部連結</h3>
        <p>交通部 TDX、中央氣象署、環境部、健保署、地方政府、台灣中油、財政部、臺灣證券交易所、證券櫃檯買賣中心等開放資料；導航、叫車、訂票只開官方連結，付款在對方的 App 或網站完成，請另參考對方的隱私權政策。防詐檢查結果不代表一定安全，有疑問請撥 165。</p>
        <h3>8. 聯絡我們</h3>
        <p>〔待補：營運單位聯絡信箱與電話〕</p>
      </article>`;
  },
};
