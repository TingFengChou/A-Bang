// 架構第二輪 #3：「聽懂了」那句跟這一輪的解析用同一組條件（常用地點、這一輪的時間）；判斷層的規則也一樣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../core/index.js';
import { runDemo, judgeCalls } from '../core/agent/run.js';
import { getProfile } from '../core/agents/index.js';

const svc = createServices({ forceMock: true });
const saved = { 家: { name: '家', lat: 25.0418, lon: 121.5076 }, 公司: { name: '公司', lat: 25.0330, lon: 121.5654 } };
const notes = async (messages, opts = {}) => { const out = []; await runDemo(svc, { messages, savedPlaces: saved }, (e) => out.push(e), opts); return out; };

test('常用地點「從家去公司」接著「改坐公車」：聽懂了那句說沿用家 → 公司', async () => {
  const out = await notes([{ role: 'user', content: '從家去公司' }, { role: 'assistant', content: '選「捷運」。' }, { role: 'user', content: '改坐公車' }], { now: Date.parse('2026-11-28T10:00:00+08:00') });
  const heard = out.filter((e) => e.type === 'agent_note').map((e) => e.text).join('｜');
  assert.match(heard, /沿用.*家.*公司/, heard);
});

test('判斷層拿到這一輪的時間與常用地點', async () => {
  const seen = [];
  const judge = async (text, prior, opts) => { seen.push(opts); return null; };
  const jc = judgeCalls(judge, { messages: [{ role: 'user', content: '回家' }], savedPlaces: saved }, getProfile('life'), { now: 123 });
  await jc.quick();
  assert.equal(seen[0].now, 123);
  assert.deepEqual(Object.keys(seen[0].saved), ['家', '公司']);
});
