// 預設地區（T-HOMEAREA，2026-11-28 Claude 與 Antigravity 第八輪）：沒授權定位（或定位服務關著）的人，在首次引導或設定選一個「縣市＋區」，
// 問「怎麼去」「附近藥局」「天氣」時先用那一區查，並照實說「未取得目前位置，先依你設定的預設地區（大安區）查詢」。
// - 只存在這支手機（一個鍵）；不放進常用地點（跟家、公司分開，Antigravity 的提醒）
// - 區的代表點＝那一區的戶政事務所座標（/api/v1/areas，內政部開放資料）
// - 暫時抓不到定位（逾時、訊號差）不套用：照舊可以重試（只有沒權限、定位服務關著才用）
import { api } from './api.js';

export const HOME_AREA_KEY = 'abang.homeArea';

/** 存著的預設地區（壞掉或沒有回 null） */
export function homeArea() {
  try {
    const a = JSON.parse(localStorage.getItem(HOME_AREA_KEY) || 'null');
    return a && typeof a.county === 'string' && typeof a.town === 'string' && a.lat > 21 && a.lat < 27 && a.lon > 118 && a.lon < 123 ? a : null;
  } catch { return null; }
}
export function setHomeArea(a) {
  try { localStorage.setItem(HOME_AREA_KEY, JSON.stringify({ county: a.county, town: a.town, lat: a.lat, lon: a.lon })); } catch { /* 無痕模式 */ }
}
export function clearHomeArea() { try { localStorage.removeItem(HOME_AREA_KEY); } catch { /* 無痕模式 */ } }
/** 顯示用的名稱：「臺北市大安區」 */
export const areaLabel = (a) => (a ? `${a.county}${a.town}` : '');

/** 離某個位置最近的區（「用目前位置帶入」：只抓這一次，換成行政區；代表點是戶政事務所，所以是「大概在哪一區」） */
export function nearestArea(areas, pos) {
  let best = null;
  for (const c of areas || []) for (const t of c.towns || []) {
    const d = (t.lat - pos.lat) ** 2 + ((t.lon - pos.lon) * Math.cos((pos.lat * Math.PI) / 180)) ** 2;
    if (!best || d < best.d) best = { county: c.county, town: t.town, lat: t.lat, lon: t.lon, d };
  }
  return best && { county: best.county, town: best.town, lat: best.lat, lon: best.lon };
}

/**
 * 縣市＋區兩層選單（六都在最前面；長輩不用打字，也避開台／臺、同名區）。
 * @param {HTMLElement} box
 * @param {{ onChange?: (a: object|null) => void }} [o] 選好區時回傳 { county, town, lat, lon }
 * @returns {Promise<{ value: () => object|null, areas: () => Array }>}
 */
export async function areaPicker(box, { onChange } = {}) {
  const r = await api.areas().catch(() => null);
  const areas = r?.areas || [];
  const mk = (tag, props) => Object.assign(document.createElement(tag), props);
  const cSel = mk('select', { className: 'area-county' }), tSel = mk('select', { className: 'area-town', disabled: true });
  cSel.setAttribute('aria-label', '縣市');
  tSel.setAttribute('aria-label', '區');
  cSel.append(mk('option', { value: '', textContent: '選縣市' }), ...areas.map((c, i) => mk('option', { value: String(i), textContent: c.county })));
  const fillTowns = () => {
    const c = cSel.value === '' ? null : areas[Number(cSel.value)]; // Number('') 是 0：沒選不能當成選了第一個
    tSel.replaceChildren(mk('option', { value: '', textContent: c ? '選區' : '先選縣市' }), ...(c ? c.towns.map((t, i) => mk('option', { value: String(i), textContent: t.town })) : []));
    tSel.disabled = !c;
  };
  const value = () => {
    const c = cSel.value === '' ? null : areas[Number(cSel.value)], t = tSel.value === '' ? null : c?.towns[Number(tSel.value)];
    return c && t && tSel.value !== '' ? { county: c.county, town: t.town, lat: t.lat, lon: t.lon } : null;
  };
  cSel.addEventListener('change', () => { fillTowns(); onChange?.(null); });
  tSel.addEventListener('change', () => onChange?.(value()));
  fillTowns(); // 還沒選縣市：區的選單顯示「先選縣市」（首次使用巡檢：原本是空白的）
  const now = homeArea();
  if (now) { // 已經設過：預先選好
    const ci = areas.findIndex((c) => c.county === now.county);
    if (ci >= 0) { cSel.value = String(ci); fillTowns(); const ti = areas[ci].towns.findIndex((t) => t.town === now.town); if (ti >= 0) tSel.value = String(ti); }
  }
  const row = mk('div', { className: 'area-picker' });
  row.append(cSel, tSel);
  box.replaceChildren(areas.length ? row : mk('p', { className: 'note', textContent: '地區清單暫時載不到；之後可以在「設定與隱私」再選。' }));
  return { value, areas: () => areas };
}
