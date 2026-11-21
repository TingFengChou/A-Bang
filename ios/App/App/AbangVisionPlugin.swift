// 阿幫會看（M14-02，ADR-0015）：拍照或選一張圖，在手機上讀字（OCR）與條碼，只把讀出來的文字回給 JS。
// JS 端：public/js/vision.js（Capacitor 外掛名 AbangVision）。
// - 拍照：UIImagePickerController（系統相機），第一次用時系統才問相機權限（Info.plist NSCameraUsageDescription）；照片只在記憶體，不存相簿。
// - 選圖：PHPickerViewController（系統相片選擇器，在 App 之外執行），只拿到使用者選的那一張，不需要相簿權限。
// - 讀字：Vision VNRecognizeTextRequest（accurate、zh-Hant＋en-US、語言校正）；條碼：VNDetectBarcodesRequest（QR、Code 39：發票）。
// - 影像理解：Foundation Models（Apple Intelligence）目前不收圖片，所以不回報這項能力（不假裝）。
// 只記耗時，不記讀出來的字。
import UIKit
import Capacitor
import Vision
import AVFoundation
import PhotosUI

@objc(AbangVisionPlugin)
public class AbangVisionPlugin: CAPPlugin, CAPBridgedPlugin, UIImagePickerControllerDelegate, UINavigationControllerDelegate, PHPickerViewControllerDelegate {
    public let identifier = "AbangVisionPlugin"
    public let jsName = "AbangVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise),
    ]
    /// 長邊最多這麼多像素（OCR 夠用，記憶體與速度都穩）
    private static let maxEdge: CGFloat = 2560
    private var pending: CAPPluginCall?
    private var want: [String] = ["text", "barcode"]

    @objc func available(_ call: CAPPluginCall) {
        let cam = UIImagePickerController.isSourceTypeAvailable(.camera)
        let perm: String
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: perm = "granted"
        case .denied, .restricted: perm = "denied"
        default: perm = "prompt"
        }
        call.resolve([
            "platform": "ios",
            "camera": cam,
            "photos": true,
            "cameraPermission": perm,
            "text": ["available": true, "engine": "apple-vision"],
            "barcode": ["available": true, "engine": "apple-vision"],
        ])
    }

    @objc func capture(_ call: CAPPluginCall) {
        if pending != nil { call.reject("上一張還在讀", "busy"); return }
        want = (call.getArray("want") as? [String]) ?? ["text", "barcode"]
        let source = call.getString("source") ?? "camera"
        if source == "photos" { presentPicker(call); return }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { call.reject("這支手機沒有相機", "unavailable"); return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: presentCamera(call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async { ok ? self.presentCamera(call) : call.reject("沒有相機權限", "denied") }
            }
        default: call.reject("沒有相機權限", "denied")
        }
    }

    private func presentCamera(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("打不開相機", "unavailable"); return }
            self.pending = call
            let p = UIImagePickerController()
            p.sourceType = .camera
            p.delegate = self
            vc.present(p, animated: true)
        }
    }

    private func presentPicker(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("打不開相片選擇器", "unavailable"); return }
            self.pending = call
            var cfg = PHPickerConfiguration()
            cfg.filter = .images
            cfg.selectionLimit = 1
            let p = PHPickerViewController(configuration: cfg)
            p.delegate = self
            vc.present(p, animated: true)
        }
    }

    // MARK: 相機
    public func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let img = info[.originalImage] as? UIImage
        picker.dismiss(animated: true)
        guard let call = take() else { return }
        guard let img = img else { call.reject("沒有拍照", "cancelled"); return }
        read(call, img)
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        take()?.reject("沒有拍照", "cancelled")
    }

    // MARK: 相片選擇器
    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = take() else { return }
        guard let item = results.first?.itemProvider, item.canLoadObject(ofClass: UIImage.self) else { call.reject("沒有選照片", "cancelled"); return }
        item.loadObject(ofClass: UIImage.self) { obj, _ in
            guard let img = obj as? UIImage else { call.reject("讀不到這張圖", "failed"); return }
            self.read(call, img)
        }
    }

    @discardableResult private func take() -> CAPPluginCall? { let c = pending; pending = nil; return c }

    // MARK: 讀字與條碼
    private func read(_ call: CAPPluginCall, _ image: UIImage) {
        notifyListeners("stage", data: ["stage": "reading"]) // JS 開始「阿幫在看」動畫
        let want = self.want
        DispatchQueue.global(qos: .userInitiated).async {
            let t0 = Date()
            guard let cg = Self.upright(image) else { call.reject("讀不到這張圖", "failed"); return }
            let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
            var reqs: [VNRequest] = []
            let textReq = VNRecognizeTextRequest()
            textReq.recognitionLevel = .accurate
            textReq.usesLanguageCorrection = true
            let langs = ["zh-Hant", "en-US"]
            let supported = (try? textReq.supportedRecognitionLanguages()) ?? []
            textReq.recognitionLanguages = langs.filter { supported.isEmpty || supported.contains($0) }
            if want.contains("text") { reqs.append(textReq) }
            let codeReq = VNDetectBarcodesRequest()
            codeReq.symbologies = [.qr, .code39]
            if want.contains("barcode") { reqs.append(codeReq) }
            do { try handler.perform(reqs) } catch { CAPLog.print("AbangVision: read failed"); call.reject("這次沒讀到", "failed"); return }
            var out: [String: Any] = ["engine": "apple-vision", "width": cg.width, "height": cg.height]
            if want.contains("text") {
                let lines: [[String: Any]] = (textReq.results ?? []).compactMap { o in
                    guard let s = o.topCandidates(1).first?.string, !s.isEmpty else { return nil }
                    return ["text": s, "box": Self.box(o.boundingBox)]
                }
                out["text"] = ["full": lines.compactMap { $0["text"] as? String }.joined(separator: "\n"), "lines": lines, "blocks": Self.blocks(lines)]
            }
            if want.contains("barcode") {
                out["barcodes"] = (codeReq.results ?? []).compactMap { b -> [String: Any]? in
                    guard let raw = b.payloadStringValue, !raw.isEmpty else { return nil }
                    return ["format": b.symbology == .qr ? "qr_code" : b.symbology == .code39 ? "code_39" : "other", "raw": raw]
                }
            }
            let ms = Int(Date().timeIntervalSince(t0) * 1000)
            out["ms"] = ms
            CAPLog.print("AbangVision: read in \(ms) ms") // 只記耗時，不記內容
            call.resolve(out)
        }
    }

    /// 轉正並縮到長邊 maxEdge（相機照片帶方向資訊；畫一次就是正的）
    private static func upright(_ img: UIImage) -> CGImage? {
        let edge = max(img.size.width, img.size.height)
        let scale = min(1, maxEdge / max(edge, 1))
        if img.imageOrientation == .up, scale >= 1 { return img.cgImage }
        let size = CGSize(width: floor(img.size.width * scale), height: floor(img.size.height * scale))
        let fmt = UIGraphicsImageRendererFormat.default()
        fmt.scale = 1
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }.cgImage
    }

    /// Vision 的座標原點在左下；換成左上（0～1）
    private static func box(_ r: CGRect) -> [String: Double] {
        let f = { (v: CGFloat) in (Double(v) * 1000).rounded() / 1000 }
        return ["x": f(r.minX), "y": f(1 - r.maxY), "w": f(r.width), "h": f(r.height)]
    }

    /// Vision 只給行；把上下相鄰、左右重疊的行併成文字區塊（與 Android 的 blocks 對應）
    private static func blocks(_ lines: [[String: Any]]) -> [[String: Any]] {
        var out: [(text: [String], x: Double, y: Double, r: Double, b: Double)] = []
        let sorted = lines.sorted { (($0["box"] as? [String: Double])?["y"] ?? 0) < (($1["box"] as? [String: Double])?["y"] ?? 0) }
        for l in sorted {
            guard let t = l["text"] as? String, let bx = l["box"] as? [String: Double], let x = bx["x"], let y = bx["y"], let w = bx["w"], let h = bx["h"] else { continue }
            if let i = out.indices.last, y - out[i].b < h * 0.8, x < out[i].r, x + w > out[i].x {
                out[i].text.append(t); out[i].x = min(out[i].x, x); out[i].r = max(out[i].r, x + w); out[i].b = max(out[i].b, y + h)
            } else {
                out.append((text: [t], x: x, y: y, r: x + w, b: y + h))
            }
        }
        return out.map { ["text": $0.text.joined(separator: "\n"), "box": ["x": $0.x, "y": $0.y, "w": $0.r - $0.x, "h": $0.b - $0.y]] }
    }
}
