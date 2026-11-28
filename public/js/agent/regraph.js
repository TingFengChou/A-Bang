// 決策圖在手機上重算後（點了「帶行李」、答了「趕時間嗎」、點掉偏好），同一輪的行程卡與總結跟著換（設計第三輪 #1）：
// 原本圖改推叫車，行程卡還標「建議 捷運」、總結還寫「選捷運」，長輩不知道該聽哪個。純函式，測試用。

/**
 * 行程卡的資料換成重算後的排序；沒有改（狀態切回原樣）就還原伺服器的結果。
 * @param {object} data plan_trip 的資料（伺服器原本那一份）
 * @param {{ changed: boolean, best: string|null, ranked: object[], excluded: object[], reason: string, states: Array<{ key: string, source: string }> }} x 決策圖重算的結果
 */
export function regraphData(data, x) {
  if (!x?.changed || !x.best) return data;
  return { ...data, best: x.best, ranking: { ...data.ranking, ranked: x.ranked, excluded: x.excluded, reason: x.reason }, states: x.states };
}

/**
 * 總結補一句（推薦換了才說；換回原本的就不說）。
 * @param {{ changed: boolean, best: string|null, bestName: string|null, labels?: string[] }} x
 * @param {string|null} serverBest 伺服器原本推薦的方案 id
 * @param {'en'|null} [lang]
 */
export function regraphNote(x, serverBest, lang = null) {
  if (!x?.changed || !x.best || x.best === serverBest || !x.bestName) return null;
  const labels = (x.labels || []).filter(Boolean);
  if (lang === 'en') return `Recalculated with what you picked: now ${x.bestName}.`;
  return labels.length ? `依你選的「${labels.join('、')}」重算，改推「${x.bestName}」。` : `重算後改推「${x.bestName}」。`;
}

/**
 * 開著的「阿幫問你」問的就是剛在圖上選的狀況（「有帶行李嗎？」→ 點了帶行李）：該收起，回傳要顯示的結果句；不相干回 null。
 * @param {{ options?: Array<{ kind?: string, state?: string, label?: string }> }|null} ask
 * @param {Array<{ key: string }>} states 重算後開著的狀況
 * @param {'en'|null} [lang]
 */
export function askSettledBy(ask, states, lang = null) {
  const on = new Set((states || []).map((s) => s.key));
  const hit = (ask?.options || []).find((o) => o.kind === 'state' && on.has(o.state));
  if (!hit) return null;
  return lang === 'en' ? `Got it on the chart: ${hit.label}` : `已在決策圖選了「${hit.label}」`;
}
