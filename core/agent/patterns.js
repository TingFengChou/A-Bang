// 規則判斷共用的寫法（架構第二輪 #4 第一步：公車路線號碼原本在 demo-intent、ask、clarify、run 各寫一份，改一處容易漏另一處）。
// 只放「寫法完全相同」的；刻意不同的（vision-text 不收 0 開頭）各自保留。

/** 公車路線號碼（台北的紅藍綠棕橘小幹、區間、副線）：給 new RegExp 組字串用 */
export const ROUTE_NO = '[紅藍綠棕橘小幹]?\\d{1,4}[區副]?';
/** 整句就是一個路線號碼（「307」「紅30」「綠1區」） */
export const ROUTE_EXACT = new RegExp(`^${ROUTE_NO}$`);
/** 阿幫說過的「公車 307」：取出路線號碼 */
export const SAID_BUS_ROUTE = new RegExp(`公車\\s*(${ROUTE_NO})`);
