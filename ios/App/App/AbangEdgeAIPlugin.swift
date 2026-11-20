// 裝置端 AI 判斷（ADR-0014）：Apple Intelligence（Foundation Models）在手機上判斷意圖與狀態。
// JS 端：public/js/edge-judge.js（Capacitor 外掛名 AbangEdgeAI）。只回 { engine, result: { intent, states } }，
// iOS 26 以下、機型不支援、沒開 Apple Intelligence、模型還在下載、語言不支援 → status 回 available: false，judge 回錯誤，JS 改由伺服器判斷。
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
    ]

    @objc func status(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let s = AppleJudge.status()
            call.resolve(["available": s.available, "engine": "apple", "reason": s.reason])
            return
        }
        #endif
        call.resolve(["available": false, "engine": "apple", "reason": "os-too-old"])
    }

    @objc func prewarm(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), AppleJudge.status().available {
            AppleJudge.shared.prewarm(instructions: call.getString("instructions") ?? "")
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
                    CAPLog.print("AbangEdgeAI: judged in \(Int(Date().timeIntervalSince(t0) * 1000)) ms") // 只記耗時，不記內容
                    call.resolve(["engine": "apple", "result": ["intent": r.intent, "states": r.states]])
                } catch {
                    CAPLog.print("AbangEdgeAI: judge failed \(type(of: error))") // 不印句子內容
                    call.reject("judge failed")
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
let edgeStates = ["rush", "luggage", "budget", "lessWalk", "rain", "badAir"]

@available(iOS 26.0, *)
@Generable
struct EdgeJudgement {
    @Guide(description: "使用者想做什麼，只能選一個", .anyOf(edgeIntents))
    var intent: String
    @Guide(description: "使用者明講的狀態（rush luggage budget lessWalk rain badAir），沒有就空陣列", .maximumCount(6))
    var states: [String]
}

@available(iOS 26.0, *)
final class AppleJudge {
    static let shared = AppleJudge()
    private var ready: LanguageModelSession?
    private var readyInstructions = ""

    /// 系統模型能不能用（不能用時說原因，JS 只用來決定要不要等）
    static func status() -> (available: Bool, reason: String) {
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
