# 意圖與狀態判斷小實驗（2026-11-20 10:55 台灣時間）

評估集：`scripts/eval/decision-set.json`，172 題自行撰寫的繁中提問（63 題容易、109 題困難：口語、沒有關鍵字、追問），intent 15 類、states 6 種。

| 方法 | 意圖正確率 | 容易 | 困難 | 狀態 precision | 狀態 recall | 狀態 F1 | 意圖＋狀態全對 | 延遲 p50／p95 | 錯誤 |
|---|---|---|---|---|---|---|---|---|---|
| 規則（示範模式） | 68.0% | 96.8% | 51.4% | 88.5% | 67.6% | 76.7% | 64.0% | 0／0 ms | 0 |

## 規則（示範模式） 答錯的題目（55）

- 11「我快遲到了！現在人在台大，要趕去南港展覽館」：答 unknown，應為 trip
- 13「預算有限，從師大夜市回台北車站有什麼便宜的方式」：答 unknown，應為 trip
- 15「外面雨好大，等等要從公司（信義區）回家（板橋）」：答 unknown，應為 trip
- 16「霧霾好重，帶著小孩要從內湖去動物園」：答 aqi，應為 trip
- 20「帶著嬰兒車和行李去高鐵站，從民生社區出發」：答 unknown，應為 trip
- 30「到桃園機場最快的方式，我在台北車站」：答 unknown，應為 trip
- 31「去陽明山有公車嗎」：答 unknown，應為 trip
- 33「我腳受傷，從台大醫院回永和」：答 unknown，應為 trip
- 34「YouBike 還是公車比較快？從公館到台北車站」：答 youbike，應為 trip
- 36「有長輩跟小孩，空氣也很髒，去兒童新樂園」：答 unknown，應為 trip
- 37「很急！西門到松山機場」：答 unknown，應為 trip
- 38「坐什麼最便宜？台北到台中」：答 unknown，應為 trip
- 41「附近可以坐什麼公車去101」：答 nearby_bus，應為 trip
- 45「藍15到站時間」：答 unknown，應為 bus_route
- 46「我在等的那班 299 怎麼還沒來」：答 unknown，應為 bus_route
- 47「幫我看一下 綠1 現在開到哪」：答 unknown，應為 bus_route
- 49「想知道棕9末班車走了沒」：答 unknown，應為 bus_route
- 50「1503 往基隆的車還要多久」：答 unknown，應為 bus_route
- 51「601 現在在哪一站」：答 unknown，應為 bus_route
- 52「我在公車站等307，還要多久」：答 unknown，應為 bus_route
- 53「299 末班車幾點」：答 unknown，應為 bus_route
- 63「離我最近的站牌在哪」：答 unknown，應為 nearby_bus
- 68「板南線往南港的車還要多久」：答 unknown，應為 metro
- 69「忠孝復興站文湖線多久一班」：答 unknown，應為 metro
- 70「MRT 西門站下一班車」：答 unknown，應為 metro
- 71「中山站的紅線下一班」：答 unknown，應為 metro
- 72「文湖線現在有沒有誤點」：答 unknown，應為 metro
- 73「淡水信義線往象山多久一班」：答 unknown，應為 metro
- 79「搭高鐵去台南要多久，幾點有車」：答 unknown，應為 rail
- 81「今天還有回台中的高鐵嗎」：答 unknown，應為 rail
- 83「自強號幾點開」：答 unknown，應為 rail
- 90「晚上會很冷嗎」：答 unknown，應為 weather
- 91「外面在下雨嗎」：答 unknown，應為 weather
- 92「明天會下雨嗎」：答 unknown，應為 weather
- 93「颱風要來了嗎」：答 unknown，應為 weather
- 97「現在適合出門跑步嗎？空氣會不會很髒」：答 unknown，應為 aqi
- 100「小孩氣喘，今天空氣ok嗎」：答 unknown，應為 aqi
- 101「今天要戴口罩嗎」：答 unknown，應為 aqi
- 104「剛剛是不是有在搖」：答 unknown，應為 quake
- 113「哪裡可以買退燒藥」：答 unknown，應為 pharmacy
- 120「資源回收車幾點到」：答 unknown，應為 garbage
- 125「加滿一桶油大概要多少錢」：答 unknown，應為 fuel
- 134「幫我對一下 54348835 這張」：答 unknown，應為 invoice
- 135「特別獎號碼」：答 unknown，應為 invoice
- 136「上一期的頭獎是多少」：答 unknown，應為 invoice
- 142「聯發科現在多少錢一股」：答 unknown，應為 stock
- 143「我該買台積電嗎？」：答 unknown，應為 stock
- 145「0056 殖利率」：答 unknown，應為 stock
- 146「鴻海今天表現如何」：答 unknown，應為 stock
- 154「307 到哪了？ → 那 262 呢」：答 unknown，應為 bus_route
- 155「大安區有哪些藥局 → 那中山區呢」：答 unknown，應為 pharmacy
- 156「台中天氣如何 → 那高雄呢」：答 unknown，應為 weather
- 158「從西門町到台北101怎麼去 → 可是我很趕」：答 unknown，應為 trip
- 159「從台北車站到松山機場 → 我有帶行李喔」：答 unknown，應為 trip
- 160「發票 12345678 有沒有中 → 那 87654321 呢」：答 unknown，應為 invoice

