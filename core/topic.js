// 範圍外的問題「聽懂了什麼」（2026-11-23 產品負責人：範圍內的照意圖採用，範圍外的至少了解意圖）。
// 判斷層（手機上的 Apple Intelligence／Gemini Nano、伺服器模型）用幾個字寫出使用者想做的事（topic，例「訂餐廳」「寫信給老闆」），
// 意圖是 unknown（阿幫沒有這項服務）時才採用。純函式：手機（public/js/edge-judge.js 經 /core/）與伺服器共用同一套檢查。

/** 主題最長幾個字（太長就不是短語，多半是模型把原句抄回來） */
export const TOPIC_MAX = 12;

/**
 * 整理模型寫的主題；不像短語或可能帶個資（網址、電話、email、長串數字）就回 null。
 * @param {unknown} s
 * @returns {string|null}
 */
export function cleanTopic(s) {
  if (typeof s !== 'string') return null;
  if (/https?:|www\.|\.(?:com|tw|net|org|io)\b|@|\d{4,}/i.test(s)) return null; // 網址、email、電話、帳號：不帶（整理標點之前先看，「a.com」才擋得到）
  const t = s.replace(/[「」『』"'“”‘’。．.！!？?，,、：:；;（）()[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || [...t].length > TOPIC_MAX || [...t].length < 2) return null;
  if (/^(?:unknown|none|null|其他|無|沒有|不知道|不確定)$/i.test(t)) return null; // 模型沒寫出東西
  return t;
}
