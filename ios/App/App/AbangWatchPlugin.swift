// 到站提醒的即時動態（Live Activity）：鎖定畫面與動態島顯示還要多久（JS：public/js/native-watch.js，外掛名 AbangWatch）。
// 介面跟 Android 的 AbangWatchPlugin 一樣（start／stop／status），多一個 update：
// iOS 不讓 App 在背景一直查到站時間，所以這裡不連網；App 開著時畫面每次查到就呼叫 update 更新，
// 鎖定畫面用系統倒數（Text(timerInterval:)）走到預估到站。真正的提醒照舊是排好的本機通知。
// 提醒響過、取消、末班已過、超過 90 分鐘：畫面呼叫 stop 結束；App 被關掉後過期的，下次打開時清掉。
import ActivityKit
import Capacitor
import Foundation

@objc(AbangWatchPlugin)
public class AbangWatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AbangWatchPlugin"
    public let jsName = "AbangWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    /// 最長盯多久（跟畫面一樣 90 分鐘）
    private static let maxSec: TimeInterval = 90 * 60

    override public func load() {
        if #available(iOS 16.2, *) {
            Task { await Self.endExpired() }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.reject("這支 iPhone 不支援即時動態"); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.reject("即時動態已關閉"); return }
        guard let route = call.getString("routeName"), !route.isEmpty,
              let stop = call.getString("stop"), !stop.isEmpty else { call.reject("參數不完整"); return }
        let lang = call.getString("lang") == "en" ? "en" : "zh"
        let lead = max(60, call.getInt("leadSec") ?? 180)
        let now = Date()
        var until = now.addingTimeInterval(Self.maxSec)
        if let ms = call.getDouble("until"), ms > 0 {
            until = min(until, Date(timeIntervalSince1970: ms / 1000))
        }
        guard until > now else { call.reject("提醒已過期"); return }
        let attrs = AbangWatchAttributes(routeName: route, stop: stop, leadSec: lead, lang: lang, until: until)
        let first = lang == "en" ? "Watching bus \(route) at \(stop)" : "正在幫你盯 \(route)（\(stop)）"
        let state = AbangWatchAttributes.ContentState(text: first, arrival: nil, updatedAt: now)
        let old = Activity<AbangWatchAttributes>.activities // 現在就記下要結束哪些（不會結束等一下新開的）
        Task {
            await Self.end(old)
            do {
                _ = try Activity.request(attributes: attrs, content: ActivityContent(state: state, staleDate: until), pushType: nil)
                call.resolve(["polls": false, "live": true])
            } catch {
                call.reject("無法顯示即時動態")
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("參數不完整"); return }
        let now = Date()
        let arrival = call.getInt("etaSec").map { now.addingTimeInterval(TimeInterval(max(0, $0))) }
        Task {
            for a in Activity<AbangWatchAttributes>.activities where a.activityState == .active {
                let until = a.attributes.until
                if now >= until { await a.end(nil, dismissalPolicy: .immediate); continue }
                // 過了預估到站一分鐘還沒有新的預估（App 在背景）：鎖定畫面改說「打開阿幫看最新」
                let stale = arrival.map { min($0.addingTimeInterval(60), until) } ?? until
                let state = AbangWatchAttributes.ContentState(text: text, arrival: arrival, updatedAt: now)
                await a.update(ActivityContent(state: state, staleDate: stale))
            }
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        // 畫面重設提醒時是先 stop 再 start（不等 stop 完）：只結束呼叫當下已經有的，免得把緊接著新開的也結束
        let old = Activity<AbangWatchAttributes>.activities
        Task {
            await Self.end(old)
            call.resolve()
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        var active = false
        if #available(iOS 16.2, *) {
            active = Activity<AbangWatchAttributes>.activities.contains { $0.activityState == .active }
        }
        // iOS 不在背景查：提醒由本機通知送、末班已過由畫面判斷，所以 firedAt／endedAt 一律 0
        call.resolve(["active": active, "firedAt": 0, "endedAt": 0, "polls": false])
    }

    @available(iOS 16.2, *)
    private static func end(_ list: [Activity<AbangWatchAttributes>]) async {
        for a in list {
            await a.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// App 被關掉後留下、已經超過 90 分鐘的即時動態
    @available(iOS 16.2, *)
    private static func endExpired() async {
        let now = Date()
        for a in Activity<AbangWatchAttributes>.activities where now >= a.attributes.until {
            await a.end(nil, dismissalPolicy: .immediate)
        }
    }
}
