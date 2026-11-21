// 阿幫的腦袋（#/ai）：模型資訊的整理（只顯示拿得到的）、本機計數、文字與字典、入口與離線清單、/api/v1/status 的 agent 欄位
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EDGE_INTENTS, EDGE_STATES, EDGE_STATS_KEY, edgeEnabled, setEdgeEnabled, edgeStats, noteEdgeJudge, edgeJudge, _resetEdge } from '../public/js/edge-judge.js';
import { ENGINE_NAME, EDGE_REASONS, normalizeEdgeInfo, normalizeServerInfo, noteAgentStatus, lastAgentStatus, _resetAgentStatus, languageNames, nodeText, judgedText } from '../public/js/ai-info.js';
import { ZH, EN, aiT, pageLang } from '../public/js/pages/ai-i18n.js';
import { restRoutes } from '../server/rest.js';
import { createServices } from '../core/index.js';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
function fakeStorage() {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  return mem;
}
afterEach(() => { delete globalThis.localStorage; delete globalThis.Capacitor; _resetEdge(); _resetAgentStatus(); });

test('狀態正規化：Android 可用時列出系統回報的欄位；關掉＝off；網頁版什麼都不列', () => {
  const raw = { available: true, engine: 'gemini-nano', reason: 'ok', featureStatus: 'available', modelName: 'nano-x', tokenLimit: 4096, osVersion: '16', device: 'Google Pixel Test', aicoreVersion: '0.release.1' };
  assert.deepEqual(normalizeEdgeInfo(raw), { state: 'ready', reason: 'ok', active: true, engine: 'gemini-nano', modelName: 'nano-x', tokenLimit: 4096, osVersion: '16', device: 'Google Pixel Test', aicoreVersion: '0.release.1' });
  const off = normalizeEdgeInfo(raw, { enabled: false });
  assert.equal(off.state, 'off');
  assert.equal(off.active, false, '使用者關掉：不算在手機上判斷');
  assert.equal(off.modelName, 'nano-x', '模型還在，資訊照列');
  assert.deepEqual(normalizeEdgeInfo({ available: false, reason: 'web' }), { state: 'web', reason: 'web', active: false });
  assert.deepEqual(normalizeEdgeInfo(null), { state: 'web', reason: 'web', active: false });
  assert.deepEqual(normalizeEdgeInfo({ available: false, reason: 'web', engine: 'gemini-nano', modelName: 'x' }).modelName, undefined, '網頁版不列任何模型欄位');
});

test('狀態正規化：拿不到或長得奇怪的欄位就沒有（不補預設值、不編造）', () => {
  const bare = normalizeEdgeInfo({ available: true, engine: 'apple', reason: 'ok' });
  assert.deepEqual(bare, { state: 'ready', reason: 'ok', active: true, engine: 'apple' }, '外掛沒回的欄位不出現');
  const odd = normalizeEdgeInfo({ available: true, engine: 'gemini-nano', modelName: 42, tokenLimit: -5, languages: 'zh', osVersion: 'x'.repeat(80), device: '', aicoreVersion: { v: 1 } });
  for (const k of ['modelName', 'tokenLimit', 'languages', 'osVersion', 'device', 'aicoreVersion', 'download']) assert.equal(odd[k], undefined, k);
  assert.equal(normalizeEdgeInfo({ available: true, engine: 'gemini-nano', tokenLimit: 4096.5 }).tokenLimit, undefined, '不是整數');
  assert.equal(normalizeEdgeInfo({ available: true, engine: 'other', reason: 'ok' }).active, false, '不認得的引擎不算可用');
  assert.equal(normalizeEdgeInfo({ available: 'yes', engine: 'apple' }).state, 'unsupported', 'available 要是 true');
  assert.equal(normalizeEdgeInfo({ available: true, engine: 'gemini-nano', modelName: 'nano\u0000-v3\n' }).modelName, 'nano-v3', '控制字元拿掉');
});

test('狀態正規化：iOS 的語言與 contextSize；下載中有進度才有百分比；各種不可用原因', () => {
  const ios = normalizeEdgeInfo({ available: true, engine: 'apple', reason: 'ok', availability: 'available', languages: ['zh-TW', 'en', 'en', '<b>', 7, 'ja'], contextSize: 4096, osVersion: '26.1' });
  assert.deepEqual(ios.languages, ['zh-TW', 'en', 'ja'], '只收語言代碼、去重複');
  assert.equal(ios.tokenLimit, 4096);
  const dl = normalizeEdgeInfo({ available: false, engine: 'gemini-nano', reason: 'downloading', downloadTotalBytes: 2000, downloadedBytes: 740 });
  assert.equal(dl.state, 'downloading');
  assert.deepEqual(dl.download, { total: 2000, done: 740, pct: 37 });
  assert.equal(normalizeEdgeInfo({ available: false, engine: 'gemini-nano', reason: 'downloading' }).download, undefined, '系統沒回報進度：不顯示百分比');
  assert.equal(normalizeEdgeInfo({ available: false, engine: 'gemini-nano', reason: 'needs-wifi' }).state, 'downloadable');
  for (const reason of ['unsupported', 'disabled', 'os-too-old', 'language', 'unavailable']) {
    const x = normalizeEdgeInfo({ available: false, engine: 'apple', reason });
    assert.deepEqual([x.state, x.reason, x.active], ['unsupported', reason, false], reason);
  }
  assert.equal(normalizeEdgeInfo({ available: false, engine: 'apple', reason: 'something-new' }).reason, 'unavailable', '不認得的原因');
  assert.deepEqual(normalizeEdgeInfo({ available: false, reason: 'no-plugin' }), { state: 'unsupported', reason: 'no-plugin', active: false });
});

test('計數：只在本機記次數與耗時，換日歸零、上次耗時留著；壞資料當沒有', () => {
  const mem = fakeStorage();
  const day1 = new Date(2026, 10, 21, 9, 0).getTime();
  assert.deepEqual(edgeStats(day1), { today: 0, lastMs: null });
  noteEdgeJudge(412.4, day1);
  noteEdgeJudge(388, day1 + 60_000);
  assert.deepEqual(edgeStats(day1 + 120_000), { today: 2, lastMs: 388 });
  assert.deepEqual(JSON.parse(mem.get(EDGE_STATS_KEY)), { d: '2026-11-21', n: 2, ms: 388 }, '只有日期、次數、毫秒（沒有句子）');
  const day2 = new Date(2026, 10, 22, 0, 5).getTime();
  assert.deepEqual(edgeStats(day2), { today: 0, lastMs: 388 });
  noteEdgeJudge(NaN, day2);
  assert.deepEqual(edgeStats(day2), { today: 1, lastMs: 388 }, '耗時不合理：次數照記、耗時留上一次的');
  mem.set(EDGE_STATS_KEY, '{壞掉');
  assert.deepEqual(edgeStats(day2), { today: 0, lastMs: null });
  mem.set(EDGE_STATS_KEY, JSON.stringify({ d: '2026-11-22', n: -3, ms: 9e9 }));
  assert.deepEqual(edgeStats(day2), { today: 0, lastMs: null });
  delete globalThis.localStorage;
  assert.deepEqual(edgeStats(day2), { today: 0, lastMs: null }, '沒有 localStorage（無痕）不出錯');
  assert.doesNotThrow(() => noteEdgeJudge(100, day2));
});

test('計數：edgeJudge 成功才記（用外掛回報的耗時），失敗、看不懂、關閉都不記；開關共用', async () => {
  fakeStorage();
  const cap = (impl) => { globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: (_p, method, args) => impl(method, args) }; };
  cap(async () => ({ engine: 'gemini-nano', ms: 412, result: '{"intent":"trip","states":["rush"]}' }));
  assert.deepEqual(await edgeJudge('我快遲到了，怎麼去台北車站'), { intent: 'trip', states: ['rush'], engine: 'gemini-nano' }, '回傳不含耗時（deviceJudge 只有三個欄位）');
  assert.deepEqual(edgeStats(), { today: 1, lastMs: 412 });
  cap(async () => ({ engine: 'apple', result: { intent: 'weather', states: [] } }));
  await edgeJudge('明天會下雨嗎');
  const s = edgeStats();
  assert.equal(s.today, 2);
  assert.ok(s.lastMs >= 0 && s.lastMs < 1000, '外掛沒回耗時：用這裡量到的');
  cap(async () => ({ engine: 'gemini-nano', result: '看不懂' }));
  assert.equal(await edgeJudge('？？'), null);
  cap(async () => { throw new Error('judge failed'); });
  assert.equal(await edgeJudge('307 到哪了'), null);
  assert.equal(edgeStats().today, 2, '沒判斷出來不算');

  assert.equal(setEdgeEnabled(false), true);
  assert.equal(edgeEnabled(), false);
  assert.equal(globalThis.localStorage.getItem('abang.edgeAI'), 'off', '跟設定頁同一個鍵');
  cap(async () => ({ engine: 'gemini-nano', ms: 300, result: '{"intent":"trip","states":[]}' }));
  assert.equal(await edgeJudge('去台北101'), null);
  assert.equal(edgeStats().today, 2);
  setEdgeEnabled(true);
  assert.equal(edgeEnabled(), true);
  delete globalThis.localStorage;
  assert.equal(setEdgeEnabled(false), false, '存不了回 false');
});

test('伺服器資訊：照 /api/v1/status 與最近一輪的 status 事件；不認得的不顯示', () => {
  assert.deepEqual(normalizeServerInfo(null), {});
  assert.deepEqual(normalizeServerInfo({ mode: 'demo', model: 'x', judge: { embed: false, llm: false } }), { mode: 'demo', embed: false, llm: false }, '示範模式沒有模型名稱');
  assert.deepEqual(normalizeServerInfo({ mode: 'local', model: 'qwen3:8b', judge: { embed: true, llm: true } }), { mode: 'local', model: 'qwen3:8b', embed: true, llm: true });
  assert.deepEqual(normalizeServerInfo({ mode: 'claude', model: 'claude-test-model' }), { mode: 'claude', model: 'claude-test-model' }, '沒有 judge：成員狀態不顯示');
  assert.deepEqual(normalizeServerInfo({ mode: 'gpt', model: 'x', judge: { embed: 'yes' } }), {}, '不認得的模式、不是布林的旗標');

  noteAgentStatus({ type: 'status', mode: 'claude', model: 'claude-test-model', lang: 'en', judge: { intent: 'trip', source: 'device', engine: 'gemini-nano', confidence: 0.4 } });
  assert.deepEqual(lastAgentStatus(), { mode: 'claude', model: 'claude-test-model', judge: { source: 'device', engine: 'gemini-nano' } }, '只留模式、模型、判斷來源（不留意圖與內容）');
  assert.deepEqual(normalizeServerInfo(null, lastAgentStatus()), { last: { mode: 'claude', model: 'claude-test-model', source: 'device', engine: 'gemini-nano' }, mode: 'claude', model: 'claude-test-model' }, '沒有 API 資料時用最近一輪的');
  noteAgentStatus({ type: 'status', mode: 'rules', judge: { source: 'embed', engine: 'apple' } });
  const r = normalizeServerInfo({ mode: 'local', model: 'qwen3:8b' }, lastAgentStatus());
  assert.deepEqual(r.last, { mode: 'rules', source: 'embed' }, '不是裝置判斷就沒有引擎');
  assert.equal(r.mode, 'local', '目前的模式以 API 為準');
  noteAgentStatus({ type: 'text', text: '不是 status' });
  assert.equal(lastAgentStatus().mode, 'rules', '其他事件不記');
});

test('/api/v1/status：有 agentInfo 時帶 agent（模式、模型、判斷層成員），沒有就不帶', () => {
  const svc = createServices({ forceMock: true });
  assert.equal('agent' in restRoutes(svc)['/api/v1/status'].handler({}), false);
  const info = { mode: 'local', model: 'qwen3:8b', judge: { embed: true, llm: true } };
  const out = restRoutes(svc, { agentInfo: () => info })['/api/v1/status'].handler({});
  assert.deepEqual(out.agent, info);
  assert.ok(out.sources && out.packs, '原本的欄位還在');
  assert.deepEqual(normalizeServerInfo(out.agent), { mode: 'local', model: 'qwen3:8b', embed: true, llm: true });
});

test('字典：中英文鍵相同；每個意圖、狀態、原因、模型狀態都有字；缺鍵退回中文', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(ZH).sort());
  for (const [lang, dict] of [['zh', ZH], ['en', EN]]) {
    for (const k of EDGE_INTENTS) assert.ok(dict[`intent.${k}`], `${lang} intent.${k}`);
    for (const k of EDGE_STATES) assert.ok(dict[`state.${k}`], `${lang} state.${k}`);
    for (const k of EDGE_REASONS) assert.ok(dict[`reason.${k}`], `${lang} reason.${k}`);
    for (const k of ['ready', 'off', 'downloading', 'downloadingPct', 'downloadable', 'unsupported', 'web']) assert.ok(dict[`status.${k}`], `${lang} status.${k}`);
    for (const k of ['ready', 'off', 'downloading', 'downloadable', 'unsupported', 'web']) assert.ok(dict[`hero.sub.${k}`], `${lang} hero.sub.${k}`);
    for (const k of ['web', 'off', 'downloading', 'downloadable', 'unsupported', 'failed']) assert.ok(dict[`trial.why.${k}`], `${lang} trial.why.${k}`); // 試判斷第 1 段改用伺服器判斷的原因
    for (const k of Object.keys(ENGINE_NAME)) assert.ok(dict[`model.provider.${k}`], `${lang} model.provider.${k}`);
    for (const k of ['claude', 'local', 'demo', 'rules']) assert.ok(dict[`server.who.${k}`] && dict[`server.mode.${k}`], `${lang} server ${k}`);
    for (const k of ['device', 'embed', 'llm', 'rules']) assert.ok(dict[`server.src.${k}`], `${lang} server.src.${k}`);
  }
  assert.doesNotMatch(Object.values(EN).join('\n'), /[一-鿿]/, '英文字典沒有中文');
  assert.equal(aiT('en')('title'), "Abang's brain");
  assert.equal(aiT(null)('title'), '阿幫的腦袋');
  assert.equal(aiT('en')('沒有這個鍵'), '沒有這個鍵');
  assert.equal(aiT(null)('status.downloadingPct', { pct: 37 }), '模型下載中（37%）');
  assert.equal(pageLang({ lang: 'en' }), 'en');
  assert.equal(pageLang({ lang: 'fr' }), null);
});

test('文字：判斷結果一句話（動畫的等義文字）、節點短字、語言名稱', () => {
  const zh = aiT(null), en = aiT('en');
  assert.equal(judgedText({ intent: 'trip', states: ['rush'] }, 412, zh), '聽懂了：意圖是「行程規劃」；狀態是「趕時間」。花了 412 毫秒，沒有離開手機。');
  assert.equal(judgedText({ intent: 'weather', states: [] }, null, zh), '聽懂了：意圖是「天氣」；沒有特別提到狀態。沒有離開手機。', '沒有耗時就不說');
  assert.equal(judgedText({ intent: 'trip', states: ['elder', 'lessWalk', 'fly'] }, 388.6, zh), '聽懂了：意圖是「行程規劃」；狀態是「帶長輩、少走路」。花了 389 毫秒，沒有離開手機。');
  assert.equal(judgedText({ intent: 'pizza', states: [] }, 5, zh), '聽懂了：意圖是「其他」；沒有特別提到狀態。花了 5 毫秒，沒有離開手機。', '不認得的意圖當其他');
  assert.equal(judgedText({ intent: 'trip', states: ['rush'] }, 412, en), 'Got it: intent is "Trip planning"; situation is "In a hurry". Took 412 ms, never left the phone.');
  assert.equal(nodeText(['趕時間']), '趕時間');
  assert.equal(nodeText(['趕時間', '帶長輩']), '趕時間、帶長輩');
  assert.equal(nodeText(['趕時間', '帶長輩', '少走路']), '趕時間 +2', '放不下：第一個＋還有幾個');
  assert.equal(nodeText(['In a hurry', 'With elders'], ', '), 'In a hurry +1');
  assert.deepEqual(languageNames(['en', 'zh-TW'], 'en'), ['English', 'Chinese (Taiwan)']);
  assert.match(languageNames(['ja'], null)[0], /日文|日語/);
  assert.deepEqual(languageNames(['not a tag'], 'en'), ['not a tag'], '不認得照原樣');
});

test('入口與外殼：路由、設定頁連結、離線清單、樣式；動畫可關、有等義文字', async () => {
  assert.match(await read('public/js/app.js'), /\[\/\^\\\/ai\$\/, ai\]/);
  assert.match(await read('public/js/pages/settings.js'), /href="#\/ai"/);
  const sw = await read('public/sw.js');
  for (const f of ['/css/ai.css', '/js/pages/ai.js', '/js/pages/ai-i18n.js', '/js/ai-info.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.match(await read('public/index.html'), /href="\/css\/ai\.css"/);
  const css = await read('public/css/ai.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.ai-hero \*[^}]*animation: none !important/);
  assert.match(css, /html\.lite-motion \.ai-hero \* \{ animation: none !important/);
  assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/, '一律淺色');
  const page = await read('public/js/pages/ai.js');
  assert.match(page, /class="ai-stage" id="ai-stage" aria-hidden="true"/, '動畫對讀屏隱藏');
  assert.match(page, /id="ai-live" role="status"/, '同樣的資訊用文字說');
  // 試判斷（2026-11-22）：第 2～4 段才用網路——agent（只送句子）與建議驗證；不取定位、不送常用地點
  assert.deepEqual([...page.matchAll(/fetch\(`([^`]+)`/g)].map((m) => m[1]), ['${API_BASE}/api/v1/suggest/check']);
  assert.doesNotMatch(page, /browserLocation|getCurrentPosition|loadPlaces|savedPlaces|habit/, '試判斷不取定位、不送常用地點與習慣');
});

test('原生外掛：status 回報系統查得到的欄位、judge 回耗時（兩個平台）', async () => {
  const java = await read('android/app/src/main/java/tw/abang/app/AbangEdgeAIPlugin.java');
  for (const k of ['featureStatus', 'modelName', 'tokenLimit', 'downloadTotalBytes', 'downloadedBytes', 'aicoreVersion', 'osVersion', 'device']) assert.ok(java.includes(`"${k}"`), `Android ${k}`);
  assert.match(java, /getBaseModelName\(\)/);
  assert.match(java, /getTokenLimit\(\)/);
  assert.match(java, /ret\.put\("ms", ms\)/);
  assert.match(java, /infoExec\.execute\(\(\) -> call\.resolve\(describe\(o, s\)\)\)/, '查模型資訊不佔 judge 的執行緒');
  assert.match(java, /infoTried = true;/, '查不到也只查一次');
  assert.match(await read('android/app/src/main/AndroidManifest.xml'), /<queries>\s*<package android:name="com\.google\.android\.aicore" \/>\s*<\/queries>/);
  const swift = await read('ios/App/App/AbangEdgeAIPlugin.swift');
  for (const k of ['availability', 'languages', 'contextSize', 'osVersion']) assert.ok(swift.includes(`"${k}"`), `iOS ${k}`);
  assert.match(swift, /supportedLanguages/);
  assert.match(swift, /if #available\(iOS 27\.0, \*\), case \.available = model\.availability, model\.contextSize > 0/, 'iOS 26 的 contextSize 是寫死的 4096，不當系統回報');
  assert.match(swift, /"ms": ms/);
});
