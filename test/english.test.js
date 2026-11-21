// 英文名稱保留（M3-14，ADR-0007）：來源有 En 時輸出 *En 欄位；沒有或空白時不輸出（不捏造）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en, enField } from '../core/util.js';
import { createTransitServices } from '../core/services/transit.js';
import { createMetroServices } from '../core/services/metro.js';
import { createTdxClient } from '../core/tdx-client.js';

const Z = (zh, En) => ({ Zh_tw: zh, ...(En !== undefined && { En }) });

test('en／enField：只有非空字串才輸出', () => {
  assert.deepEqual([en(Z('台北', 'Taipei')), en(Z('台北', '  ')), en(Z('台北')), en('台北'), en(null)], ['Taipei', undefined, undefined, undefined, undefined]);
  assert.deepEqual(enField('nameEn', Z('台北', 'Taipei')), { nameEn: 'Taipei' });
  assert.deepEqual(enField('nameEn', Z('台北')), {});
});

function tdxWith(routes) {
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 86400 }));
    for (const [re, body] of routes) if (re.test(u)) return new Response(JSON.stringify(body));
    return new Response('[]');
  };
  return createTdxClient({ clientId: 'a', clientSecret: 'b', fetchImpl });
}

test('公車、YouBike、高鐵車站：有英文就帶 *En，沒有就不帶', async () => {
  const P = { PositionLat: 25.0478, PositionLon: 121.517 };
  const tdx = tdxWith([
    [/Bus\/Station\/NearBy/, [{ StationID: 'S1', StationUID: 'TPES1', StationName: Z('臺北車站', 'Taipei Main Station'), StationPosition: P, Stops: [{ RouteName: Z('307', '307') }] },
      { StationID: 'S2', StationUID: 'TPES2', StationName: Z('無英文站'), StationPosition: P, Stops: [] }]],
    [/Bike\/Station\/NearBy/, [{ StationUID: 'B1', StationName: Z('YouBike2.0_捷運台北車站', 'YouBike2.0_MRT Taipei Main Sta.'), StationPosition: P, ServiceType: 2 }]],
    [/Bike\/Availability/, [{ StationUID: 'B1', AvailableRentBikes: 3, AvailableReturnBikes: 5, ServiceStatus: 1 }]],
    [/THSR\/Station/, [{ StationID: '1000', StationName: Z('台北', 'Taipei') }]],
  ]);
  const { bus, bike, rail } = createTransitServices(tdx);
  const st = await bus.nearbyStations({ lat: 25.0478, lon: 121.517 });
  assert.equal(st.find((s) => s.stationId === 'S1').nameEn, 'Taipei Main Station');
  assert.equal('nameEn' in st.find((s) => s.stationId === 'S2'), false);
  const b = await bike.nearby({ lat: 25.0478, lon: 121.517 });
  assert.equal(b[0].nameEn, 'MRT Taipei Main Sta.');
  assert.deepEqual(await rail.thsrStations(), [{ id: '1000', name: '台北', nameEn: 'Taipei' }]);
});

test('捷運：車站、目的地、路線英文', async () => {
  const tdx = tdxWith([
    [/Metro\/Station\/TRTC/, [{ StationID: 'BL12', StationName: Z('台北車站', 'Taipei Main Station'), StationPosition: { PositionLat: 25.04, PositionLon: 121.51 } }]],
    [/Metro\/LiveBoard\/TRTC/, [{ LineID: 'BL', LineName: Z('板南線', 'Bannan Line'), StationID: 'BL12', DestinationStationName: Z('頂埔', 'Dingpu'), EstimateTime: 3 }]],
  ]);
  const { metro } = createMetroServices(tdx);
  const r = await metro.liveBoard({ system: 'TRTC', station: '台北車站' });
  assert.equal(r.stationEn, 'Taipei Main Station');
  assert.deepEqual([r.trains[0].lineEn, r.trains[0].destinationEn], ['Bannan Line', 'Dingpu']);
});

test('S12g 更多英文地名：觀光客常去的景點、夜市、車站、機場、醫院', async () => {
  const { parseIntent: pi } = await import('../core/agent/demo-intent.js');
  const { readFile } = await import('node:fs/promises');
  const to = (t) => pi(t).to;
  assert.equal(to('How do I get from Ximen to Taroko?'), '太魯閣國家公園遊客中心');
  assert.equal(to('How to get to Pier-2 from Zuoying'), '駁二藝術特區');
  assert.equal(to("How do I get to Tamsui Fisherman's Wharf?"), '淡水漁人碼頭', '長的地名優先');
  assert.equal(to('Take me to the Taipei Fine Arts Museum'), '臺北市立美術館');
  assert.equal(to('How do I go to the Grand Hotel from 228 Park?'), '圓山大飯店');
  assert.deepEqual(pi('Is it raining at Kenting?').places, ['墾丁大街']);
  const L = JSON.parse(await readFile(new URL('../core/data/landmarks.json', import.meta.url), 'utf8'));
  const items = Array.isArray(L) ? L : L.items;
  assert.ok(items.filter((x) => x.en).length >= 140, '有英文名稱的地標');
  const seen = new Map();
  for (const x of items) for (const a of x.aliases.filter((k) => /[A-Za-z]/.test(k))) {
    assert.ok(!seen.has(a.toLowerCase()) || seen.get(a.toLowerCase()) === x.name, `英文別名重複：${a}（${seen.get(a.toLowerCase())}／${x.name}）`);
    seen.set(a.toLowerCase(), x.name);
  }
});
