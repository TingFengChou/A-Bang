// 阿幫的 App Intents（M16-02，ADR-0021 第 1 階段）：Siri、捷徑、Spotlight、動作按鈕都叫得到阿幫。
// 只做「把事情交給 App」：問題、可疑訊息、要開的頁面放進收件匣（UserDefaults，只存最後一筆），打開 App 後由網頁接手
// （public/js/app-intents.js 經 AbangSystem.takeIntent／intent 事件讀取）。資料都在 App 裡照原本的流程查（core/ 唯一），
// 原生端不打 API、不念工具結果（防詐要經過防詐 agent 的完整判斷與護欄）。
import AppIntents
import Foundation

/** 捷徑交給 App 的事（App 沒開時先存著，開了再拿） */
enum AbangIntentInbox {
    static let key = "abang.intent.pending"
    static let posted = Notification.Name("AbangIntentPosted")

    static func put(kind: String, text: String) {
        UserDefaults.standard.set(["kind": kind, "text": text, "at": Date().timeIntervalSince1970], forKey: key)
        NotificationCenter.default.post(name: posted, object: nil)
    }

    static let takenKey = "abang.intent.takenAt"

    /** 拿出來就清掉；超過 10 分鐘的不算（使用者早就做別的事了）；拿過的（時間不比上次新）不再做第二次 */
    static func take() -> [String: Any]? {
        let d = UserDefaults.standard
        guard let v = d.dictionary(forKey: key) else { return nil }
        d.removeObject(forKey: key)
        guard let at = v["at"] as? Double, at > d.double(forKey: takenKey) else { return nil }
        d.set(at, forKey: takenKey)
        if Date().timeIntervalSince1970 - at > 600 { return nil }
        return v
    }
}

@available(iOS 16.0, *)
struct AskAbangIntent: AppIntent {
    static var title: LocalizedStringResource = "問阿幫"
    static var description = IntentDescription("把問題交給阿幫：怎麼去、公車多久到、天氣、藥局、發票……")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "問題", requestValueDialog: IntentDialog("想問阿幫什麼？"))
    var question: String

    @MainActor
    func perform() async throws -> some IntentResult {
        AbangIntentInbox.put(kind: "ask", text: String(question.prefix(500)))
        return .result()
    }
}

@available(iOS 16.0, *)
struct CheckScamIntent: AppIntent {
    static var title: LocalizedStringResource = "查詐騙"
    static var description = IntentDescription("把可疑的簡訊、網址或電話交給阿幫的防詐，比對 165 的詐騙手法。")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "可疑的訊息", requestValueDialog: IntentDialog("把可疑的簡訊、網址或電話號碼貼上來"))
    var message: String

    @MainActor
    func perform() async throws -> some IntentResult {
        AbangIntentInbox.put(kind: "scam", text: String(message.prefix(500))) // 問阿幫一輪最多 500 字
        return .result()
    }
}

/// 去政府辦事要帶什麼（M16-04a，2026-11-28：每個功能都想 App Functions）：只把「X 要帶什麼」交給 App，照問阿幫原本的流程查
@available(iOS 16.0, *)
struct GovServiceIntent: AppIntent {
    static var title: LocalizedStringResource = "辦事要帶什麼"
    static var description = IntentDescription("問阿幫去政府辦事要帶什麼：換身分證、健保卡補辦、戶籍謄本、敬老卡……")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "要辦的事", requestValueDialog: IntentDialog("要辦什麼事？例如換身分證、健保卡補辦"))
    var thing: String

    @MainActor
    func perform() async throws -> some IntentResult {
        AbangIntentInbox.put(kind: "ask", text: String("\(thing.prefix(40))要帶什麼"))
        return .result()
    }
}

/// 附近現在有看診的診所（M16-04e）：不用多說，交給 App 用手機位置查
@available(iOS 16.0, *)
struct ClinicNearbyIntent: AppIntent {
    static var title: LocalizedStringResource = "找有開的診所"
    static var description = IntentDescription("找附近現在有登記看診的診所（健保署資料；時段是登記的，出門前先打電話）。")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AbangIntentInbox.put(kind: "ask", text: "附近現在有開的診所")
        return .result()
    }
}

@available(iOS 16.0, *)
enum AbangPage: String, AppEnum {
    case nearby, weather, reminders, antifraud, invoice

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "阿幫的頁面"
    static var caseDisplayRepresentations: [AbangPage: DisplayRepresentation] = [
        .nearby: "附近公車與 YouBike",
        .weather: "天氣",
        .reminders: "提醒",
        .antifraud: "防詐",
        .invoice: "發票對獎",
    ]
}

@available(iOS 16.0, *)
struct OpenAbangPageIntent: AppIntent {
    static var title: LocalizedStringResource = "打開阿幫的頁面"
    static var description = IntentDescription("直接打開阿幫的附近、天氣、提醒、防詐或發票對獎。")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "頁面")
    var page: AbangPage

    @MainActor
    func perform() async throws -> some IntentResult {
        AbangIntentInbox.put(kind: "page", text: page.rawValue)
        return .result()
    }
}

@available(iOS 16.0, *)
struct AbangShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskAbangIntent(), phrases: [
            "問\(.applicationName)",
            "用\(.applicationName)問問題",
            "Ask \(.applicationName)",
        ], shortTitle: "問阿幫", systemImageName: "bubble.left.and.bubble.right")
        AppShortcut(intent: CheckScamIntent(), phrases: [
            "用\(.applicationName)查詐騙",
            "\(.applicationName)查詐騙",
            "Check a scam with \(.applicationName)",
        ], shortTitle: "查詐騙", systemImageName: "exclamationmark.shield")
        AppShortcut(intent: OpenAbangPageIntent(), phrases: [
            "打開\(.applicationName)的\(\.$page)",
            "\(.applicationName)\(\.$page)",
            "Open \(\.$page) in \(.applicationName)",
        ], shortTitle: "打開頁面", systemImageName: "square.grid.2x2")
        AppShortcut(intent: GovServiceIntent(), phrases: [
            "用\(.applicationName)查辦事要帶什麼",
            "\(.applicationName)辦事要帶什麼",
            "What to bring with \(.applicationName)",
        ], shortTitle: "辦事要帶什麼", systemImageName: "doc.text")
        AppShortcut(intent: ClinicNearbyIntent(), phrases: [
            "用\(.applicationName)找有開的診所",
            "\(.applicationName)附近有開的診所",
            "Find an open clinic with \(.applicationName)",
        ], shortTitle: "找有開的診所", systemImageName: "cross.case")
    }
}
