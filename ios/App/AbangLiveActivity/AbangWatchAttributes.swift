// 到站提醒的即時動態資料（App 與 Widget Extension 共用這個檔案）
// 只有路線、站名、提醒分鐘數與一句狀態；不放位置、不放個資。
import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct AbangWatchAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 「307 往撫遠街・約 5 分到「臺北車站(忠孝)」・到站前 2 分提醒你」
        var text: String
        /// 預估到站時間（沒有預估：尚未發車、這班來不及）
        var arrival: Date?
        /// 這個預估是什麼時候查的（App 在背景時 iOS 不讓查，鎖定畫面照實說）
        var updatedAt: Date
    }

    var routeName: String
    var stop: String
    var leadSec: Int
    /// "zh" 或 "en"
    var lang: String
    /// 最晚盯到什麼時候（90 分鐘）
    var until: Date
}
