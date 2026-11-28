// 手機上的小模型（E3）的前端：結果整理、伺服器有沒有採用、設定頁那一列
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmbed, judgeFromDevice, JUDGE_ENGINES, EDGE_ENGINES, EDGE_ENGINE_NAME } from '../public/js/edge-judge.js';
import { embedRowView, EMBED_APPROX_MB } from '../public/js/edge-embed-ui.js';
import { EMBED_ENGINE, embedSupported, embedState } from '../public/js/edge-embed.js';
import { embedUrls, ORT_WASM } from '../public/js/edge-embed-files.js';
import { DEVICE_JUDGE_ENGINES } from '../core/agent/judge.js';
import { deviceLine } from '../public/js/agent/thinking.js';

test('引擎清單與伺服器相同；小模型不在能寫回答的清單', () => {
  assert.deepEqual(JUDGE_ENGINES, DEVICE_JUDGE_ENGINES);
  assert.ok(!EDGE_ENGINES.includes(EMBED_ENGINE));
  assert.equal(EDGE_ENGINE_NAME.e5, '小模型');
});

test('normalizeEmbed：意圖要對、信心 0～1（取三位）、狀態只留認得的', () => {
  assert.deepEqual(normalizeEmbed({ intent: 'trip', confidence: 0.98765, states: ['rush', 'rush', 'hack'], ms: 20 }), { intent: 'trip', states: ['rush'], engine: 'e5', confidence: 0.988 });
  assert.equal(normalizeEmbed({ intent: 'hack', confidence: 0.9, states: [] }), null);
  assert.equal(normalizeEmbed({ intent: 'trip', confidence: 1.2, states: [] }), null);
  assert.equal(normalizeEmbed({ intent: 'trip', confidence: NaN, states: [] }), null);
  assert.equal(normalizeEmbed(null), null);
});

test('judgeFromDevice：系統模型是 device；小模型被當作嵌入分類器（embed＋e5）也算', () => {
  assert.ok(judgeFromDevice({ source: 'device', engine: 'apple' }));
  assert.ok(judgeFromDevice({ source: 'embed', engine: 'e5' }));
  assert.ok(!judgeFromDevice({ source: 'embed' }));
  assert.ok(!judgeFromDevice({ source: 'rules', engine: 'e5' }));
  assert.ok(!judgeFromDevice(null));
});

test('回答上方那一行：小模型被採用／沒被採用', () => {
  assert.equal(deviceLine({ sent: { engine: 'e5' }, judge: { source: 'embed', engine: 'e5' } }), '阿幫先在手機上用小模型聽懂您要做什麼。');
  assert.equal(deviceLine({ sent: { engine: 'e5' }, judge: { source: 'embed' } }), '手機上的小模型先聽了一遍；這一輪以伺服器的判斷為準。');
  assert.equal(deviceLine({ sent: { engine: 'e5' }, judge: { source: 'embed', engine: 'e5' } }, 'en'), "Abang first worked out what you want on your phone with Abang's small model.");
  assert.equal(deviceLine({ sent: { engine: 'apple' }, judge: { source: 'device', engine: 'apple' } }), '阿幫先在手機上用 Apple Intelligence 聽懂您要做什麼。');
});

test('設定頁那一列：每個狀態的字與按鈕', () => {
  const v = (state, extra = {}) => embedRowView({ state, wanted: false, supported: true, ...extra });
  assert.equal(embedRowView({ state: 'idle', supported: false }).button, null);
  assert.deepEqual([v('idle').button, v('idle').action], ['下載', 'download']);
  assert.match(v('idle').text, new RegExp(`${EMBED_APPROX_MB} MB`));
  assert.deepEqual([v('idle', { wanted: true }).action, v('ready').action], ['delete', 'delete']);
  const d = v('downloading', { progress: { loaded: 50, total: 200 } });
  assert.deepEqual([d.pct, d.busy, d.action], [25, true, null]);
  assert.match(d.text, /25%/);
  assert.equal(v('evicted').action, 'download');
  assert.equal(v('missing').action, 'download');
  assert.equal(v('error', { wanted: true }).action, 'delete');
  assert.equal(v('error').action, 'download');
});

test('Node 沒有 Worker：視為不支援；初始狀態沒下載', () => {
  assert.equal(embedSupported(), typeof Worker === 'function' && typeof indexedDB === 'object');
  assert.deepEqual([embedState().state, embedState().wanted], ['idle', false]);
});

test('要下載的檔案：.wasm 在第一個，接著模型四個檔', () => {
  const u = embedUrls('https://abang.example.tw');
  assert.equal(u[0], `https://abang.example.tw/edge-model/${ORT_WASM}`);
  assert.equal(u.length, 5);
  assert.ok(u.every((x) => x.startsWith('https://abang.example.tw/edge-model/')));
});
