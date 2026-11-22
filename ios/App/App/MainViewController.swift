// App 專用的外掛在這裡註冊（Capacitor 8：專案內的外掛要手動註冊）
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AbangEdgeAIPlugin())
        bridge?.registerPluginInstance(AbangSystemPlugin()) // 開啟 App 設定（S1c）
        bridge?.registerPluginInstance(AbangVisionPlugin()) // 阿幫會看：手機上讀字與條碼（ADR-0015）
        bridge?.registerPluginInstance(AbangVoicePlugin()) // 語音問阿幫（M14-01）
        bridge?.registerPluginInstance(AbangWatchPlugin()) // 到站提醒的即時動態（鎖定畫面、動態島）
    }
}
