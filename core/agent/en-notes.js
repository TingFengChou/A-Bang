// 英文提問的討論串說明（S12c，2026-11-21）：示範規則的小幫手說明是中文，英文那一輪換成英文。
// 「@角色」標籤保留（畫面用它對應小幫手頭像）；只換後面的說明。地名等資料維持原文。對不上的就照原文（不亂翻）。
const RULES = [
  [/^先確認「(.+)」和「(.+)」在哪$/, (m) => `finding where ${m[1]} and ${m[2]} are`],
  [/^確認「(.+)」在哪$/, (m) => `finding where ${m[1]} is`],
  [/^找「(.+)」的位置$/, (m) => `finding ${m[1]}`],
  [/^「(.+)」在哪個縣市$/, (m) => `which city ${m[1]} is in`],
  [/^看一下外面的狀況$/, () => 'checking weather, air and traffic'],
  [/^幫你比較幾種走法$/, () => 'comparing ways to get there'],
  [/^看一下現在的天氣$/, () => 'checking the weather now'],
  [/^看一下明天的預報$/, () => "checking tomorrow's forecast"],
  [/^附近測站的空氣品質$/, () => 'air quality at the nearest station'],
  [/^附近還有車嗎$/, () => 'bikes and docks nearby'],
  [/^附近有哪些站牌$/, () => 'bus stops nearby'],
  [/^出門前幫你看一下$/, () => 'checking before you head out'],
  [/^(\S+) 現在到哪了，離你最近的站多久到$/, (m) => `where bus ${m[1]} is, and when it reaches the stop nearest you`],
  [/^(\S+) 現在到哪了$/, (m) => `where bus ${m[1]} is now`],
  [/^找(.*)最近的(.*)站，看下一班$/, () => 'nearest station, next train'],
  [/^(.+)站下一班$/, (m) => `next train at ${m[1]}`],
  [/^找(.+)最近的站，看到(.+)的班次$/, (m) => `nearest station, trains to ${m[2]}`],
  [/^(.+)到(.+)的班次$/, (m) => `trains from ${m[1]} to ${m[2]}`],
  [/^(.+)到(.+)的票價$/, (m) => `fares from ${m[1]} to ${m[2]}`],
  [/^依你的位置找這一區的健保藥局$/, () => 'NHI pharmacies in your area'],
  [/^「(.+)」那一區的健保藥局$/, (m) => `NHI pharmacies around ${m[1]}`],
  [/^(.+)的健保藥局$/, (m) => `NHI pharmacies in ${m[1]}`],
  [/^看 MyDrama 的(.+)$/, () => 'checking short dramas on MyDrama'],
  [/^在 MyDrama 找「(.+)」$/, (m) => `searching MyDrama for ${m[1]}`],
  [/^沒找到，改看熱門排行$/, () => 'nothing found; showing popular ones'],
  [/^看《(.+)》的簡介$/, (m) => `synopsis of 《${m[1]}》`],
  [/^你選了公車，我幫你盯 (\S+) 在「(.+)」的到站$/, (m) => `you picked the bus; watching ${m[1]} at ${m[2]}`],
  [/^先看 (\S+) 在「(.+)」今天有沒有車$/, (m) => `checking if bus ${m[1]} is running at ${m[2]}`],
  [/^(\S+) (今天沒有營運|末班已過|這站交管不停靠)，不列入，重新比較$/, (m) => `bus ${m[1]} ${({ 今天沒有營運: 'is not running today', 末班已過: 'has finished for the day', 這站交管不停靠: 'is not stopping there' })[m[2]]}; comparing again without it`],
];

/** 「@天氣 看一下現在的天氣」→「@天氣 checking the weather now」；對不上照原文 */
export function enNote(note) {
  const m = /^((?:@\S+\s+)*)(.*)$/.exec(String(note));
  const [tags, body] = [m[1], m[2].trim()];
  for (const [re, fn] of RULES) {
    const x = re.exec(body);
    if (x) return `${tags}${fn(x)}`;
  }
  return note;
}
