package tw.abang.app;

import android.net.ConnectivityManager;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * 裝置端 AI 判斷（ADR-0014）：Gemini Nano（ML Kit GenAI Prompt API，經系統的 AICore）在手機上判斷意圖與狀態。
 * JS 端：public/js/edge-judge.js（外掛名 AbangEdgeAI）。只回 { engine, result: "模型輸出的 JSON 字串" }，由 JS 驗證列舉值。
 * Android 8 以下、機型不支援、模型還沒下載 → status 回 available: false，judge 回錯誤，JS 改由伺服器判斷。
 * 不記錄使用者的句子，只記耗時與錯誤類型。
 * status 另外回報系統查得到的模型資訊（「阿幫的腦袋」#/ai 顯示；查不到的欄位就不回傳，不編造）：
 * featureStatus、modelName（基礎模型名稱）、tokenLimit、下載進度、aicoreVersion、osVersion、device。
 * write（ADR-0017）：把伺服器的程式版總結改寫成自然的一兩句；數字由 JS 的程式護欄檢查，不過就用程式版。
 */
@CapacitorPlugin(name = "AbangEdgeAI")
public class AbangEdgeAIPlugin extends Plugin {
    private static final String TAG = "AbangEdgeAI";
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    /** 查模型資訊（名稱、token 上限）用另一條執行緒：最多等 2 秒，不能擋住排在 exec 上的 judge／prewarm（PR 審查） */
    private final ExecutorService infoExec = Executors.newSingleThreadExecutor();
    /** 一題最多跑這麼久（JS 只等 1.8 秒；原生端也要停，否則下一題排在後面一起逾時） */
    private static final long JUDGE_TIMEOUT_MS = 1500;
    /** 寫回答最多跑這麼久（ADR-0017；JS 等 2.5 秒，逾時就用程式版總結） */
    private static final long WRITE_TIMEOUT_MS = 2300;
    private GenerativeModelFutures model;
    private volatile boolean downloading = false;
    /** 確認可用之後就不必每題再問系統 */
    private volatile boolean available = false;
    /** 配額用完或被系統擋下時，暫停到這個時間（毫秒）再試 */
    private volatile long pausedUntil = 0;
    /** 模型資訊（系統回報；確認可用後查一次就記住）：基礎模型名稱、一次最多能讀的 token 數 */
    private volatile String modelName = null;
    private volatile int tokenLimit = 0;
    /** 查過就不再查（查不到也記住：每次 status 都等 2 秒沒有意義） */
    private volatile boolean infoTried = false;
    /** 下載進度（位元組；DownloadCallback 回報，沒回報就是 0） */
    private volatile long downloadTotal = 0;
    private volatile long downloadDone = 0;

    private GenerativeModelFutures model() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
        return model;
    }

    private static boolean osOk() { return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O; } // ML Kit GenAI 需要 API 26

    /** 0 不支援、1 可下載、2 下載中、3 可用（FeatureStatus）；取不到回 -1 */
    private int featureStatus() {
        if (available) return FeatureStatus.AVAILABLE;
        try {
            int s = model().checkStatus().get(1000, TimeUnit.MILLISECONDS);
            available = s == FeatureStatus.AVAILABLE;
            return s;
        } catch (Exception e) { return -1; }
    }

    /** 只在不計流量的網路（Wi-Fi）下載：模型數百 MB 以上，不在行動網路偷偷下載 */
    private boolean unmetered() {
        ConnectivityManager cm = getContext().getSystemService(ConnectivityManager.class);
        return cm != null && !cm.isActiveNetworkMetered();
    }

    /** 錯誤代碼（不含句子內容）；配額、忙碌、背景被擋時暫停 10 分鐘 */
    private String errorCode(Throwable e) {
        Throwable c = e.getCause() != null ? e.getCause() : e;
        if (c instanceof GenAiException) {
            GenAiException g = (GenAiException) c;
            pausedUntil = System.currentTimeMillis() + 10 * 60_000;
            return "GenAiException:" + g.getErrorCode();
        }
        return c.getClass().getSimpleName();
    }

    /** 可下載時在背景下載（模型由系統的 AICore 管理，多個 App 共用） */
    private void startDownload() {
        if (downloading || !unmetered()) return;
        downloading = true;
        model().download(new DownloadCallback() {
            @Override public void onDownloadStarted(long bytesToDownload) { downloadTotal = bytesToDownload; downloadDone = 0; }
            @Override public void onDownloadProgress(long totalBytesDownloaded) { downloadDone = totalBytesDownloaded; }
            @Override public void onDownloadCompleted() { downloading = false; Logger.info(TAG, "Gemini Nano 下載完成"); }
            @Override public void onDownloadFailed(GenAiException e) { downloading = false; Logger.warn(TAG, "Gemini Nano 下載失敗：" + e.getClass().getSimpleName()); }
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        if (!osOk()) { call.resolve(describe(result(false, "os-too-old"), -1)); return; }
        exec.execute(() -> {
            int s = featureStatus();
            if (s == FeatureStatus.DOWNLOADABLE) startDownload();
            String reason = s == FeatureStatus.AVAILABLE ? "ok" : s == FeatureStatus.DOWNLOADING || (s == FeatureStatus.DOWNLOADABLE && downloading) ? "downloading" : s == FeatureStatus.DOWNLOADABLE ? "needs-wifi" : s == FeatureStatus.UNAVAILABLE ? "unsupported" : "unavailable";
            JSObject o = result(s == FeatureStatus.AVAILABLE, reason);
            infoExec.execute(() -> call.resolve(describe(o, s))); // 查模型資訊不佔 exec（judge 不排隊）
        });
    }

    /** 加上系統查得到的資訊（只在這支手機上顯示，不送伺服器）；任何一項查不到就不放 */
    private JSObject describe(JSObject o, int s) {
        o.put("osVersion", Build.VERSION.RELEASE);
        o.put("device", (Build.MANUFACTURER + " " + Build.MODEL).trim());
        String fs = s == FeatureStatus.AVAILABLE ? "available" : s == FeatureStatus.DOWNLOADING ? "downloading" : s == FeatureStatus.DOWNLOADABLE ? "downloadable" : s == FeatureStatus.UNAVAILABLE ? "unavailable" : null;
        if (fs != null) o.put("featureStatus", fs);
        try { // AICore：系統裡管理 Gemini Nano 的元件（AndroidManifest 的 <queries> 讓 App 看得到它的版本）
            String v = getContext().getPackageManager().getPackageInfo("com.google.android.aicore", 0).versionName;
            if (v != null && !v.isEmpty()) o.put("aicoreVersion", v);
        } catch (Exception e) { /* 沒有 AICore 或看不到：不顯示 */ }
        if (s == FeatureStatus.AVAILABLE) {
            if (!infoTried) queryModelInfo();
            if (modelName != null) o.put("modelName", modelName);
            if (tokenLimit > 0) o.put("tokenLimit", tokenLimit);
        } else if (downloading && downloadTotal > 0) {
            o.put("downloadTotalBytes", downloadTotal);
            o.put("downloadedBytes", Math.min(downloadDone, downloadTotal));
        }
        return o;
    }

    /** 模型名稱與 token 上限：只查一次（成功或失敗都記住），在 infoExec 上跑 */
    private void queryModelInfo() {
        infoTried = true;
        try { String n = model().getBaseModelName().get(1000, TimeUnit.MILLISECONDS); if (n != null && !n.isEmpty()) modelName = n; } catch (Exception e) { /* 查不到：不顯示 */ }
        try { Integer n = model().getTokenLimit().get(1000, TimeUnit.MILLISECONDS); if (n != null && n > 0) tokenLimit = n; } catch (Exception e) { /* 查不到：不顯示 */ }
    }

    @PluginMethod
    public void prewarm(PluginCall call) {
        if (!osOk()) { call.resolve(); return; }
        exec.execute(() -> {
            int s = featureStatus();
            if (s == FeatureStatus.AVAILABLE) { try { model().warmup().get(); } catch (Exception e) { Logger.warn(TAG, "warmup 失敗：" + e.getClass().getSimpleName()); } }
            else if (s == FeatureStatus.DOWNLOADABLE) startDownload();
            call.resolve();
        });
    }

    @PluginMethod
    public void judge(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.isEmpty()) { call.reject("沒有句子"); return; }
        if (!osOk()) { call.reject("unavailable: os-too-old"); return; }
        String instructions = call.getString("instructions", "");
        JSArray hist = call.getArray("history", new JSArray());
        exec.execute(() -> {
            long t0 = System.currentTimeMillis();
            try {
                if (System.currentTimeMillis() < pausedUntil || featureStatus() != FeatureStatus.AVAILABLE) { call.reject("unavailable"); return; }
                StringBuilder prompt = new StringBuilder(instructions)
                    .append("\n只回一行 JSON，不要其他文字：{\"intent\":\"意圖\",\"states\":[\"狀態\"]}\n");
                List<String> prior = hist.toList();
                if (!prior.isEmpty()) prompt.append("前文：").append(String.join("／", prior)).append('\n');
                prompt.append("這句：").append(text);
                GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new TextPart(prompt.toString()));
                b.setTemperature(0f);
                b.setTopK(1);
                b.setMaxOutputTokens(80);
                ListenableFuture<GenerateContentResponse> f = model().generateContent(b.build());
                GenerateContentResponse r;
                try { r = f.get(JUDGE_TIMEOUT_MS, TimeUnit.MILLISECONDS); }
                catch (TimeoutException te) { f.cancel(true); Logger.warn(TAG, "judge timeout"); call.reject("timeout"); return; }
                String out = r.getCandidates().isEmpty() ? "" : r.getCandidates().get(0).getText();
                long ms = System.currentTimeMillis() - t0;
                Logger.info(TAG, "judged in " + ms + " ms"); // 只記耗時，不記內容
                JSObject ret = new JSObject();
                ret.put("engine", "gemini-nano");
                ret.put("ms", ms); // 模型花多久（#/ai 顯示「上次判斷花多久」）
                ret.put("result", out == null ? "" : out);
                call.resolve(ret);
            } catch (Exception e) {
                Logger.warn(TAG, "judge failed: " + errorCode(e));
                call.reject("judge failed");
            }
        });
    }

    /**
     * 回答也在手機上寫（ADR-0017）：把伺服器的程式版總結改寫成自然的一兩句。
     * JS 端（public/js/edge-write.js）組好指示與輸入（草稿＋事實清單），回來後由程式護欄（core/edge-write.js）檢查數字；
     * 這裡只負責跑模型。只回 { engine, ms, text }；不記內容，只記耗時與錯誤類型。
     */
    @PluginMethod
    public void write(PluginCall call) {
        String prompt = call.getString("prompt", "");
        if (prompt == null || prompt.isEmpty()) { call.reject("沒有草稿"); return; }
        if (!osOk()) { call.reject("unavailable: os-too-old"); return; }
        String instructions = call.getString("instructions", "");
        exec.execute(() -> {
            long t0 = System.currentTimeMillis();
            try {
                if (System.currentTimeMillis() < pausedUntil || featureStatus() != FeatureStatus.AVAILABLE) { call.reject("unavailable"); return; }
                GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new TextPart(instructions + "\n\n" + prompt));
                b.setTemperature(0.2f);
                b.setTopK(3);
                b.setMaxOutputTokens(160);
                ListenableFuture<GenerateContentResponse> f = model().generateContent(b.build());
                GenerateContentResponse r;
                try { r = f.get(WRITE_TIMEOUT_MS, TimeUnit.MILLISECONDS); }
                catch (TimeoutException te) { f.cancel(true); Logger.warn(TAG, "write timeout"); call.reject("timeout"); return; }
                String out = r.getCandidates().isEmpty() ? "" : r.getCandidates().get(0).getText();
                long ms = System.currentTimeMillis() - t0;
                Logger.info(TAG, "wrote in " + ms + " ms"); // 只記耗時，不記內容
                JSObject ret = new JSObject();
                ret.put("engine", "gemini-nano");
                ret.put("ms", ms);
                ret.put("text", out == null ? "" : out);
                call.resolve(ret);
            } catch (Exception e) {
                Logger.warn(TAG, "write failed: " + errorCode(e));
                call.reject("write failed");
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        exec.shutdownNow();
        infoExec.shutdownNow();
        super.handleOnDestroy();
    }

    private static JSObject result(boolean available, String reason) {
        JSObject o = new JSObject();
        o.put("available", available);
        o.put("engine", "gemini-nano");
        o.put("reason", reason);
        o.put("write", true); // 這個版本的外掛也能寫回答（ADR-0017）；JS 看到才帶 clientCaps.edgeWrite
        return o;
    }
}
