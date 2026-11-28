// TDX 縣市代碼對照
export const CITIES = [
  { city: 'Taipei', code: 'TPE', name: '臺北市' },
  { city: 'NewTaipei', code: 'NWT', name: '新北市' },
  { city: 'Taoyuan', code: 'TAO', name: '桃園市' },
  { city: 'Taichung', code: 'TXG', name: '臺中市' },
  { city: 'Tainan', code: 'TNN', name: '臺南市' },
  { city: 'Kaohsiung', code: 'KHH', name: '高雄市' },
  { city: 'Keelung', code: 'KEE', name: '基隆市' },
  { city: 'Hsinchu', code: 'HSZ', name: '新竹市' },
  { city: 'HsinchuCounty', code: 'HSQ', name: '新竹縣' },
  { city: 'MiaoliCounty', code: 'MIA', name: '苗栗縣' },
  { city: 'ChanghuaCounty', code: 'CHA', name: '彰化縣' },
  { city: 'NantouCounty', code: 'NAN', name: '南投縣' },
  { city: 'YunlinCounty', code: 'YUN', name: '雲林縣' },
  { city: 'ChiayiCounty', code: 'CYQ', name: '嘉義縣' },
  { city: 'Chiayi', code: 'CYI', name: '嘉義市' },
  { city: 'PingtungCounty', code: 'PIF', name: '屏東縣' },
  { city: 'YilanCounty', code: 'ILA', name: '宜蘭縣' },
  { city: 'HualienCounty', code: 'HUA', name: '花蓮縣' },
  { city: 'TaitungCounty', code: 'TTT', name: '臺東縣' },
  { city: 'KinmenCounty', code: 'KIN', name: '金門縣' },
  { city: 'PenghuCounty', code: 'PEN', name: '澎湖縣' },
  { city: 'LienchiangCounty', code: 'LIE', name: '連江縣' },
];

const byCode = Object.fromEntries(CITIES.map((c) => [c.code, c]));
const byCity = Object.fromEntries(CITIES.map((c) => [c.city.toLowerCase(), c]));

/** 接受 'Taipei' / 'TPE' / '台北市' / '臺北' 等寫法 */
export function resolveCity(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (Object.hasOwn(byCity, s.toLowerCase())) return byCity[s.toLowerCase()]; // 只認自己的鍵（「constructor」「__proto__」不是縣市，V8-1）
  if (Object.hasOwn(byCode, s.toUpperCase())) return byCode[s.toUpperCase()];
  const zh = s.replace(/台/g, '臺');
  return CITIES.find((c) => c.name === zh || c.name.slice(0, 2) === zh.slice(0, 2)) || null;
}

/** 由 StationUID / StopUID 前三碼推回城市 */
export function cityFromUID(uid = '') {
  return byCode[uid.slice(0, 3)] || null;
}
