// 阿幫的「小程式」註冊表：首頁格子、路由都由這裡產生。
// 新增服務 = 寫一個 pages/xxx.js + 在這裡加一行；status: 'soon' 代表規劃中。
export const miniApps = [
  // 交通（第一階段）
  { id: 'nearby', group: 'transit', name: '附近', icon: 'pin', route: '#/nearby' },
  { id: 'bus', group: 'transit', name: '公車', icon: 'bus', route: '#/bus' },
  { id: 'bike', group: 'transit', name: 'YouBike', icon: 'bike', route: '#/nearby?tab=bike' },
  { id: 'thsr', group: 'transit', name: '高鐵', icon: 'hsr', route: '#/rail/thsr' },
  { id: 'tra', group: 'transit', name: '台鐵', icon: 'train', route: '#/rail/tra' },
  { id: 'metro', group: 'transit', name: '捷運', icon: 'metro', status: 'soon', source: 'TDX Metro' },
  // 生活（後續階段）
  { id: 'weather', group: 'life', name: '天氣', icon: 'sun', status: 'soon', source: '中央氣象署' },
  { id: 'aqi', group: 'life', name: '空氣品質', icon: 'air', status: 'soon', source: '環境部' },
  { id: 'quake', group: 'life', name: '地震', icon: 'quake', status: 'soon', source: '中央氣象署' },
  { id: 'pharmacy', group: 'life', name: '藥局', icon: 'pharmacy', status: 'soon', source: '健保署' },
  { id: 'garbage', group: 'life', name: '垃圾車', icon: 'trash', status: 'soon', source: '各縣市環保局' },
  { id: 'antifraud', group: 'gov', name: '防詐', icon: 'shield', route: '#/agent/antifraud' }, // M7：阿幫・防詐
  { id: 'fuel', group: 'gov', name: '油價', icon: 'fuel', status: 'soon', source: '台灣中油' },
  { id: 'invoice', group: 'gov', name: '發票對獎', icon: 'receipt', status: 'soon', source: '財政部' },
];

export const groups = [
  { id: 'transit', name: '交通出行', note: '資料來源：TDX 運輸資料流通服務' },
  { id: 'life', name: '生活與環境', note: '即將推出' },
  { id: 'gov', name: '消費與政府服務', note: '防詐：165 開放資料' },
];
