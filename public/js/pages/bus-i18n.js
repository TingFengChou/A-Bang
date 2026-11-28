// 公車路線頁的文字字典（S12g，2026-11-21）：網址帶 lang=en（觀光客從英文對話的「Open bus page」進來）時整頁用英文。
// 跟卡片字典（public/ui/cards/i18n/）同一套做法：鍵相同、佔位符 {name}、英文缺鍵退回中文、英文單數用 key.one。
// 站名、路線名是資料，照原文；這裡只放阿幫自己寫的字。中文的值與改版前的畫面一字不差（沒帶 lang 時行為不變）。

export const ZH = {
  'title': '{route} 公車',
  'save': '收藏',
  'saved': '已加入收藏',
  'unsaved': '已取消收藏',
  'loading': '載入中…',
  'netError': '目前連不上網路，連上後再試一次',
  'loadFail': '{route} 公車資料這次查不到（不是沒有車）；可以再試一次，或問阿幫改搭其他方式',
  'pickHint': '點站名設成上車站，就能設到站提醒和下車提醒。',
  'pickHintChange': '點其他站名可以改上車站。',
  'announceSoon': '{route} 即將進站：{stops}',
  'updated': '更新於 {time}・每 20 秒自動更新',
  'stale': '離線：這是 {time} 存下的資料，連上網路後自動更新',
  'yesterday': '昨天 {time}',
  'busHere': '公車在這附近',
  'stopPick': '{stop}，設為上車站',
  'boardHere': '您在這上車',
  'offHere': '您在這下車',
  'plateSoon': '{plate} 即將抵達',
  'picked': '上車站：{stop}。可以設提醒了',
  'pickedKeep': '上車站：{stop}。原本的提醒還在，可在上方取消',
  'otherArrival': '另有提醒：「{stop}」到站前 {n} 分',
  'otherArrivalRiding': '另有到站提醒：「{stop}」到站前 {n} 分',
  'otherAlight': '另有下車提醒：在「{stop}」下車',
  'focusAt': '到「{stop}」',
  'ridingPre': '車快到「{stop}」了，上車後開始算',
  'riding': '坐車中・從「{stop}」上車',
  'rideShort': '坐車中',
  'rideShortSoon': '快到了',
  'rideShortMin': '約 {n} 分',
  'rideLeftTo': '往「{stop}」',
  'rideLeftSoon': '快到「{stop}」了',
  'rideLeftMin': '約 {n} 分到「{stop}」',
  'alertSet': '已設定：到站前 {n} 分提醒您（{when}）',
  'alertNext': '這班快到了、可能趕不上；下一班到站前 {n} 分提醒您（{when}）',
  'alertCancel': '取消提醒',
  'alertBtn': '到站前 {n} 分提醒我',
  'alertToast': '好，{route} 到「{stop}」前 {n} 分提醒您',
  'cancel': '取消',
  'cancelWhat': '取消：{text}',
  'canceled': '已取消提醒',
  'alightOn': '下車提醒：快到「{stop}」前約 2 分提醒您',
  'alightNoPerm': '沒有通知權限：App 關著時不會提醒，請開著畫面。',
  'alightCancel': '取消下車提醒',
  'alightCanceled': '已取消下車提醒',
  'alightPick': '上車了嗎？要在哪一站下車？',
  'alightGo': '快到時提醒我下車',
  'alightFail': '估不出要坐多久，請重新整理後再試',
  'alightToast': '好，快到「{stop}」時提醒您下車',
  'alightToastDropped': '好，快到「{stop}」時提醒您下車（到站提醒已取消）',
  'askContext': '使用者正在看 {route} 公車的即時動態',
  'askContextStop': '使用者正在看 {route} 公車的即時動態，上車站「{stop}」',
  'askChip': '{route} 到哪了？',
  'askChipStop': '{route} 到哪了？我在{stop}',
};

export const EN = {
  'title': 'Bus {route}',
  'save': 'Save route',
  'saved': 'Saved',
  'unsaved': 'Removed from saved',
  'loading': 'Loading…',
  'netError': "Can't connect right now. Try again when you're online.",
  'loadFail': "Couldn't load bus {route} this time (that doesn't mean there's no bus). Try again, or ask A-Bang for another way.",
  'pickHint': 'Tap a stop to set where you get on. Then you can set arrival and get-off reminders.',
  'pickHintChange': 'Tap another stop to change where you get on.',
  'announceSoon': 'Bus {route} arriving soon: {stops}',
  'updated': 'Updated {time} · refreshes every 20 sec',
  'stale': "Offline: showing data from {time}. It updates when you're back online.",
  'yesterday': 'yesterday {time}',
  'busHere': 'Bus is near here',
  'stopPick': '{stop}, set as your stop',
  'boardHere': 'You get on here',
  'offHere': 'You get off here',
  'plateSoon': '{plate} arriving soon',
  'picked': 'Your stop: {stop}. You can set reminders now.',
  'pickedKeep': 'Your stop: {stop}. Your earlier reminder is still on. You can cancel it above.',
  'otherArrival': 'Reminder {n} min before {stop}',
  'otherArrivalRiding': 'Arrival reminder {n} min before {stop}',
  'otherAlight': 'Get-off reminder at {stop}',
  'focusAt': 'At {stop}',
  'ridingPre': 'Bus is almost at {stop}. Timing starts once you get on.',
  'riding': 'On the bus · got on at {stop}',
  'rideShort': 'On the bus',
  'rideShortSoon': 'Almost there',
  'rideShortMin': '{n} min',
  'rideLeftTo': 'To {stop}',
  'rideLeftSoon': 'Almost at {stop}',
  'rideLeftMin': '{n} min to {stop}',
  'alertSet': "Set: I'll remind you {n} min before it arrives ({when})",
  'alertNext': "This bus is almost here and you may miss it. I'll remind you {n} min before the next one ({when})",
  'alertCancel': 'Cancel reminder',
  'alertBtn': 'Remind me {n} min before',
  'alertToast': "OK, I'll remind you {n} min before bus {route} reaches {stop}",
  'cancel': 'Cancel',
  'cancelWhat': 'Cancel: {text}',
  'canceled': 'Reminder cancelled',
  'alightOn': "Get-off reminder: I'll alert you about 2 min before {stop}",
  'alightNoPerm': "Notifications are off, so I can't remind you when the app is closed. Keep this screen open.",
  'alightCancel': 'Cancel get-off reminder',
  'alightCanceled': 'Get-off reminder cancelled',
  'alightPick': 'On the bus? Where do you get off?',
  'alightGo': 'Remind me before my stop',
  'alightFail': "Can't estimate the ride time. Refresh and try again.",
  'alightToast': "OK, I'll remind you to get off before {stop}",
  'alightToastDropped': "OK, I'll remind you to get off before {stop} (arrival reminder cancelled)",
  'askContext': 'The user is looking at live info for bus {route}',
  'askContextStop': 'The user is looking at live info for bus {route}, getting on at "{stop}"',
  'askChip': 'Where is bus {route}?',
  'askChipStop': "Where is bus {route}? I'm at {stop}",
};

/** 網址的 lang：只認 en，其他一律中文 */
export const pageLang = (query = {}) => (query.lang === 'en' ? 'en' : null);

/**
 * 指定語言的 t（英文缺鍵退回中文；缺鍵回傳鍵本身，測試抓得到）。
 * @param {'en'|null} lang
 * @returns {(key: string, vars?: Record<string, any>) => string}
 */
export function busT(lang) {
  const dict = lang === 'en' ? EN : ZH;
  return (key, vars = {}) => {
    const msg = (vars.n === 1 && dict[`${key}.one`]) || dict[key] || ZH[key];
    if (msg == null) return key;
    return msg.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  };
}
