// 情境對話的期望檢查（test/scenarios.test.js 示範模式、scripts/eval-scenarios.js 模型模式共用）
// 期望欄位：tools／toolsNot／toolsNone、states／statesNot、bestRole／bestRoleNot、arriveBy（null＝不該有）、
// fromHere、from／to／fromNot（地名，台／臺相同）、textHas／textNot、resultHas。一律檢查：決策最多一次、沒有錯誤、回答不露出工具英文名稱。
const norm = (s) => String(s ?? '').replace(/臺/g, '台').replace(/\s/g, '');
const TOOL_NAME = /\b[a-z]+(?:_[a-z0-9]+)+\b/;

/** 檢查一輪的期望，回傳不符合的說明（空陣列＝通過） */
export function check(es, x = {}) {
  const bad = [];
  const tools = es.filter((e) => e.type === 'tool_start').map((e) => e.name);
  const text = es.filter((e) => e.type === 'text').map((e) => e.delta).join('');
  const decisions = es.filter((e) => e.type === 'decision');
  const d = decisions[0];
  const best = d?.options.find((o) => o.id === d.best);
  const trip = es.find((e) => e.type === 'tool_result' && (e.tool || e.name) === 'plan_trip');
  for (const t of x.tools || []) if (!tools.includes(t)) bad.push(`沒用 ${t}（用了 ${tools.join('、') || '無'}）`);
  for (const t of x.toolsNot || []) if (tools.includes(t)) bad.push(`不該用 ${t}`);
  if (x.toolsNone && tools.length) bad.push(`不該查工具（用了 ${tools.join('、')}）`);
  for (const k of x.states || []) if (!d?.states.some((s) => s.key === k)) bad.push(`狀態沒有 ${k}（${d?.states.map((s) => s.key).join('、') || '無'}）`);
  for (const k of x.statesNot || []) if (d?.states.some((s) => s.key === k)) bad.push(`狀態不該有 ${k}`);
  if (x.bestRole && best?.role !== x.bestRole) bad.push(`最佳方案應為 ${x.bestRole}（是 ${best?.role ?? '無'}）`);
  if (x.bestRoleNot && best?.role === x.bestRoleNot) bad.push(`最佳方案不該是 ${x.bestRoleNot}`);
  if ('arriveBy' in x && (d?.arriveBy ?? null) !== x.arriveBy) bad.push(`抵達時間應為 ${x.arriveBy}（是 ${d?.arriveBy ?? null}）`);
  if (x.fromHere && trip?.data?.from?.name !== '你的位置') bad.push(`起點應為你的位置（是 ${trip?.data?.from?.name}）`);
  if (x.from && !norm(trip?.data?.from?.name).includes(norm(x.from))) bad.push(`起點應為 ${x.from}（是 ${trip?.data?.from?.name}）`);
  if (x.fromNot && trip && norm(trip.data?.from?.name).includes(norm(x.fromNot))) bad.push(`起點不該是 ${x.fromNot}`);
  if (x.to && !norm(trip?.data?.to?.name).includes(norm(x.to))) bad.push(`終點應為 ${x.to}（是 ${trip?.data?.to?.name}）`);
  for (const w of x.textHas || []) if (!text.includes(w)) bad.push(`總結缺「${w}」`);
  for (const w of x.textNot || []) if (text.includes(w)) bad.push(`總結不該有「${w}」`);
  const said = es.filter((e) => e.type === 'tool_result').map((e) => e.speak || '').join('');
  for (const w of x.resultHas || []) if (!said.includes(w)) bad.push(`工具回報缺「${w}」`);
  if (decisions.length > 1) bad.push(`決策出現 ${decisions.length} 次（重複的行程卡）`);
  if (TOOL_NAME.test(text.replace(/https?:\/\/\S+/g, ''))) bad.push(`回答露出工具名稱（${TOOL_NAME.exec(text)[0]}）`);
  if (es.some((e) => e.type === 'error')) bad.push(`錯誤：${es.find((e) => e.type === 'error').message}`);
  return bad;
}
