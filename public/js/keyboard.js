// 手機鍵盤偵測：可見區域（visualViewport）比完整高度矮很多、且焦點在輸入框 → <html class="kb-open">。
// iOS WKWebView 鍵盤只縮 visualViewport；Android（adjustResize）連 innerHeight 也縮，所以跟「沒在打字時的高度」比。
// 視窗大小改變（轉向、分割畫面、摺疊機）且沒在打字時，重新記完整高度。沒有 visualViewport（舊瀏覽器）就不做事。
const typing = (doc) => { const a = doc.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|color|file)$/.test(a.type))); };

/** 鍵盤是否打開（可見高度 < 完整高度的 75% 且在打字） */
export const keyboardOpen = (visible, full, isTyping) => isTyping && full > 0 && visible < full * 0.75;

/** @returns {() => void} 停止偵測（移除所有 listener） */
export function watchKeyboard(win = globalThis.window) {
  const vv = win?.visualViewport;
  if (!vv) return () => {};
  const doc = win.document;
  let full = win.innerHeight;
  let later = 0;
  const update = () => {
    const t = typing(doc);
    if (!t) full = win.innerHeight; // 沒在打字：這就是完整高度（轉向、分割畫面後也對）
    else full = Math.max(full, win.innerHeight);
    const open = keyboardOpen(vv.height, full, t);
    doc.documentElement.classList.toggle('kb-open', open);
    // 底部對話面板（<dialog>）跟著可見區域：iOS 版面高度不變，鍵盤蓋住的部分要讓出來
    const st = doc.documentElement.style;
    if (!st) return; // 測試用的假文件
    if (open) { st.setProperty('--vvh', `${Math.round(vv.height)}px`); st.setProperty('--kb', `${Math.max(0, Math.round(win.innerHeight - vv.height - (vv.offsetTop || 0)))}px`); }
    else { st.removeProperty('--vvh'); st.removeProperty('--kb'); }
  };
  // 焦點移到按鈕（點「送出」、建議問題）時晚一點再判斷：鍵盤收起前分頁列不跑回來，點擊不會落空
  const onFocusOut = () => { clearTimeout(later); later = setTimeout(update, 300); };
  vv.addEventListener('resize', update);
  win.addEventListener('resize', update);
  doc.addEventListener('focusin', update);
  doc.addEventListener('focusout', onFocusOut);
  return () => {
    clearTimeout(later);
    vv.removeEventListener('resize', update);
    win.removeEventListener('resize', update);
    doc.removeEventListener('focusin', update);
    doc.removeEventListener('focusout', onFocusOut);
  };
}
