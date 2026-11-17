// 導航連結與出發時機（M3-01）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navLinks, walkMinutes, leaveAt, withNav } from '../core/nav.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { distanceM } from '../core/util.js';

test('navLinks 產生 Google／Apple 步行導航連結', () => {
  const n = navLinks(25.0478123456, 121.517);
  assert.equal(n.google, 'https://www.google.com/maps/dir/?api=1&destination=25.047812%2C121.517&travelmode=walking');
  assert.equal(n.apple, 'https://maps.apple.com/?daddr=25.047812%2C121.517&dirflg=w');
});

test('navLinks 支援其他交通方式，未知方式退回步行', () => {
  assert.match(navLinks(25, 121, 'transit').google, /travelmode=transit$/);
  assert.match(navLinks(25, 121, 'transit').apple, /dirflg=r$/);
  assert.match(navLinks(25, 121, 'driving').apple, /dirflg=d$/);
  assert.match(navLinks(25, 121, 'bicycling').google, /travelmode=bicycling$/);
  assert.match(navLinks(25, 121, 'rocket').google, /travelmode=walking$/);
});

test('navLinks 座標無效時回傳 null', () => {
  assert.equal(navLinks(null, 121), null);
  assert.equal(navLinks(25, undefined), null);
  assert.equal(navLinks(NaN, 121), null);
  assert.equal(navLinks(95, 121), null);
});

test('walkMinutes：直線 × 1.3 ÷ 4.5 km/h，無條件進位', () => {
  assert.equal(walkMinutes(0), 1);
  assert.equal(walkMinutes(75), 2);   // 97.5 m ÷ 75 m/分 = 1.3 → 2
  assert.equal(walkMinutes(400), 7);  // 520 ÷ 75 = 6.93 → 7
  assert.equal(walkMinutes(-1), null);
  assert.equal(walkMinutes(undefined), null);
});

test('leaveAt：到站時間 − 步行時間', () => {
  const now = Date.parse('2026-12-01T08:00:00+08:00');
  const ok = leaveAt({ etaSec: 600, distanceM: 400, now });   // 走 7 分，車 10 分後到
  assert.equal(ok.walkMin, 7);
  assert.equal(ok.leaveInSec, 180);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.leaveAt, '2026-12-01T00:03:00.000Z');
  assert.equal(ok.text, '走過去要 7 分，3 分鐘後出門');

  assert.equal(leaveAt({ etaSec: 450, distanceM: 400, now }).status, 'hurry');
  const missed = leaveAt({ etaSec: 120, distanceM: 400, now });
  assert.equal(missed.status, 'missed');
  assert.match(missed.text, /趕不上/);
  assert.equal(leaveAt({ etaSec: null, distanceM: 400 }), null);
});

test('withNav 不修改原物件', () => {
  const src = [{ name: 'A', lat: 25, lon: 121 }, { name: 'B' }];
  const out = withNav(src);
  assert.equal(src[0].nav, undefined);
  assert.ok(out[0].nav.google.includes('25%2C121'));
  assert.equal(out[1].nav, null);
});

test('bus_nearby_stations、youbike_nearby 每筆附 nav', async () => {
  const svc = createServices({ forceMock: true });
  for (const name of ['bus_nearby_stations', 'youbike_nearby']) {
    const r = await callTool(svc, name, { lat: 25.0478, lon: 121.517 });
    assert.ok(r.data.length > 0, name);
    for (const s of r.data) {
      assert.ok(s.nav, `${name}: ${s.name}`);
      assert.ok(s.nav.google.includes(encodeURIComponent(`${Number(s.lat.toFixed(6))},${Number(s.lon.toFixed(6))}`)), name);
      assert.match(s.nav.apple, /^https:\/\/maps\.apple\.com\/\?daddr=/);
    }
  }
});

test('bus_route_eta 站點附 nav、示範模式有 shape', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'bus_route_eta', { city: 'Taipei', routeName: '307' });
  for (const d of r.data.directions) {
    for (const s of d.stops) {
      assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon), s.stopName);
      assert.ok(s.nav.google.includes(encodeURIComponent(`${Number(s.lat.toFixed(6))},${Number(s.lon.toFixed(6))}`)), s.stopName);
    }
  }
  // 返程站序與去程相反，座標也跟著反轉
  const [go, back] = r.data.directions;
  assert.deepEqual([go.stops[0].lat, go.stops[0].lon], [back.stops.at(-1).lat, back.stops.at(-1).lon]);
  // 形狀從去程第一站到最後一站，點數比站多
  assert.ok(r.data.shape.length > go.stops.length);
  assert.deepEqual(r.data.shape[0], [go.stops[0].lat, go.stops[0].lon]);
  assert.deepEqual(r.data.shape.at(-1), [go.stops.at(-1).lat, go.stops.at(-1).lon]);
  // 站距約 350 公尺：第一站到第二站 250～450 公尺
  const dm = distanceM(go.stops[0].lat, go.stops[0].lon, go.stops[1].lat, go.stops[1].lon);
  assert.ok(dm > 250 && dm < 450, String(dm));
});

test('toHHMM：先整體四捨五入再換算（59.6 分 → 01:00）', async () => {
  const { toHHMM } = await import('../core/util.js');
  assert.deepEqual([toHHMM(59.6), toHHMM(119.8), toHHMM(1445), toHHMM(0)], ['01:00', '02:00', '00:05', '00:00']);
});
