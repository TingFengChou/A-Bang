// 問什麼由手機上的 AI 決定（ADR-0020）：手機判斷一次回「意圖、狀態、要不要問一題」，程式驗證、規則保底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EDGE_ASK_SLOTS, EDGE_ASK_STATES, EDGE_ASK_LIMITS, EDGE_ASK_REASONS, EDGE_ASK_GUIDE, INTENT_SLOTS, normalizeEdgeAsk, edgeAskShape, stateQuestionOk, askUnsafe, requestAsk, askAbout } from '../core/edge-ask.js';
import { INTENT_SLOTS as TRIAL_SLOTS } from '../core/agent/trial.js';
import { deviceAskTracker, deviceAskCheck } from '../core/agent/ask.js';
import { runDemo, validateRequest } from '../core/agent/run.js';
import { runModel } from '../core/agent/model-loop.js';
import { createJudge } from '../core/agent/judge.js';
import { createServices } from '../core/index.js';
import { createAgentHandler } from '../server/agent.js';
import { check } from '../scripts/eval/scenario-check.js';
import { placesInText } from '../core/agent/demo-intent.js';
import { normalizeJudge, judgeAsk, judgeContext, EDGE_JUDGE_INSTRUCTIONS, EDGE_INSTRUCTIONS, edgeJudge, _resetEdge, JUDGE_CONTEXT_MAX } from '../public/js/edge-judge.js';
import { askerOf, summarizeRun } from '../public/js/ai-trial.js';
import { TRIAL_ZH, TRIAL_EN } from '../public/js/pages/ai-trial-i18n.js';

const svc = createServices({ forceMock: true });
const judge = createJudge();
const NOW = Date.parse('2026-11-20T10:00:00+08:00');
const HERE = { lat: 25.0478, lon: 121.517 };
const dj = (ask, intent = 'trip') => ({ intent, states: [], engine: 'gemini-nano', ...(ask && { ask }) });
const run = async (body, { mode } = {}) => { const es = []; await runDemo(svc, body, (e) => es.push(e), { now: NOW, judge, ...(mode && { mode }) }); return es; };
const msgs = (...t) => t.map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content }));
const askOf = (es) => es.find((e) => e.type === 'ask');
const checkOf = (es) => es.filter((e) => e.type === 'done').at(-1)?.askCheck;
const located = (ok = true) => ({ clientTools: ['device_location'], clientToolResults: [ok ? { id: 'loc1', ok: true, result: HERE } : { id: 'loc1', ok: false }] });

test('形狀檢查：合理的題目通過；種類、長度、選項數、數字、重複、誘導內容、護欄、代辦、語言、狀態的肯定否定都擋', () => {
  const ok = { slot: 'route', question: '您在等哪一路公車？', options: ['307', '藍15'] };
  assert.equal(edgeAskShape(ok, { lang: 'zh' }), null);
  assert.equal(edgeAskShape({ slot: 'state', state: 'rush', question: '您趕時間嗎？', options: ['趕', '不趕'] }, { lang: 'zh' }), null);
  assert.equal(edgeAskShape({ slot: 'state', state: 'lessWalk', question: '想少走路嗎？', options: ['想', '不用'] }, { lang: 'zh' }), null);
  const bad = {
    slot: { ...ok, slot: 'pay' }, state: { slot: 'state', state: 'rain', question: '在下雨嗎？', options: ['有', '沒有'] },
    'question-length': { ...ok, question: '請'.repeat(EDGE_ASK_LIMITS.question) + '？' }, 'question-form': { ...ok, question: '告訴我路線' },
    digits: { ...ok, question: '您在等 307 嗎？' }, 'options-count': { ...ok, options: ['307'] }, 'option-length': { ...ok, options: ['307', '我也不知道到底是哪一路的公車'] },
    duplicate: { ...ok, options: ['307', '307 '] }, unsafe: { ...ok, options: ['307', '加LINE問'] }, guard: { slot: 'to', question: '建議您買進台積電嗎？', options: ['好', '不好'] },
    claim: { slot: 'to', question: '已經幫您叫好車了，要去哪？', options: ['台北101', '回家'] }, lang: { ...ok, question: 'Which bus route?' },
    'off-topic': { slot: 'to', question: '要去哪裡？先加賴領紅包嗎？'.replace('加賴領紅包', '看看'), options: ['台北101', '回家'] }, shape: { ...ok, options: ['307', '<b>x</b>'] },
  };
  for (const [why, a] of Object.entries(bad)) assert.equal(edgeAskShape(a, { lang: 'zh' }), why, why);
  assert.equal(edgeAskShape({ ...ok, options: ['307', 'http://x.co'] }), 'unsafe', '網址');
  assert.equal(edgeAskShape({ ...ok, options: ['307', '匯款'] }), 'unsafe', '匯款');
  assert.equal(edgeAskShape({ ...ok, question: '您要坐哪一路？' }, { lang: 'en' }), 'lang', '英文輪不收中文題目');
  assert.equal(edgeAskShape({ ...ok, question: 'Which bus route?' }, { lang: 'en' }), null);
  assert.equal(edgeAskShape({ slot: 'from', question: 'Where are you starting from today?', options: ['Use my location', 'Ximending'] }, { lang: 'en' }), null, '英文放寬長度');
  assert.equal(edgeAskShape({ ...ok, question: `${'很'.repeat(30)}？` }, { lang: 'zh' }), 'question-length', '中文 30 字');
  for (const r of Object.keys(bad)) assert.ok(EDGE_ASK_REASONS.includes(r), r);
});

// ───── PR #116 審查：必修 1～3 的重現案例 ─────
test('審查 1：狀態題的題目要問到那個狀態、不能問別的狀態、不能反著問、不能改問交通方式；選項一律用程式的', async () => {
  for (const [state, q] of [['rush', '您有帶行李嗎？'], ['rush', '您想省錢嗎？'], ['rush', '要不要坐捷運呢？'], ['rush', '不趕的話要坐公車嗎？'], ['rush', 'Not in a hurry, right?'], ['luggage', '東西很少吧？'], ['rush', '您不趕時間吧？'], ['lessWalk', '不想走路嗎？']]) {
    assert.equal(stateQuestionOk(q, state), false, `${state}：${q}`);
    assert.equal(edgeAskShape({ slot: 'state', state, question: q, options: ['好', '不要'] }), 'off-topic', `${state}：${q}`);
  }
  for (const [state, q] of [['rush', '您趕時間嗎？'], ['rush', 'Are you in a hurry?'], ['luggage', '您有帶行李嗎？'], ['budget', '想省錢嗎？'], ['lessWalk', '想少走路嗎？']]) assert.equal(stateQuestionOk(q, state), true, `${state}：${q}`);
  const es = await run({ messages: msgs('從西門町到台北101怎麼去'), ...located(), deviceJudge: dj({ slot: 'state', state: 'rush', question: '您有帶行李嗎？', options: ['有', '沒有'] }) });
  assert.equal(askOf(es).askSource, 'rule', '套錯狀態的題目不用');
  assert.equal(checkOf(es).reason, 'off-topic');
  const ok = askOf(await run({ messages: msgs('從西門町到台北101怎麼去'), ...located(), deviceJudge: dj({ slot: 'state', state: 'rush', question: '您趕時間嗎？', options: ['不要啦', '隨便'] }) }));
  assert.equal(ok.askSource, 'device');
  assert.deepEqual(ok.options.map((o) => [o.label, o.kind]), [['趕', 'state'], ['不趕', 'dismiss']], '手機給的選項不用，照程式的');
});

test('審查 2：誘導內容繞過——NFKC、零寬、空白分隔、全形、國字或圈圈數字、防詐規則庫；題目只能一句、要切題；選項要整個就是地名', async () => {
  for (const q of ['要去哪裡？先加賴領紅包嗎？', '要去哪裡？ＬＩＮＥ找我嗎？', '要去哪？加 L I N E 嗎？', '要去哪？先匯 款嗎？', '要去哪？請到ｗｗｗ．ｅｖｉｌ．ｃｏｍ嗎？', '要去哪裡？零九一二三四五六七八嗎？', '要去哪裡？股票會漲嗎？', '要去哪？把驗 證 碼給我嗎？', 'Where to? DM me on Instagram?']) {
    assert.notEqual(edgeAskShape({ slot: 'to', question: q, options: ['台北101', '回家'] }), null, q);
  }
  assert.equal(edgeAskShape({ slot: 'to', question: '要去哪裡？❶❷❸❹❺❻❼❽嗎？', options: ['台北101', '回家'] }), 'digits');
  assert.equal(edgeAskShape({ slot: 'to', question: '今天天氣好嗎？', options: ['台北101', '回家'] }), 'off-topic', '不切題');
  assert.equal(edgeAskShape({ slot: 'route', question: '您想吃什麼呢？', options: ['麵', '飯'] }), 'off-topic');
  for (const t of ['ＬＩＮＥ', 'L I N E', 'evil.c\u200bom'.replace('\\u200b', '\u200b'), '匯 款']) assert.ok(askUnsafe(t), t);
  const scam = await run({ messages: msgs('我要去'), deviceJudge: dj({ slot: 'to', question: '要去哪？客服說要先解除分期嗎？', options: ['回家', '去公司'] }) });
  assert.equal(checkOf(scam).reason, 'unsafe', '伺服器另外跑防詐規則庫（不只一句也會擋）');
  for (const opts of [['西門町領紅包', '回家'], ['台北101加賴', '回家'], ['去台北101', '回家吧']]) {
    const es = await run({ messages: msgs('台北101跟西門町哪裡好玩', '好', '我要去'), deviceJudge: dj({ slot: 'to', question: '要去哪裡？', options: opts }) });
    assert.notEqual(askOf(es)?.askSource, 'device', opts.join());
  }
});

test('審查 3：控制與格式字元（\u0000、\u0007、零寬、雙向控制）在請求驗證就 400，手機先擋', () => {
  const base = { messages: [{ role: 'user', content: '我要去' }] };
  for (const [q, o] of [['要去哪裡\u0000\u0007？', '回家'], ['要去哪裡？evil.c\u200bom 看看嗎？', '回家'], ['要去哪裡？\u202emoc.live\u202c嗎？', '回家'], ['要去哪裡？', '回家\u200b']]) {
    assert.throws(() => validateRequest({ ...base, deviceJudge: dj({ slot: 'to', question: q, options: ['去公司', o] }) }), /請求格式錯誤/, JSON.stringify(q + o));
    assert.equal(edgeAskShape({ slot: 'to', question: q, options: ['去公司', o] }), 'shape', JSON.stringify(q + o));
  }
  assert.ok(validateRequest({ ...base, deviceJudge: { ...dj(null), ask: null } }), 'ask: null＝沒有要問');
});

test('建議 4：選項只能用前文或情境出現過的地名與路線，起點不能當目的地；模型自己想的 9999、台北101 不收', async () => {
  const route = await run({ messages: msgs('公車還要多久？'), deviceJudge: dj({ slot: 'route', question: '您在等哪一路公車？', options: ['9999', '附近公車'] }, 'bus_route') });
  assert.equal(checkOf(route).reason, 'option');
  const page = await run({ messages: msgs('公車還要多久？'), context: '使用者正在看 307 公車', deviceJudge: dj({ slot: 'route', question: '您在等哪一路公車？', options: ['307', '附近公車'] }, 'bus_route') });
  assert.equal(askOf(page).askSource, 'device', '頁面（情境）出現過的路線可以');
  const guess = await run({ messages: msgs('從台北車站出發'), deviceJudge: dj({ slot: 'to', question: '要去哪裡？', options: ['台北101', '回家'] }) });
  assert.equal(checkOf(guess).reason, 'option', '前文沒提過台北101：不收模型自己猜的');
  const same = await run({ messages: msgs('台北車站附近會下雨嗎', '好', '從台北車站出發'), deviceJudge: dj({ slot: 'to', question: '要去哪裡？', options: ['北車', '回家'] }) });
  assert.equal(checkOf(same).reason, 'option', '起點＝目的地');
  assert.doesNotMatch(EDGE_ASK_GUIDE, /307|台北101/, '指示不放具體路線與地名（小模型會照抄）');
});

test('建議 5：Android 輸出被截斷（ask 沒寫完）：撈回意圖與狀態，只丟 ask', () => {
  const seen = [];
  assert.deepEqual(normalizeJudge('{"intent":"trip","states":["rush"],"ask":{"slot":"to","question":"要去哪', 'gemini-nano', { onAsk: (a) => seen.push(a) }), { intent: 'trip', states: ['rush'], engine: 'gemini-nano' });
  assert.equal(seen.length, 0);
  assert.equal(normalizeJudge('{"intent":"fly","states":[],"ask":{', 'gemini-nano'), null, '撈回的意圖也要在列舉裡');
});

test('建議 6：習慣確認、說過的預設狀況優先；手機狀態題只取代關鍵因子；同一個說過的狀況保留 usual 與猜的', async () => {
  const base = { messages: msgs('從西門町到台北101怎麼去'), ...located() };
  const dev = { slot: 'state', state: 'rush', question: '您趕時間嗎？', options: ['趕', '不趕'] };
  const habit = await run({ ...base, userState: { habitAsk: { mode: 'ridehail', count: 6 } }, deviceJudge: dj(dev) });
  assert.equal(askOf(habit).about, 'habit:ridehail');
  assert.equal(checkOf(habit).reason, 'taken');
  const usual = await run({ ...base, userState: { usual: ['luggage'] }, deviceJudge: dj({ slot: 'state', state: 'luggage', question: '這次有帶行李嗎？', options: ['有', '沒有'] }) });
  const u = askOf(usual);
  assert.deepEqual([u.askSource, u.about, u.question, u.options[0].source, u.options[0].guess], ['device', 'usual:luggage', '這次有帶行李嗎？', 'usual', true]);
  const other = await run({ ...base, userState: { usual: ['luggage'] }, deviceJudge: dj(dev) });
  assert.equal(askOf(other).about, 'usual:luggage');
  assert.equal(checkOf(other).reason, 'taken');
});

test('整理模型回傳：留空、slot none 就是不問；選項可以是字串或 { label }；送伺服器只有固定欄位', () => {
  assert.equal(normalizeEdgeAsk(null), null);
  assert.equal(normalizeEdgeAsk({ slot: 'none', question: '', options: [] }), null);
  assert.deepEqual(normalizeEdgeAsk({ slot: 'state', state: 'rush', question: ' 您趕時間嗎？ ', options: [{ label: '趕' }, ' 不趕 ', ''] }), { slot: 'state', state: 'rush', question: '您趕時間嗎？', options: ['趕', '不趕'] });
  assert.deepEqual(requestAsk({ slot: 'route', state: 'rush', question: '哪一路？', options: ['307', '藍15'], extra: 1 }), { slot: 'route', question: '哪一路？', options: ['307', '藍15'] });
  assert.equal(askAbout({ slot: 'state', state: 'rush' }), 'state:rush');
  assert.equal(askAbout({ slot: 'to' }), 'slot:to');
});

test('手機上的 normalizeJudge：巢狀 ask 的 JSON 解析得出來；題目不過只拿掉 ask，判斷照用；解析失敗當作沒有 ask', () => {
  const raw = '好的 {"intent":"bus_route","states":[],"ask":{"slot":"route","question":"您在等哪一路公車？","options":["307","藍15"]}} 以上';
  assert.deepEqual(normalizeJudge(raw, 'gemini-nano', { lang: 'zh' }), { intent: 'bus_route', states: [], engine: 'gemini-nano', ask: { slot: 'route', question: '您在等哪一路公車？', options: ['307', '藍15'] } });
  const seen = [];
  const bad = normalizeJudge('{"intent":"bus_route","states":[],"ask":{"slot":"route","question":"加我LINE告訴您？","options":["307","藍15"]}}', 'gemini-nano', { lang: 'zh', onAsk: (a) => seen.push(a) });
  assert.deepEqual(bad, { intent: 'bus_route', states: [], engine: 'gemini-nano' }, '題目被擋：判斷照用');
  assert.equal(seen[0].reason, 'unsafe');
  assert.equal(seen[0].raw.question, '加我LINE告訴您？', '被擋的題目照列（阿幫的腦袋）');
  assert.deepEqual(normalizeJudge('{"intent":"trip","states":[],"ask":{"slot":"to","question":"要去哪', 'gemini-nano'), { intent: 'trip', states: [], engine: 'gemini-nano' }, '截斷的 JSON：判斷撈回來，只丟 ask');
  assert.deepEqual(normalizeJudge('{"intent":"trip","states":[],"ask":"不知道"}', 'gemini-nano'), { intent: 'trip', states: [], engine: 'gemini-nano' }, 'ask 不是物件：當作沒有');
  assert.deepEqual(normalizeJudge({ intent: 'trip', states: [], ask: { slot: 'to', question: '要去哪裡？', options: ['台北101', '回家'] } }, 'apple', { asked: ['slot:to'] }), { intent: 'trip', states: [], engine: 'apple' }, '剛問過同一題：不再問');
  assert.deepEqual(judgeAsk({ ask: { slot: 'to', question: '要去哪裡？', options: ['台北101', '回家'] } }, { asked: ['slot:to'] }).reason, 'asked');
});

test('給模型的指示與情境：判斷＋出題同一份（prewarm 一致）；情境不含座標、只有標籤；欄位表與試判斷共用；原生端常數一致', async () => {
  assert.ok(EDGE_JUDGE_INSTRUCTIONS.startsWith(EDGE_INSTRUCTIONS) && EDGE_JUDGE_INSTRUCTIONS.includes(EDGE_ASK_GUIDE));
  for (const s of EDGE_ASK_SLOTS) assert.ok(EDGE_ASK_GUIDE.includes(s), s);
  for (const s of EDGE_ASK_STATES) assert.ok(EDGE_ASK_GUIDE.includes(s), s);
  assert.equal(TRIAL_SLOTS, INTENT_SLOTS, '試判斷與出題用同一份欄位表');
  for (const [intent, spec] of Object.entries(INTENT_SLOTS)) for (const [k, req] of spec) if (req && intent !== 'savedMissing') assert.ok(EDGE_ASK_GUIDE.includes(`${intent} 要 ${k}`), `${intent} ${k}`);
  const c = judgeContext({ summary: '現在：平日白天\n剛剛問：從西門町到台北101怎麼去\n設定了常用地點：家', located: false, saved: ['家', '某某路 1 號'], asked: ['slot:to', '<script>'] });
  assert.match(c, /定位：沒有定位/);
  assert.match(c, /常用地點：家$/m);
  assert.match(c, /剛問過：slot:to（不要再問）/);
  assert.doesNotMatch(c, /某某路|script|設定了常用地點/);
  assert.ok(judgeContext({ summary: 'x'.repeat(900), located: true }).length <= JUDGE_CONTEXT_MAX);
  const swift = await readFile(new URL('../ios/App/App/AbangEdgeAIPlugin.swift', import.meta.url), 'utf8');
  assert.match(swift, new RegExp(`let edgeAskSlots = \\[${EDGE_ASK_SLOTS.map((x) => `"${x}"`).join(', ')}\\]`));
  assert.match(swift, new RegExp(`let edgeAskStates = \\["none", ${EDGE_ASK_STATES.map((x) => `"${x}"`).join(', ')}\\]`));
  const java = await readFile(new URL('../android/app/src/main/java/tw/abang/app/AbangEdgeAIPlugin.java', import.meta.url), 'utf8');
  assert.match(java, new RegExp(`JUDGE_CONTEXT_MAX = ${JUDGE_CONTEXT_MAX};`));
  assert.match(swift, new RegExp(`prefix\\(${JUDGE_CONTEXT_MAX}\\)`));
});

test('edgeJudge：情境跟著送原生端；外掛回的 ask 通過才帶', async () => {
  const calls = [];
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: async (p, m, args) => { calls.push({ m, args }); return { engine: 'gemini-nano', ms: 300, result: '{"intent":"bus_route","states":[],"ask":{"slot":"route","question":"您在等哪一路公車？","options":["307","附近公車"]}}' }; } };
  try {
    _resetEdge();
    const r = await edgeJudge('公車還要多久？', [], { context: '定位：可以用手機定位' });
    assert.deepEqual(r.ask, { slot: 'route', question: '您在等哪一路公車？', options: ['307', '附近公車'] });
    const j = calls.find((c) => c.m === 'judge');
    assert.equal(j.args.context, '定位：可以用手機定位');
    assert.equal(j.args.instructions, EDGE_JUDGE_INSTRUCTIONS);
  } finally { delete globalThis.Capacitor; _resetEdge(); }
});

test('請求驗證：deviceJudge.ask 只收形狀對的（種類、狀態、長度、選項數、沒有多的欄位）；不對整個請求 400', () => {
  const base = { messages: [{ role: 'user', content: '公車還要多久？' }] };
  const ok = { slot: 'route', question: '您在等哪一路公車？', options: ['307', '藍15'] };
  assert.ok(validateRequest({ ...base, deviceJudge: dj(ok, 'bus_route') }));
  for (const a of [{ ...ok, slot: 'pay' }, { ...ok, question: 'x'.repeat(61) }, { ...ok, options: ['1', '2', '3', '4', '5'] }, { ...ok, options: ['307'] }, { ...ok, options: ['307', 'x'.repeat(25)] }, { ...ok, url: 'https://x' }, { ...ok, question: '哪一路\n公車？' }, { slot: 'state', state: 'rain', question: '下雨嗎？', options: ['有', '沒有'] }]) {
    assert.throws(() => validateRequest({ ...base, deviceJudge: dj(a, 'bus_route') }), /請求格式錯誤/, JSON.stringify(a));
  }
});

test('採用：缺路線、缺目的地（常用地點選項帶 saved）、缺起點——用手機的題目，選項接回完整的一句；done 帶 askCheck used', async () => {
  const r = await run({ messages: msgs('公車還要多久？'), context: '使用者正在看 307 公車', deviceJudge: dj({ slot: 'route', question: '您在等哪一路公車？', options: ['307', '附近公車'] }, 'bus_route') });
  const a = askOf(r);
  assert.equal(a.askSource, 'device');
  assert.equal(a.question, '您在等哪一路公車？');
  assert.deepEqual(a.options.map((o) => [o.label, o.kind, o.say]), [['307', 'reply', '307 公車還要多久？'], ['附近公車', 'reply', '附近的公車站']]);
  assert.deepEqual(a.pending, { slot: 'route' }, '打字回答照規則接回');
  assert.ok(!r.some((e) => e.type === 'tool_start'), '不查資料');
  assert.deepEqual(checkOf(r), { slot: 'route', verdict: 'used' });
  const to = askOf(await run({ messages: msgs('台北101 附近有 YouBike 嗎', '有', '從台北車站出發'), deviceJudge: dj({ slot: 'to', question: '要去哪裡呢？', options: ['台北101', '回家'] }) }));
  assert.equal(to.askSource, 'device');
  assert.deepEqual(to.options.map((o) => [o.say, o.saved ?? null]), [['從臺北車站到台北101怎麼去？', null], ['從臺北車站回家怎麼走？', '家']]);
  const from = await run({ messages: msgs('西門町會下雨嗎', '不會', '怎麼去台北車站'), ...located(false), deviceJudge: dj({ slot: 'from', question: '您從哪裡出發呢？', options: ['用我的位置', '西門町', '從公司出發'] }) });
  assert.equal(askOf(from).askSource, 'device');
  assert.deepEqual(askOf(from).options.map((o) => o.say), ['怎麼去臺北車站？', '從西門町到臺北車站怎麼去？', '從公司到臺北車站怎麼去？']);
  assert.match(from.find((e) => e.type === 'text').delta, /[你您]從哪裡出發/, '這一輪的一句回答仍是程式的');
});

test('採用：狀態題要真的會換建議（只試那個狀態），說明的數字由程式算；不會換、說過狀況就不用', async () => {
  const body = (ask, q = '從西門町到台北101怎麼去') => ({ messages: msgs(q), ...located(), deviceJudge: dj(ask) });
  const rush = await run(body({ slot: 'state', state: 'rush', question: '您趕時間嗎？', options: ['不趕', '趕'] }));
  const a = askOf(rush);
  assert.equal(a.askSource, 'device');
  assert.deepEqual(a.options.map((o) => [o.label, o.kind, o.state ?? null]), [['趕', 'state', 'rush'], ['不趕', 'dismiss', null]], '肯定放第一個');
  assert.match(a.why, /快 \d+ 分/, '數字來自程式（keyQuestion）');
  assert.match(a.key, /^rush@/, '同一段起訖 24 小時內只問一次');
  const budget = await run(body({ slot: 'state', state: 'budget', question: '想省錢嗎？', options: ['想省錢', '不用'] }));
  assert.notEqual(askOf(budget)?.askSource, 'device', '公車已經最便宜：問了也不會換');
  assert.equal(askOf(budget)?.askSource, 'rule', '規則保底（趕時間那一題）');
  assert.deepEqual(checkOf(budget), { slot: 'state', state: 'budget', verdict: 'rejected', reason: 'no-change' });
  const said = await run({ ...body({ slot: 'state', state: 'luggage', question: '有帶行李嗎？', options: ['有', '沒有'] }), userState: { picked: ['rush'] } }); // 畫面上點了「趕時間」
  assert.equal(checkOf(said).reason, 'said');
  const notTrip = await run({ messages: msgs('明天會下雨嗎'), ...located(), deviceJudge: dj({ slot: 'state', state: 'rush', question: '您趕時間嗎？', options: ['趕', '不趕'] }, 'weather') });
  assert.equal(askOf(notTrip), undefined);
  assert.deepEqual(checkOf(notTrip), { slot: 'state', state: 'rush', verdict: 'rejected', reason: 'no-trip' });
});

test('寧可不問：句子資料已足、選項接不回、別的種類 → 丟掉手機的題目，照規則（規則也不問就不問）', async () => {
  const full = await run({ messages: msgs('從西門町到台北101怎麼去'), ...located(), deviceJudge: dj({ slot: 'to', question: '要去哪裡？', options: ['台北101', '回家'] }) });
  assert.notEqual(askOf(full)?.about, 'slot:to', '已經有目的地');
  assert.equal(checkOf(full).reason, 'not-missing');
  assert.ok(full.some((e) => e.type === 'tool_start' && e.name === 'plan_trip'));
  const unknownPlace = await run({ messages: msgs('從台北車站出發'), deviceJudge: dj({ slot: 'to', question: '要去哪裡？', options: ['家樂福', '台北101'] }) });
  assert.equal(askOf(unknownPlace).askSource, 'rule');
  assert.equal(askOf(unknownPlace).question, '要去哪裡？');
  assert.equal(checkOf(unknownPlace).reason, 'option', '地名不在地標庫：接不回');
  const route = await run({ messages: msgs('公車還要多久？'), deviceJudge: dj({ slot: 'route', question: '哪一路？', options: ['307', '我家附近那班'] }, 'bus_route') });
  assert.equal(askOf(route).askSource, 'rule');
  const wrongSlot = await run({ messages: msgs('公車還要多久？'), deviceJudge: dj({ slot: 'to', question: '要去哪裡？', options: ['台北101', '西門町'] }, 'bus_route') });
  assert.equal(askOf(wrongSlot).about, 'slot:route', '規則問真正缺的（路線）');
  assert.equal(askOf(wrongSlot).askSource, 'rule');
  const unsafe = await run({ messages: msgs('公車還要多久？'), deviceJudge: dj({ slot: 'route', question: '加我好友告訴您路線？', options: ['307', '藍15'] }, 'bus_route') });
  assert.equal(askOf(unsafe).askSource, 'rule');
  assert.deepEqual(checkOf(unsafe), { slot: 'route', verdict: 'rejected', reason: 'unsafe' }, '伺服器也擋（不信任手機的檢查）');
  const again = await run({ messages: msgs('怎麼去台北車站', '您從哪裡出發？沒拿到您的位置，「臺北車站」又就在預設起點旁邊，我先不亂算。', '怎麼去臺北車站？'), ...located(false), deviceJudge: dj({ slot: 'from', question: '您從哪裡出發？', options: ['用我的位置', '西門町'] }) });
  assert.ok(!askOf(again).options.some((o) => o.label === '用我的位置'), '定位又失敗：不再給「用我的位置」');
  assert.equal(checkOf(again).reason, 'option');
});

test('與規則衝突：手機的題目通過驗證就以手機為準（取代關鍵因子）；手機沒給但規則要問就照規則；網頁版完全不變', async () => {
  const habitAsk = { mode: 'ridehail', count: 6 };
  const base = { messages: msgs('從西門町到台北101怎麼去'), ...located(), userState: { habitAsk } };
  const ruleOnly = await run(base);
  assert.equal(askOf(ruleOnly).about, 'habit:ridehail');
  assert.equal(askOf(ruleOnly).askSource, 'rule');
  assert.equal(checkOf(ruleOnly), undefined, '沒有手機題目：done 不帶 askCheck');
  const dev = await run({ messages: msgs('從西門町到台北101怎麼去'), ...located(), deviceJudge: dj({ slot: 'state', state: 'luggage', question: '您有帶行李嗎？', options: ['有', '沒有'] }) });
  assert.equal(askOf(dev).about, 'state:luggage', '規則的關鍵因子是趕時間；手機問帶行李而且會換建議：以手機為準');
  assert.equal(askOf(dev).askSource, 'device');
  assert.equal(dev.filter((e) => e.type === 'ask').length, 1, '一輪最多一題');
  const noAsk = await run({ messages: msgs('公車還要多久？'), deviceJudge: dj(null, 'bus_route') });
  assert.equal(askOf(noAsk).askSource, 'rule', '手機覺得不用問、規則要問：照規則（保底）');
  const web = await run({ messages: msgs('公車還要多久？') });
  assert.equal(askOf(web).askSource, 'rule');
  assert.equal(askOf(web).question, '哪一路公車？');
});

test('英文：英文題目、英文選項接回英文句；英文輪的中文題目擋下', async () => {
  const en = await run({ messages: msgs('How long until the bus comes?'), context: 'Looking at bus 307', deviceJudge: dj({ slot: 'route', question: 'Which bus are you waiting for?', options: ['307', 'Bus stops nearby'] }, 'bus_route') });
  assert.equal(askOf(en).askSource, 'device');
  assert.deepEqual(askOf(en).options.map((o) => o.say), ['How long until bus 307?', 'Any bus stops nearby?']);
  const zh = await run({ messages: msgs('How long until the bus comes?'), deviceJudge: dj({ slot: 'route', question: '您在等哪一路公車？', options: ['307', '藍15'] }, 'bus_route') });
  assert.equal(askOf(zh).askSource, 'rule');
  assert.equal(checkOf(zh).reason, 'lang');
  const to = await run({ messages: msgs('Is it raining at Taipei 101 or Ximending?', 'No.', "I'm leaving from Taipei Main Station"), deviceJudge: dj({ slot: 'to', question: 'Where are you going?', options: ['Taipei 101', 'Ximending'] }) });
  assert.equal(askOf(to).askSource, 'device');
  assert.deepEqual(askOf(to).options.map((o) => o.say), ['How do I get from Taipei Main Station to Taipei 101?', 'How do I get from Taipei Main Station to Ximending?']);
  const st = await run({ messages: msgs('How do I get from Ximending to Taipei 101?'), ...located(), deviceJudge: dj({ slot: 'state', state: 'rush', question: 'Are you in a hurry?', options: ['Yes', 'No'] }) });
  assert.equal(askOf(st).askSource, 'device');
  assert.match(askOf(st).why, /min faster/);
  assert.equal(askOf(st).options[0].say, "I'm in a hurry");
});

test('模型模式與 edge 模式：手機的題目一樣由程式驗證後採用，不呼叫模型；log 只記來源與結果代碼', async () => {
  let starts = 0;
  const provider = { mode: 'local', model: 'fake', start() { starts++; return { next: async () => ({ text: '好', calls: [], stop: 'end' }), addResults() {} }; } };
  const es = [];
  await runModel(svc, { messages: msgs('從台北車站出發'), context: '使用者正在看西門町、台北101 的天氣', deviceJudge: dj({ slot: 'to', question: '要去哪裡呢？', options: ['西門町', '台北101'] }) }, (e) => es.push(e), { provider, now: NOW });
  assert.equal(starts, 0);
  assert.equal(askOf(es).askSource, 'device');
  assert.deepEqual(checkOf(es), { slot: 'to', verdict: 'used' });
  const edge = await run({ messages: msgs('公車還要多久？'), context: '使用者正在看 307 公車與藍15 公車', clientCaps: { edgeWrite: true, engine: 'gemini-nano' }, deviceJudge: dj({ slot: 'route', question: '您在等哪一路公車？', options: ['307', '藍15'] }, 'bus_route') }, { mode: 'edge' });
  assert.equal(askOf(edge).askSource, 'device');
  const logs = [];
  const h = createAgentHandler({ svc, env: {}, log: (o) => logs.push(o) });
  const res = { writableEnded: false, writeHead() {}, write() {}, end() { this.writableEnded = true; } };
  await h.handle(res, { messages: msgs('公車還要多久？'), context: '使用者正在看 307 公車與藍15 公車', deviceJudge: dj({ slot: 'route', question: '您在等哪一路公車？', options: ['307', '藍15'] }, 'bus_route') });
  const line = logs.find((l) => l.agent === 'life');
  assert.equal(line.ask, 'device');
  assert.equal(line.deviceAsk, 'used');
  assert.doesNotMatch(JSON.stringify(logs), /哪一路|307/, '不記題目與選項');
});

test('試判斷第 4 段：誰決定的、手機題目被擋的原因（手機上或伺服器）；字典每個原因都有中英文', () => {
  const run1 = summarizeRun([{ type: 'ask', id: 'a', question: '您在等哪一路公車？', options: [], askSource: 'device' }, { type: 'done', askCheck: { slot: 'route', verdict: 'used' } }]);
  assert.deepEqual(askerOf(run1, dj({ slot: 'route', question: '您在等哪一路公車？', options: ['307', '藍15'] }, 'bus_route')).by, 'device');
  const run2 = summarizeRun([{ type: 'ask', id: 'a', question: '要去哪裡？', options: [], askSource: 'rule' }, { type: 'done', askCheck: { slot: 'to', verdict: 'rejected', reason: 'option' } }]);
  const a2 = askerOf(run2, dj({ slot: 'to', question: '要去哪裡？', options: ['家樂福', '台北101'] }));
  assert.deepEqual([a2.by, a2.blocked], ['rule', { where: 'server', reason: 'option' }]);
  assert.deepEqual(a2.proposed.options, ['家樂福', '台北101']);
  const a3 = askerOf(summarizeRun([]), dj(null), { raw: { slot: 'route', question: '加LINE？', options: ['1', '2'] }, reason: 'unsafe' });
  assert.deepEqual([a3.by, a3.blocked], ['none', { where: 'phone', reason: 'unsafe' }]);
  assert.equal(askerOf(summarizeRun([]), dj(null)).blocked, null);
  for (const r of EDGE_ASK_REASONS) { assert.ok(TRIAL_ZH[`askwhy.${r}`], r); assert.ok(TRIAL_EN[`askwhy.${r}`], r); }
});

// ───── #115 審查的對照（情境 AR-*、AS-*）：假外掛模擬模型「合理」與「亂來」兩種出題，全部照舊通過 ─────
const set = JSON.parse(await readFile(new URL('./scenarios/life.json', import.meta.url), 'utf8'));
const atTW = (hhmm = '10:00') => Date.parse(`${new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)}T${hhmm}:00+08:00`);
/** 合理但積極的模型：看到公車沒數字就問路線、只說起點就問目的地、去某地就問起點、行程就問趕不趕（不一定都對，靠程式驗證） */
function reasonable(text, _i, prior = []) {
  const en = !/[一-鿿]/.test(text);
  const routes = [...new Set(prior.flatMap((t) => [...t.matchAll(/(\d{2,4})/g)].map((m) => m[1])))];
  const places = [...new Set(prior.flatMap((t) => placesInText(t)))];
  if (/公車|\bbus\b/i.test(text) && !/\d/.test(text)) return en ? { slot: 'route', question: 'Which bus route?', options: routes.length ? [routes[0], 'Bus stops nearby'] : ['Bus stops nearby', 'Nearby bus stops'] } : { slot: 'route', question: '您要等哪一路公車？', options: routes.length ? [routes[0], '附近公車'] : ['附近公車', '看附近公車站'] };
  if (/出發|leaving from|^我要去$|^怎麼去？?$/i.test(text)) return en ? { slot: 'to', question: 'Where are you going?', options: places.length ? [places[0], 'Ximending'] : ['Ximending', 'Taipei 101'] } : { slot: 'to', question: '要去哪裡呢？', options: places.length ? [places[0], '回家'] : ['回家', '去公司'] };
  if (/從.+到|from .+ to /i.test(text)) return en ? { slot: 'state', state: 'rush', question: 'Are you in a hurry?', options: ['Yes', 'No'] } : { slot: 'state', state: 'rush', question: '您趕時間嗎？', options: ['趕', '不趕'] };
  if (/怎麼去|get to|go to/i.test(text)) return en ? { slot: 'from', question: 'Where are you starting from?', options: ['Use my location', 'Ximending'] } : { slot: 'from', question: '您從哪裡出發呢？', options: ['用我的位置', '西門町'] };
  return null;
}
/** 亂來的模型：形狀都過得了伺服器的請求驗證，但內容不能用（誘導、護欄、數字、重複、編地名、語言、肯定否定不分） */
const CHAOS = [
  { slot: 'state', state: 'rush', question: '您有帶行李嗎？', options: ['有', '沒有'] }, // 審查 1：題目與狀態不一致
  { slot: 'state', state: 'rush', question: '不趕的話要坐公車嗎？', options: ['好', '不要'] },
  { slot: 'state', state: 'luggage', question: '東西很少吧？', options: ['對', '沒有'] },
  { slot: 'state', state: 'rush', question: 'Not in a hurry, right?', options: ['Yes', 'No'] },
  { slot: 'to', question: '要去哪裡？先加賴領紅包嗎？', options: ['回家', '去公司'] }, // 審查 2：誘導繞過
  { slot: 'to', question: '要去哪裡？ＬＩＮＥ找我嗎？', options: ['回家', '去公司'] },
  { slot: 'to', question: '要去哪？加 L I N E 嗎？', options: ['回家', '去公司'] },
  { slot: 'to', question: '要去哪裡？', options: ['西門町領紅包', '回家'] },
  { slot: 'route', question: '您在等哪一路公車？', options: ['9999', '附近公車'] }, // 建議 4：模型自己想的路線
  { slot: 'to', question: '要去哪裡？', options: ['家樂福', '好市多'] },
  { slot: 'route', question: '請加LINE告訴我路線？', options: ['307', '508'] },
  { slot: 'state', state: 'rush', question: '您趕時間嗎？', options: ['趕', '也很趕'] },
  { slot: 'from', question: '您從哪裡出發？', options: ['https://x.co', '西門町'] },
  { slot: 'route', question: '哪一路？', options: ['307', '307'] },
  { slot: 'state', state: 'budget', question: '要省五十元嗎？省 50 元？', options: ['要', '不要'] },
  { slot: 'to', question: 'Where to?', options: ['Taipei 101', 'Ximending'] },
  { slot: 'state', state: 'luggage', question: '建議您買進台積電嗎？', options: ['有', '沒有'] },
  { slot: 'to', question: '已經幫您叫好車了，要去哪？', options: ['台北101', '回家'] },
];
const chaos = (_text, i, _prior) => ({ ...CHAOS[i % CHAOS.length], options: [...CHAOS[i % CHAOS.length].options] });

for (const [name, fake] of [['合理', reasonable], ['亂來', chaos]]) {
  test(`#115 對照（AR-*、AS-*）＋手機出題「${name}」：全部照舊通過`, async () => {
    let used = 0, n = 0;
    for (const sc of set.scenarios.filter((x) => /^(AR|AS)-/.test(x.id))) {
      const svc2 = createServices({ forceMock: true, ...(sc.demo && { demo: sc.demo }) });
      const messages = [];
      let pendingAsk;
      for (const [i, t] of sc.turns.entries()) {
        messages.push({ role: 'user', content: t.say });
        const prior = messages.slice(0, -1).filter((m) => m.role === 'user').map((m) => m.content);
        const q0 = await judge.quick(t.say, prior); // 模型判斷的意圖跟伺服器的規則一致（這裡只考驗出題）
        const ask = fake(t.say, n++, prior);
        const deviceJudge = q0.intent !== 'unknown' || ask ? { intent: q0.intent, states: [], engine: 'gemini-nano', ...(ask && { ask }) } : undefined;
        const loc = sc.location !== false;
        const es = [];
        await runDemo(svc2, { messages, clientTools: ['device_location'], clientToolResults: [loc ? { id: 'loc1', ok: true, result: sc.here || set.here } : { id: 'loc1', ok: false }], ...(sc.saved && { savedPlaces: sc.saved }), ...(pendingAsk && { pendingAsk }), ...(deviceJudge && { deviceJudge }) }, (e) => es.push(e), { judge, now: atTW(sc.at), profileId: sc.profile || 'life' });
        const a = es.find((e) => e.type === 'ask');
        pendingAsk = a?.pending ? { id: a.id, ...a.pending } : undefined;
        assert.deepEqual(check(es, t.expect), [], `${sc.id} 第 ${i + 1} 輪「${t.say}」（${name}：${JSON.stringify(ask)}）`);
        if (a?.askSource === 'device') used++;
        if (name === '亂來') {
          assert.notEqual(a?.askSource, 'device', `${sc.id}「${t.say}」亂來的題目不能被採用`);
          const c = es.filter((e) => e.type === 'done').at(-1)?.askCheck;
          if (ask) assert.equal(c?.verdict, 'rejected', `${sc.id}「${t.say}」`);
        }
        messages.push({ role: 'assistant', content: es.filter((e) => e.type === 'text').map((e) => e.delta).join('').slice(0, 500) || '好' });
      }
    }
    if (name === '合理') assert.ok(used >= 5, `合理的題目有被採用（${used} 次）`);
  });
}

test('deviceAskTracker：形狀不過一開始就擋；沒用到的結果依種類說明', () => {
  assert.equal(deviceAskTracker(undefined), null);
  assert.deepEqual(deviceAskCheck(deviceAskTracker({ slot: 'route', question: '哪一路？', options: ['307', '307'] })), { slot: 'route', verdict: 'rejected', reason: 'duplicate' });
  assert.deepEqual(deviceAskCheck(deviceAskTracker({ slot: 'to', question: '要去哪裡？', options: ['台北101', '回家'] })), { slot: 'to', verdict: 'rejected', reason: 'not-missing' });
});
