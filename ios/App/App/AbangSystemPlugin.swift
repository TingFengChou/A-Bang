// 系統功能（外掛名 AbangSystem）。只開系統畫面，不讀、不改任何設定或資料；最後一步都由使用者在系統畫面上確認。
// - openSettings（S1c）：定位權限被拒絕或定位服務關閉時，開本 App 的設定頁（iOS 不允許直接開「定位服務」總開關）。JS 端：public/js/location-help.js
// - addCalendarEvent（ADR-0021）：開系統的新增行程畫面（EKEventEditViewController），使用者按「加入」才寫進行事曆。
//   iOS 17 以上這個畫面在 App 外執行，不需要行事曆權限；iOS 15～16 要先問一次（NSCalendarsUsageDescription）。阿幫不讀行事曆。
// - share（ADR-0021）：開系統分享面板（UIActivityViewController），使用者自己選對象、按送出。
//   JS 端：public/js/device-actions.js（內容由 core/device-actions.js 產生，不經模型）
import UIKit
import Capacitor
import EventKit
import EventKitUI

@objc(AbangSystemPlugin)
public class AbangSystemPlugin: CAPPlugin, CAPBridgedPlugin, EKEventEditViewDelegate {
    public let identifier = "AbangSystemPlugin"
    public let jsName = "AbangSystem"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addCalendarEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    private lazy var eventStore = EKEventStore()
    /** 等新增行程畫面關掉才回覆的那個呼叫（同時只會有一個畫面） */
    private var calendarCall: CAPPluginCall?

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("無法開啟設定"); return }
            UIApplication.shared.open(url) { ok in ok ? call.resolve() : call.reject("無法開啟設定") }
        }
    }

    @objc func addCalendarEvent(_ call: CAPPluginCall) {
        guard let title = call.getString("title"), !title.isEmpty,
              let start = call.getDouble("start"), let end = call.getDouble("end"), end > start, end - start <= 24 * 3600 * 1000 else {
            call.reject("行程資料不完整", "invalid"); return
        }
        let location = call.getString("location")
        let notes = call.getString("notes")
        DispatchQueue.main.async {
            let present = { [weak self] in
                guard let self = self, let vc = self.bridge?.viewController else { call.reject("無法開啟行事曆", "no-view"); return }
                if self.calendarCall != nil { call.reject("行事曆畫面已經開著", "busy"); return }
                let event = EKEvent(eventStore: self.eventStore)
                event.title = title
                event.startDate = Date(timeIntervalSince1970: start / 1000)
                event.endDate = Date(timeIntervalSince1970: end / 1000)
                event.location = location
                event.notes = notes
                let editor = EKEventEditViewController()
                editor.eventStore = self.eventStore
                editor.event = event
                editor.editViewDelegate = self
                self.calendarCall = call
                vc.present(editor, animated: true)
            }
            if #available(iOS 17.0, *) {
                present() // 在 App 外執行，不需要權限
            } else {
                self.eventStore.requestAccess(to: .event) { granted, _ in
                    DispatchQueue.main.async { granted ? present() : call.reject("沒有行事曆權限", "denied") }
                }
            }
        }
    }

    public func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
        controller.dismiss(animated: true)
        calendarCall?.resolve(["saved": action == .saved])
        calendarCall = nil
    }

    @objc func share(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else { call.reject("沒有要分享的內容", "invalid"); return }
        var items: [Any] = [text]
        if let s = call.getString("url"), let url = URL(string: s), url.scheme == "https" { items.append(url) } // 只收 https
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.bridge?.viewController else { call.reject("無法開啟分享", "no-view"); return }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            if let pop = sheet.popoverPresentationController { // iPad：從畫面下方中間跳出
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 120, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { _, completed, _, _ in call.resolve(["shared": completed]) }
            vc.present(sheet, animated: true)
        }
    }
}
