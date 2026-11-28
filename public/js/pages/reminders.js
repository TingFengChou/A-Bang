// 提醒 #/reminders（2026-11-21 首頁重新設計）：進行中的到站提醒、下車提醒、出門提醒，一筆一筆取消。
// 資料都在這支手機：到站（ui/cards/host-web.js）、下車（alight.js）、出門（reminders.js）。整理成清單的純函式在 reminder-items.js。
// 沒有提醒時教怎麼設（公車頁、上車後、行程卡）。原本設定頁的出門提醒清單搬到這裡。
import { icons } from '../icons.js';
import { esc, chev } from '../ui.js';
import { reminderItems } from '../reminder-items.js';
import { listReminders, cancelReminder, notifyState } from '../reminders.js';
import { alightWatch, stopAlight } from '../alight.js';
import { createWebHost, currentArrivalWatch } from '../../ui/cards/host-web.js';
import { chatTurnFor } from '../agent/chat-links.js';

const KIND = { alight: ['bus', '#0f766e'], arrival: ['bus', '#1d4ed8'], leave: ['bell', '#b45309'] };
const EVENTS = ['abang:reminders', 'abang:alight-watch', 'abang:arrival-watch'];

export default {
  title: '提醒',
  shellTitle: 'title.reminders',
  root: true,
  render({ main, toast, onCleanup }) {
    main.innerHTML = `
      <section aria-labelledby="rem-h">
        <div class="rem-perm" id="rem-perm" role="status" hidden></div>
        <div class="section-title"><h2 id="rem-h" tabindex="-1">進行中的提醒</h2><span id="rem-count"></span></div>
        <div id="rem-list"></div>
      </section>
      <section aria-labelledby="how-h" class="rem-how">
        <div class="section-title"><h2 id="how-h">阿幫可以在這些時候叫您</h2></div>
        <div class="card list">
          <a href="#/bus"><span class="ab-token sm" style="--c:#1d4ed8" aria-hidden="true">${icons.bus}</span><div class="grow"><div class="title">公車快到站</div><div class="sub wrap">查公車、點您上車的站，按「到站前 3 分提醒我」</div></div>${chev}</a>
          <a href="#/bus"><span class="ab-token sm" style="--c:#0f766e" aria-hidden="true">${icons.bell}</span><div class="grow"><div class="title">快到站該下車</div><div class="sub wrap">上車後在公車頁選下車站，快到時提醒您</div></div>${chev}</a>
          <a href="#/agent?q=${encodeURIComponent('去台北 101')}"><span class="ab-token sm" style="--c:#b45309" aria-hidden="true">${icons.route}</span><div class="grow"><div class="title">該出門了</div><div class="sub wrap">問阿幫怎麼去，在行程卡按「提醒我出門」</div></div>${chev}</a>
        </div>
      </section>`;
    const box = main.querySelector('#rem-list');
    let lastSig = null;
    const paint = () => {
      const items = reminderItems({ arrival: currentArrivalWatch(), alight: alightWatch(), leave: listReminders() });
      // 到站、下車提醒每 20 秒查一次就送一次事件：內容沒變就不重畫（鍵盤與讀屏的焦點不會掉）
      const sig = JSON.stringify(items);
      if (sig === lastSig) return;
      lastSig = sig;
      main.querySelector('#rem-count').textContent = items.length ? `${items.length} 個` : '';
      box.replaceChildren();
      if (!items.length) {
        box.innerHTML = `<div class="card rem-empty"><img src="/brand/abang-default.svg" alt="" width="72" height="72"><div><b>目前沒有提醒</b><p>設了提醒，阿幫會在時間到的時候叫您；手機 App 關著也會響（網頁版要開著才會響）。下面教您怎麼設。</p></div></div>`;
        return;
      }
      const list = document.createElement('div');
      list.className = 'card list rem-list';
      list.setAttribute('role', 'list');
      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'rem-row';
        row.setAttribute('role', 'listitem');
        row.dataset.kind = it.kind;
        const [ic, c] = KIND[it.kind];
        const turn = chatTurnFor(it.ref); // 在問阿幫設的：回到那一輪（對話還在才有）
        row.innerHTML = `<span class="ab-token sm" style="--c:${c}" aria-hidden="true">${icons[ic]}</span><div class="grow"><div class="title">${esc(it.title)}</div><div class="sub wrap">${esc(it.sub)}</div>${it.href ? `<a class="rem-open" href="${esc(it.href)}">看公車 ›</a>` : ''}${turn ? `<a class="rem-open rem-chat" href="#/agent?turn=${turn}">看當時的對話 ›</a>` : ''}</div>`;
        const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small quiet', textContent: '取消' });
        del.setAttribute('aria-label', it.cancelLabel);
        del.addEventListener('click', () => {
          if (it.kind === 'alight') stopAlight();
          else if (it.kind === 'arrival') createWebHost().unwatchArrival();
          else cancelReminder(it.id);
          paint(); // 事件也會重畫；這裡先畫（同步，焦點才放得到標題）
          toast('已取消提醒');
          main.querySelector('#rem-h').focus(); // 被取消的那列不見了：焦點回到標題
        });
        row.append(del);
        list.append(row);
      }
      box.append(list);
    };
    paint();
    for (const ev of EVENTS) addEventListener(ev, paint);
    onCleanup(() => { for (const ev of EVENTS) removeEventListener(ev, paint); });
    // 通知被拒：提醒只會在畫面上說（照實寫）
    // 設計第二輪：提示移到列表上方、做成提示條；App 加「打開通知設定」（AbangSystem.openSettings，跟定位失敗同一個）
    notifyState().then((st) => {
      const p = main.querySelector('#rem-perm');
      if (!p || st !== 'denied') return;
      const c = globalThis.Capacitor;
      const app = c?.isNativePlatform?.() && typeof c.nativePromise === 'function';
      p.hidden = false;
      p.replaceChildren(Object.assign(document.createElement('p'), { textContent: app ? '通知關著，提醒只會在阿幫開著時跳出來。' : '通知關著，提醒只會在這一頁開著時跳出來。要改到瀏覽器的網站設定，把「通知」改成允許。' }));
      if (app) {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: '打開通知設定' });
        b.addEventListener('click', async () => { try { await c.nativePromise('AbangSystem', 'openSettings', { target: 'app' }); } catch { toast('打不開設定，請自己到手機的「設定 → Abang → 通知」開啟。'); } });
        p.append(b);
      }
    }).catch(() => {});
  },
};
