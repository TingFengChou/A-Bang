// 「阿幫記得你」（2026-11-28 Claude 與 Antigravity 第十三輪）：首頁「今天」卡最下面的「依據」點開的抽屜。
// 一眼看到阿幫記得什麼、一鍵忘掉（透明＋一鍵刪除是主動助手的底線）。全部只在這支手機；不上傳。
// 內容：常用地點、固定通勤方式、預設地區、交通習慣（同意優先的方式、說過的狀況、記了幾次）、上次的對話、提醒。
// 刪除只動那一項；改完送 abang:memory 事件，首頁的今天卡重算。
import { esc } from './ui.js';
import { loadPlaces, savePlace, SAVED_KEYS } from './saved-places.js';
import { homeArea, clearHomeArea, areaLabel } from './home-area.js';
import { habitSummary, habitName, USUAL_LABEL, revokeHabit, revokeUsual, clearHabits } from './habits.js';
import { loadChat, clearChat } from './chat-store.js';
import { listReminders } from './reminders.js';
import { loadCommute, clearCommute } from './home-data.js';

/**
 * 抽屜要列的項目（純函式：給 node:test 測）。
 * @returns {Array<{ id: string, group: string, title: string, sub: string, forget?: string }>}  forget：按鈕上的字（沒有就不能從這裡刪）
 */
export function memoryRows({ places = {}, area = null, habits = null, chat = null, reminders = 0, commute = null } = {}) {
  const rows = [];
  for (const k of SAVED_KEYS) if (places[k]) rows.push({ id: `place:${k}`, group: '常用地點', title: k, sub: places[k].name && places[k].name !== k ? places[k].name : '座標只在這支手機', forget: '忘掉' });
  if (commute) { // 固定通勤方式（首頁改版 H4，ADR-0023）：上班日早上「今日通勤」、傍晚「今日返家」用它
    const label = (l) => (l.mode === 'bus' ? l.route : l.name || l.line);
    rows.push({ id: 'commute', group: '固定通勤方式', title: `${commute.from === '家' ? '住家' : commute.from} → ${commute.legs.map(label).join(' → ')} → ${commute.to === '家' ? '住家' : commute.to}`, sub: '上班日早上與傍晚，首頁顯示這條路今天的狀況', forget: '忘掉' });
  }
  if (area) rows.push({ id: 'area', group: '預設地區', title: areaLabel(area), sub: '沒開定位時先用這一區查', forget: '忘掉' });
  if (habits) {
    for (const m of habits.confirmed || []) rows.push({ id: `habit:${m}`, group: '交通習慣', title: `優先推${habitName(m)}`, sub: '你說過「好」', forget: '不用了' });
    for (const k of habits.usual || []) rows.push({ id: `usual:${k}`, group: '交通習慣', title: USUAL_LABEL[k] || k, sub: '你說過的狀況（每次會再問）', forget: '忘掉' });
    if (habits.total) rows.push({ id: 'picks', group: '交通習慣', title: `記了 ${habits.total} 次選擇`, sub: '只有交通方式和時間，沒有地點', forget: '全部清掉' });
  }
  if (chat?.length) rows.push({ id: 'chat', group: '對話', title: `上次的對話（${chat.length} 則）`, sub: '只有文字，12 小時後自動清掉', forget: '清掉' });
  if (reminders) rows.push({ id: 'reminders', group: '提醒', title: `${reminders} 個出門提醒`, sub: '在「提醒」頁管理' });
  return rows;
}

const read = () => ({ places: loadPlaces(), area: homeArea(), habits: habitSummary(), chat: loadChat()?.messages || null, reminders: listReminders().length, commute: loadCommute() });

/** 忘掉一項 */
function forget(id) {
  if (id.startsWith('place:')) savePlace(id.slice(6), null);
  else if (id === 'area') clearHomeArea();
  else if (id.startsWith('habit:')) revokeHabit(id.slice(6));
  else if (id.startsWith('usual:')) revokeUsual(id.slice(6));
  else if (id === 'picks') clearHabits();
  else if (id === 'chat') clearChat();
  else if (id === 'commute') { clearCommute(); return; } // clearCommute 自己送 abang:memory
  dispatchEvent(new CustomEvent('abang:memory', { detail: { id } }));
}

/** 打開抽屜（同一時間只有一個） */
export function openMemorySheet({ toast } = {}) {
  document.querySelector('dialog.memory-sheet')?.remove();
  const dlg = document.createElement('dialog');
  dlg.className = 'memory-sheet';
  dlg.setAttribute('aria-labelledby', 'mem-title');
  const paint = () => {
    const rows = memoryRows(read());
    const groups = [...new Set(rows.map((r) => r.group))];
    dlg.innerHTML = `
      <div class="sheet-head"><span class="sheet-grip" aria-hidden="true"></span>
        <img src="/brand/abang-happy.svg" alt="" width="40" height="40">
        <h2 id="mem-title" tabindex="-1">阿幫記得你</h2>
        <button type="button" class="btn small quiet mem-close">完成</button></div>
      <div class="sheet-body">
        <p class="mem-lead">這些都只存在這支手機，不會上傳。問阿幫時，只送那一題用得到的地點。</p>
        ${rows.length ? groups.map((g) => `<section class="mem-group" aria-label="${esc(g)}"><h3>${esc(g)}</h3><div class="card list">${rows.filter((r) => r.group === g).map((r) => `
          <div class="mem-row" data-id="${esc(r.id)}"><div class="grow"><div class="title">${esc(r.title)}</div><div class="sub">${esc(r.sub)}</div></div>
          ${r.forget ? `<button type="button" class="btn small quiet mem-forget" data-id="${esc(r.id)}" aria-label="${esc(`${r.forget}：${r.title}`)}">${esc(r.forget)}</button>` : '<a class="btn small quiet" href="#/reminders">看提醒</a>'}</div>`).join('')}</div></section>`).join('')
    : '<p class="mem-empty">阿幫現在什麼都沒記。設定家和公司後，每天早上會幫你看怎麼去。</p>'}
        <p class="mem-more"><a class="btn small" href="#/settings">設定常用地點與預設地區 ›</a></p>
      </div>`;
    dlg.querySelector('.mem-close').addEventListener('click', () => dlg.close());
    dlg.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => dlg.close()));
    dlg.querySelectorAll('.mem-forget').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '確定？'; b.classList.add('danger'); return; } // 按兩下才刪：不會誤觸
      const title = b.closest('.mem-row')?.querySelector('.title')?.textContent || '';
      forget(b.dataset.id);
      toast?.(`已忘掉「${title}」`);
      paint();
      dlg.querySelector('#mem-title')?.focus();
    }));
  };
  paint();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 點背景關
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('#mem-title')?.focus();
  return dlg;
}
