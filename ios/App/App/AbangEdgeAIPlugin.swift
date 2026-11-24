// 裝置端 AI 判斷（ADR-0014）：Apple Intelligence（Foundation Models）在手機上判斷意圖與狀態。
// JS 端：public/js/edge-judge.js（Capacitor 外掛名 AbangEdgeAI）。只回 { engine, result: { intent, states, ask? } }（ask：要不要先問一題，ADR-0020），
// write（ADR-0017）：把伺服器的程式版總結改寫成自然的一兩句；數字由 JS 的程式護欄檢查，不過就用程式版。
// suggest（AGENT.md §5.5）：猜使用者接下來想問的話。優先順序 judge ＞ write ＞ suggest：judge、write 開始前都先取消正在跑的 suggest。
// iOS 26 以下、機型不支援、沒開 Apple Intelligence、模型還在下載、語言不支援 → status 回 available: false，judge 回錯誤，JS 改由伺服器判斷。
// status 另外回報系統查得到的模型資訊（「阿幫的腦袋」#/ai 顯示；查不到的欄位就不回傳，不編造）：availability、languages、contextSize、osVersion。
import Foundation
import UIKit
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

@objc(AbangEdgeAIPlugin)
public class AbangEdgeAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AbangEdgeAIPlugin"
    public let jsName = "AbangEdgeAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prewarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "judge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "suggest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelSuggest", returnType: CAPPluginReturnPromise),
    ]
    /// 正在跑的 suggest（judge 或 cancelSuggest 來時取消：judge 優先）；結束時比對同一個再清掉
    private var suggestTask: Task<Void, Never>?
    private var suggestID = 0
    /// 取消記號：每次取消加一；還沒呼叫模型的 suggest 看到記號變了就不跑（PR #112 審查）
    private var suggestToken = 0
    private let suggestLock = NSLock()

    /// 最近一次取消 suggest 的時間
    private var suggestCancelledAt = Date.distantPast
    /// 取消建議後這段時間內的「忙碌」類錯誤不算模型壞掉（產品負責人 2026-11-21；與 Android BUSY_GRACE_MS 相同）
    static let busyGrace: TimeInterval = 3

    /// 取消 suggest：不論模型開始跑了沒有（記號加一），有 suggest 在等或在跑就記取消時間；回傳有沒有取消到
    @discardableResult private func stopSuggest() -> Bool {
        suggestLock.lock(); defer { suggestLock.unlock() }
        suggestToken += 1
        guard let t = suggestTask else { return false }
        suggestTask = nil
        t.cancel()
        suggestCancelledAt = Date()
        return true
    }

    /// 自己逾時：也記取消時間（模型可能還在收尾）
    private func noteSuggestTimeout() { suggestLock.lock(); suggestCancelledAt = Date(); suggestLock.unlock() }
    /// 這一次還有效嗎（沒被取消）
    private func suggestValid(_ token: Int) -> Bool { suggestLock.lock(); defer { suggestLock.unlock() }; return suggestToken == token }
    /// 結束時清掉（比對同一個，不清到下一次的）
    private func suggestDone(_ id: Int) { suggestLock.lock(); if suggestID == id { suggestTask = nil }; suggestLock.unlock() }

    /// App 在前景嗎（UIApplication 的狀態只能在主執行緒讀）。不在前景時 Foundation Models 會限流或拒絕：不呼叫，回 background（JS 不跳斷路器，交給伺服器／規則）
    static func appActive() -> Bool {
        if Thread.isMainThread { return UIApplication.shared.applicationState == .active }
        return DispatchQueue.main.sync { UIApplication.shared.applicationState == .active }
    }
    /// 系統暫時不讓用（不是模型壞掉）：App 不在前景時的錯誤（含限流）→ "background"；JS 不跳斷路器，這一題交給伺服器或規則
    private func softReason(_ error: Error) -> String? {
        if !Self.appActive() { return "background" }
        return nil
    }

    /// 剛取消建議（3 秒內）又遇到忙碌類錯誤（同時有請求在跑、被限流、取消中）：這一題回 busy 交給伺服器
    private func busyAfterCancel(_ error: Error) -> Bool {
        suggestLock.lock(); let at = suggestCancelledAt; suggestLock.unlock()
        guard Date().timeIntervalSince(at) < Self.busyGrace else { return false }
        if error is CancellationError { return true }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), AppleJudge.code(error) == "rateLimited" { return true }
        #endif
        return String(describing: error).lowercased().contains("concurrent")
    }

    /// 使用者送出問題了：取消正在跑的 suggest（JS edge-judge.js cancelSuggest；judge 自己也會先取消）
    @objc func cancelSuggest(_ call: CAPPluginCall) {
        call.resolve(["cancelled": stopSuggest()])
    }

    @objc func status(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let s = AppleJudge.status()
            var out: [String: Any] = ["available": s.available, "engine": "apple", "reason": s.reason, "osVersion": Self.osVersion, "write": true, "suggest": true] // write：也能寫回答（ADR-0017）；suggest：也能猜下一句
            for (k, v) in AppleJudge.info() { out[k] = v }
            call.resolve(out)
            return
        }
        #endif
        call.resolve(["available": false, "engine": "apple", "reason": "os-too-old", "osVersion": Self.osVersion])
    }

    /// 系統版本（例：26.1；只在這支手機上顯示）
    private static var osVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return v.patchVersion > 0 ? "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)" : "\(v.majorVersion).\(v.minorVersion)"
    }

    @objc func prewarm(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), AppleJudge.status().available {
            let ins = call.getString("instructions") ?? ""
            Task { await AppleJudge.shared.prewarm(instructions: ins) }
        }
        #endif
        call.resolve()
    }

    @objc func judge(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("沒有句子"); return }
        let history = (call.getArray("history") as? [String]) ?? []
        let context = String((call.getString("context") ?? "").prefix(400)) // 只在手機上組的情境（不含座標；與 JS JUDGE_CONTEXT_MAX 相同）
        stopSuggest() // judge 優先：正在猜下一句就先取消，模型讓給這一題
        let instructions = call.getString("instructions") ?? ""
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let s = AppleJudge.status()
            guard s.available else { CAPLog.print("AbangEdgeAI: unavailable \(s.reason)"); call.reject("unavailable: \(s.reason)"); return }
            guard Self.appActive() else { call.reject("background"); return } // App 不在前景：不呼叫模型
            Task {
                let t0 = Date()
                do {
                    let r = try await AppleJudge.shared.judge(text: text, history: history, context: context, instructions: instructions)
                    let ms = Int(Date().timeIntervalSince(t0) * 1000)
                    CAPLog.print("AbangEdgeAI: judged in \(ms) ms") // 只記耗時，不記內容
                    var result: [String: Any] = ["intent": r.intent, "states": r.states]
                    if let ask = r.ask { result["ask"] = ask } // 題目由 JS 與伺服器的程式驗證（ADR-0020）
                    if !r.topic.isEmpty { result["topic"] = r.topic }
                    call.resolve(["engine": "apple", "ms": ms, "result": result]) // ms：模型花多久（#/ai 顯示）
                } catch {
                    CAPLog.print("AbangEdgeAI: judge failed \(AppleJudge.code(error))") // 錯誤種類，不印句子內容
                    call.reject(self.softReason(error) ?? (self.busyAfterCancel(error) ? "busy" : "judge failed")) // background／busy：這一題改由伺服器判斷，JS 不當成不可用
                }
            }
            return
        }
        #endif
        call.reject("unavailable: os-too-old")
    }

    /// 回答也在手機上寫（ADR-0017）：把伺服器的程式版總結改寫成自然的一兩句。
    /// JS（public/js/edge-write.js）組好指示與輸入，回來後由程式護欄（core/edge-write.js）檢查數字；這裡只跑模型。不記內容，只記耗時。
    @objc func write(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else { call.reject("沒有草稿"); return }
        let instructions = call.getString("instructions") ?? ""
        // 輸入上限（指示＋草稿與事實，字數；與 core/edge-write.js WRITE_MAX_INPUT 相同）：超過就拒絕，不送進模型
        guard prompt.count + instructions.count <= 4000 else { call.reject("too long"); return }
        stopSuggest() // write 也比猜下一句優先：模型讓給這一題的回答
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let s = AppleJudge.status()
            guard s.available else { call.reject("unavailable: \(s.reason)"); return }
            guard Self.appActive() else { call.reject("background"); return } // App 不在前景：不呼叫模型，用程式版
            Task {
                let t0 = Date()
                do {
                    let text = try await AppleJudge.write(prompt: prompt, instructions: instructions)
                    let ms = Int(Date().timeIntervalSince(t0) * 1000)
                    CAPLog.print("AbangEdgeAI: wrote in \(ms) ms") // 只記耗時，不記內容
                    call.resolve(["engine": "apple", "ms": ms, "text": text])
                } catch {
                    CAPLog.print("AbangEdgeAI: write failed \(AppleJudge.code(error))")
                    call.reject(self.softReason(error) ?? (self.busyAfterCancel(error) ? "busy" : "write failed")) // background／busy：這一題用程式版
                }
            }
            return
        }
        #endif
        call.reject("unavailable: os-too-old")
    }

    /// 動態「下一句」建議（AGENT.md §5.5）：依情境（JS 組好、不含座標）猜使用者接下來最可能問的幾句。
    /// 只回 { engine, ms, result: [句子] }，句子由 JS 送伺服器規則驗證、程式排序。不記錄情境與句子。
    @objc func suggest(_ call: CAPPluginCall) {
        guard let context = call.getString("context"), !context.isEmpty else { call.reject("沒有情境"); return }
        let instructions = call.getString("instructions") ?? ""
        let count = Swift.min(6, Swift.max(1, call.getInt("max") ?? 4))
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let s = AppleJudge.status()
            guard s.available else { call.reject("unavailable: \(s.reason)"); return }
            guard Self.appActive() else { call.reject("background"); return } // App 不在前景：改用規則
            stopSuggest()
            suggestLock.lock()
            suggestID += 1
            let id = suggestID, token = suggestToken
            suggestTask = Task {
                defer { self.suggestDone(id) }
                guard self.suggestValid(token) else { call.reject("cancelled"); return } // 還沒開始就被取消：不呼叫模型
                let t0 = Date()
                do {
                    // 1.5 秒沒猜完就取消（JS 也只等 1.5 秒）；逾時也記取消時間
                    let list: [String]? = try await withThrowingTaskGroup(of: [String]?.self) { group in
                        group.addTask { try await AppleJudge.shared.suggest(context: context, instructions: instructions, max: count) }
                        group.addTask { try await Task.sleep(nanoseconds: 1_500_000_000); return nil }
                        let first = try await group.next() ?? nil
                        group.cancelAll()
                        return first
                    }
                    guard let list else { self.noteSuggestTimeout(); call.reject("timeout"); return }
                    try Task.checkCancellation()
                    let ms = Int(Date().timeIntervalSince(t0) * 1000)
                    CAPLog.print("AbangEdgeAI: suggested in \(ms) ms") // 只記耗時，不記內容
                    call.resolve(["engine": "apple", "ms": ms, "result": list])
                } catch {
                    if Task.isCancelled || error is CancellationError { call.reject("cancelled"); return } // 讓給 judge，不算錯誤
                    CAPLog.print("AbangEdgeAI: suggest failed \(AppleJudge.code(error))") // 不影響 judge／write
                    call.reject(self.softReason(error) ?? "suggest failed")
                }
            }
            suggestLock.unlock()
            return
        }
        #endif
        call.reject("unavailable: os-too-old")
    }
}

/// 寫回答逾時（2.3 秒；JS 只等 2.5 秒）
struct EdgeWriteTimeout: Error {}

#if canImport(FoundationModels)
/// 意圖（與 core/agent/judge.js JUDGE_INTENTS 相同；test/edge-judge.test.js 比對）
let edgeIntents = ["trip", "bus_route", "youbike", "nearby_bus", "metro", "rail", "weather", "aqi", "quake", "pharmacy", "garbage", "fuel", "invoice", "stock", "traffic",
                   "intercity", "ridehail", "booking", "place", "outing", "drama", "exercise", "scam", "reminder", "settings", "help", "chat", "emergency", "unknown"]
/// 狀態（與 JUDGE_STATES 相同）
let edgeStates = ["rush", "luggage", "budget", "lessWalk", "rain", "badAir", "elder", "kids", "mobility"]

/// 手機可以提議問的種類與狀況（與 core/edge-ask.js EDGE_ASK_SLOTS、EDGE_ASK_STATES 相同；test/edge-ask.test.js 比對）
let edgeAskSlots = ["route", "to", "from", "state", "railFrom", "railTo", "place", "where", "topic"]
let edgeAskStates = ["none", "rush", "budget", "luggage", "lessWalk"]

/// 要不要先問使用者一題（ADR-0020）：模型提候選，JS 與伺服器的程式驗證，不通過就照規則問
@available(iOS 26.0, *)
@Generable
struct EdgeAsk {
    @Guide(description: "問哪一種：route 缺公車路線、to 缺目的地、from 沒定位也沒說起點、state 會改變建議的狀況、railFrom 高鐵台鐵缺起站、railTo 缺迄站、place 地名有好幾個、where 沒定位問在哪、topic 只說類別", .anyOf(edgeAskSlots))
    var slot: String
    @Guide(description: "slot 是 state 時問哪個狀況，其他填 none", .anyOf(edgeAskStates))
    var state: String
    @Guide(description: "30 字內的一句問句，不要有數字")
    var question: String
    @Guide(description: "2～4 個 12 字內的短答（路線號碼、地名、回家、用我的位置；state 一個肯定一個否定）", .minimumCount(2), .maximumCount(4))
    var options: [String]
}

@available(iOS 26.0, *)
@Generable
struct EdgeJudgement {
    @Guide(description: "使用者想做什麼，只能選一個", .anyOf(edgeIntents))
    var intent: String
    @Guide(description: "使用者明講的狀態，沒有就空陣列", .maximumCount(9), .element(.anyOf(edgeStates)))
    var states: [String]
    @Guide(description: "要先問使用者的一題；資料夠、不用問就留空（寧可不問）")
    var ask: EdgeAsk?
    @Guide(description: "使用者想做的事，2～10 個字的短語（例：訂餐廳、寫信給老闆、查快遞）；不要放人名、電話、網址")
    var topic: String
}

@available(iOS 26.0, *)
@Generable
struct EdgeSuggestions {
    @Guide(description: "使用者接下來最可能問阿幫的話，每句單獨看得懂、口語、短", .maximumCount(6))
    var questions: [String]
}

/// actor：備用 session 會被 prewarm（Capacitor 佇列）與 judge（Task）同時存取（PR #32 審查）
@available(iOS 26.0, *)
actor AppleJudge {
    static let shared = AppleJudge()
    private var ready: LanguageModelSession?
    private var readyInstructions = ""

    /// 系統模型能不能用（不能用時說原因，JS 只用來決定要不要等）
    nonisolated static func status() -> (available: Bool, reason: String) {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            return model.supportsLocale(Locale(identifier: "zh-Hant-TW")) ? (true, "ok") : (false, "language")
        case .unavailable(.deviceNotEligible): return (false, "unsupported")
        case .unavailable(.appleIntelligenceNotEnabled): return (false, "disabled")
        case .unavailable(.modelNotReady): return (false, "downloading")
        case .unavailable: return (false, "unavailable")
        }
    }

    /// 系統回報的模型資訊（#/ai 顯示）：可用性原文、支援的語言、一次能讀多少 token；沒有的就不放
    nonisolated static func info() -> [String: Any] {
        let model = SystemLanguageModel.default
        var o: [String: Any] = [:]
        switch model.availability {
        case .available: o["availability"] = "available"
        case .unavailable(.deviceNotEligible): o["availability"] = "deviceNotEligible"
        case .unavailable(.appleIntelligenceNotEnabled): o["availability"] = "appleIntelligenceNotEnabled"
        case .unavailable(.modelNotReady): o["availability"] = "modelNotReady"
        case .unavailable: break
        }
        // supportedLanguages：Set<Locale.Language>（iOS 26.0 起）
        let langs = model.supportedLanguages.map { $0.minimalIdentifier }.sorted()
        if !langs.isEmpty { o["languages"] = langs }
        // contextSize：SDK 標成 iOS 26.0 起可用，但 26.x 是 @backDeployed 寫死回 4096（不是系統查到的）；iOS 27 起才是系統回報的值，之前不放
        if #available(iOS 27.0, *), case .available = model.availability, model.contextSize > 0 { o["contextSize"] = model.contextSize }
        return o
    }

    /// 每一題用新的 session（不累積前一題的對話）；先準備好一個並預先載入，下一題就快
    private func take(_ instructions: String) -> LanguageModelSession {
        if let s = ready, readyInstructions == instructions { ready = nil; return s }
        return LanguageModelSession(instructions: instructions)
    }

    func prewarm(instructions: String) {
        let s = LanguageModelSession(instructions: instructions)
        s.prewarm()
        ready = s
        readyInstructions = instructions
    }

    /// 錯誤種類（GenerationError 的 case 名；不含句子內容）
    nonisolated static func code(_ error: Error) -> String {
        if let g = error as? LanguageModelSession.GenerationError {
            switch g {
            case .guardrailViolation: return "guardrail"
            case .rateLimited: return "rateLimited"
            case .exceededContextWindowSize: return "context"
            case .unsupportedLanguageOrLocale: return "language"
            default: return "generation"
            }
        }
        return String(describing: type(of: error))
    }

    /// 寫回答：每次新的 session（不帶前一題）；2.3 秒沒寫完就取消
    nonisolated static func write(prompt: String, instructions: String) async throws -> String {
        try await withThrowingTaskGroup(of: String?.self) { group in
            group.addTask {
                let session = LanguageModelSession(instructions: instructions)
                let r = try await session.respond(to: prompt, options: GenerationOptions(temperature: 0.2, maximumResponseTokens: 160))
                return r.content
            }
            group.addTask {
                try await Task.sleep(nanoseconds: 2_300_000_000)
                return nil
            }
            let first = try await group.next() ?? nil
            group.cancelAll()
            guard let text = first else { throw EdgeWriteTimeout() }
            return text
        }
    }

    /// 猜下一句：每次新的 session（不累積前一次）；有一點變化但不亂編
    func suggest(context: String, instructions: String, max: Int) async throws -> [String] {
        let session = LanguageModelSession(instructions: instructions)
        let r = try await session.respond(to: "寫 \(max) 句。\n情境：\n\(context)", generating: EdgeSuggestions.self, options: GenerationOptions(temperature: 0.5))
        return Array(r.content.questions.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.prefix(max))
    }

    func judge(text: String, history: [String], context: String, instructions: String) async throws -> (intent: String, states: [String], ask: [String: Any]?, topic: String) {
        let session = take(instructions)
        defer { prewarm(instructions: instructions) }
        let prior = history.isEmpty ? "" : "前文：\(history.joined(separator: "／"))\n"
        let ctx = context.isEmpty ? "" : "情境：\(context)\n"
        let r = try await session.respond(to: "\(ctx)\(prior)這句：\(text)", generating: EdgeJudgement.self, options: GenerationOptions(sampling: .greedy))
        let states = Array(Set(r.content.states.filter { edgeStates.contains($0) }))
        // 題目只做最基本的整理（種類要對）；長度、選項、內容由 JS 與伺服器的程式驗證
        var ask: [String: Any]? = nil
        if let a = r.content.ask, edgeAskSlots.contains(a.slot) {
            var o: [String: Any] = ["slot": a.slot, "question": a.question, "options": Array(a.options.prefix(4))]
            if a.slot == "state", a.state != "none" { o["state"] = a.state }
            ask = o
        }
        // topic：範圍外的問題至少說得出使用者想做什麼；整理與個資檢查在 JS 與伺服器（core/topic.js）
        return (edgeIntents.contains(r.content.intent) ? r.content.intent : "unknown", states, ask, String(r.content.topic.prefix(24)))
    }
}
#endif
