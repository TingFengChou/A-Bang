// 阿幫問你（ADR-0016）：共用的問句＋選項按鈕區塊。問阿幫頁、底部對話面板（同一個頁面元件）都用這個。
// 事件格式見 core/agent/ask.js；按鈕的效果由呼叫端（onAnswer）決定：state 即時重算、reply 送出一句、store 存手機、dismiss 不做事。
// 可及性：role=group＋aria-labelledby（讀屏念問句）、問句 aria-live、原生按鈕可用鍵盤；不搶焦點（不打斷），答完焦點留在區塊的結果句。
// 語音或打字的人：下一句就是答案（matchAnswer）；對不上就當略過，照常送出。

const YES = /^(好|好啊|好的|要|是|是的|對|對啊|嗯|可以|ok|okay|yes|yeah|yep|sure)$/i;
const NO = /^(不|不用|不要|不必|沒|沒有|不是|no|nope|no thanks)$/i;

/**
 * 使用者用打的（或說的）回答：下一句就是答案——但寧可略過，也不能把新問題當成答案（尤其是會存進手機的偏好）。
 * 1. 全字等於某個選項（去掉句尾標點）→ 那個選項
 * 2. 整句就是 YES／NO 說法（好、好啊、是、對、要、不用、不要、沒有、yes、no…）且只有兩個選項 → 第一／第二個
 * 3. 「包含」比對只用在：不是 store 類（存偏好只接受 1、2）、沒有問號、而且選項 ≥ 3 字或這句只比選項多 2 字以內（「我不趕」→ 不趕）
 * 其他都回 null＝略過，這句照常送出（帶 pendingAsk）。「好像要下雨，明天天氣如何」「不用轉乘的路線」「趕快帶我去台北車站」都不算答案。
 * @param {{ options: Array<{ label: string, kind?: string }> }} ask
 * @param {string} text
 */
export function matchAnswer(ask, text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t || !ask?.options?.length || t.length > 20) return null;
  const bare = t.replace(/[!！。.～~，,、]+$/u, '');
  const low = bare.toLowerCase();
  const exact = ask.options.find((o) => o.label.toLowerCase() === low);
  if (exact) return exact;
  if (ask.options.length === 2 && YES.test(bare)) return ask.options[0];
  if (ask.options.length === 2 && NO.test(bare)) return ask.options[1];
  if (/[?？嗎呢]/.test(t)) return null; // 看起來是在問問題
  const hit = [...ask.options].filter((o) => o.kind !== 'store').sort((a, b) => b.label.length - a.label.length)
    .find((o) => (o.label.length >= 3 || bare.length <= o.label.length + 2) && low.includes(o.label.toLowerCase()));
  return hit || null;
}

let seq = 0;
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {{ id: string, question: string, options: Array<{ label: string, value: string, kind: string, guess?: boolean }>, why?: string }} ask
 * @param {{ lang?: 'en'|null, onAnswer: (o: object) => (string|void|Promise<string|void>) }} opts onAnswer 回傳一句結果（顯示在區塊裡）
 * @returns {{ el: HTMLElement, ask: object, answer: (o: object) => Promise<void>, skip: () => void, open: () => boolean }}
 */
export function mountAsk(ask, { lang = null, onAnswer }) {
  const en = lang === 'en';
  const qid = `ask-q-${++seq}`;
  const box = el('section', 'ask');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-labelledby', qid);
  box.dataset.about = ask.about || '';
  const head = el('p', 'ask-head', en ? 'Abang asks' : '阿幫問你');
  const q = el('p', 'ask-q', ask.question);
  q.id = qid;
  q.setAttribute('aria-live', 'polite');
  if (en) q.lang = 'en';
  const row = el('div', 'ask-opts');
  let done = false;
  const ctl = {
    el: box, ask,
    open: () => !done,
    async answer(o) {
      if (done) return;
      done = true;
      let said;
      try { said = await onAnswer(o); } catch {
        done = false; // 沒做成：按鈕恢復，可以再按一次
        let err = box.querySelector('.ask-err');
        if (!err) { err = el('p', 'ask-err', en ? "That didn't work. Please try again." : '沒做成，請再試一次。'); err.setAttribute('role', 'alert'); box.append(err); }
        return;
      }
      box.querySelector('.ask-err')?.remove();
      row.remove(); why?.remove();
      box.classList.add('answered');
      const r = el('p', 'ask-done', said || (en ? `Got it: ${o.label}` : `好的：${o.label}`));
      r.tabIndex = -1;
      r.setAttribute('role', 'status');
      box.append(r);
      if (box.contains(document.activeElement) || document.activeElement === document.body) r.focus({ preventScroll: true }); // 按了按鈕：焦點留在結果句（按鈕已拿掉）
    },
    skip() { if (done) return; done = true; box.classList.add('skipped'); row.remove(); why?.remove(); box.hidden = true; },
  };
  for (const o of ask.options) {
    const b = el('button', `ask-opt${o.guess ? ' guess' : ''}`, o.label);
    b.type = 'button';
    b.dataset.kind = o.kind;
    if (o.guess) { const g = el('small', 'ask-guess', en ? 'my guess' : '猜的'); b.append(' ', g); b.setAttribute('aria-label', `${o.label}（${en ? 'my guess' : '阿幫猜的'}）`); }
    b.onclick = () => ctl.answer(o);
    row.append(b);
  }
  const skipBtn = el('button', 'ask-skip', en ? 'Skip' : '略過');
  skipBtn.type = 'button';
  skipBtn.onclick = () => ctl.skip();
  row.append(skipBtn);
  const why = ask.why ? el('p', 'ask-why', ask.why) : null;
  box.append(head, q, row, ...(why ? [why] : []));
  return ctl;
}
