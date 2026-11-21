// 健康與運動（ADR-0018）：從「健康」App（HealthKit）讀步數（stepCount）與體能訓練時間（appleExerciseTime），今天與近 7 天，只讀不寫。
// JS 端：public/js/health.js（外掛名 AbangHealth）。回傳只有每日的日期、步數、運動分鐘（不漏 HealthKit 的樣本、來源 App 等原始欄位）；
// JS 只在手機上判斷，不送伺服器。這裡不寫 log。
// - status()：裝置有沒有 HealthKit（iPad 沒有 → no-healthkit）、App 有沒有 HealthKit entitlement（沒有 → no-entitlement）、
//   有沒有問過權限（prompt／asked）。iOS 不告訴 App 使用者有沒有允許「讀取」（隱私設計），所以問過就回 asked，讀不到資料時 JS 說怎麼去「健康」App 打開。
// - requestPermission()：跳「健康」App 的權限畫面（NSHealthShareUsageDescription），允許由使用者自己按。
// - summary({ days })：HKStatisticsCollectionQuery 每天加總，固定以 Asia/Taipei 切日（跟 JS 的 core/health-nudge.js twDate 一致）。
// 開發版用免費的個人開發團隊簽章時可能不能帶 HealthKit entitlement（scripts/ios-dev-install.js 會改用不含 entitlement 的建置）：這時回 no-entitlement，JS 反白說原因。
import Foundation
import HealthKit
import Capacitor

@objc(AbangHealthPlugin)
public class AbangHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AbangHealthPlugin"
    public let jsName = "AbangHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "summary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    private lazy var store = HKHealthStore()
    private var readTypes: Set<HKObjectType> {
        var s = Set<HKObjectType>()
        if let t = HKObjectType.quantityType(forIdentifier: .stepCount) { s.insert(t) }
        if let t = HKObjectType.quantityType(forIdentifier: .appleExerciseTime) { s.insert(t) }
        return s
    }

    /// App 簽章裡有沒有 HealthKit entitlement（建置時寫進 Info.plist 的 AbangHealthKit；沒有 entitlement 的建置會設成 NO）
    private var hasEntitlement: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "AbangHealthKit") as? String)?.uppercased() != "NO"
    }

    private func unavailable(_ reason: String) -> [String: Any] { ["available": false, "reason": reason, "source": "healthkit"] }
    private func ok(_ permission: String) -> [String: Any] { ["available": true, "permission": permission, "source": "healthkit"] }

    private func reasonIfUnavailable() -> String? {
        if !HKHealthStore.isHealthDataAvailable() { return "no-healthkit" }
        if !hasEntitlement { return "no-entitlement" }
        return nil
    }

    /// 沒有 entitlement 時 HealthKit 的錯誤訊息會提到 entitlement
    private func mapError(_ e: Error?) -> String {
        let m = (e as NSError?)?.localizedDescription.lowercased() ?? ""
        return m.contains("entitlement") ? "no-entitlement" : "failed"
    }

    @objc func status(_ call: CAPPluginCall) {
        if let r = reasonIfUnavailable() { call.resolve(unavailable(r)); return }
        store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { st, err in
            if let err = err { call.resolve(self.unavailable(self.mapError(err))); return }
            call.resolve(self.ok(st == .unnecessary ? "asked" : "prompt")) // 不確定（unknown）就當還沒問：打開時會跳權限畫面
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        if let r = reasonIfUnavailable() { call.resolve(unavailable(r)); return }
        store.requestAuthorization(toShare: [], read: readTypes) { done, err in
            if let err = err { call.resolve(self.unavailable(self.mapError(err))); return }
            call.resolve(self.ok(done ? "asked" : "prompt"))
        }
    }

    @objc func summary(_ call: CAPPluginCall) {
        if let r = reasonIfUnavailable() { call.reject("unavailable", r); return }
        let days = max(1, min(7, call.getInt("days") ?? 7))
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Taipei") ?? .current // 跟 JS（core/health-nudge.js twDate）一樣用台灣時間切日
        let todayStart = cal.startOfDay(for: Date())
        guard let from = cal.date(byAdding: .day, value: -(days - 1), to: todayStart) else { call.reject("failed"); return }
        let fmt = DateFormatter()
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = cal.timeZone
        fmt.dateFormat = "yyyy-MM-dd"
        var rows: [[String: Any]] = (0..<days).map { i in
            let d = cal.date(byAdding: .day, value: i, to: from) ?? from
            return ["date": fmt.string(from: d), "steps": NSNull(), "exerciseMin": NSNull()]
        }
        let group = DispatchGroup()
        let lock = NSLock()
        func collect(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, _ key: String) {
            guard let type = HKQuantityType.quantityType(forIdentifier: id) else { return }
            group.enter()
            let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: from, end: Date(), options: .strictStartDate),
                                                options: .cumulativeSum, anchorDate: todayStart, intervalComponents: DateComponents(day: 1))
            q.initialResultsHandler = { _, results, _ in
                defer { group.leave() }
                guard let results = results else { return } // 沒允許、沒資料：留 null
                results.enumerateStatistics(from: from, to: Date()) { st, _ in
                    guard let sum = st.sumQuantity() else { return }
                    let i = cal.dateComponents([.day], from: from, to: st.startDate).day ?? -1
                    guard i >= 0 && i < days else { return }
                    lock.lock(); rows[i][key] = Int(sum.doubleValue(for: unit).rounded()); lock.unlock()
                }
            }
            store.execute(q)
        }
        collect(.stepCount, .count(), "steps")
        collect(.appleExerciseTime, .minute(), "exerciseMin")
        group.notify(queue: .main) { call.resolve(["source": "healthkit", "days": rows]) }
    }

    /// iPhone 不能直接開「健康」App 的權限頁（JS 只說路徑）
    @objc func openSettings(_ call: CAPPluginCall) { call.reject("unsupported") }
}
