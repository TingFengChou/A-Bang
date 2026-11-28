// 情境對話的期望檢查（test/scenarios.test.js 示範模式、scripts/eval-scenarios.js 模型模式共用）
// 期望欄位：tools／toolsNot／toolsNone、states／statesNot、bestRole／bestRoleNot、arriveBy（null＝不該有）、
// fromHere、from／to／fromNot／toNot（地名，台／臺相同）、optionHas（{ role: 名稱要含的字 }）、textHas／textNot、resultHas、tipHas（行程卡提醒）、
// 阿幫問你（ADR-0016）：asks（問句要含這些字；沒有 ask 事件算失敗）、asksNone（這輪不該問）、asksNot（可以問別的，但問句不該含這些字）、askOptions（第 1 個在 options[0].label，其餘在任一選項）、askKind（options[0].kind）、askGuess（options[0].guess）。
// 一律檢查：決策最多一次、ask 最多一次、沒有錯誤、回答不露出工具英文名稱。
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
  if (x.toNot && trip && norm(trip.data?.to?.name).includes(norm(x.toNot))) bad.push(`終點不該是 ${x.toNot}（是 ${trip.data?.to?.name}）`);
  const asks = es.filter((e) => e.type === 'ask'), ask = asks[0];
  if (asks.length > 1) bad.push(`一輪問了 ${asks.length} 個問題（最多一個）`);
  if (x.asks) { if (!ask) bad.push('應該問使用者（沒有 ask 事件）'); else for (const w of [].concat(x.asks)) if (!ask.question.includes(w)) bad.push(`問句缺「${w}」（${ask.question}）`); }
  if (x.asksNone && ask) bad.push(`這輪不該問（問了「${ask.question}」）`);
  if (x.asksNot && ask) for (const w of [].concat(x.asksNot)) if (ask.question.includes(w)) bad.push(`問句不該含「${w}」（${ask.question}）`);
  if (x.askOptions) {
    const [first, ...rest] = [].concat(x.askOptions);
    const labels = ask?.options?.map((o) => o.label) || [];
    if (!ask) bad.push('應該有選項（沒有 ask 事件）');
    else {
      if (first && !labels[0]?.includes(first)) bad.push(`第一個選項應含「${first}」（是 ${labels[0]}）`);
      for (const w of rest) if (!labels.some((l) => l.includes(w))) bad.push(`選項缺「${w}」（${labels.join('、')}）`);
    }
  }
  if (x.askKind && ask?.options?.[0]?.kind !== x.askKind) bad.push(`第一個選項的 kind 應為 ${x.askKind}（是 ${ask?.options?.[0]?.kind ?? '無'}）`);
  if ('askGuess' in x && !!ask?.options?.[0]?.guess !== !!x.askGuess) bad.push(`第一個選項${x.askGuess ? '應' : '不該'}標「猜的」`);
  for (const w of x.textHas || []) if (!text.includes(w)) bad.push(`總結缺「${w}」`);
  for (const w of x.textNot || []) if (text.includes(w)) bad.push(`總結不該有「${w}」`);
  const said = es.filter((e) => e.type === 'tool_result').map((e) => e.speak || '').join('');
  // 一項可以是陣列：其中一個出現就算（結果會隨當下時間換一個說法時，例：垃圾車那一站正在收時改講隔壁點）
  for (const w of x.resultHas || []) if (![].concat(w).some((y) => said.includes(y))) bad.push(`工具回報缺「${[].concat(w).join('」或「')}」`);
  for (const w of x.tipHas || []) if (!(trip?.data?.tips || []).some((t) => t.text.includes(w))) bad.push(`行程提醒缺「${w}」`);
  for (const [role, word] of Object.entries(x.optionHas || {})) { const o = d?.options.find((y) => y.role === role); if (!o) bad.push(`沒有 ${role} 方案`); else if (word && !o.name.includes(word)) bad.push(`${role} 方案名稱缺「${word}」（${o.name}）`); }
  if (decisions.length > 1) bad.push(`決策出現 ${decisions.length} 次（重複的行程卡）`);
  if (TOOL_NAME.test(text.replace(/https?:\/\/\S+/g, ''))) bad.push(`回答露出工具名稱（${TOOL_NAME.exec(text)[0]}）`);
  if (es.some((e) => e.type === 'error')) bad.push(`錯誤：${es.find((e) => e.type === 'error').message}`);
  return bad;
}
