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
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 裝置端 AI 判斷（ADR-0014）：Gemini Nano（ML Kit GenAI Prompt API，經系統的 AICore）在手機上判斷意圖與狀態。
 * JS 端：public/js/edge-judge.js（外掛名 AbangEdgeAI）。只回 { engine, result: "模型輸出的 JSON 字串" }，由 JS 驗證列舉值。
 * Android 8 以下、機型不支援、模型還沒下載 → status 回 available: false，judge 回錯誤，JS 改由伺服器判斷。
 * 不記錄使用者的句子，只記耗時與錯誤類型。
 * status 另外回報系統查得到的模型資訊（「阿幫的腦袋」#/ai 顯示；查不到的欄位就不回傳，不編造）：
 * featureStatus、modelName（基礎模型名稱）、tokenLimit、下載進度、aicoreVersion、osVersion、device。
 * write（ADR-0017）：把伺服器的程式版總結改寫成自然的一兩句；數字由 JS 的程式護欄檢查，不過就用程式版。
 * suggest（AGENT.md §5.5）：猜使用者接下來想問的話。三個任務的優先順序 judge ＞ write ＞ suggest：judge、write 在 exec 上依序跑，
 * suggest 用自己的執行緒，judge 或 write 一進來就取消它（stopSuggest），取消後 3 秒內的忙碌錯誤不暫停。
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
    /** 寫回答的輸入上限（指示＋草稿與事實，字數）：超過就拒絕，不送進模型 */
    private static final int WRITE_MAX_INPUT = 4000;
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
        long since = System.currentTimeMillis() - suggestCancelledAt;
        if (c instanceof GenAiException) {
            GenAiException g = (GenAiException) c;
            if (busyAfterCancel(g.getErrorCode(), since)) return BUSY_CODE + ":" + g.getErrorCode(); // 剛取消建議、模型還在收尾：這一題交給伺服器，不暫停
            pausedUntil = System.currentTimeMillis() + 10 * 60_000;
            return "GenAiException:" + g.getErrorCode();
        }
        if (c instanceof CancellationException && since < BUSY_GRACE_MS) return BUSY_CODE;
        return c.getClass().getSimpleName();
    }

    /** 取消建議後這段時間內的「忙碌」類錯誤不算模型壞掉（產品負責人 2026-11-21） */
    static final long BUSY_GRACE_MS = 3000;
    static final String BUSY_CODE = "busy-after-cancel";
    /** 最近一次取消 suggest 的時間（毫秒） */
    private volatile long suggestCancelledAt = 0;
    /** 剛取消建議（3 秒內）又拿到 BUSY（已有請求在跑）或 CANCELLED（取消中）：只是讓位造成的，不暫停 10 分鐘 */
    static boolean busyAfterCancel(int code, long sinceCancelMs) {
        return sinceCancelMs >= 0 && sinceCancelMs < BUSY_GRACE_MS && (code == GenAiException.ErrorCode.BUSY || code == GenAiException.ErrorCode.CANCELLED);
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
        stopSuggest(); // judge 優先：正在猜下一句就先取消，模型讓給這一題
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
                String code = errorCode(e);
                Logger.warn(TAG, "judge failed: " + code);
                call.reject(code.startsWith(BUSY_CODE) ? "busy" : "judge failed"); // busy：這一題改由伺服器判斷，JS 不當成不可用
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
        if (instructions == null) instructions = "";
        if (prompt.length() + instructions.length() > WRITE_MAX_INPUT) { call.reject("too long"); return; } // 與 core/edge-write.js WRITE_MAX_INPUT 相同
        final String input = instructions + "\n\n" + prompt;
        stopSuggest(); // write 也比猜下一句優先：模型讓給這一題的回答
        exec.execute(() -> {
            long t0 = System.currentTimeMillis();
            try {
                if (System.currentTimeMillis() < pausedUntil || featureStatus() != FeatureStatus.AVAILABLE) { call.reject("unavailable"); return; }
                GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new TextPart(input));
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
                String code = errorCode(e);
                Logger.warn(TAG, "write failed: " + code);
                call.reject(code.startsWith(BUSY_CODE) ? "busy" : "write failed"); // busy：剛讓位，不暫停；這一題用程式版
            }
        });
    }

    /** 猜使用者接下來想問的話：一次最多跑這麼久（JS 只等 1.5 秒） */
    private static final long SUGGEST_TIMEOUT_MS = 1500;
    /** 猜下一句用自己的執行緒：judge 在 exec 上，不會排在 suggest 後面（產品負責人 2026-11-21：judge 優先） */
    private final ExecutorService suggestExec = Executors.newSingleThreadExecutor();
    /** 正在跑的 suggest（judge 或 cancelSuggest 來時取消） */
    private volatile ListenableFuture<GenerateContentResponse> suggestFuture;
    /** 取消記號：每次取消加一；排隊中、還沒呼叫模型的 suggest 看到記號變了就不跑（PR #112 審查） */
    private final AtomicLong suggestToken = new AtomicLong();
    /** 排隊中或正在跑的 suggest 數（有的話取消時才記取消時間） */
    private final AtomicInteger suggestPending = new AtomicInteger();

    /**
     * 取消 suggest：不論 future 設好了沒有——排隊中的看到記號變了就不跑、已在跑的取消 future；
     * 有 suggest 排隊或在跑就記取消時間（之後 3 秒內 judge／write 的忙碌錯誤不暫停）。回傳有沒有取消到。
     */
    private boolean stopSuggest() {
        suggestToken.incrementAndGet();
        boolean had = suggestPending.get() > 0;
        if (had) suggestCancelledAt = System.currentTimeMillis();
        ListenableFuture<GenerateContentResponse> f = suggestFuture;
        suggestFuture = null;
        if (f != null && !f.isDone()) f.cancel(true);
        return had;
    }

    /**
     * 動態「下一句」建議（AGENT.md §5.5）：依情境（頁面、最近的問題與結果摘要、時段；JS 組好、不含座標）猜使用者接下來最可能問的幾句。
     * 只回 { engine, ms, result: "每行一句" }，句子由 JS 送伺服器規則驗證、程式排序。不記錄情境與句子，只記耗時與錯誤類型。
     * 使用者送出問題時 judge 優先：judge 一進來（或 JS 呼叫 cancelSuggest）就取消，回 "cancelled"。
     * suggest 的任何錯誤都不設 pausedUntil（背景任務失敗不該停掉 judge／write）；自己逾時也記取消時間（模型可能還在收尾）。
     */
    @PluginMethod
    public void suggest(PluginCall call) {
        String context = call.getString("context", "");
        if (context == null || context.isEmpty()) { call.reject("沒有情境"); return; }
        if (!osOk()) { call.reject("unavailable: os-too-old"); return; }
        String instructions = call.getString("instructions", "");
        Integer maxArg = call.getInt("max", 4);
        int max = Math.max(1, Math.min(6, maxArg == null ? 4 : maxArg));
        final long my = suggestToken.get();
        suggestPending.incrementAndGet();
        suggestExec.execute(() -> {
            long t0 = System.currentTimeMillis();
            ListenableFuture<GenerateContentResponse> f = null;
            try {
                if (suggestToken.get() != my) { call.reject("cancelled"); return; } // 排隊時就被取消了：不呼叫模型
                if (System.currentTimeMillis() < pausedUntil || featureStatus() != FeatureStatus.AVAILABLE) { call.reject("unavailable"); return; }
                String prompt = instructions + "\n每行一句，共 " + max + " 句；不要編號、不要引號、不要其他文字。\n情境：\n" + context;
                GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new TextPart(prompt));
                b.setTemperature(0.4f); // 有一點變化（每次不完全一樣），但不亂編
                b.setTopK(16);
                b.setMaxOutputTokens(160);
                if (suggestToken.get() != my) { call.reject("cancelled"); return; }
                f = model().generateContent(b.build());
                suggestFuture = f;
                if (suggestToken.get() != my) { f.cancel(true); call.reject("cancelled"); return; } // 剛設好就被取消
                GenerateContentResponse r;
                try { r = f.get(SUGGEST_TIMEOUT_MS, TimeUnit.MILLISECONDS); }
                catch (TimeoutException te) { f.cancel(true); suggestCancelledAt = System.currentTimeMillis(); Logger.warn(TAG, "suggest timeout"); call.reject("timeout"); return; }
                String out = r.getCandidates().isEmpty() ? "" : r.getCandidates().get(0).getText();
                long ms = System.currentTimeMillis() - t0;
                Logger.info(TAG, "suggested in " + ms + " ms"); // 只記耗時，不記內容
                JSObject ret = new JSObject();
                ret.put("engine", "gemini-nano");
                ret.put("ms", ms);
                ret.put("result", out == null ? "" : out);
                call.resolve(ret);
            } catch (CancellationException | InterruptedException e) {
                Logger.info(TAG, "suggest cancelled for judge");
                call.reject("cancelled");
            } catch (Exception e) {
                if (f != null && f.isCancelled()) { call.reject("cancelled"); return; } // 被 judge 取消
                Logger.warn(TAG, "suggest failed: " + suggestErrorCode(e)); // 不暫停（不用 errorCode）
                call.reject("suggest failed");
            } finally {
                if (suggestFuture == f) suggestFuture = null;
                suggestPending.decrementAndGet();
            }
        });
    }

    /** suggest 的錯誤種類（只記，不設 pausedUntil） */
    static String suggestErrorCode(Throwable e) {
        Throwable c = e.getCause() != null ? e.getCause() : e;
        return c instanceof GenAiException ? "GenAiException:" + ((GenAiException) c).getErrorCode() : c.getClass().getSimpleName();
    }

    /** 使用者送出問題了：取消正在跑的 suggest（JS edge-judge.js cancelSuggest；judge 自己也會先取消） */
    @PluginMethod
    public void cancelSuggest(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("cancelled", stopSuggest());
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        exec.shutdownNow();
        infoExec.shutdownNow();
        suggestExec.shutdownNow();
        super.handleOnDestroy();
    }

    private static JSObject result(boolean available, String reason) {
        JSObject o = new JSObject();
        o.put("available", available);
        o.put("engine", "gemini-nano");
        o.put("reason", reason);
        o.put("write", true); // 這個版本的外掛也能寫回答（ADR-0017）；JS 看到才帶 clientCaps.edgeWrite
        o.put("suggest", true); // 也能猜下一句（AGENT.md §5.5）
        return o;
    }
}
