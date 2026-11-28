// 捷運轉乘規劃（core/metro-route.js、metro_route）：2026-11-23 使用者「有辦法做到轉乘建議嗎？」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRoutes, findRoute, trainGoesWay, stationKey } from '../core/metro-route.js';
import { normStationOfLine, adultFare } from '../core/services/metro.js';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const S = (pairs) => pairs.map(([id, name]) => ({ id, name }));
// 真實 StationOfLine 的子集（順序、代碼照 TDX 2026-11-23）
const TRTC = toRoutes('TRTC', [
  { lineId: 'BL', line: '板南線', stations: S([['BL01', '頂埔'], ['BL07', '板橋'], ['BL11', '西門'], ['BL12', '台北車站'], ['BL15', '忠孝復興'], ['BL18', '市政府']]) },
  { lineId: 'BR', line: '文湖線', stations: S([['BR09', '大安'], ['BR10', '忠孝復興'], ['BR11', '南京復興'], ['BR13', '松山機場']]) },
  { lineId: 'G', line: '松山新店線', stations: S([['G01', '新店'], ['G03', '七張'], ['G04', '大坪林'], ['G09', '古亭'], ['G12', '西門'], ['G03A', '小碧潭']]) },
  { lineId: 'O', line: '中和新蘆線', stations: S([['O01', '南勢角'], ['O05', '古亭'], ['O11', '民權西路'], ['O12', '大橋頭'], ['O18', '新莊'], ['O21', '迴龍'], ['O50', '三重國小'], ['O54', '蘆洲']]) },
  { lineId: 'R', line: '淡水信義線', stations: S([['R10', '台北車站'], ['R13', '民權西路'], ['R22', '北投'], ['R27', '紅樹林'], ['R28', '淡水'], ['R22A', '新北投']]) },
]);
const NTMC = toRoutes('NTMC', [
  { lineId: 'LB', line: '三鶯線', stations: S([['LB01', '頂埔'], ['LB06', '三峽'], ['LB08', '鶯歌車站'], ['LB12', '鶯桃福德']]) },
  { lineId: 'Y', line: '環狀線', stations: S([['Y07', '大坪林'], ['Y16', '板橋'], ['Y20', '新北產業園區']]) },
]);
const TYMC = toRoutes('TYMC', [{ lineId: 'A', line: '機場線', stations: S([['A1', '台北車站'], ['A3', '新北產業園區站'], ['A12', '機場第一航廈站']]) }]);
const KLRT = toRoutes('KLRT', [{ lineId: 'C', line: '環狀輕軌', stations: S([['C1', '籬仔內'], ['C5', '夢時代'], ['C14', '哈瑪星'], ['C20', '臺鐵美術館'], ['C37', '輕軌機廠站']]) }]);
const NORTH = [...TRTC, ...NTMC, ...TYMC];
const say = (r) => r.legs.map((l) => `${l.line}:${l.from}→${l.to}${l.toward ? `(往${l.toward})` : `(下一站${l.next})`}`).join(' / ');

test('站名鍵：臺／台相同、機場捷運結尾的「站」去掉', () => {
  assert.equal(stationKey('新北產業園區站'), stationKey('新北產業園區'));
  assert.equal(stationKey('臺北車站'), stationKey('台北車站'));
});

test('同一條線直達：往哪個終點、坐幾站', () => {
  const r = findRoute(NORTH, '台北車站', '市政府');
  assert.equal(say(r), '板南線:台北車站→市政府(往市政府)'); // 子集的最後一站
  assert.deepEqual([r.transfers, r.legs[0].stops, r.legs[0].next], [0, 2, '忠孝復興']);
});

test('同系統轉乘：台北車站 → 松山機場（板南線忠孝復興轉文湖線）', () => {
  const r = findRoute(NORTH, '台北車站', '松山機場');
  assert.equal(say(r), '板南線:台北車站→忠孝復興(往市政府) / 文湖線:忠孝復興→松山機場(往松山機場)');
  assert.equal(r.transfers, 1);
  assert.equal(r.minutes, 1 * 2 + 5 + 2 * 2, '每站約 2 分＋轉乘 5 分（子集：台北車站下一站就是忠孝復興）');
});

test('跨系統：鶯歌 → 台北車站（三鶯線頂埔轉板南線）；機場捷運站名有「站」也能轉', () => {
  assert.equal(say(findRoute(NORTH, '鶯歌車站', '台北車站')), '三鶯線:鶯歌車站→頂埔(往頂埔) / 板南線:頂埔→台北車站(往市政府)');
  const r = findRoute(NORTH, '大坪林', '機場第一航廈');
  assert.equal(say(r), '環狀線:大坪林→新北產業園區(往新北產業園區) / 機場線:新北產業園區站→機場第一航廈站(往機場第一航廈站)');
});

test('北捷支線：小碧潭、新北投是接駁（在七張、北投換車）；蘆洲支線是直通（新莊 → 蘆洲在大橋頭換車）', () => {
  assert.equal(say(findRoute(NORTH, '古亭', '小碧潭')), '松山新店線:古亭→七張(往新店) / 小碧潭支線:七張→小碧潭(往小碧潭)');
  assert.equal(say(findRoute(NORTH, '台北車站', '新北投')), '淡水信義線:台北車站→北投(往淡水) / 新北投支線:北投→新北投(往新北投)');
  assert.equal(say(findRoute(NORTH, '南勢角', '蘆洲')), '中和新蘆線:南勢角→蘆洲(往蘆洲)', '南勢角直通蘆洲，不用換車');
  assert.equal(say(findRoute(NORTH, '新莊', '蘆洲')), '中和新蘆線:新莊→大橋頭(往南勢角) / 中和新蘆線:大橋頭→蘆洲(往蘆洲)');
  // 兩邊共用的一段：往迴龍或蘆洲都可以坐；迴龍不會接到三重國小
  assert.match(findRoute(NORTH, '南勢角', '民權西路').legs[0].toward, /^(迴龍／蘆洲|蘆洲／迴龍)$/);
  assert.equal(findRoute(NORTH, '迴龍', '三重國小').legs.length, 2);
});

test('淡海輕軌藍海線：在濱海沙崙分岔（崁頂不會接到台北海洋大學）', () => {
  const V = toRoutes('NTDLRT', [{ lineId: 'V', line: '淡海輕軌', stations: S([['V01', '紅樹林'], ['V09', '濱海沙崙'], ['V10', '淡海新市鎮'], ['V11', '崁頂'], ['V28', '台北海洋大學'], ['V27', '沙崙'], ['V26', '淡水漁人碼頭']]) }]);
  assert.equal(say(findRoute(V, '紅樹林', '淡水漁人碼頭')), '淡海輕軌:紅樹林→淡水漁人碼頭(往淡水漁人碼頭)');
  assert.equal(findRoute(V, '崁頂', '台北海洋大學').legs[0].stops + findRoute(V, '崁頂', '台北海洋大學').legs.slice(1).reduce((n, l) => n + l.stops, 0), 3, '崁頂 → 淡海新市鎮 → 濱海沙崙 → 台北海洋大學');
});

test('環狀線（高雄輕軌）：頭尾相連、走近的那一邊，卡片說下一站不說往哪', () => {
  const r = findRoute(KLRT, '籬仔內', '輕軌機廠站');
  assert.deepEqual([r.legs[0].stops, r.legs[0].loop, r.legs[0].toward, r.legs[0].next], [1, true, undefined, '輕軌機廠站']);
  assert.equal(findRoute(KLRT, '夢時代', '哈瑪星').legs[0].stops, 1);
});

test('看板的車是不是往這段的方向（往蘆洲的車在南勢角也算往民權西路方向）', () => {
  const leg = { ...findRoute(NORTH, '台北車站', '松山機場').legs[0], key: 'TRTC:BL', dir: 1 };
  assert.equal(trainGoesWay(NORTH, leg, '南港展覽館'), false, '子集沒有這站：看不出來就不算');
  assert.equal(trainGoesWay(NORTH, leg, '市政府'), true);
  assert.equal(trainGoesWay(NORTH, leg, '頂埔'), false);
  const o = findRoute(NORTH, '南勢角', '民權西路');
  const ol = { ...o.legs[0], key: o.legs[0].key ?? (o.legs[0].toward.startsWith('迴龍') ? 'TRTC:O' : 'TRTC:O-F'), dir: 1 };
  assert.equal(trainGoesWay(NORTH, ol, '蘆洲'), true);
  assert.equal(trainGoesWay(NORTH, ol, '迴龍'), true);
  assert.equal(trainGoesWay(KLRT, { key: 'KLRT:C', fromId: 'C5', dir: 1 }, '籬仔內（順行）'), false, '環狀線分不出來：不顯示下一班');
});

test('StationOfLine 正規化與 ODFare 成人單程票', () => {
  const lines = normStationOfLine('NTMC', [{ LineID: 'LB', Stations: [{ Sequence: 2, StationID: 'LB02', StationName: { Zh_tw: '媽祖田', En: 'Mazutian' } }, { Sequence: 1, StationID: 'LB01', StationName: { Zh_tw: '頂埔', En: 'Dingpu' } }] }]);
  assert.deepEqual(lines, [{ lineId: 'LB', line: '三鶯線', lineEn: 'Sanying Line', color: '#77B5DE', stations: [{ id: 'LB01', name: '頂埔', nameEn: 'Dingpu' }, { id: 'LB02', name: '媽祖田', nameEn: 'Mazutian' }] }]);
  assert.equal(adultFare([{ Fares: [{ TicketType: 1, FareClass: 3, Price: 10 }, { TicketType: 1, FareClass: 1, Price: 25 }, { TicketType: 3, FareClass: 1, Price: 20 }] }]), 25);
  assert.equal(adultFare([]), null);
});

test('metro_route（示範資料）：跨系統、票價、第一段下一班、不同城市說原因', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'metro_route', { from: '鶯歌車站', to: '松山' });
  assert.equal(r.card, 'metro-route');
  assert.deepEqual(r.data.legs.map((l) => l.line), ['三鶯線', '板南線', '松山新店線']);
  assert.equal(r.data.transfers, 2);
  assert.ok(r.data.fare > 0 && r.data.fareNote, '跨系統：分段相加並說明');
  assert.ok(r.data.next?.etaMin >= 0, '第一段（三鶯線往頂埔）的下一班');
  assert.match(r.text, /^鶯歌車站 → 松山：約 \d+ 分/);
  await assert.rejects(callTool(svc, 'metro_route', { from: '台北車站', to: '高鐵臺中站' }), /不同城市/);
  await assert.rejects(callTool(svc, 'metro_route', { from: '台北車站', to: '臺北車站' }), /不同的站/);
  const tc = await callTool(svc, 'metro_route', { from: '市政府', to: '高鐵臺中站', system: 'TMRT' });
  assert.ok(tc.data.next.headway, '台中捷運：第一段只有班距');
});

test('metro_route：路網上游壞掉照實說連不上，不說成「路網資料可能還沒有這一站」（P0-2 B 降級盤點）', async () => {
  const { TdxError } = await import('../core/tdx-client.js');
  const { shown, publicMessage } = await import('../core/util.js');
  const svc = createServices({ forceMock: true });
  const down = { ...svc, metro: { ...svc.metro, lines: async () => { throw shown(new TdxError(503, 'TDX API 錯誤 503'), '交通資料（TDX）暫時無法取得'); } } };
  await assert.rejects(callTool(down, 'metro_route', { from: '台北車站', to: '內湖' }), (e) => publicMessage(e) === '交通資料（TDX）暫時無法取得' && !/路網資料/.test(e.message));
  // 行程規劃（不 strict）照舊回 null 改用估算
  const { metroNetRoute } = await import('../core/services/metro-net.js');
  assert.equal(await metroNetRoute(down.metro, { from: '台北車站', to: '內湖', systems: ['TRTC'] }), null);
});
