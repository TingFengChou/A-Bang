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
  { id: 'antifraud', source: 'antifraud', group: 'safe', name: '防詐', icon: 'shield', route: '#/agent/antifraud' }, // M7：阿幫・防詐
  { id: 'fuel', source: 'opendata', group: 'gov', name: '油價', icon: 'fuel', route: '#/s/fuel' },
  { id: 'invoice', source: 'opendata', group: 'gov', name: '發票對獎', icon: 'receipt', route: '#/s/invoice' },
  { id: 'stock', source: 'opendata', group: 'gov', name: '股市', icon: 'chart', route: '#/s/stock' },
];

export const groups = [
  { id: 'transit', name: '交通', note: '交通部 TDX' },
  { id: 'life', name: '生活', note: '氣象署、環境部、健保署、環保局' },
  { id: 'gov', name: '消費與政府', note: '中油、財政部、證交所' },
  { id: 'safe', name: '防詐', note: '165 全民防騙網' },
];

/** 服務總覽（#/services）的一句說明：沿用頁首的說法（HERO），沒有頁首的另寫 */
export const DESC = { antifraud: '可疑簡訊、電話、網址，貼上來幫您看' };
export const descOf = (id) => DESC[id] || HERO[id]?.[0] || '';

// 格子與頁首的代表色（立體代幣）：交通依方式、生活與政府服務依主題
export const TILE_COLOR = { nearby: '#1d4ed8', bus: '#0f766e', bike: '#d97706', thsr: '#c2410c', tra: '#1e3a8a', metro: '#0e7490', weather: '#0284c7', aqi: '#0d9488', quake: '#b45309',
  pharmacy: '#15803d', garbage: '#475569', antifraud: '#b91c1c', fuel: '#9a3412', invoice: '#7c3aed', stock: '#be123c' };

/** 點進格子後的頁首（page-hero.js）：一句「在這裡可以做什麼」（不重複卡片標題）＋資料來源 */
/** 內容多的頁面用精簡頁首（圖示小、只有一行），資料早點出現 */
export const HERO_COMPACT = new Set(['nearby', 'bike', 'thsr', 'tra', 'pharmacy', 'garbage']);
export const HERO = {
  nearby: ['身邊有哪些公車站', '交通部 TDX'],
  bus: ['查路線，看公車到哪了', '交通部 TDX'],
  bike: ['附近 YouBike 借得到、還得了嗎', '交通部 TDX'],
  thsr: ['下一班高鐵幾點、多少錢', '交通部 TDX'],
  tra: ['下一班火車幾點、多少錢', '交通部 TDX'],
  metro: ['下一班捷運還要等多久', '交通部 TDX'],
  weather: ['要不要帶傘、穿多少', '中央氣象署'],
  aqi: ['出門要不要戴口罩', '環境部'],
  quake: ['剛剛是不是地震了', '中央氣象署'],
  pharmacy: ['附近哪家藥局開著', '衛福部健保署'],
  garbage: ['垃圾車幾點到您家附近', '各縣市環保局'],
  fuel: ['這週加一公升多少錢', '台灣中油'],
  invoice: ['這期發票有沒有中獎', '財政部'],
  stock: ['查個股，看今天收多少', '證交所、櫃買中心'],
};
