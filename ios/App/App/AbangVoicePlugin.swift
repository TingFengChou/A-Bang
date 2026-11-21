// 語音問阿幫（M14-01）：iOS Speech（SFSpeechRecognizer）＋AVAudioEngine 把你說的話轉成文字。JS 端：public/js/voice.js（外掛名 AbangVoice）。
// 手機上優先：supportsOnDeviceRecognition 為 true 時 requiresOnDeviceRecognition = true（語音不離開手機）；
// 為 false（機型或語言不支援）時退回系統辨識，並照實回報 onDevice: false（Apple 的伺服器辨識）。
// 事件：partial { text }、level { level: 0–1 }、final { text, onDevice }、error { code, message }。iOS 不會自己停：停頓 1.5 秒就收尾（JS 也會）。
// 權限：麥克風（NSMicrophoneUsageDescription）、語音辨識（NSSpeechRecognitionUsageDescription），第一次 start() 才問。
// 不錄音存檔、不上傳；log 只記錯誤代碼，不記辨識內容。App 到背景就停止。
import Foundation
import AVFoundation
import Speech
import UIKit
import Capacitor

@objc(AbangVoicePlugin)
public class AbangVoicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AbangVoicePlugin"
    public let jsName = "AbangVoice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    /// 第幾段：取消或重新開始後，舊的回呼不算
    private var session = 0
    private var onDevice = false
    private var lastText = ""
    private var silence: DispatchWorkItem?
    private var lastLevelAt: TimeInterval = 0
    /// 有裝 tap 才拿掉（沒用過麥克風時不碰 inputNode）
    private var tapped = false
    private static let silenceSeconds = 1.5

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(onBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    @objc private func onBackground() { DispatchQueue.main.async { self.session += 1; self.teardown() } }

    static func lang(_ s: String?) -> String { (s ?? "").lowercased().hasPrefix("en") ? "en-US" : "zh-TW" }

    private static var osVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return v.patchVersion > 0 ? "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)" : "\(v.majorVersion).\(v.minorVersion)"
    }

    // MARK: 權限
    private enum Mic { case granted, denied, undetermined }
    private static func micState() -> Mic {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return .granted
            case .denied: return .denied
            default: return .undetermined
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        default: return .undetermined
        }
    }
    private static func askMic(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) { AVAudioApplication.requestRecordPermission { ok in DispatchQueue.main.async { done(ok) } }; return }
        AVAudioSession.sharedInstance().requestRecordPermission { ok in DispatchQueue.main.async { done(ok) } }
    }
    /// 兩個權限合起來：都允許 granted；任一個拒絕 denied；還沒問 prompt
    private static func permission() -> String {
        let sp = SFSpeechRecognizer.authorizationStatus()
        let mic = micState()
        if sp == .denied || sp == .restricted || mic == .denied { return "denied" }
        if sp == .authorized && mic == .granted { return "granted" }
        return "prompt"
    }
    /// 先麥克風、再語音辨識；失敗回 (code, message)
    private func ensurePermissions(_ done: @escaping (String?, String?) -> Void) {
        let speech = {
            switch SFSpeechRecognizer.authorizationStatus() {
            case .authorized: done(nil, nil)
            case .notDetermined:
                SFSpeechRecognizer.requestAuthorization { st in DispatchQueue.main.async { st == .authorized ? done(nil, nil) : done("speech-permission", "語音辨識權限沒有打開") } }
            default: done("speech-permission", "語音辨識權限沒有打開")
            }
        }
        switch Self.micState() {
        case .granted: speech()
        case .denied: done("permission", "麥克風權限沒有打開")
        case .undetermined: Self.askMic { ok in ok ? speech() : done("permission", "麥克風權限沒有打開") }
        }
    }

    // MARK: 方法
    @objc func available(_ call: CAPPluginCall) {
        let lang = Self.lang(call.getString("lang"))
        var o: [String: Any] = ["engine": "ios-speech", "lang": lang, "osVersion": Self.osVersion, "permission": Self.permission()]
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: lang)) else {
            o["available"] = false; o["reason"] = "language"; call.resolve(o); return
        }
        o["available"] = r.isAvailable
        o["onDevice"] = r.supportsOnDeviceRecognition
        if !r.isAvailable { o["reason"] = "no-service" }
        call.resolve(o)
    }

    @objc func start(_ call: CAPPluginCall) {
        let lang = Self.lang(call.getString("lang"))
        DispatchQueue.main.async {
            self.ensurePermissions { code, msg in
                if let code = code { call.reject(msg ?? code, code); return }
                self.begin(call, lang)
            }
        }
    }

    private func begin(_ call: CAPPluginCall, _ lang: String) {
        session += 1
        teardown()
        let my = session
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: lang)) else { call.reject("語音辨識不支援這個語言", "language"); return }
        guard rec.isAvailable else { call.reject("語音辨識現在不能用", "no-service"); return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        onDevice = rec.supportsOnDeviceRecognition
        req.requiresOnDeviceRecognition = onDevice // 能在手機上就一定在手機上
        if #available(iOS 16.0, *) { req.addsPunctuation = true }
        let audio = AVAudioSession.sharedInstance()
        do {
            try audio.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
        } catch { CAPLog.print("AbangVoice: audio session \((error as NSError).code)"); call.reject("麥克風現在不能用", "audio"); return }
        let input = engine.inputNode
        let fmt = input.outputFormat(forBus: 0)
        guard fmt.sampleRate > 0, fmt.channelCount > 0 else { teardown(); call.reject("麥克風現在不能用", "audio"); return }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [weak self] buf, _ in
            req.append(buf) // 只交給辨識，不寫檔
            self?.level(buf, my)
        }
        tapped = true
        engine.prepare()
        do { try engine.start() } catch { teardown(); call.reject("麥克風現在不能用", "audio"); return }
        request = req
        lastText = ""
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async { self?.handle(result, error, my) }
        }
        call.resolve(["onDevice": onDevice, "engine": "ios-speech", "lang": lang])
    }

    private func handle(_ result: SFSpeechRecognitionResult?, _ error: Error?, _ my: Int) {
        guard my == session else { return }
        if let r = result {
            let text = r.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
            if r.isFinal {
                let out: [String: Any] = ["text": text.isEmpty ? lastText : text, "onDevice": onDevice]
                session += 1
                teardown()
                notifyListeners("final", data: out)
                return
            }
            if !text.isEmpty && text != lastText {
                lastText = text
                notifyListeners("partial", data: ["text": text])
                armSilence(my)
            }
        }
        if let e = error {
            let (code, msg) = Self.map(e as NSError)
            CAPLog.print("AbangVoice: error \((e as NSError).domain) \((e as NSError).code)") // 只記代碼
            let text = lastText
            session += 1
            teardown()
            // 已經聽到字了（例如收尾時才報錯）：把聽到的當作最後的文字
            if !text.isEmpty { notifyListeners("final", data: ["text": text, "onDevice": onDevice]) }
            else { notifyListeners("error", data: ["code": code, "message": msg]) }
        }
    }

    /// 停頓 1.5 秒：當作說完了，請辨識收尾（最後的文字由 isFinal 回來）
    private func armSilence(_ my: Int) {
        silence?.cancel()
        let w = DispatchWorkItem { [weak self] in guard let self = self, my == self.session else { return }; self.endAudio() }
        silence = w
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.silenceSeconds, execute: w)
    }

    private func endAudio() {
        silence?.cancel(); silence = nil
        if engine.isRunning { engine.stop() }
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio()
    }

    /// 音量（給動畫；一秒十幾次）
    private func level(_ buf: AVAudioPCMBuffer, _ my: Int) {
        guard let ch = buf.floatChannelData?[0] else { return }
        let n = Int(buf.frameLength)
        guard n > 0 else { return }
        let now = Date().timeIntervalSince1970
        guard now - lastLevelAt >= 0.08 else { return }
        lastLevelAt = now
        var sum: Float = 0
        for i in 0..<n { sum += ch[i] * ch[i] }
        let rms = sqrt(sum / Float(n))
        let db = 20 * log10(max(rms, 0.000_01))
        let lv = min(1, max(0, (db + 50) / 40)) // 約 -50 dB（安靜）～ -10 dB（大聲）
        DispatchQueue.main.async { [weak self] in
            guard let self = self, my == self.session else { return }
            self.notifyListeners("level", data: ["level": lv])
        }
    }

    /// 系統錯誤 → JS 的錯誤種類（voice.js VOICE_ERRORS）
    static func map(_ e: NSError) -> (String, String) {
        if e.domain == "kAFAssistantErrorDomain" {
            switch e.code {
            case 1110: return ("no-speech", "沒有聽到聲音")
            case 203: return ("no-match", "沒聽清楚")
            case 1700, 1101, 1107: return ("service", "語音辨識出了問題")
            case 216, 209, 301: return ("client", "語音辨識被中斷")
            default: break
            }
        }
        if e.domain == NSURLErrorDomain { return ("network", "語音辨識連不上") }
        return ("service", "語音辨識出了問題")
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.endAudio(); call.resolve() }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.session += 1; self.teardown(); call.resolve() }
    }

    private func teardown() {
        silence?.cancel(); silence = nil
        if engine.isRunning { engine.stop() }
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
