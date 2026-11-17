// 卡片文字字典（繁體中文，台灣用語；M4-03 🧩 多語預留，ADR-0007、PLATFORM.md）。
// 卡片程式不寫死任何使用者看得到的文字，一律用 t(key, vars)；新增語言時複製本檔改名（例 en.js），鍵相同。
// 佔位符 {name} 由 vars 帶入；缺鍵時回傳鍵本身，方便測試發現。

export const LOCALE = 'zh-TW';

export const MESSAGES = {
  // ── 共通 ──
  'common.demo': '示範資料',
  'common.loading': '更新中…',
  'common.updatedAt': '{time} 更新',
  'common.refreshFailed': '暫時無法更新・{time} 的資料',
  'common.retry': '重試',
  'common.navigate': '導航',
  'common.remind': '提醒我',
  'common.more': '看更多',
  'common.less': '收起',
  'common.estimated': '估算',
  'common.minutes': '{n} 分',
  'common.meters': '{n} 公尺',
  'common.km': '{n} 公里',
  'common.price': '{n} 元',
  'common.priceRange': '{low}～{high} 元',
  'common.empty': '目前沒有資料',
  'common.copyLink': '複製連結',
  'common.copied': '已複製',

  // ── L2 確認視窗（訂票、叫車；UX.md §6） ──
  'confirm.title': '要前往官方網站嗎？',
  'confirm.go': '前往官方網站',
  'confirm.cancel': '取消',
  'confirm.payNote': '付款在官方網站完成，阿幫不會取得你的付款資料',

  // ── bus-route ──
  'busRoute.title': '{route} 公車',
  'busRoute.switchDir': '切換方向',
  'busRoute.coming': '即將進站',
  'busRoute.plate': '車牌 {plate}',
  'busRoute.ask': '{route} 在「{stop}」下一班車什麼時候到？',
  'busRoute.context': '使用者在看 {route} 的「{stop}」站',

  // ── bus-station ──
  'busStation.title': '{name} 到站',
  'busStation.empty': '這個站目前沒有車要來',
  'busStation.outbound': '去程',
  'busStation.inbound': '返程',

  // ── nearby ──
  'nearby.title': '附近公車站',
  'nearby.empty': '附近 {radius} 公尺沒有公車站',
  'nearby.expand': '擴大到 1 公里找找看',
  'nearby.expandAsk': '幫我找附近 1 公里內的公車站',
  'nearby.routes': '經過 {routes}',

  // ── youbike ──
  'youbike.title': '附近 YouBike',
  'youbike.sortRent': '借車',
  'youbike.sortReturn': '還車',
  'youbike.rent': '可借 {n}',
  'youbike.electric': '電輔 {n}',
  'youbike.return': '可還 {n}',
  'youbike.outOfService': '暫停營運',
  'youbike.empty': '附近 {radius} 公尺沒有 YouBike 站',

  // ── metro ──
  'metro.title': '{station} 即時到站',
  'metro.toward': '往 {dest}',
  'metro.empty': '目前沒有即時到站資料',

  // ── timetable ──
  'timetable.title.THSR': '高鐵 {from} → {to}',
  'timetable.title.TRA': '台鐵 {from} → {to}',
  'timetable.title.BUS': '國道客運 {from} → {to}',
  'timetable.duration': '{n} 分鐘',
  'timetable.book': '訂票',
  'timetable.excluded': '{why}',
  'timetable.nextDay': '隔日',
  'timetable.delay': '塞車多 {n} 分',
  'timetable.board': '{stop} 上車',
  'timetable.empty': '{date} 沒有符合的班次',

  // ── trip ──
  'trip.title': '{from} → {to}',
  'trip.best': '建議',
  'trip.alternatives': '備案',
  'trip.arrive': '{time} 到',
  'trip.wait': '等 {n} 分',
  'trip.walk': '走 {n} 分',
  'trip.score': '{n} 分',
  'trip.excluded': '已排除',
  'trip.states': '目前狀況',
  'trip.state.auto': '自動判斷',
  'trip.state.user': '你說的',
  'trip.state.picked': '你選的',
  'trip.ridehail': '叫車',
  'trip.book': '訂票',
  'trip.leg.walk': '走路',
  'trip.leg.bike': 'YouBike',
  'trip.leg.bus': '公車',
  'trip.leg.transit': '市區轉乘',
  'trip.leg.thsr': '高鐵',
  'trip.leg.tra': '台鐵',
  'trip.leg.intercity': '客運',
  'trip.leg.ridehail': '叫車',
  'trip.none': '這段路找不到可行的交通方式',
};

/**
 * 取字典文字並帶入佔位符。
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 */
export function t(key, vars = {}) {
  const msg = MESSAGES[key];
  if (msg == null) return key;
  return msg.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
}
