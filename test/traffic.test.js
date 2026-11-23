// 路況（M3-06）：走廊判斷、整體 level、TDX 形狀 fixture、示範情境、tool
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficServices, onCorridor, summarize } from '../core/services/traffic.js';
import { createTdxClient } from '../core/tdx-client.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const TPE = { lat: 25.0478, lon: 121.517 };
const HSZ = { lat: 24.8016, lon: 120.9716 }; // 台北 → 新竹，直線約 60 公里，往西南
// 沿起訖直線取一小段：t 從 a 到 b
const along = (a, b) => [a, b].map((t) => [TPE.lat + (HSZ.lat - TPE.lat) * t, TPE.lon + (HSZ.lon - TPE.lon) * t]);
const wkt = (pts) => `LINESTRING(${pts.map(([la, lo]) => `${lo} ${la}`).join(', ')})`;

test('onCorridor：沿途且同向才算；反向、偏離、超出起訖都不算', () => {
  assert.equal(onCorridor(along(0.2, 0.3), TPE, HSZ), true);
  assert.equal(onCorridor(along(0.3, 0.2), TPE, HSZ), false); // 反方向車道
  assert.equal(onCorridor(along(1.3, 1.4), TPE, HSZ), false); // 超過終點
  const off = along(0.4, 0.5).map(([la, lo]) => [la + 0.1, lo]); // 往北偏 11 公里
  assert.equal(onCorridor(off, TPE, HSZ), false);
  assert.equal(onCorridor([], TPE, HSZ), false);
});

test('summarize：壅塞累計 5 公里就算 jam，不被順暢路段平均掉；延誤只算慢的路段', () => {
  const fast = { lengthKm: 40, speedKmh: 95, limitKmh: 100 };
  assert.deepEqual(summarize([fast, fast]), { level: 'smooth', delayMin: 0 });
  assert.deepEqual(summarize([fast, fast, { lengthKm: 6, speedKmh: 30, limitKmh: 100 }]), { level: 'jam', delayMin: 8 });
  assert.equal(summarize([fast, { lengthKm: 10, speedKmh: 60, limitKmh: 100 }]).level, 'slow');
  assert.equal(summarize([fast, { lengthKm: 2, speedKmh: 20, limitKmh: 100 }]).level, 'smooth'); // 短暫壅塞不影響
  assert.deepEqual(summarize([{ lengthKm: 5, speedKmh: null, limitKmh: 100 }]), { level: null, delayMin: null });
});

function liveSvc({ news = 'ok', live } = {}) {
  const fixtures = {
    SectionShape: { SectionShapes: [
      { SectionID: 'S2', Geometry: wkt(along(0.5, 0.7)) },
      { SectionID: 'S1', Geometry: wkt(along(0.1, 0.3)) },
      { SectionID: 'S1R', Geometry: wkt(along(0.3, 0.1)) },      // 反向
      { SectionID: 'X', Geometry: 'POINT(121 25)' },              // 格式不明
    ] },
    Section: { Sections: [
      { SectionID: 'S1', SectionName: '林口－桃園', RoadName: '國道1號', RoadDirection: 'S', SpeedLimit: 100, SectionLength: 12 },
      { SectionID: 'S2', RoadName: '國道1號', RoadDirection: 'S' },
    ] },
    Live: live ?? { LiveTraffics: [
      { SectionID: 'S1', TravelSpeed: 25, CongestionLevel: '3', DataCollectTime: '2026-11-17T21:00:00+08:00' },
      { SectionID: 'S2', TravelSpeed: 90 },
      { SectionID: 'S1R', TravelSpeed: 100 },
    ] },
    // RoadEvent/LiveEvent（2026-11-23 實測格式）：位置是 POINT（經度 緯度），方向在 Location.FreeExpressHighway.Direction
    Event: { LiveEvents: [
      { Description: '國道一號 南向 40K+000 事故', Positions: `POINT(${along(0.2, 0.2)[0][1]} ${along(0.2, 0.2)[0][0]})`, Location: { FreeExpressHighway: { Direction: '南向' } }, PublishTime: '2026-11-17T20:50:00+08:00' },
      { Description: '國道一號 北向 40K+000 施工', Positions: `POINT(${along(0.2, 0.2)[0][1]} ${along(0.2, 0.2)[0][0]})`, Location: { FreeExpressHighway: { Direction: '北向' } } }, // 對向
      { Description: '國道三號 南向 施工', Positions: 'POINT(121.3 24.5)' }, // 不在沿途
    ] },
  };
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
    if (u.includes('/RoadEvent/LiveEvent/Freeway')) return news === 'ok' ? new Response(JSON.stringify(fixtures.Event)) : new Response('x', { status: 500 });
    for (const k of ['SectionShape', 'Section', 'Live']) {
      if (u.includes(`/Road/Traffic/${k}/Freeway`)) return new Response(JSON.stringify(fixtures[k]));
    }
    return new Response('not found', { status: 404 });
  };
  return createTrafficServices(createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl })).traffic;
}

test('status：只取沿途同向路段、依行進順序、合併名稱與速限、事件依道路篩選', async () => {
  const r = await liveSvc().status({ from: { ...TPE }, to: { ...HSZ } });
  assert.equal(r.covered, true);
  assert.deepEqual(r.segments.map((s) => [s.id, s.name, s.speedKmh, s.limitKmh]), [
    ['S1', '林口－桃園', 25, 100],
    ['S2', '國道1號 S', 90, 100],
  ]);
  assert.equal(r.segments[0].lengthKm, 12);
  assert.ok(r.segments[1].lengthKm > 10 && r.segments[1].lengthKm < 14); // 由形狀估
  assert.equal(r.level, 'jam');
  assert.equal(r.delayMin, 22); // 12 km：25 km/h 要 28.8 分，速限 7.2 分
  assert.deepEqual(r.events.map((e) => e.title), ['國道一號 南向 40K+000 事故']);
  assert.equal(r.updatedAt, '2026-11-17T21:00:00+08:00');
});

test('status：事件端點失敗不影響；沒有車速資料時 level 為 null；短程不查', async () => {
  const r = await liveSvc({ news: 'fail' }).status({ from: { ...TPE }, to: { ...HSZ } });
  assert.equal(r.level, 'jam');
  assert.deepEqual(r.events, []);
  const none = await liveSvc({ live: { LiveTraffics: [] } }).status({ from: { ...TPE }, to: { ...HSZ } });
  assert.deepEqual([none.covered, none.level, none.delayMin], [true, null, null]);
  const near = await liveSvc().status({ from: { ...TPE }, to: { lat: 25.034, lon: 121.5645 } });
  assert.deepEqual([near.covered, near.level, near.segments.length], [false, null, 0]);
  await assert.rejects(liveSvc().status({ from: { lat: 0, lon: 0 }, to: { ...HSZ } }), /台灣範圍/);
});

test('示範情境：預設順暢、jam 有壅塞與事件', async () => {
  const smooth = createServices({ forceMock: true });
  const s = await smooth.traffic.status({ from: { ...TPE }, to: { lat: 22.6394, lon: 120.3025 } });
  assert.deepEqual([s.level, s.delayMin, s.events.length], ['smooth', 0, 0]);
  const jam = createServices({ forceMock: true, demo: { traffic: 'jam' } });
  const j = await jam.traffic.status({ from: { ...TPE }, to: { lat: 22.6394, lon: 120.3025 } });
  assert.equal(j.level, 'jam');
  assert.ok(j.delayMin > 0 && j.events.length === 1);
});

test('traffic_status tool：地名與座標皆可、speak、找不到地名', async () => {
  const svc = createServices({ forceMock: true, demo: { traffic: 'jam' } });
  const r = await callTool(svc, 'traffic_status', { from: '台北車站', to: { lat: 22.6394, lon: 120.3025 } });
  assert.deepEqual([r.data.from, typeof r.data.to], ['臺北車站', 'string']);
  assert.equal(r.data.fromPoint.name, '臺北車站');
  assert.deepEqual([r.data.toPoint.lat, r.data.toPoint.lon], [22.6394, 120.3025]);
  assert.match(r.speak, /^沿途國道塞車中，預估多花 \d+ 分鐘（國道1號 事故/);
  assert.match(r.text, /^臺北車站 → 22\.6394, 120\.3025（直線 \d+\.\d 公里）：國道塞車中/);
  const near = await callTool(svc, 'traffic_status', { from: '台北車站', to: '台北101' });
  assert.equal(near.speak, '起訖很近，不需要看國道路況。');
  await assert.rejects(callTool(svc, 'traffic_status', { from: '不存在的地方xyz', to: '台北101' }), /找不到「不存在的地方xyz」/);
});
