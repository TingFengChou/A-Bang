// 阿幫的「小程式」註冊表：首頁格子、路由都由這裡產生。
// 新增服務 = 寫一個 pages/xxx.js + 在這裡加一行；status: 'soon' 代表規劃中。
// source：資料類別（對應 /api/v1/status 的 sources[].id，示範資料時格子標「示範」）。
export const miniApps = [
  // 交通（第一階段）
  { id: 'nearby', source: 'transit', group: 'transit', name: '附近', icon: 'pin', route: '#/nearby' },
  { id: 'bus', source: 'transit', group: 'transit', name: '公車', icon: 'bus', route: '#/bus' },
  { id: 'bike', source: 'transit', group: 'transit', name: 'YouBike', icon: 'bike', route: '#/nearby?tab=bike' },
  { id: 'thsr', source: 'transit', group: 'transit', name: '高鐵', icon: 'hsr', route: '#/rail/thsr' },
  { id: 'tra', source: 'transit', group: 'transit', name: '台鐵', icon: 'train', route: '#/rail/tra' },
  { id: 'metro', source: 'transit', group: 'transit', name: '捷運', icon: 'metro', route: '#/s/metro' },
  // 生活（後續階段）
  { id: 'weather', source: 'weather', group: 'life', name: '天氣', icon: 'sun', route: '#/s/weather' },
  { id: 'aqi', source: 'aqi', group: 'life', name: '空氣品質', icon: 'air', route: '#/s/aqi' },
  { id: 'quake', source: 'quake', group: 'life', name: '地震', icon: 'quake', route: '#/s/quake' },
  { id: 'pharmacy', source: 'opendata', group: 'life', name: '藥局', icon: 'pharmacy', route: '#/s/pharmacy' },
  { id: 'garbage', source: 'opendata', group: 'life', name: '垃圾車', icon: 'trash', route: '#/s/garbage' },
  { id: 'antifraud', source: 'antifraud', group: 'gov', name: '防詐', icon: 'shield', route: '#/agent/antifraud' }, // M7：阿幫・防詐
  { id: 'fuel', source: 'opendata', group: 'gov', name: '油價', icon: 'fuel', route: '#/s/fuel' },
  { id: 'invoice', source: 'opendata', group: 'gov', name: '發票對獎', icon: 'receipt', route: '#/s/invoice' },
  { id: 'stock', source: 'opendata', group: 'gov', name: '股市', icon: 'chart', route: '#/s/stock' },
];

export const groups = [
  { id: 'transit', name: '交通出行', note: '資料來源：TDX 運輸資料流通服務' },
  { id: 'life', name: '生活與環境', note: '資料來源：政府開放資料' },
  { id: 'gov', name: '消費與政府服務', note: '防詐、油價、發票、股市：政府開放資料' },
];

// 格子與頁首的代表色（立體代幣）：交通依方式、生活與政府服務依主題
export const TILE_COLOR = { nearby: '#1d4ed8', bus: '#0f766e', bike: '#d97706', thsr: '#c2410c', tra: '#1d4ed8', metro: '#0e7490', weather: '#0284c7', aqi: '#0891b2', quake: '#b45309',
  pharmacy: '#15803d', garbage: '#475569', antifraud: '#b91c1c', fuel: '#9a3412', invoice: '#7c3aed', stock: '#be123c' };

/** 點進格子後的頁首（page-hero.js）：一句說明＋資料來源 */
export const HERO = {
  nearby: ['身邊 400 公尺的公車站', '交通部 TDX'],
  bus: ['查路線，看公車到哪了', '交通部 TDX'],
  bike: ['附近 YouBike 可借可還', '交通部 TDX'],
  thsr: ['高鐵時刻與票價', '交通部 TDX'],
  tra: ['台鐵時刻與票價', '交通部 TDX'],
  metro: ['捷運列車即時到站', '交通部 TDX'],
  weather: ['現在天氣與降雨機率', '中央氣象署'],
  aqi: ['附近測站的空氣品質', '環境部'],
  quake: ['最近的有感地震', '中央氣象署'],
  pharmacy: ['健保特約藥局與營業時間', '衛福部健保署'],
  garbage: ['附近垃圾車什麼時候來', '各縣市環保局'],
  fuel: ['本週汽油、柴油價格', '台灣中油'],
  invoice: ['開獎號碼與我的發票對獎', '財政部'],
  stock: ['台股收盤行情', '證交所、櫃買中心'],
};
