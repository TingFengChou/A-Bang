// 我的發票（本機）：發票號碼與消費日期只存在這支手機（localStorage），不上傳保存。
// 開獎後打開 App 時自動對獎（invoice_check_batch，對獎規則只在 core）；中獎時主動通知。
// 網頁沒有背景排程：App 沒打開時不會對獎，下次打開才對（不需推播伺服器、不保存使用者資料）。
import { storage, esc } from './ui.js';
import { confetti } from '../ui/cards/confetti.js';
import { scanSupported, openScanner } from './invoice-qr.js';

const KEY = 'invoices';
export const WALLET_MAX = 100;
const FINAL = new Set(['won', 'lost', 'unavailable']);

/** 台灣今天 YYYY-MM-DD */
export const todayTW = (now = Date.now()) => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);

export const wallet = {
  /** @returns {Array<{ id: string, number: string, date?: string, period?: string, status?: string, drawDate?: string, prize?: string|null, amount?: number, title?: string }>} */
  list: () => (Array.isArray(storage.get(KEY)) ? storage.get(KEY) : []),
  save: (list) => storage.set(KEY, list.slice(0, WALLET_MAX)),
  /** 新增一張；號碼 8 碼、日期不能是未來；同號碼同期不重複 */
  add({ number, date, period }) {
    const n = String(number || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(n)) throw new Error('發票號碼請輸入 8 位數字');
    if (!period && !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('請選消費日期');
    if (date && date > todayTW()) throw new Error('消費日期還沒到');
    const list = wallet.list();
    if (list.some((x) => x.number === n && (x.date === date || (period && x.period === period)))) throw new Error('這張已經存過了');
    if (list.length >= WALLET_MAX) throw new Error(`最多存 ${WALLET_MAX} 張，請先刪掉已對過的`);
    const item = { id: `${n}-${date || period}`, number: n, ...(date && { date }), ...(period && { period }) };
    wallet.save([item, ...list]);
    return item;
  },
  remove: (id) => wallet.save(wallet.list().filter((x) => x.id !== id)),
};

/** 要對獎的：還沒對過、或待開獎且開獎日已到 */
export const needsCheck = (x, today = todayTW()) => !FINAL.has(x.status) && (x.status !== 'pending' || !x.drawDate || x.drawDate <= today);

/**
 * 對獎（只送需要的發票）。回傳這次「新中獎」與摘要；沒有要對的回 null。
 * @param {(name: string, args: object) => Promise<{ data: any }>} callTool
 * @param {{ all?: boolean }} [opts] all：新增後立刻對（包含還沒到開獎日的，用來取得期別與開獎日）
 */
export async function checkWallet(callTool, { all = false } = {}) {
  const today = todayTW();
  const due = wallet.list().filter((x) => (all ? !FINAL.has(x.status) : needsCheck(x, today)));
  if (!due.length) return null;
  const r = await callTool('invoice_check_batch', { items: due.map((x) => ({ number: x.number, ...(x.date ? { date: x.date } : { period: x.period }) })) });
  const byId = new Map(due.map((x, i) => [x.id, r.data.results[i]]));
  const won = [];
  const list = wallet.list().map((x) => {
    const res = byId.get(x.id);
    if (!res) return x;
    if (res.status === 'won' && x.status !== 'won') won.push({ ...x, ...res });
    return { ...x, status: res.status, period: res.period, drawDate: res.drawDate, prize: res.prize ?? null, amount: res.amount ?? 0, ...(res.title && { title: res.title }) };
  });
  wallet.save(list);
  return { won, summary: r.data.summary, decided: due.filter((x) => FINAL.has(byId.get(x.id)?.status)).length };
}

const money = (n) => Number(n).toLocaleString('zh-TW');
const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
function statusHtml(x) {
  if (x.status === 'won') return `<span class="inv-st won">${esc(x.prize)}・${money(x.amount)} 元</span>`;
  if (x.status === 'lost') return '<span class="inv-st">沒中</span>';
  if (x.status === 'unavailable') return '<span class="inv-st">超過查詢範圍</span>';
  if (x.status === 'pending') return `<span class="inv-st wait">${md(x.drawDate)} 開獎</span>`;
  return '<span class="inv-st wait">待對獎</span>';
}

/**
 * 服務頁「我的發票」區塊：新增、清單、刪除；進頁時自動對獎。
 * @param {HTMLElement} el
 * @param {{ callTool: Function, toast?: (m: string) => void }} opts
 */
export function renderWallet(el, { callTool, toast = () => {} }) {
  el.innerHTML = `
    <div class="section-title"><h2>我的發票</h2><span>存在這支手機</span></div>
    ${scanSupported()
    ? '<button class="btn inv-scan" id="inv-scan" type="button">掃發票 QR code</button>'
    : '<p class="updated inv-noscan">這個瀏覽器不支援掃描（例如 iPhone Safari），請手動輸入號碼和日期。</p>'}
    <form class="form inv-add" id="inv-add">
      <div class="row"><input class="field" name="number" inputmode="numeric" maxlength="10" placeholder="發票號碼 8 碼" aria-label="發票號碼 8 碼" autocomplete="off">
      <input class="field" name="date" type="date" aria-label="消費日期" value="${todayTW()}" max="${todayTW()}"></div>
      <button class="btn">存起來，開獎自動對</button>
    </form>
    <div class="card list" id="inv-list"></div>
    <p class="updated">號碼只存在這支手機的瀏覽器；對獎時把號碼和日期送到阿幫伺服器比對，不會保存。打開 App 時，開獎後的發票會自動對獎。領獎方式與期限以財政部公告為準。</p>`;
  const listEl = el.querySelector('#inv-list');
  const draw = () => {
    const list = wallet.list();
    listEl.innerHTML = list.length
      ? list.map((x) => `<div data-id="${esc(x.id)}"><div class="grow"><div class="title">${esc(x.number)}</div><div class="sub">${esc(x.date ? `消費 ${x.date}` : `${x.period} 期`)}</div></div>${statusHtml(x)}<button class="btn ghost inv-del" type="button" aria-label="刪除 ${esc(x.number)}">刪除</button></div>`).join('')
      : '<div class="sub wrap">還沒有存發票。輸入號碼和消費日期，開獎後打開阿幫就會自動幫你對獎。</div>';
  };
  const run = async (opts) => {
    try {
      const r = await checkWallet(callTool, opts);
      draw();
      if (r?.won.length) { toast(`🎉 中獎了！${r.won.map((w) => `${w.number} ${w.prize}`).join('、')}`); confetti(listEl); }
    } catch (e) { toast(`對獎失敗：${e.message}`); }
  };
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('.inv-del');
    if (!b) return;
    wallet.remove(b.closest('[data-id]').dataset.id);
    draw();
  });
  // 掃描：一張接一張存，關閉後一次對獎
  el.querySelector('#inv-scan')?.addEventListener('click', () => openScanner({
    onCode(code) {
      try {
        wallet.add(code);
        draw();
        return `已存 ${code.track}-${code.number}`;
      } catch (err) { return `${code.track}-${code.number}：${err.message}`; }
    },
    onClose(count) { if (count) { toast(`已存 ${count} 張發票`); run({ all: true }); } },
  }));
  el.querySelector('#inv-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      wallet.add({ number: f.number.value, date: f.date.value });
      f.number.value = '';
      draw();
      await run({ all: true }); // 立刻對：已開獎的直接出結果，沒開獎的顯示開獎日
    } catch (err) { f.number.setCustomValidity(err.message); f.number.reportValidity(); f.number.setCustomValidity(''); }
  });
  draw();
  run();
}

/**
 * 打開 App 時：有開獎日已到的發票就自動對獎，中獎主動通知（toast；已允許通知時另發系統通知）。
 * @returns {Promise<{ won: any[], decided: number } | null>}
 */
export async function autoCheckOnOpen(callTool, { toast = () => {} } = {}) {
  if (!wallet.list().some((x) => needsCheck(x))) return null;
  const r = await checkWallet(callTool);
  if (!r) return null;
  if (r.won.length) {
    const msg = `🎉 你存的發票中獎了：${r.won.map((w) => `${w.number} ${w.prize}`).join('、')}`;
    toast(msg);
    if (typeof document !== 'undefined') confetti(document.body);
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('阿幫：發票中獎', { body: msg, icon: '/icons/icon.svg' }); } catch { /* 部分瀏覽器只允許 SW 通知 */ }
  } else if (r.decided) toast(`你存的 ${r.decided} 張發票已對獎，這期沒中`);
  return r;
}
