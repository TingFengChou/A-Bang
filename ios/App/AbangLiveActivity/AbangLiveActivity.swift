// 即時動態：到站提醒與出發倒數（kind "leave"，第十四輪）；鎖定畫面（淺色）與動態島（精簡、展開、最小）。
// 跟 Android 通知列常駐的說法一樣：「307 往撫遠街・約 5 分到「臺北車站(忠孝)」・到站前 2 分提醒你」，
// 右上角用系統倒數（Text(timerInterval:)）走到預估到站；App 不在前景時不會有新的預估，照實寫「HH:mm 的預估」。
import ActivityKit
import SwiftUI
import WidgetKit

private let brand = Color(red: 0x0F / 255, green: 0x76 / 255, blue: 0x6E / 255) // 品牌青 #0F766E
private let ink = Color(red: 0x1F / 255, green: 0x2A / 255, blue: 0x44 / 255) // 夜藍 #1F2A44
private let mint = Color(red: 0xE1 / 255, green: 0xF5 / 255, blue: 0xEE / 255) // 薄荷 #E1F5EE
private let glow = Color(red: 0x5E / 255, green: 0xEA / 255, blue: 0xD4 / 255) // 光暈（動態島黑底上用）

struct AbangLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AbangWatchAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Color.white)
                .activitySystemActionForegroundColor(brand)
        } dynamicIsland: { context in
            let en = context.attributes.lang == "en"
            let icon = context.attributes.kind == "leave" ? "figure.walk" : "bus.fill"
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(context.attributes.routeName).font(.headline).foregroundStyle(.white)
                    } icon: {
                        Image(systemName: icon).foregroundStyle(glow)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(state: context.state, stale: context.isStale, en: en, leave: context.attributes.kind == "leave")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(glow)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 88, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(context.state.text)
                            .font(.subheadline)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                        Footnote(state: context.state, stale: context.isStale, en: en, leave: context.attributes.kind == "leave", short: true)
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.7))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                HStack(spacing: 3) {
                    Image(systemName: icon).foregroundStyle(glow)
                    Text(context.attributes.routeName).foregroundStyle(.white).lineLimit(1)
                }
                .font(.caption.weight(.semibold))
            } compactTrailing: {
                Countdown(state: context.state, stale: context.isStale, en: en, leave: context.attributes.kind == "leave")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(glow)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 44, alignment: .trailing)
            } minimal: {
                Image(systemName: icon).foregroundStyle(glow)
            }
            .keylineTint(brand)
        }
    }
}

/// 鎖定畫面：淺色卡片
private struct LockScreenView: View {
    let context: ActivityViewContext<AbangWatchAttributes>

    var body: some View {
        let en = context.attributes.lang == "en"
        let leave = context.attributes.kind == "leave"
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label(leave ? (en ? "Abang · time to leave" : "阿幫・出發倒數") : (en ? "Abang · bus reminder" : "阿幫・到站提醒"), systemImage: leave ? "figure.walk" : "bus.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(brand)
                Spacer(minLength: 8)
                Countdown(state: context.state, stale: context.isStale, en: en, leave: context.attributes.kind == "leave")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(ink)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 110, alignment: .trailing)
            }
            Text(context.state.text)
                .font(.subheadline)
                .foregroundStyle(ink)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            if let a = context.state.arrival, context.state.updatedAt < a, !context.isStale {
                ProgressView(timerInterval: context.state.updatedAt...a, countsDown: false, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                    .tint(brand)
            }
            Footnote(state: context.state, stale: context.isStale, en: en, leave: context.attributes.kind == "leave")
                .font(.caption2)
                .foregroundStyle(ink.opacity(0.6))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(alignment: .topTrailing) {
            Circle().fill(mint).frame(width: 90, height: 90).offset(x: 30, y: -40)
        }
    }
}

/// 倒數到預估到站（系統自己走，不用 App 更新）；已過或沒有預估時用文字
private struct Countdown: View {
    let state: AbangWatchAttributes.ContentState
    let stale: Bool
    let en: Bool
    var leave = false

    var body: some View {
        let now = Date()
        if let a = state.arrival, a > now, !stale {
            Text(timerInterval: now...a, countsDown: true)
                .monospacedDigit()
        } else if state.arrival != nil {
            Text(leave ? (en ? "Go now" : "該出門了") : (en ? "Due" : "進站中"))
        } else {
            Text("—")
        }
    }
}

/// 「14:05 的預估・App 開著時更新」（short：動態島只寫「14:05 的預估」）；過時：「預估可能過時，打開阿幫看最新」
private struct Footnote: View {
    let state: AbangWatchAttributes.ContentState
    let stale: Bool
    let en: Bool
    var leave = false
    var short = false

    var body: some View {
        if leave { // 出發倒數：時間照時刻表算的，不用連網也會走；過了開車時間說可能已經開走
            if stale { return Text(verbatim: en ? "The train may have left. Open Abang for the next one." : "這班可能已經開走了，打開阿幫看下一班") }
            return Text(verbatim: short ? (en ? "From the timetable" : "照時刻表算的") : (en ? "From the timetable · counts down without data" : "照時刻表算的・不用連網也會倒數"))
        }
        let f = DateFormatter()
        f.dateFormat = "HH:mm" // 跟 App 裡一樣用 24 小時制（台灣時間由手機時區決定）
        let hm = f.string(from: state.updatedAt)
        if stale {
            return Text(verbatim: en ? "May be out of date. Open Abang for the latest." : "預估可能過時，打開阿幫看最新")
        }
        if en {
            return Text(verbatim: short ? "Estimated at \(hm)" : "Estimated at \(hm) · updates while Abang is open")
        }
        return Text(verbatim: short ? "\(hm) 的預估" : "\(hm) 的預估・App 開著時更新")
    }
}
