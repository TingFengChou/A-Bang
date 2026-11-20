// 情境對話的期望檢查（test/scenarios.test.js 示範模式、scripts/eval-scenarios.js 模型模式共用）
/** 檢查一輪的期望，回傳不符合的說明（空陣列＝通過） */
export function check(es, x) {
  const bad = [];
  const tools = es.filter((e) => e.type === 'tool_start').map((e) => e.name);
  const text = es.filter((e) => e.type === 'text').map((e) => e.delta).join('');
  const d = es.find((e) => e.type === 'decision');
  const best = d?.options.find((o) => o.id === d.best);
  for (const t of x.tools || []) if (!tools.includes(t)) bad.push(`沒用 ${t}（用了 ${tools.join('、') || '無'}）`);
  if (x.toolsNone && tools.length) bad.push(`不該查工具（用了 ${tools.join('、')}）`);
  for (const k of x.states || []) if (!d?.states.some((s) => s.key === k)) bad.push(`狀態沒有 ${k}（${d?.states.map((s) => s.key).join('、') || '無'}）`);
  if (x.bestRole && best?.role !== x.bestRole) bad.push(`最佳方案應為 ${x.bestRole}（是 ${best?.role ?? '無'}）`);
  if (x.arriveBy && d?.arriveBy !== x.arriveBy) bad.push(`抵達時間應為 ${x.arriveBy}（是 ${d?.arriveBy}）`);
  if (x.fromHere) { const r = es.find((e) => e.type === 'tool_result' && (e.tool || e.name) === 'plan_trip'); if (r?.data?.from?.name !== '你的位置') bad.push(`起點應為你的位置（是 ${r?.data?.from?.name}）`); }
  for (const w of x.textHas || []) if (!text.includes(w)) bad.push(`總結缺「${w}」`);
  const said = es.filter((e) => e.type === 'tool_result').map((e) => e.speak || '').join('');
  for (const w of x.resultHas || []) if (!said.includes(w)) bad.push(`工具回報缺「${w}」`);
  for (const w of x.textNot || []) if (text.includes(w)) bad.push(`總結不該有「${w}」`);
  if (es.some((e) => e.type === 'error')) bad.push(`錯誤：${es.find((e) => e.type === 'error').message}`);
  return bad;
}
