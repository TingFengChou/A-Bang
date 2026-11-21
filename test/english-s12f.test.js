// S12f：英文提問時，資料裡的中文也換英文（地名、站名、路線名維持中文）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripSignals } from '../core/agent/events.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';
import { etaText } from '../public/ui/cards/cards/bus-route.js';
import { optName } from '../public/ui/cards/cards/trip.js';
import { etaLabel } from '../public/ui/cards/countdown.js';
import { tFor, withLocale } from '../public/ui/cards/i18n/index.js';

const en = tFor('en');

test('決策圖資料膠囊：英文那一輪用 km、City、Clear、Rain', () => {
  const trip = { straightKm: 5, weather: { raining: false, pop3h: 10, summary: '晴，24°C' }, air: { aqi: 58 }, traffic: { covered: false } };
  assert.deepEqual(tripSignals(trip), { 地點: '5 公里', 天氣: '24°C', 空品: 'AQI 58', 路況: '市區' });
  assert.deepEqual(tripSignals(trip, 'en'), { 地點: '5 km', 天氣: '24°C', 空品: 'AQI 58', 路況: 'Local roads' });
  assert.equal(tripSignals({ weather: { raining: true }, traffic: { covered: true, level: 'jam', delayMin: 12 } }, 'en').路況, '+12 min');
  assert.equal(tripSignals({ weather: { raining: true } }, 'en').天氣, 'Rain');
});

test('行程分段：每段都有英文說明（detailEn），中文照舊', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'plan_trip', { from: '臺北車站', to: '台北101', departAt: '2026-11-21T10:00' });
  const legs = r.data.options.flatMap((o) => o.legs);
  assert.ok(legs.length > 3);
  for (const l of legs) {
    assert.ok(l.detail, '中文說明');
    assert.ok(l.detailEn && !/步行|分（估算）|坐 \d+ 站|車程/.test(l.detailEn), `英文說明：${l.detailEn}`);
  }
});

test('公車到站英文：分鐘、進站、未發車；中文用資料原文', () => {
  withLocale('en', () => {
    assert.equal(etaText({ status: 0, etaSec: 300, statusText: '5 分' }, en, 'en'), '5 min');
    assert.equal(etaText({ status: 0, etaSec: 150, statusText: '即將進站' }, en, 'en'), etaLabel(150), '跟每秒倒數同一套規則（一秒後不換字）');
    assert.equal(etaText({ status: 0, etaSec: 40, statusText: '進站中' }, en, 'en'), etaLabel(40));
  });
  assert.equal(etaText({ status: 1, etaSec: null, statusText: '尚未發車' }, en, 'en'), 'Not departed yet');
  assert.equal(etaText({ status: 0, etaSec: 300, statusText: '5 分' }, en, null), '5 分');
});

test('行程方案名稱英文：公車號與捷運線名留著', () => {
  assert.equal(optName({ role: 'bus', name: '公車 棕9' }, en, 'en'), 'Bus 棕9');
  assert.equal(optName({ role: 'metro', name: '捷運 淡水信義線' }, en, 'en'), 'MRT 淡水信義線');
  assert.equal(optName({ role: 'ridehail', name: '叫車（Uber）' }, en, 'en'), 'Taxi (Uber)');
  assert.equal(optName({ role: 'intercity', name: '國道客運 1610' }, en, 'en'), 'Coach 1610');
  assert.equal(optName({ role: 'metro', name: '捷運（淡水信義線→板南線）' }, en, 'en'), 'MRT (淡水信義線→板南線)');
  assert.equal(optName({ role: 'walk', name: '步行' }, en, null), '步行');
});
