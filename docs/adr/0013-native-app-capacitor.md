# ADR-0013：手機 App 用 Capacitor 包現有網頁

狀態：已採用（2026-11-20，Austin：「先寫 ADR 做殼」）

## 背景
阿幫目前是 PWA。網頁版有幾個做不到或做不好的地方：到站提醒只能在 App 開著時響、掃發票 QR code 依賴瀏覽器相機、定位權限流程不一、不能上架讓大眾搜尋安裝。之後也想把判斷層（嵌入分類器）放到手機上跑（地端 AI）。
網頁版要繼續存在，畫面、卡片、動畫不想維護兩份。

## 決策
1. 用 **Capacitor 8**（Ionic，MIT）把 `public/` 原樣包成 Android 與 iOS App；網頁與 App 共用同一份前端程式，不引入前端框架（維持 CLAUDE.md「`public/` 免建置」）。
2. **前端打包進 App**（不是遠端載入網站）：`npm run build:app` 把 `public/`、白名單 vendor（GSAP）、共用核心檔（`core/decide.js`）複製到 `dist/app/`，並在 `index.html` 注入 `window.__ABANG_API_BASE__`（伺服器網址）與 `window.__ABANG_APP__ = true`。理由：App 開啟不用等網路下載畫面；Apple 審查（4.2）不接受只包一個網站的 App。
3. **API 位址可設定**：前端所有 API 呼叫改經 `public/js/base.js` 的 `API_BASE`（網頁版是空字串＝同站，行為不變）。App 的位址由 `ABANG_API_BASE` 環境變數在打包時決定；正式環境必須是 HTTPS。
4. **伺服器 CORS**：MCP 與 `/api/v1/tools` 原本就允許任何來源，維持不變。問阿幫端點（`/api/v1/agent`）與其他 REST 讀取路由（公車、天氣…）原本只給同站，改成另外允許 App 的固定來源（`capacitor://localhost`、`https://localhost`，可用 `APP_ORIGINS` 調整）；不用 `*`。沒有 cookie、沒有登入，CORS 只是讓 App 的 WebView 能讀回應，限流照舊依 IP。
5. **Service worker 在 App 內不註冊**（畫面已在 App 裡；iOS 的 `capacitor://` 也不支援）。
6. **開發用**：`npm run build:app` 預設 API 位址 `http://localhost:8787`；Android 模擬器先 `adb reverse tcp:8787 tcp:8787`，iOS 模擬器直接連得到本機。Android 的網路安全設定（`res/xml/network_security_config.xml`）只對 `localhost`、`127.0.0.1`、`10.0.2.2` 允許明碼 http，其他網域一律 HTTPS。
7. App ID `tw.abang.app`、名稱「阿幫」（上架前可改）。
8. 原生功能分批加，每批都要有網頁版的退路：① 到站提醒改手機本機通知（Local Notifications，不需要推播伺服器）、② 原生相機掃 QR、③ 定位。推播伺服器（排程、每天固定時間通知）另寫 ADR（L-16）。

## 不採用
- **React Native／Flutter**：要重寫全部畫面與卡片，網頁版還是得留一份。
- **只做 PWA**：iOS 的網頁通知與背景能力有限，也不能上架。
- **遠端載入網站（`server.url` 指向正式網址）**：開啟要等網路、離線一片白，Apple 審查風險高；只用在開發。
- **TWA（Android 包 PWA）**：只有 Android，原生功能少。

## 影響
- 新增 devDependencies `@capacitor/cli`、`@capacitor/core`、`@capacitor/android`、`@capacitor/ios`（都鎖 8.6.0，MIT）；只有打包 App 時用到，不進伺服器的 Docker 映像（`npm ci --omit=dev`）。Capacitor CLI 需要 Node ≥ 22（CI 已用 22；伺服器本身仍支援 Node 20）。
- 新目錄 `android/`、`ios/`（原生專案，進版控；`build`、`Pods` 等產物不進）。`dist/app/` 是打包產物，不進版控。
- 開發環境：Android 需要 Android Studio（內建 JDK）與 SDK；iOS 需要 Xcode。上架需要 Apple Developer 與 Google Play 開發者帳號（Austin 處理）。
- App 一定要連一台對外的 HTTPS 伺服器（M6-06 部署）才能給別人用；在那之前只能在模擬器或同網段的手機上連開發機。
- 隱私：App 與網頁相同，不收集個資；定位、相機、發票資料只存在手機。上架需要隱私權政策頁。
