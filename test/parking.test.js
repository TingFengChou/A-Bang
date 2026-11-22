// 台北市、新北市停車場（市府開放資料）：TWD97 換算、正規化、分頁、空位、開車方案用得到（不連網，fixture 取自 2026-11-23 實際資料的幾筆）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { twd97ToWgs84 } from '../core/twd97.js';
import { distanceM } from '../core/util.js';
import { createOpenDataClient } from '../core/opendata-client.js';
import { createParkingServices } from '../core/services/parking.js';
import { normTaipeiLot, normNtpcLot, normNtpcAvail, parseTaipeiDesc, fareOf, TPE_DESC_URL, NTPC_DESC, NTPC_AVAIL } from '../core/services/parking-open.js';

const fx = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const TPE = fx('parking-taipei-desc.json');
const NTPC = fx('parking-ntpc-desc.json');
const NTPC_AV = fx('parking-ntpc-avail.json');

test('twd97ToWgs84：台北市停車場 TWD97 換算與入口座標差不到 40 公尺；0、寫錯的回 null', () => {
  const p = twd97ToWgs84(302864.7812, 2771988.958); // 台灣聯通長春停車場，入口 25.0552, 121.5242
  assert.ok(distanceM(p.lat, p.lon, 25.0552, 121.5242) < 40);
  const bq = twd97ToWgs84('296882', '2767068'); // 遠東百貨板橋店
  assert.ok(distanceM(bq.lat, bq.lon, 25.0109, 121.4645) < 60);
  assert.equal(twd97ToWgs84(0, 0), null);
  assert.equal(twd97ToWgs84('abc', 1), null);
  assert.equal(twd97ToWgs84(298296.6, 298296.6), null, '換算後不在台灣');
});

test('台北市停車場：入口座標優先、與 TWD97 差太多不收、只停機車的不收；收費只留第一句', () => {
  const lots = TPE.data.park.map(normTaipeiLot);
  assert.deepEqual(lots[0], { id: 'TPE0001', name: '台灣聯通長春停車場', lat: 25.0552, lon: 121.5242, address: '長春路17號地下1層', fare: '計時：100元/時', total: 17, live: true });
  assert.equal(lots[3], null, 'TPE1251：TWD97 與入口差 3 公里，位置不確定不收');
  assert.equal(lots[4], null, '機車停車場（小型車 0 格）不收');
  assert.ok(lots[5] && lots[5].id === 'TPE0004' && Math.abs(lots[5].lat - 25.0343) < 0.001, '沒有入口座標：用 TWD97 換算');
  assert.equal(parseTaipeiDesc(TPE).length, 4);
  assert.throws(() => parseTaipeiDesc({ data: { park: [] } }), /空/);
  assert.throws(() => parseTaipeiDesc({}), /沒有停車場清單/);
  assert.equal(fareOf('小型車：計時 30元/時(09-18)，10元/時(18-09)，全程以半小時計；月租 全日4,200元'), '小型車：計時 30元/時(09-18)，10元/時(18-09)，全程以半小時計');
  assert.equal(fareOf('小型車計時80元;小型車月租8000元;'), '小型車計時80元');
  assert.equal(fareOf(null), '');
});

test('新北市停車場：TWD97 寫反的換回來、座標 0 不收；空位 -9＝不知道', () => {
  const lots = NTPC.map(normNtpcLot);
  assert.equal(lots[0].name, '板橋車站地下停車場');
  assert.ok(distanceM(lots[0].lat, lots[0].lon, 25.0143, 121.4637) < 150);
  assert.ok(lots[3] && lots[3].lat > 25 && lots[3].lat < 25.2 && lots[3].lon > 121.4, '時上京宴：東距、北距寫反，換回來在蘆洲');
  assert.equal(lots[4], null, '新莊體育園區：座標 0,0 不收');
  const av = normNtpcAvail([...NTPC_AV, { ID: 'X', AVAILABLE: '7' }, { ID: 'Y' }]);
  assert.deepEqual([av.get('010031').available, av.get('010056').available, av.get('X').available, av.has('Y')], [34, null, 7, false]);
});

/** 假的開放資料網路：依網址回 fixture，記錄下載次數 */
function fakeNet() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === TPE_DESC_URL) return new Response(JSON.stringify(TPE));
    if (url.startsWith(NTPC_DESC)) return new Response(JSON.stringify(url.includes('page=0') ? NTPC : []));
    if (url.startsWith(NTPC_AVAIL)) return new Response(JSON.stringify(url.includes('page=0') ? NTPC_AV : []));
    return new Response('not found', { status: 404 });
  };
  return { calls, od: createOpenDataClient({ fetchImpl }) };
}

test('parking.nearby 台北市：清單用市府資料、空位走 TDX（同一個 ID）；清單快取 1 天、不打 TDX CarPark', async () => {
  const net = fakeNet();
  const tdxCalls = [];
  const tdx = { get: async (path, q) => { tdxCalls.push([path, q]); return { ParkingAvailabilities: [{ CarParkID: 'TPE0096', AvailableSpaces: 0, TotalSpaces: 1998, FullStatus: 1 }, { CarParkID: 'TPE0070', AvailableSpaces: 428, TotalSpaces: 446, FullStatus: 0 }] }; } };
  const svc = createParkingServices(tdx, { od: net.od });
  const r = await svc.parking.nearby({ lat: 25.0365, lon: 121.5645 }); // 市府附近
  assert.equal(r.city, 'Taipei');
  assert.deepEqual(r.lots.map((l) => [l.id, l.available ?? null]), [['TPE0070', 428], ['TPE0004', null], ['TPE0096', 0]], '沒空位的放最後');
  assert.ok(r.lots.every((l) => l.distanceM <= 600));
  assert.equal(tdxCalls.length, 1);
  assert.match(tdxCalls[0][0], /ParkingAvailability\/City\/Taipei$/);
  assert.match(tdxCalls[0][1].$filter, /'TPE0070'/);
  await svc.parking.nearby({ lat: 25.0365, lon: 121.5645 });
  assert.equal(net.calls.filter((u) => u === TPE_DESC_URL).length, 1, '清單只下載一次');
  const far = await svc.parking.nearby({ lat: 25.1, lon: 121.52, city: 'Taipei' });
  assert.deepEqual(far, { city: 'Taipei', lots: [], noData: true }, '600 公尺內沒有：照實說查不到');
});

test('parking.nearby 新北市：清單與空位都用新北開放資料（分頁到不滿一頁）；空位壞了照列停車場', async () => {
  const net = fakeNet();
  const tdx = { get: async () => { throw new Error('不該打 TDX'); } };
  const svc = createParkingServices(tdx, { od: net.od });
  const r = await svc.parking.nearby({ lat: 25.0143, lon: 121.4637 }); // 板橋車站
  assert.equal(r.city, 'NewTaipei');
  assert.deepEqual(r.lots.map((l) => [l.name, l.available ?? null]), [['板橋車站地下停車場', 34], ['市民廣場地下停車場', 473], ['遠東百貨停車場', null]]);
  assert.equal(r.lots[0].fare, '小型車計時80元');
  assert.equal(net.calls.filter((u) => u.startsWith(NTPC_DESC)).length, 1, '第一頁不滿 1000 筆就不抓下一頁');

  const broken = createOpenDataClient({ fetchImpl: async (url) => (url.startsWith(NTPC_AVAIL) ? new Response('x', { status: 500 }) : new Response(JSON.stringify(NTPC))) });
  const r2 = await createParkingServices(tdx, { od: broken }).parking.nearby({ lat: 25.0143, lon: 121.4637 });
  assert.equal(r2.lots.length, 3);
  assert.ok(r2.lots.every((l) => l.available === undefined));
});

test('parking.nearby：清單下載失敗就丟錯（開車方案照列估算）；沒有 od 時台北照舊走 TDX', async () => {
  const bad = createOpenDataClient({ fetchImpl: async () => new Response('x', { status: 503 }) });
  await assert.rejects(createParkingServices({ get: async () => ({}) }, { od: bad }).parking.nearby({ lat: 25.0365, lon: 121.5645 }), /台北市停車場資料回應錯誤/);
  const tdx = { get: async (path) => (path.includes('CarPark/') ? { CarParks: [] } : {}) };
  assert.deepEqual(await createParkingServices(tdx).parking.nearby({ lat: 25.0365, lon: 121.5645 }), { city: 'Taipei', lots: [], noData: true });
});
