// 手機鍵盤偵測：可見區域（visualViewport）比完整高度矮很多、且焦點在輸入框 → <html class="kb-open">。
// iOS WKWebView 鍵盤只縮 visualViewport；Android（adjustResize）連 innerHeight 也縮，所以跟「看過的最大高度」比。
// 轉向時重設最大高度。沒有 visualViewport（舊瀏覽器）就不做事。
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|color|file)$/.test(a.type))); };

/** 鍵盤是否打開（可見高度 < 完整高度的 75% 且在打字） */
export const keyboardOpen = (visible, full, isTyping) => isTyping && full > 0 && visible < full * 0.75;

export function watchKeyboard(win = globalThis.window) {
  const vv = win?.visualViewport;
  if (!vv) return () => {};
  let full = win.innerHeight;
  const update = () => {
    full = Math.max(full, win.innerHeight);
    win.document.documentElement.classList.toggle('kb-open', keyboardOpen(vv.height, full, typing()));
  };
  const reset = () => { full = win.innerHeight; update(); };
  vv.addEventListener('resize', update);
  win.addEventListener('orientationchange', reset);
  win.document.addEventListener('focusin', update);
  win.document.addEventListener('focusout', () => setTimeout(update, 0));
  return () => { vv.removeEventListener('resize', update); win.removeEventListener('orientationchange', reset); };
}
