// 常用地點（S1，2026-11-21）：家、公司、學校的座標只存在這支手機；問阿幫時只有提到的那個才一起送出（「回家」只送家）。
import { inTaiwan } from './agent/client.js';

const KEY = 'abang.places';
export const SAVED_KEYS = ['家', '公司', '學校'];
/** 與伺服器 core/agent/demo-intent.js SAVED_WORDS 相同（test/saved-places.test.js 比對）：提到才送 */
export const WORDS = { 家: /回家|到家|去家|家裡|我家|回去家|從家|家出發/, 公司: /公司|上班|下班/, 學校: /學校|上學|上課|放學/ };

export function loadPlaces() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    // 舊資料或被改過的資料：台灣範圍外的不用（伺服器會拒絕整個請求）
    return Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([k, p]) => SAVED_KEYS.includes(k) && inTaiwan(p)));
  } catch { return {}; }
}
export function savePlace(key, p) {
  if (!SAVED_KEYS.includes(key) || (p && !inTaiwan(p))) return false;
  const all = loadPlaces();
  if (p) all[key] = { name: String(p.name || key).slice(0, 40), lat: Number(p.lat.toFixed(5)), lon: Number(p.lon.toFixed(5)) };
  else delete all[key];
  try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; } // 無痕模式
}
/** 「重來」之後前面的對話不再沿用（與伺服器 demo-intent.js RESET 相同） */
const RESET = /^(?:重來|重新開始|從頭開始|從頭來|從頭|清除|清掉|算了)(?:吧|啦)?[。！!.]?$/;
/** 這幾句話（由舊到新）提到的常用地點（只送這些；「重來」之前的不算）；沒有回 undefined */
export function placesFor(texts) {
  const all = loadPlaces();
  const r = texts.findLastIndex((t) => RESET.test(String(t).trim()));
  const text = texts.slice(r + 1).join('\n');
  const out = Object.fromEntries(SAVED_KEYS.filter((k) => all[k] && WORDS[k].test(text)).map((k) => [k, all[k]]));
  return Object.keys(out).length ? out : undefined;
}
