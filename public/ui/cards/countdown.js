// 卡片動態（M4-07）：到站倒數每秒在本地遞減（不額外呼叫 API），數字變化時輕微提示；
// prefers-reduced-motion 時只更新文字、不做動畫。資料仍以每 20～30 秒的刷新為準（ADR-0009：不造假）。
import { t } from './i18n/zh-TW.js';

export const SOON_SEC = 180;

/** 秒數 → 易讀文字（與伺服器 busStatusText 規則一致：< 60 進站中、< 180 即將進站、其餘 N 分） */
export function etaLabel(sec) {
  if (sec == null) return null;
  if (sec < 60) return t('eta.arriving');
  if (sec < SOON_SEC) return t('busRoute.coming');
  return t('common.minutes', { n: Math.floor(sec / 60) });
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 每秒更新 root 內所有 [data-eta-sec]（秒，相對於 root.dataset.drawnAt 的時間點）。
 * @returns {() => void} 停止
 */
export function startCountdown(root, now = () => Date.now()) {
  const tick = () => {
    const base = Number(root.dataset.drawnAt) || now();
    const elapsed = (now() - base) / 1000;
    for (const el of root.querySelectorAll('[data-eta-sec]')) {
      const left = Math.max(0, Number(el.dataset.etaSec) - elapsed);
      const text = etaLabel(left);
      if (text && el.textContent !== text) {
        el.textContent = text;
        el.classList.toggle('soon', left < SOON_SEC);
        if (!reducedMotion()) { const c = el.classList.contains?.('ab-focus-eta') ? 'ab-flip' : 'ab-tick'; el.classList.remove(c); void el.offsetWidth; el.classList.add(c); } // 上車站大字倒數翻牌
      }
    }
  };
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
