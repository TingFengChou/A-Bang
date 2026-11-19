// 掃發票：電子發票證明聯的左邊 QR code（或中間一維條碼）→ 號碼＋消費日期（或期別），存進「我的發票」。
// 用瀏覽器內建 BarcodeDetector 與相機，影像只在手機上辨識、不上傳；只取號碼與日期，不保存統編、金額與品項。
// 不支援 BarcodeDetector 的瀏覽器（iPhone Safari、桌面 Firefox 等）改手動輸入（不加第三方掃碼套件）。

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 解析發票條碼文字（財政部「電子發票證明聯一維及二維條碼規格」）。
 * - 左邊 QR：字軌 2 碼＋號碼 8 碼＋民國開立日期 7 碼（yyyMMdd）＋隨機碼 4 碼＋…（前 77 碼固定）
 * - 右邊 QR：以「**」開頭（品項明細），沒有號碼 → { side: 'right' }
 * - 一維條碼（Code 39）：期別 5 碼（民國年＋雙數月）＋字軌號碼 10 碼＋隨機碼 4 碼 → 只有期別
 * @param {string} text
 * @returns {{ track: string, number: string, date?: string, period?: string } | { side: 'right' } | null}
 */
export function parseInvoiceCode(text) {
  const s = String(text ?? '').trim();
  if (s.startsWith('**')) return { side: 'right' };
  let m = /^([A-Z]{2})(\d{8})(\d{3})(\d{2})(\d{2})\d{4}/.exec(s);
  if (m) {
    const [, track, number, y, mm, dd] = m;
    const month = Number(mm), day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { track, number, date: `${Number(y) + 1911}-${mm}-${dd}` };
  }
  m = /^(\d{3})(\d{2})([A-Z]{2})(\d{8})\d{4}$/.exec(s);
  if (m) {
    const [, y, mm, track, number] = m;
    const end = Number(mm);
    if (end < 2 || end > 12 || end % 2) return null;
    return { track, number, period: `${y}${pad2(end - 1)}` }; // 期別以單數起始月表示（11509＝9–10 月）
  }
  return null;
}

/** 這個瀏覽器能不能掃 */
export const scanSupported = () => typeof globalThis.BarcodeDetector === 'function' && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);

/**
 * 開啟掃描視窗：連續掃描，每辨識到一張新的發票就呼叫 onCode；按「完成」或 Esc 關閉並停止相機。
 * @param {{ onCode: (code: { track: string, number: string, date?: string, period?: string }) => string, onClose?: (count: number) => void }} opts
 *   onCode 回傳要顯示的一句話（例如「已存 AB-12345678」或錯誤原因）
 */
export async function openScanner({ onCode, onClose = () => {} }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'scan-dialog';
  dlg.setAttribute('aria-label', '掃描發票 QR code');
  dlg.innerHTML = `
    <div class="scan-view"><video playsinline muted aria-hidden="true"></video><div class="scan-frame" aria-hidden="true"></div></div>
    <p class="scan-tip">對準發票<b>左邊</b>的 QR code，可以一張接一張掃。</p>
    <p class="scan-status" role="status" aria-live="polite">開啟相機中…</p>
    <button class="btn scan-done" type="button">完成</button>`;
  document.body.append(dlg);
  const video = dlg.querySelector('video');
  const status = dlg.querySelector('.scan-status');
  let stream = null, timer = null, closed = false, count = 0;
  const seen = new Set();

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    if (dlg.open) dlg.close();
    dlg.remove();
    onClose(count);
  };
  dlg.querySelector('.scan-done').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Esc
  dlg.showModal();

  try {
    const formats = await globalThis.BarcodeDetector.getSupportedFormats?.() ?? ['qr_code'];
    const detector = new globalThis.BarcodeDetector({ formats: ['qr_code', 'code_39'].filter((f) => formats.includes(f)) });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    await video.play();
    status.textContent = '對準 QR code…';
    const tick = async () => {
      if (closed) return;
      try {
        for (const { rawValue } of await detector.detect(video)) {
          if (seen.has(rawValue)) continue;
          seen.add(rawValue);
          const code = parseInvoiceCode(rawValue);
          if (!code) { status.textContent = '這不是發票的條碼'; continue; }
          if (code.side === 'right') { status.textContent = '這是右邊的明細 QR code，請掃左邊那個'; continue; }
          const msg = onCode(code);
          if (/^已存/.test(msg)) { count++; globalThis.navigator?.vibrate?.(60); }
          status.textContent = count ? `${msg}（這次已存 ${count} 張）` : msg;
        }
      } catch { /* 單張畫面辨識失敗就看下一張 */ }
      timer = setTimeout(tick, 250);
    };
    tick();
  } catch (e) {
    status.textContent = e?.name === 'NotAllowedError' ? '沒有相機權限：請在瀏覽器設定允許相機，或改用手動輸入。' : '無法開啟相機，請改用手動輸入。';
  }
  return { close };
}
