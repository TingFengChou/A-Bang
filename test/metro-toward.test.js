// 捷運往某方向（PM 第二輪：「往南港的板南線」原本被排成去南港車站的行程）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { towardTrains } from '../core/metro-route.js';
import { parseIntent } from '../core/agent/demo-intent.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const LINES = [
  { lineId: 'BL', stations: [{ name: '頂埔' }, { name: '板橋' }, { name: '西門' }, { name: '台北車站' }, { name: '忠孝復興' }, { name: '市政府' }, { name: '南港展覽館' }] },
  { lineId: 'R', stations: [{ name: '象山' }, { name: '台北101／世貿' }, { name: '台北車站' }, { name: '中山' }, { name: '北投' }, { name: '淡水' }] },
];
const TRAINS = [{ lineId: 'BL', destination: '南港展覽館' }, { lineId: 'BL', destination: '頂埔' }, { lineId: 'R', destination: '淡水' }, { lineId: 'R', destination: '象山' }];

test('towardTrains：終點或沿路的站都算；名稱寫一部分也可以；對不到回 null', () => {
  const d = (t) => towardTrains(TRAINS, LINES, '台北車站', t)?.map((x) => x.destination);
  assert.deepEqual(d('南港'), ['南港展覽館']);
  assert.deepEqual(d('市政府'), ['南港展覽館']);
  assert.deepEqual(d('板橋'), ['頂埔']);
  assert.deepEqual(d('北投'), ['淡水']);
  assert.equal(towardTrains(TRAINS, LINES, '台北車站', '台中'), null);
  assert.equal(towardTrains(TRAINS, LINES, '台北車站', '台北車站'), null, '就是這一站：不算方向');
});

test('規則：往南港的板南線、板南線往南港下一班、往淡水的捷運；問怎麼去仍是行程', () => {
  const p = (q) => parseIntent(q, { history: [] });
  for (const [q, toward] of [['往南港的板南線', '南港'], ['板南線往南港下一班', '南港'], ['往淡水的捷運還要多久', '淡水']]) {
    assert.equal(p(q).intent, 'metro', q);
    assert.equal(p(q).toward, toward, q);
  }
  assert.equal(p('坐捷運往台北車站怎麼去').intent, 'trip');
});

test('工具：只回往那個方向的車；對不到照原本全部列並記下', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'metro_live_board', { station: '台北車站', toward: '南港' });
  assert.ok(r.data.trains.length && r.data.trains.every((t) => t.destination === '南港展覽館'));
  assert.equal(r.data.toward, '南港');
  const miss = await callTool(svc, 'metro_live_board', { station: '台北車站', toward: '台中' });
  assert.equal(miss.data.towardMissed, '台中');
  assert.ok(miss.data.trains.length >= 2);
});
