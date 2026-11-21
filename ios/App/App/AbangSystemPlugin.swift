// 開啟系統設定（S1c）：定位權限被拒絕或定位服務關閉時，開本 App 的設定頁（iOS 不允許直接開「定位服務」總開關）。
// JS 端：public/js/location-help.js（外掛名 AbangSystem）。只開設定頁，不讀、不改任何設定。
import UIKit
import Capacitor

@objc(AbangSystemPlugin)
public class AbangSystemPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AbangSystemPlugin"
    public let jsName = "AbangSystem"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("無法開啟設定"); return }
            UIApplication.shared.open(url) { ok in ok ? call.resolve() : call.reject("無法開啟設定") }
        }
    }
}
