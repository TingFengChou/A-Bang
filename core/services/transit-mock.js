// 大眾運輸服務（示範資料版）：介面與 transit.js 完全相同。
// 沒有 TDX 金鑰時自動使用，方便開發、Demo、測試 MCP。資料為模擬，非真實營運資訊。
import { resolveCity } from '../cities.js';
import { distanceM, busStatusText, minutesBetween, todayTW, assertLatLon, UserError } from '../util.js';
import { findStation, sortEta } from './transit.js';

const STOP_POOL = ['捷運站(1號出口)', '市政府', '圖書館', '國小', '醫院', '公園', '市場', '派出所', '區公所', '高中', '活動中心', '郵局', '轉運站', '體育館', '文化中心', '新村', '二段', '大學', '商圈', '加油站'];
const ROAD_POOL = ['中山', '中正', '民生', '民權', '復興', '建國', '忠孝', '仁愛', '信義', '和平', '光復', '敦化'];
const ROUTES = ['307', '262', '藍15', '紅30', '棕9', '601', '212', '綠1', '235', '1503'];

// 以字串產生穩定亂數，讓同一站每次看到的資料一致
export function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}
// 隨時間遞減的 ETA，每 15 分鐘循環
function liveEta(key, status0Rate = 0.85) {
  const r = seeded(key);
  if (r() > status0Rate) return { etaSec: null, status: r() > 0.5 ? 1 : 3 };
  const period = 900;
  const t = (Date.now() / 1000 + r() * period) % period;
  return { etaSec: Math.round(period - t), status: 0 };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// 示範路線的起點：各縣市市中心附近（其他縣市用台北）
const CENTER = { Taipei: [25.0478, 121.517], NewTaipei: [25.0120, 121.4637], Taoyuan: [24.9937, 121.3010], Taichung: [24.1477, 120.6736], Tainan: [22.9971, 120.2127], Kaohsiung: [22.6273, 120.3014] };
const r6 = (n) => Number(n.toFixed(6));
// 沿著略微彎曲的方向，每站約 350 公尺，產生 n 個站點座標
function mockPath(r, city, n) {
  const [lat0, lon0] = CENTER[city] || CENTER.Taipei;
  let lat = lat0 + (r() - 0.5) * 0.02, lon = lon0 + (r() - 0.5) * 0.02;
  let heading = r() * 2 * Math.PI;
  return Array.from({ length: n }, (_, i) => {
    if (i) {
      heading += (r() - 0.5) * 0.6;
      lat += (350 * Math.cos(heading)) / 111000;
      lon += (350 * Math.sin(heading)) / (111000 * Math.cos((lat * Math.PI) / 180));
    }
    return [r6(lat), r6(lon)];
  });
}
// 站與站之間插入中點，讓形狀比站點密
const densify = (pts) => pts.flatMap((p, i) => (i ? [[r6((pts[i - 1][0] + p[0]) / 2), r6((pts[i - 1][1] + p[1]) / 2)], p] : [p]));

const THSR = [['0990', '南港'], ['1000', '台北'], ['1010', '板橋'], ['1020', '桃園'], ['1030', '新竹'], ['1035', '苗栗'], ['1040', '台中'], ['1043', '彰化'], ['1047', '雲林'], ['1050', '嘉義'], ['1060', '台南'], ['1070', '左營']].map(([id, name]) => ({ id, name }));
const TRA = [['0900', '基隆'], ['1000', '臺北'], ['1020', '板橋'], ['1080', '桃園'], ['1100', '中壢'], ['1210', '新竹'], ['3160', '苗栗'], ['3300', '臺中'], ['3360', '彰化'], ['4080', '嘉義'], ['4220', '臺南'], ['4400', '高雄'], ['7190', '宜蘭'], ['7000', '花蓮'], ['6000', '臺東']].map(([id, name]) => ({ id, name }));
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

export function createMockTransitServices() {
  const bus = {
    async searchRoutes({ city, keyword }) {
      const c = resolveCity(city) || resolveCity('Taipei');
      return ROUTES.filter((r) => r.includes(keyword)).map((routeName) => {
        const r = seeded(routeName);
        return { city: c.city, routeName, departure: pick(r, ROAD_POOL) + pick(r, STOP_POOL), destination: pick(r, ROAD_POOL) + pick(r, STOP_POOL) };
      });
    },
    async routeEta({ city, routeName }) {
      const c = resolveCity(city) || resolveCity('Taipei');
      const r = seeded(routeName);
      const n = 14 + Math.floor(r() * 10);
      const names = Array.from({ length: n }, () => pick(r, ROAD_POOL) + pick(r, STOP_POOL));
      const coords = mockPath(r, c.city, n);
      const mk = (dir, list, pts) => {
        // 模擬 2~3 台車在路線上，各站 ETA 由最近車輛推算
        const buses = [0.15, 0.5, 0.85].map((p) => p * list.length + ((Date.now() / 90000) % list.length));
        return list.map((stopName, i) => {
          const ahead = buses.map((b) => (i - (b % list.length) + list.length) % list.length);
          const k = Math.min(...ahead);
          const etaSec = Math.round(k * 95 + 20);
          return { seq: i + 1, stopName, lat: pts[i][0], lon: pts[i][1], etaSec, status: 0, statusText: busStatusText(0, etaSec), plate: k < 0.5 ? `${pad(Math.floor(r() * 90 + 10))}0-FT` : null };
        });
      };
      return {
        city: c.city, routeName, demo: true, updatedAt: new Date().toISOString(),
        directions: [
          { direction: 0, label: `往 ${names.at(-1)}`, stops: mk(0, names, coords) },
          { direction: 1, label: `往 ${names[0]}`, stops: mk(1, [...names].reverse(), [...coords].reverse()) },
        ],
        shape: densify(coords),
      };
    },
    async nearbyStations({ lat, lon, radius = 400 }) {
      [lat, lon] = assertLatLon(lat, lon);
      const r = seeded(`${lat.toFixed(3)},${lon.toFixed(3)}`);
      return Array.from({ length: 8 }, (_, i) => {
        const la = lat + (r() - 0.5) * radius / 55000, lo = lon + (r() - 0.5) * radius / 50000;
        return {
          stationId: `M${1000 + i}`, stationUid: `TPEM${1000 + i}`, city: 'Taipei',
          name: pick(r, ROAD_POOL) + pick(r, STOP_POOL), lat: la, lon: lo,
          distance: distanceM(lat, lon, la, lo),
          routes: [...new Set(Array.from({ length: 2 + Math.floor(r() * 4) }, () => pick(r, ROUTES)))],
        };
      }).sort((a, b) => a.distance - b.distance);
    },
    async stationEta({ stationId }) {
      const r = seeded(stationId);
      const routes = [...new Set(Array.from({ length: 3 + Math.floor(r() * 4) }, () => pick(r, ROUTES)))];
      return routes.map((routeName, i) => {
        const e = liveEta(`${stationId}-${routeName}`);
        return { routeName, direction: i % 2, ...e, statusText: busStatusText(e.status, e.etaSec) };
      }).sort(sortEta);
    },
  };

  const bike = {
    async nearby({ lat, lon, radius = 500 }) {
      [lat, lon] = assertLatLon(lat, lon);
      const r = seeded(`bike${lat.toFixed(3)},${lon.toFixed(3)}`);
      const tick = Math.floor(Date.now() / 60000);
      return Array.from({ length: 10 }, (_, i) => {
        const la = lat + (r() - 0.5) * radius / 55000, lo = lon + (r() - 0.5) * radius / 50000;
        const cap = 10 + Math.floor(r() * 40);
        const rent = Math.max(0, Math.min(cap, Math.floor(r() * cap + Math.sin(tick / 7 + i) * 3)));
        const electric = Math.floor(rent * r() * 0.4);
        return {
          uid: `MOCK${i}`, name: pick(r, ROAD_POOL) + '路' + pick(r, STOP_POOL), type: 'YouBike 2.0',
          address: '', lat: la, lon: lo, distance: distanceM(lat, lon, la, lo),
          capacity: cap, rent, general: rent - electric, electric, returnSlots: cap - rent,
          inService: true, updatedAt: new Date().toISOString(),
        };
      }).sort((a, b) => a.distance - b.distance);
    },
  };

  const timetable = (list, from, to, date, label, kind) => {
    const o = findStation(list, from, label), d = findStation(list, to, label);
    if (o.id === d.id) throw new UserError('起訖站不可相同');
    const hops = Math.abs(list.indexOf(o) - list.indexOf(d));
    const trains = [];
    const types = ['自強', '莒光', '區間快', '區間'];
    for (let m = 6 * 60; m < 23 * 60; m += kind === 'thsr' ? 30 : 25) {
      const r = seeded(`${kind}${o.id}${d.id}${m}`);
      const type = kind === 'thsr' ? null : pick(r, types);
      const per = kind === 'thsr' ? 11 : type === '自強' ? 18 : type === '莒光' ? 22 : 28;
      const dep = m + Math.floor(r() * 10);
      const minutes = Math.round(hops * per * (0.9 + r() * 0.2));
      trains.push({ trainNo: String(kind === 'thsr' ? 100 + trains.length * 2 : 100 + Math.floor(r() * 3000)), ...(type && { type }), depart: hhmm(dep), arrive: hhmm(dep + minutes), minutes: minutesBetween(hhmm(dep), hhmm(dep + minutes)), ...(type && { terminal: d.name }) });
    }
    return { from: o.name, to: d.name, date, demo: true, trains };
  };

  // 示範票價：依站距估算（非真實票價），欄位與 transit.js normFares 相同
  const fare = (list, from, to, label, system) => {
    const o = findStation(list, from, label), d = findStation(list, to, label);
    if (o.id === d.id) throw new UserError('起訖站不可相同');
    const hops = Math.abs(list.indexOf(o) - list.indexOf(d));
    const row = (ticketType, fareClass, price, extra = {}) => ({ ticketType, fareClass, ...extra, price: Math.round(price / 5) * 5, adultOneWay: ticketType === '單程票' && fareClass === '成人' });
    let fares;
    if (system === 'THSR') {
      const std = 40 + hops * 125;
      fares = [
        row('單程票', '成人', std, { cabin: '標準車廂' }), row('單程票', '成人', std * 1.6, { cabin: '商務車廂' }), row('單程票', '成人', std * 0.96, { cabin: '自由座' }),
        row('單程票', '孩童', std / 2, { cabin: '標準車廂' }), row('單程票', '敬老', std / 2, { cabin: '標準車廂' }),
      ];
    } else {
      fares = [['自強', 52], ['莒光', 40], ['區間', 34]].flatMap(([trainType, per]) => [
        row('單程票', '成人', Math.max(15, hops * per), { trainType }), row('單程票', '孩童', Math.max(10, hops * per / 2), { trainType }),
      ]);
    }
    return { system, from: o.name, to: d.name, demo: true, fares: fares.sort((a, b) => b.adultOneWay - a.adultOneWay || a.price - b.price) };
  };

  const rail = {
    async thsrStations() { return THSR; },
    async thsrFare({ from, to }) { return fare(THSR, from, to, '高鐵', 'THSR'); },
    async traFare({ from, to }) { return fare(TRA, from, to, '台鐵', 'TRA'); },
    async thsrTimetable({ from, to, date = todayTW() }) { return timetable(THSR, from, to, date, '高鐵', 'thsr'); },
    async traStations() { return TRA; },
    async traTimetable({ from, to, date = todayTW() }) { return timetable(TRA, from, to, date, '台鐵', 'tra'); },
  };

  return { bus, bike, rail };
}
