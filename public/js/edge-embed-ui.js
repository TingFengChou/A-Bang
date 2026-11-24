// 設定頁「手機上的小模型」（E3）：下載、進度、刪除。只在手機 App 顯示（網頁版不下載 160 MB 的模型）。
import { embedState, onEmbedChange, downloadEmbed, deleteEmbed, embedWanted } from './edge-embed.js';

/** 下載大小的概數（實際以伺服器回報為準，下載時進度條照實算） */
export const EMBED_APPROX_MB = 160;

/**
 * 狀態 → 畫面上的字與按鈕（純函式，test/edge-embed.test.js）。
 * @param {ReturnType<typeof embedState>} st
 * @returns {{ text: string, button: string|null, action: 'download'|'delete'|null, busy: boolean, pct: number|null }}
 */
export function embedRowView(st) {
  const pct = st.progress?.total ? Math.min(100, Math.floor((st.progress.loaded / st.progress.total) * 100)) : null;
  if (!st.supported) return { text: '這支手機跑不動（需要 iOS 16.4 以上，或較新的 Android）', button: null, action: null, busy: false, pct: null };
  switch (st.state) {
    case 'downloading': return { text: pct == null ? '下載中…' : `下載中 ${pct}%（請不要關掉 App）`, button: '下載中…', action: null, busy: true, pct };
    case 'loading': return { text: '從手機上載入中…', button: '刪除', action: 'delete', busy: true, pct: null };
    case 'ready': return { text: '已下載，可以使用：手機內建的 AI 不能用時由它判斷', button: '刪除', action: 'delete', busy: false, pct: null };
    case 'evicted': return { text: '手機清掉了下載的檔案，要用請重新下載', button: '重新下載', action: 'download', busy: false, pct: null };
    case 'missing': return { text: '這台伺服器沒有提供小模型，之後再試', button: '再試一次', action: 'download', busy: false, pct: null };
    case 'error': return { text: st.wanted ? '載入失敗，可以刪除後重新下載' : '下載失敗，請再試一次', button: st.wanted ? '刪除' : '再試一次', action: st.wanted ? 'delete' : 'download', busy: false, pct: null };
    default: return st.wanted
      ? { text: '已下載（問阿幫時才載入）', button: '刪除', action: 'delete', busy: false, pct: null }
      : { text: `沒有下載（約 ${EMBED_APPROX_MB} MB，建議連 Wi-Fi）`, button: '下載', action: 'download', busy: false, pct: null };
  }
}

/**
 * 在設定頁的裝置端 AI 區塊放一列。
 * @param {HTMLElement} box 容器（裡面要有 #embed-status、#embed-btn、#embed-progress）
 * @param {{ toast?: (s: string) => void, onCleanup?: (fn: Function) => void }} [o]
 */
export function mountEmbedRow(box, { toast = () => {}, onCleanup } = {}) {
  const status = box.querySelector('#embed-status');
  const btn = box.querySelector('#embed-btn');
  const bar = box.querySelector('#embed-progress');
  let action = null;
  const paint = () => {
    const v = embedRowView(embedState());
    status.textContent = v.text;
    action = v.action;
    btn.hidden = !v.button;
    btn.textContent = v.button || '';
    btn.disabled = v.busy && v.action !== 'delete';
    btn.classList.toggle('quiet', v.action === 'delete'); // 刪除用次要樣式（不是主要動作）
    bar.hidden = v.pct == null;
    if (v.pct != null) { bar.value = v.pct; bar.setAttribute('aria-valuetext', `${v.pct}%`); }
  };
  const off = onEmbedChange(paint);
  onCleanup?.(off);
  btn.addEventListener('click', async () => {
    if (action === 'download') {
      const ok = await downloadEmbed();
      toast(ok ? '小模型下載好了，手機內建的 AI 不能用時由它判斷' : embedState().state === 'missing' ? '這台伺服器沒有提供小模型' : '下載沒有完成，請再試一次');
    } else if (action === 'delete') {
      if (!globalThis.confirm?.(`要刪除手機上的小模型嗎？之後要用得再下載一次（約 ${EMBED_APPROX_MB} MB）。`)) return;
      await deleteEmbed();
      toast('已刪除手機上的小模型');
    }
  });
  paint();
  return { paint, wanted: embedWanted };
}
