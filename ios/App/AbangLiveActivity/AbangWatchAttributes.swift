// 即時動態資料（App 與 Widget Extension 共用這個檔案）：到站提醒（kind "bus"）與出發倒數（kind "leave"，2026-11-28 第十四輪）
// 只有路線或車次、站名、提醒分鐘數與一句狀態；不放位置、不放個資。
import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct AbangWatchAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 「307 往撫遠街・約 5 分到「臺北車站(忠孝)」・到站前 2 分提醒你」
        var text: String
        /// 到站提醒：預估到站時間（沒有預估：尚未發車、這班來不及）；出發倒數：該出門的時間（照時刻表算的）
        var arrival: Date?
        /// 這個預估是什麼時候查的（App 在背景時 iOS 不讓查，鎖定畫面照實說）
        var updatedAt: Date
    }

    /// "bus"（到站提醒）或 "leave"（出發倒數：台鐵、高鐵、末班車的出門提醒）
    var kind: String
    /// 到站提醒：路線；出發倒數：「台鐵 2241」
    var routeName: String
    var stop: String
    var leadSec: Int
    /// "zh" 或 "en"
    var lang: String
    /// 最晚顯示到什麼時候（到站提醒 90 分鐘；出發倒數到開車後 10 分）
    var until: Date
}
