// 手機上的小模型（E3）：分類器純函式（伺服器與手機共用）、參數檔同步、伺服器怎麼用手機送來的小模型判斷、檔案白名單
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { trainClassifier, classifyVector, roundParams, validParams, embedText, CLASSIFY_STATES, EMBED_MODEL, EMBED_DTYPE, EMBED_FILES } from '../core/judge-classify.js';
import { createJudge, JUDGE_INTENTS, JUDGE_STATES, EMBED_ENGINE } from '../core/agent/judge.js';
import { trainHash } from '../scripts/build-edge-classifier.js';
import { edgeModelFile, EDGE_VENDOR, ORT_WASM } from '../server/edge-model.js';
import { validateRequest } from '../core/agent/run.js';

const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };

test('狀態清單與判斷層相同', () => {
  assert.deepEqual(CLASSIFY_STATES, JUDGE_STATES);
});

test('embedText：e5 查詢格式；有前文帶最後一句', () => {
  assert.equal(embedText({ text: '307 到哪' }), 'query: 307 到哪');
  assert.equal(embedText({ text: '那公車呢', history: ['a', '從板橋去101'] }), 'query: 前文：從板橋去101；這句：那公車呢');
});

test('trainClassifier＋classifyVector：類別中心、信心、狀態', () => {
  const items = [{ intent: 'weather', states: [] }, { intent: 'weather', states: ['rain'] }, { intent: 'trip', states: ['rush'] }, { intent: 'trip', states: ['rush'] }];
  const X = [unit([1, 0.1, 0]), unit([1, 0, 0.2]), unit([0, 1, 0]), unit([0.1, 1, 0])];
  const p = trainClassifier(X, items, { states: ['rush', 'rain'] });
  const a = classifyVector(unit([0.05, 1, 0]), p);
  assert.equal(a.intent, 'trip');
  assert.ok(a.confidence > 0.99);
  assert.deepEqual(a.states, ['rush']);
  assert.equal(classifyVector(unit([1, 0.05, 0]), p).intent, 'weather');
  // 取整（存檔）後判斷相同
  const r = roundParams(p);
  for (const x of X) assert.deepEqual(classifyVector(x, r).intent, classifyVector(x, p).intent);
});

test('judge-classifier.json 與 judge-train.json 同步（改了訓練範例要跑 npm run build:edge-classifier）', async () => {
  const raw = await readFile(new URL('../core/data/judge-train.json', import.meta.url));
  const p = JSON.parse(await readFile(new URL('../core/data/judge-classifier.json', import.meta.url), 'utf8'));
  assert.equal(p.train, trainHash(raw), 'core/data/judge-train.json 改過了：請執行 npm run build:edge-classifier 重新產生 core/data/judge-classifier.json');
  assert.equal(p.model, EMBED_MODEL);
  assert.equal(p.dtype, EMBED_DTYPE);
  assert.ok(validParams(p, { intents: Object.keys(JUDGE_INTENTS), dim: p.dim }));
  const trained = new Set(JSON.parse(raw).items.map((it) => it.intent));
  assert.deepEqual(Object.keys(p.intents).sort(), [...trained].sort());
  assert.deepEqual(Object.keys(p.states).sort(), [...JUDGE_STATES].sort());
});

test('validParams：形狀不對就不用', () => {
  const v = new Array(384).fill(0.01);
  const ok = { tau: 0.005, intents: { trip: v }, states: { rush: { w: v, b: 0 } } };
  assert.ok(validParams(ok));
  assert.ok(!validParams({ ...ok, tau: 0 }));
  assert.ok(!validParams({ ...ok, intents: { trip: v.slice(1) } }));
  assert.ok(!validParams({ ...ok, intents: { trip: [...v.slice(1), NaN] } }));
  assert.ok(!validParams({ ...ok, states: { hack: { w: v, b: 0 } } }));
  assert.ok(!validParams({ ...ok, intents: { nope: v } }, { intents: ['trip'] }));
  assert.ok(!validParams(null));
});

// ───── 伺服器怎麼用手機送來的小模型判斷（deviceJudge.engine = e5）─────
const e5 = (intent, confidence, states = []) => ({ intent, states, engine: EMBED_ENGINE, confidence });

test('伺服器沒有嵌入分類器：小模型當作 A（有把握用它，標 embed＋e5）', async () => {
  const j = createJudge();
  const r = await j('嗯那個', [], { device: e5('weather', 0.93) });
  assert.equal(r.intent, 'weather');
  assert.equal(r.source, 'embed');
  assert.equal(r.engine, 'e5');
  assert.equal(r.confidence, 0.93);
});

test('小模型沒把握：照 A 的規則（規則有明確意圖用規則；都聽不懂、信心低當 unknown），不當作模型（B）', async () => {
  const j = createJudge();
  const ruled = await j('明天台北會下雨嗎', [], { device: e5('trip', 0.6) });
  assert.equal(ruled.intent, 'weather');
  assert.equal(ruled.source, 'rules');
  const low = await j('嗯那個', [], { device: e5('trip', 0.3) });
  assert.equal(low.intent, 'unknown');
  // 狀態只收規則的（小模型＝A，沒有 B 時 A 的狀態不單獨採用）
  const st = await j('嗯那個', [], { device: e5('trip', 0.95, ['rush', 'luggage']) });
  assert.deepEqual(st.states, []);
});

test('伺服器有自己的嵌入分類器：不用手機的小模型（同一個模型，以伺服器為準）', async () => {
  const embed = async () => ({ intent: 'aqi', confidence: 0.95, states: [] });
  const r = await createJudge({ embed })('嗯那個', [], { device: e5('weather', 0.99) });
  assert.equal(r.intent, 'aqi');
  assert.equal(r.engine, undefined);
});

test('有伺服器模型（B）時：小模型不取代 B，B 照常判斷', async () => {
  let asked = 0;
  const llm = async () => { asked++; return { intent: 'trip', states: ['rush'] }; };
  const r = await createJudge({ llm })('嗯那個', [], { device: e5('weather', 0.4, ['rush']) });
  assert.equal(asked, 1);
  assert.equal(r.intent, 'trip');
  assert.equal(r.source, 'llm');
  assert.deepEqual(r.states, ['rush']); // A（小模型）∩ B
});

test('請求驗證：小模型一定要帶 0～1 的信心；系統模型不帶', () => {
  const m = [{ role: 'user', content: '307 到哪' }];
  assert.doesNotThrow(() => validateRequest({ messages: m, deviceJudge: e5('bus_route', 0.8) }));
  assert.throws(() => validateRequest({ messages: m, deviceJudge: { intent: 'bus_route', states: [], engine: 'e5' } }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ messages: m, deviceJudge: e5('bus_route', 1.5) }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ messages: m, deviceJudge: { intent: 'bus_route', states: [], engine: 'apple', confidence: 0.9 } }), /請求格式錯誤/);
  assert.throws(() => validateRequest({ messages: m, deviceJudge: { ...e5('bus_route', 0.8), engine: 'gpt' } }), /請求格式錯誤/);
  // 小模型不能寫回答
  assert.throws(() => validateRequest({ messages: m, clientCaps: { edgeWrite: true, engine: 'e5' } }), /請求格式錯誤/);
});

// ───── 檔案白名單（server/edge-model.js）─────
test('edgeModelFile：只開放執行環境與模型的四個檔，防目錄穿越', () => {
  const dir = '/models';
  assert.equal(edgeModelFile(ORT_WASM, { modelDir: dir }).type, 'application/wasm');
  for (const f of EMBED_FILES) {
    const hit = edgeModelFile(`${EMBED_MODEL}/${f}`, { modelDir: dir });
    assert.equal(hit.file, `${dir}/${EMBED_MODEL}/${f}`);
    assert.ok(hit.type);
  }
  for (const bad of [`${EMBED_MODEL}/../../../etc/passwd`, `${EMBED_MODEL}/onnx/model.onnx`, `${EMBED_MODEL}/./config.json`, 'Xenova/other/config.json', 'package.json', '../package.json', `${EMBED_MODEL}/`, 'ort-wasm-simd-threaded.wasm']) {
    assert.equal(edgeModelFile(bad, { modelDir: dir }), null, bad);
  }
  assert.deepEqual(Object.keys(EDGE_VENDOR).sort(), ['ort-wasm-simd-threaded.asyncify.mjs', 'transformers.min.js']);
});
