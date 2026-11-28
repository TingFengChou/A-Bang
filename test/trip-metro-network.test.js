// S7b（2026-11-23）：行程規劃的捷運方案用真實路網（各線車站順序）——坐哪幾條線、往哪、幾站、在哪轉；票價用 ODFare。
// 只用已存的路網與票價（onlyStored，不在使用者這一次多花 TDX 額度）；拿不到就照舊依距離估算（既有測試涵蓋）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool } from '../core/tools/index.js';
import { createServices } from '../core/index.js';

const S = (pairs) => pairs.map(([id, name]) => ({ id, name }));
// 真實 StationOfLine 的子集（代碼、順序照 TDX；站名與示範車站清單一致，座標從車站清單取）
const LINES = {
  NTMC: [{ lineId: 'LB', line: '三鶯線', stations: S([['LB01', '頂埔'], ['LB02', '媽祖田'], ['LB03', '長壽山'], ['LB04', '橫溪'], ['LB05', '龍埔'], ['LB06', '三峽'], ['LB07', '台北大學'], ['LB08', '鶯歌車站']]) }],
  TRTC: [
    { lineId: 'BL', line: '板南線', stations: S([['BL01', '頂埔'], ['BL02', '永寧'], ['BL03', '土城'], ['BL04', '海山'], ['BL05', '亞東醫院'], ['BL06', '府中'], ['BL07', '板橋'], ['BL08', '新埔'], ['BL09', '江子翠'], ['BL10', '龍山寺'], ['BL11', '西門'], ['BL12', '台北車站'], ['BL13', '善導寺'], ['BL14', '忠孝新生'], ['BL15', '忠孝復興'], ['BL16', '忠孝敦化'], ['BL17', '國父紀念館'], ['BL18', '市政府']]) },
    { lineId: 'R', line: '淡水信義線', stations: S([['R02', '象山'], ['R03', '台北101／世貿'], ['R04', '信義安和'], ['R05', '大安'], ['R06', '大安森林公園'], ['R07', '東門'], ['R08', '中正紀念堂'], ['R09', '台大醫院'], ['R10', '台北車站'], ['R11', '中山']]) },
  ],
};

function svcWithNetwork() {
  const svc = createServices({ forceMock: true });
  const calls = [];
  svc.metro.lines = async ({ system, onlyStored }) => { calls.push({ system, onlyStored }); return LINES[system] || []; };
  svc.metro.odFare = async ({ system, onlyStored }) => { calls.push({ fare: system, onlyStored }); return system === 'NTMC' ? 25 : 35; };
  return { svc, calls };
}

test('三峽老街 → 台北101：三鶯線到頂埔、轉板南線到台北車站、再轉淡水信義線（站數、往哪、票價分段相加）', async () => {
  const { svc, calls } = svcWithNetwork();
  const r = await callTool(svc, 'plan_trip', { from: '三峽老街', to: '台北101', departAt: '10:00' });
  const m = r.data.options.find((o) => o.id === 'metro');
  assert.ok(m, '有捷運方案');
  assert.equal(m.metro.network, true);
  assert.equal(m.metro.lines, '三鶯線轉板南線轉淡水信義線');
  assert.deepEqual(m.metro.vias, ['頂埔', '台北車站']);
  assert.equal(m.metro.fare, 60, '三鶯線 25＋北捷 35（跨系統分段相加）');
  const metroLegs = m.legs.filter((l) => l.mode === 'metro').map((l) => l.detail);
  assert.deepEqual(metroLegs, [
    '三鶯線（往頂埔）：三峽 → 頂埔，5 站',
    '在頂埔站轉板南線（往市政府）：頂埔 → 台北車站，11 站',
    '在台北車站轉淡水信義線（往象山）：台北車站 → 台北101／世貿，7 站',
  ]);
  assert.ok(m.notes.some((n) => /依各線車站順序/.test(n)) && m.notes.some((n) => /跨系統票價分段相加/.test(n)));
  assert.ok(calls.every((c) => c.onlyStored === true), '行程規劃只用已存的路網與票價（不多花 TDX 額度）');
});

test('查不到已存的票價：各段依距離估、照實說', async () => {
  const { svc } = svcWithNetwork();
  svc.metro.odFare = async () => null;
  const r = await callTool(svc, 'plan_trip', { from: '三峽老街', to: '台北101', departAt: '10:00' });
  const m = r.data.options.find((o) => o.id === 'metro');
  assert.equal(m.metro.network, true);
  assert.equal(m.metro.fare, undefined);
  assert.ok(m.notes.some((n) => /票價查不到，依距離估算/.test(n)));
});

test('沒有已存的路網（示範、還沒預熱）：照舊依距離估算', async () => {
  const svc = createServices({ forceMock: true });
  const r = await callTool(svc, 'plan_trip', { from: '三峽老街', to: '台北101', departAt: '10:00' });
  const m = r.data.options.find((o) => o.id === 'metro');
  assert.ok(m && !m.metro.network);
});

// P1-3(b)（2026-11-28 Antigravity 第五輪）：高鐵／台鐵進出站走不到時，接一段真實捷運（已存路網），不只是「市區公車／捷運約 N 分（估算）」
const RAIL_LINES = {
  TRTC: [
    { lineId: 'BL', line: '板南線', stations: S([['BL07', '板橋'], ['BL11', '西門'], ['BL12', '台北車站'], ['BL15', '忠孝復興'], ['BL18', '市政府'], ['BL23', '南港展覽館']]) },
    { lineId: 'R', line: '淡水信義線', stations: S([['R02', '象山'], ['R03', '台北101／世貿'], ['R05', '大安'], ['R07', '東門'], ['R10', '台北車站'], ['R11', '中山']]) },
    { lineId: 'BR', line: '文湖線', stations: S([['BR09', '大安'], ['BR10', '忠孝復興'], ['BR24', '南港展覽館']]) },
  ],
};
function railSvc() {
  const svc = createServices({ forceMock: true });
  const calls = [];
  svc.metro.lines = async ({ system, onlyStored }) => { calls.push({ system, onlyStored }); return RAIL_LINES[system] || []; };
  svc.metro.odFare = async ({ onlyStored }) => { calls.push({ fare: true, onlyStored }); return 30; };
  return { svc, calls };
}

test('P1-3(b) 台中車站 → 台北101：台鐵到台北車站後轉淡水信義線（真實路網），不是估算接駁；只用已存的路網', async () => {
  const { svc, calls } = railSvc();
  const r = await callTool(svc, 'plan_trip', { from: '台中車站', to: '台北101', departAt: '10:00' });
  const tra = r.data.options.find((o) => o.role === 'tra');
  assert.deepEqual(tra.railMetro, { in: false, out: true });
  const details = tra.legs.map((l) => l.detail);
  assert.ok(details.includes('淡水信義線（往象山）：台北車站 → 台北101／世貿，3 站'), details.join(' | '));
  assert.ok(!details.some((d) => /市區公車／捷運約 \d+ 分（估算）/.test(d)), '出站那段不再是估算');
  assert.ok(tra.notes.some((n) => /^轉捷運（淡水信義線：台北車站 → 台北101／世貿）依各線車站順序規劃/.test(n)));
  const extra = tra.minutes - tra.legs.reduce((sum, l) => sum + l.minutes, 0) - tra.waitMin;
  assert.ok(extra > 0 && extra <= 10, `總時間＝各段＋等火車＋等捷運（多 ${extra} 分）`);
  assert.ok(calls.length && calls.every((c) => c.onlyStored === true), '只用已存的路網與票價（不多花 TDX 額度）');
});

test('P1-3(b) 高鐵桃園站 → 台北101：南港下車接板南線轉文湖線轉淡水信義線（捷運南港站就在高鐵站）', async () => {
  const { svc } = railSvc();
  // 示範車站清單沒有捷運南港站（真實資料有，跟高鐵南港站共構）：補上，路網也補上
  const base = svc.metro.stations.bind(svc.metro);
  svc.metro.stations = async (a) => [...(await base(a)), ...(a.system === 'TRTC' ? [{ id: 'BL22', ids: ['BL22'], name: '南港', lat: 25.0521, lon: 121.6068, lines: ['BL'] }] : [])];
  const lines = RAIL_LINES.TRTC.map((l) => (l.lineId === 'BL' ? { ...l, stations: [...l.stations.slice(0, -1), { id: 'BL22', name: '南港' }, ...l.stations.slice(-1)] } : l));
  svc.metro.lines = async ({ system }) => (system === 'TRTC' ? lines : []);
  const r = await callTool(svc, 'plan_trip', { from: '高鐵桃園站', to: '台北101', departAt: '10:00' });
  const thsr = r.data.options.find((o) => o.role === 'thsr');
  assert.equal(thsr.railMetro?.out, true, thsr.legs.map((l) => l.detail).join(' | '));
  assert.ok(thsr.legs.some((l) => /^走到捷運南港站/.test(l.detail)), thsr.legs.map((l) => l.detail).join(' | '));
  assert.ok(thsr.legs.some((l) => /淡水信義線.*台北101／世貿/.test(l.detail)));
});

test('P1-3(b) 接不上就照舊估算：沒有已存路網、或接上的捷運比估算慢太多（路網不完整會繞遠路）', async () => {
  const plain = createServices({ forceMock: true }); // 示範路網 onlyStored 回 null
  const a = await callTool(plain, 'plan_trip', { from: '台中車站', to: '台北101', departAt: '10:00' });
  const tra = a.data.options.find((o) => o.role === 'tra');
  assert.equal(tra.railMetro, undefined);
  assert.ok(tra.legs.some((l) => /市區公車／捷運約 \d+ 分（估算）/.test(l.detail)));
  // 只有板南線、沒有文湖線：南港展覽館 → 台北車站 → 101 繞一大圈，比估算慢超過 15 分 → 不用
  const { svc } = railSvc();
  const { RAIL_METRO_SLACK } = await import('../core/services/trip.js');
  svc.metro.lines = async ({ system }) => (system === 'TRTC' ? RAIL_LINES.TRTC.filter((l) => l.lineId !== 'BR').map((l) => (l.lineId === 'BL' ? { ...l, stations: [...l.stations.slice(0, 2), ...l.stations.slice(2)] } : l)) : []);
  const b = await callTool(svc, 'plan_trip', { from: '高鐵桃園站', to: '台北101', departAt: '10:00' });
  const thsr = b.data.options.find((o) => o.role === 'thsr');
  assert.equal(thsr.railMetro, undefined, `繞遠路超過 ${RAIL_METRO_SLACK} 分不用`);
});
