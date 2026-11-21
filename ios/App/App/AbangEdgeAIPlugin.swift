// 裝置端 AI 判斷（ADR-0014）：Apple Intelligence（Foundation Models）在手機上判斷意圖與狀態。
// JS 端：public/js/edge-judge.js（Capacitor 外掛名 AbangEdgeAI）。只回 { engine, result: { intent, states } }，
// iOS 26 以下、機型不支援、沒開 Apple Intelligence、模型還在下載、語言不支援 → status 回 available: false，judge 回錯誤，JS 改由伺服器判斷。
// status 另外回報系統查得到的模型資訊（「阿幫的腦袋」#/ai 顯示；查不到的欄位就不回傳，不編造）：availability、languages、contextSize、osVersion。
import Foundation
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
        CAPPluginMethod(name: "suggest", returnType: CAPPluginReturnPromise),
    ]

    @objc func status(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let s = AppleJudge.status()
            var out: [String: Any] = ["available": s.available, "engine": "apple", "reason": s.reason, "osVersion": Self.osVersion]
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
        let instructions = call.getString("instructions") ?? ""
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let s = AppleJudge.status()
            guard s.available else { CAPLog.print("AbangEdgeAI: unavailable \(s.reason)"); call.reject("unavailable: \(s.reason)"); return }
            Task {
                let t0 = Date()
                do {
                    let r = try await AppleJudge.shared.judge(text: text, history: history, instructions: instructions)
                    let ms = Int(Date().timeIntervalSince(t0) * 1000)
                    CAPLog.print("AbangEdgeAI: judged in \(ms) ms") // 只記耗時，不記內容
                    call.resolve(["engine": "apple", "ms": ms, "result": ["intent": r.intent, "states": r.states]]) // ms：模型花多久（#/ai 顯示）
                } catch {
                    CAPLog.print("AbangEdgeAI: judge failed \(AppleJudge.code(error))") // 錯誤種類，不印句子內容
                    call.reject("judge failed")
                }
            }
            return
        }
        #endif
        call.reject("unavailable: os-too-old")
    }

    /// 動態「下一句」建議（AGENT.md §5.4）：依情境（JS 組好、不含座標）猜使用者接下來最可能問的幾句。
    /// 只回 { engine, ms, result: [句子] }，句子由 JS 送伺服器規則驗證、程式排序。不記錄情境與句子。
    @objc func suggest(_ call: CAPPluginCall) {
        guard let context = call.getString("context"), !context.isEmpty else { call.reject("沒有情境"); return }
        let instructions = call.getString("instructions") ?? ""
        let count = Swift.min(6, Swift.max(1, call.getInt("max") ?? 4))
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let s = AppleJudge.status()
            guard s.available else { call.reject("unavailable: \(s.reason)"); return }
            Task {
                let t0 = Date()
                do {
                    let list = try await AppleJudge.shared.suggest(context: context, instructions: instructions, max: count)
                    let ms = Int(Date().timeIntervalSince(t0) * 1000)
                    CAPLog.print("AbangEdgeAI: suggested in \(ms) ms") // 只記耗時，不記內容
                    call.resolve(["engine": "apple", "ms": ms, "result": list])
                } catch {
                    CAPLog.print("AbangEdgeAI: suggest failed \(AppleJudge.code(error))")
                    call.reject("suggest failed")
                }
            }
            return
        }
        #endif
        call.reject("unavailable: os-too-old")
    }
}

#if canImport(FoundationModels)
/// 意圖（與 core/agent/judge.js JUDGE_INTENTS 相同；test/edge-judge.test.js 比對）
let edgeIntents = ["trip", "bus_route", "youbike", "nearby_bus", "metro", "rail", "weather", "aqi", "quake", "pharmacy", "garbage", "fuel", "invoice", "stock", "unknown"]
/// 狀態（與 JUDGE_STATES 相同）
let edgeStates = ["rush", "luggage", "budget", "lessWalk", "rain", "badAir", "elder", "kids", "mobility"]

@available(iOS 26.0, *)
@Generable
struct EdgeJudgement {
    @Guide(description: "使用者想做什麼，只能選一個", .anyOf(edgeIntents))
    var intent: String
    @Guide(description: "使用者明講的狀態，沒有就空陣列", .maximumCount(9), .element(.anyOf(edgeStates)))
    var states: [String]
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

    /// 猜下一句：每次新的 session（不累積前一次）；有一點變化但不亂編
    func suggest(context: String, instructions: String, max: Int) async throws -> [String] {
        let session = LanguageModelSession(instructions: instructions)
        let r = try await session.respond(to: "寫 \(max) 句。\n情境：\n\(context)", generating: EdgeSuggestions.self, options: GenerationOptions(temperature: 0.5))
        return Array(r.content.questions.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.prefix(max))
    }

    func judge(text: String, history: [String], instructions: String) async throws -> (intent: String, states: [String]) {
        let session = take(instructions)
        defer { prewarm(instructions: instructions) }
        let prior = history.isEmpty ? "" : "前文：\(history.joined(separator: "／"))\n"
        let r = try await session.respond(to: "\(prior)這句：\(text)", generating: EdgeJudgement.self, options: GenerationOptions(sampling: .greedy))
        let states = Array(Set(r.content.states.filter { edgeStates.contains($0) }))
        return (edgeIntents.contains(r.content.intent) ? r.content.intent : "unknown", states)
    }
}
#endif
