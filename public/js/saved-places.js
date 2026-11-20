// 常用地點（S1，2026-11-21）：家、公司、學校的座標只存在這支手機；問阿幫時只有提到的那個才一起送出（「回家」只送家）。
const KEY = 'abang.places';
export const SAVED_KEYS = ['家', '公司', '學校'];
const WORDS = { 家: /回家|到家|去家|家裡|我家/, 公司: /公司|上班/, 學校: /學校|上學|上課/ };

export function loadPlaces() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function savePlace(key, p) {
  if (!SAVED_KEYS.includes(key)) return;
  const all = loadPlaces();
  if (p) all[key] = { name: String(p.name || key).slice(0, 40), lat: Number(p.lat.toFixed(5)), lon: Number(p.lon.toFixed(5)) };
  else delete all[key];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* 無痕模式 */ }
}
/** 這幾句話提到的常用地點（只送這些）；沒有回 undefined */
export function placesFor(texts) {
  const all = loadPlaces();
  const text = texts.join('\n');
  const out = Object.fromEntries(SAVED_KEYS.filter((k) => all[k] && WORDS[k].test(text)).map((k) => [k, all[k]]));
  return Object.keys(out).length ? out : undefined;
}
