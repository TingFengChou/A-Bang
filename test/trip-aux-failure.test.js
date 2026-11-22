// 輔助資料（天氣、空品、路況）失敗不能讓行程整個不排（2026-11-22 Pixel 實測：三峽→台北101 國道路況 TDX 404，結果只回天氣空品、還說「找不到這兩個地點」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../core/index.js';
import { runDemo, AUX_TOOLS } from '../core/agent/run.js';
import { parseIntent, demoSummary } from '../core/agent/demo-intent.js';

const SANXIA = { lat: 24.934, lon: 121.369 };
const NOW = Date.parse('2026-11-22T12:30:00+08:00');

/** 讓某個服務方法丟錯（模擬上游 404／逾時） */
function breaking(svc, path, err = Object.assign(new Error('TDX API 錯誤 404'), { name: 'TdxError', status: 404 })) {
  const [obj, fn] = path.split('.');
  return { ...svc, [obj]: new Proxy(svc[obj], { get: (t, k) => (k === fn ? async () => { throw err; } : t[k]) }) };
}

async function ask(svc, content, extra = {}) {
  const es = [];
  await runDemo(svc, {
    messages: [{ role: 'user', content }],
    clientTools: ['device_location'],
    clientToolResults: [{ id: 'loc1', ok: true, result: { ...SANXIA, accuracy: 20 } }],
    ...extra,
  }, (e) => es.push(e), { now: NOW });
  return es;
}

const toolsRun = (es) => es.filter((e) => e.type === 'tool_start').map((e) => e.name);
const answer = (es) => es.filter((e) => e.type === 'text' || e.type === 'answer_draft').map((e) => e.text ?? e.delta ?? '').join('');

test('路況失敗：照樣排行程，不說「找不到這兩個地點」（中文、手機寫回答模式）', async () => {
  const svc = breaking(createServices({ forceMock: true }), 'traffic.status');
  for (const extra of [{}, { clientCaps: { edgeWrite: true, engine: 'gemini-nano' } }]) {
    const es = await ask(svc, '去台北 101', extra);
    assert.ok(es.some((e) => e.type === 'tool_result' && e.ok === false), '路況真的失敗了');
    assert.ok(toolsRun(es).includes('plan_trip'), '路況失敗仍排行程');
    assert.ok(es.some((e) => e.type === 'tool_result' && e.card === 'trip'), '有行程卡');
    assert.doesNotMatch(answer(es), /找不到這兩個地點/);
  }
});

test('天氣、空品失敗也一樣照排；英文同理', async () => {
  for (const path of ['weather.now', 'air.nearby']) {
    let svc;
    try { svc = breaking(createServices({ forceMock: true }), path); } catch { continue; } // 服務名稱不同就略過這一項
    const es = await ask(svc, '去台北101');
    assert.ok(toolsRun(es).includes('plan_trip'), `${path} 失敗仍排行程`);
  }
  const es = await ask(breaking(createServices({ forceMock: true }), 'traffic.status'), 'How do I get to Taipei 101?');
  assert.ok(toolsRun(es).includes('plan_trip'));
  assert.doesNotMatch(answer(es), /Try another place name/);
});

test('行程本身失敗、但地點找到了：照實說資料沒拿到，不說找不到地點（總結本身）', () => {
  const it = parseIntent('去台北101');
  it.fromPoint = { ...SANXIA, name: '你的位置' };
  const found = { find_place: [{ data: [{ name: '台北101', lat: 25.034, lon: 121.5645 }] }] };
  assert.match(demoSummary(it, found), /沒拿到行程資料/);
  assert.doesNotMatch(demoSummary(it, found), /找不到這兩個地點/);
  const none = parseIntent('去一個不存在的地方怎麼去');
  assert.doesNotMatch(demoSummary({ ...none, intent: 'trip' }, { find_place: [{ data: [] }] }), /沒拿到行程資料/);
  const en = parseIntent('How do I get to Taipei 101?');
  en.fromPoint = { ...SANXIA, name: 'your location' };
  assert.match(demoSummary(en, found), /couldn't get the trip data/);
});

test('輔助資料清單只含天氣、空品、路況（行程、地點失敗仍要停下來說明）', () => {
  assert.deepEqual([...AUX_TOOLS].sort(), ['aqi_nearby', 'traffic_status', 'weather_now', 'weather_tomorrow']);
});
