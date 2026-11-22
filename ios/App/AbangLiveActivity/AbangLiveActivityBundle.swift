// Widget Extension 入口：目前只有到站提醒的即時動態（沒有主畫面小工具）
import SwiftUI
import WidgetKit

@main
struct AbangLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        AbangLiveActivity()
    }
}
