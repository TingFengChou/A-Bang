// 捷運服務（示範資料版）：介面與 metro.js 相同。站名與路線為真實名稱，座標為近似值，到站時間為模擬。
import { seeded } from './transit-mock.js';
import { metroLineColor } from '../metro-colors.js';
import { mustSystem, findMetroStation, metroStatusCode, sortByEta, stationLines } from './metro.js';

// 各線兩端的終點站
const LINES = {
  TRTC: { BL: ['板南線', '南港展覽館', '頂埔'], R: ['淡水信義線', '淡水', '象山'], G: ['松山新店線', '松山', '新店'], O: ['中和新蘆線', '迴龍', '南勢角'], BR: ['文湖線', '動物園', '南港展覽館'] },
  TYMC: { A: ['機場線', '臺北車站', '環北'] },
  TMRT: { G: ['綠線', '北屯總站', '高鐵臺中站'] },
  KRTC: { R: ['紅線', '小港', '岡山車站'], O: ['橘線', '西子灣', '大寮'] },
  NTMC: { LB: ['三鶯線', '頂埔', '鶯桃福德'], Y: ['環狀線', '大坪林', '新北產業園區'] },
  NTDLRT: { V: ['淡海輕軌', '紅樹林', '崁頂'] },
  NTALRT: { K: ['安坑輕軌', '雙城', '十四張'] },
  KLRT: { C: ['環狀輕軌', '籬仔內', '哈瑪星'] },
};

// [代碼, 站名, 經過的線, lat, lon]
const STATIONS = {
  TRTC: [
    ['BL12', '台北車站', ['BL', 'R'], 25.0462, 121.5174], ['BL11', '西門', ['BL', 'G'], 25.0421, 121.5081],
    ['BL15', '忠孝復興', ['BL', 'BR'], 25.0416, 121.5437], ['BL18', '市政府', ['BL'], 25.0410, 121.5654],
    ['BL23', '南港展覽館', ['BL', 'BR'], 25.0553, 121.6175], ['BL01', '頂埔', ['BL'], 24.9593, 121.4206],
    ['R11', '中山', ['R', 'G'], 25.0527, 121.5203], ['R07', '東門', ['R', 'O'], 25.0339, 121.5288],
    ['R05', '大安', ['R', 'BR'], 25.0330, 121.5436], ['R13', '民權西路', ['R', 'O'], 25.0623, 121.5194],
    ['R28', '淡水', ['R'], 25.1677, 121.4459], ['R16', '士林', ['R'], 25.0935, 121.5262], ['R22', '北投', ['R'], 25.1321, 121.4986], ['R02', '象山', ['R'], 25.0328, 121.5703],
    ['R03', '台北101／世貿', ['R'], 25.0331, 121.5654], ['G09', '古亭', ['G', 'O'], 25.0263, 121.5229], ['G19', '松山', ['G'], 25.0500, 121.5776],
    ['G01', '新店', ['G'], 24.9579, 121.5379], ['BR01', '動物園', ['BR'], 24.9982, 121.5794],
    ['BL07', '板橋', ['BL'], 25.0143, 121.4625], ['BR14', '劍南路', ['BR'], 25.0848, 121.5555], ['BR15', '西湖', ['BR'], 25.0821, 121.5672],
    ['BR16', '港墘', ['BR'], 25.0800, 121.5753], ['BR17', '文德', ['BR'], 25.0785, 121.5850], ['BR18', '內湖', ['BR'], 25.0837, 121.5944],
  ],
  TYMC: [
    ['A1', '臺北車站', ['A'], 25.0490, 121.5150], ['A3', '新北產業園區', ['A'], 25.0611, 121.4596],
    ['A12', '機場第一航廈', ['A'], 25.0812, 121.2384], ['A13', '機場第二航廈', ['A'], 25.0773, 121.2318],
    ['A18', '高鐵桃園站', ['A'], 25.0137, 121.2152], ['A21', '環北', ['A'], 24.9677, 121.2257],
  ],
  TMRT: [
    ['103a', '北屯總站', ['G'], 24.1734, 120.7158], ['107', '文心崇德', ['G'], 24.1720, 120.6858],
    ['110', '市政府', ['G'], 24.1617, 120.6469], ['112', '文華高中', ['G'], 24.1435, 120.6385],
    ['119', '高鐵臺中站', ['G'], 24.1121, 120.6158],
  ],
  KRTC: [
    ['R3', '小港', ['R'], 22.5649, 120.3537], ['R4', '高雄國際機場', ['R'], 22.5701, 120.3418],
    ['R10', '美麗島', ['R', 'O'], 22.6313, 120.3019], ['R11', '高雄車站', ['R'], 22.6394, 120.3025],
    ['R16', '左營', ['R'], 22.6873, 120.3076], ['RK1', '岡山車站', ['R'], 22.7920, 120.2990],
    ['O1', '西子灣', ['O'], 22.6214, 120.2735], ['O10', '衛武營', ['O'], 22.6240, 120.3410], ['OT1', '大寮', ['O'], 22.6222, 120.3953],
  ],
  // 2026-11-22：所有捷運、輕軌系統（範圍全台灣）；座標近似值
  NTMC: [
    ['LB01', '頂埔', ['LB'], 24.9593, 121.4206], ['LB06', '三峽', ['LB'], 24.9375, 121.3730], ['LB07', '台北大學', ['LB'], 24.9437, 121.3683],
    ['LB08', '鶯歌車站', ['LB'], 24.9539, 121.3529], ['LB12', '鶯桃福德', ['LB'], 24.9520, 121.3230],
    ['Y07', '大坪林', ['Y'], 24.9827, 121.5418], ['Y16', '板橋', ['Y'], 25.0143, 121.4625], ['Y20', '新北產業園區', ['Y'], 25.0611, 121.4596],
  ],
  NTDLRT: [['V01', '紅樹林', ['V'], 25.1544, 121.4590], ['V09', '崁頂', ['V'], 25.1830, 121.4320]],
  NTALRT: [['K01', '雙城', ['K'], 24.9560, 121.5050], ['K09', '十四張', ['K'], 24.9850, 121.5300]],
  KLRT: [['C14', '哈瑪星', ['C'], 22.6214, 120.2730], ['C1', '籬仔內', ['C'], 22.6060, 120.3440]],
};

export function createMockMetroServices() {
  const metro = {
    async stations({ system }) {
      const op = mustSystem(system);
      // 與真實版一樣由代碼推線別（stationLines）；轉乘站（一個代碼、多條線）用示範資料寫的線
      return STATIONS[op].map(([id, name, lines, lat, lon]) => ({ id, ids: [id], name, lat, lon, lines: lines.length > 1 ? lines : stationLines(op, [id]) }));
    },
    async liveBoard({ system, station, last = false }) {
      const op = mustSystem(system);
      const st = findMetroStation(await metro.stations({ system: op }), station, op);
      const lines = STATIONS[op].find((x) => x[0] === st.id)[2];
      const trains = [];
      for (const lineId of lines) {
        const [line, endA, endB] = LINES[op][lineId];
        for (const dest of [endA, endB]) {
          if (dest === st.name) continue; // 終點站不顯示往自己方向的車
          // 每 6 分鐘一班、依站與方向錯開，隨時間遞減
          const r = seeded(`${op}${st.id}${lineId}${dest}`);
          const etaMin = Math.floor(((r() * 360 - Date.now() / 1000) % 360 + 360) % 360 / 60);
          trains.push({ line, lineId, ...(metroLineColor(op, lineId) && { lineColor: metroLineColor(op, lineId) }), destination: dest, etaMin, status: metroStatusCode(etaMin) });
        }
      }
      // 末班車（示範）：各方向 23:50～00:20 之間，依站與方向固定
      const lastTrains = last ? trains.map((t) => { const m = 23 * 60 + 50 + Math.floor(seeded(`last${op}${st.id}${t.lineId}${t.destination}`)() * 30); return { lineId: t.lineId, line: t.line, destination: t.destination, time: `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }; }) : null;
      return { system: op, station: st.name, stationId: st.id, lat: st.lat, lon: st.lon, demo: true, updatedAt: new Date().toISOString(), trains: trains.sort(sortByEta), ...(lastTrains && { lastTrains }) };
    },
  };
  return { metro };
}
