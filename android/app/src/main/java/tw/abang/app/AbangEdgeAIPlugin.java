package tw.abang.app;

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

/**
 * 裝置端 AI 判斷（ADR-0014）：Gemini Nano（ML Kit GenAI Prompt API，經系統的 AICore）在手機上判斷意圖與狀態。
 * JS 端：public/js/edge-judge.js（外掛名 AbangEdgeAI）。只回 { engine, result: "模型輸出的 JSON 字串" }，由 JS 驗證列舉值。
 * Android 8 以下、機型不支援、模型還沒下載 → status 回 available: false，judge 回錯誤，JS 改由伺服器判斷。
 * 不記錄使用者的句子，只記耗時與錯誤類型。
 */
@CapacitorPlugin(name = "AbangEdgeAI")
public class AbangEdgeAIPlugin extends Plugin {
    private static final String TAG = "AbangEdgeAI";
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private GenerativeModelFutures model;
    private boolean downloading = false;

    private GenerativeModelFutures model() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
        return model;
    }

    private static boolean osOk() { return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O; } // ML Kit GenAI 需要 API 26

    /** 0 不支援、1 可下載、2 下載中、3 可用（FeatureStatus）；取不到回 -1 */
    private int featureStatus() {
        try { return model().checkStatus().get(); } catch (Exception e) { return -1; }
    }

    /** 可下載時在背景下載（模型由系統的 AICore 管理，多個 App 共用） */
    private void startDownload() {
        if (downloading) return;
        downloading = true;
        model().download(new DownloadCallback() {
            @Override public void onDownloadCompleted() { downloading = false; Logger.info(TAG, "Gemini Nano 下載完成"); }
            @Override public void onDownloadFailed(GenAiException e) { downloading = false; Logger.warn(TAG, "Gemini Nano 下載失敗：" + e.getClass().getSimpleName()); }
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        if (!osOk()) { call.resolve(result(false, "os-too-old")); return; }
        exec.execute(() -> {
            int s = featureStatus();
            if (s == FeatureStatus.DOWNLOADABLE) startDownload();
            String reason = s == FeatureStatus.AVAILABLE ? "ok" : s == FeatureStatus.DOWNLOADABLE || s == FeatureStatus.DOWNLOADING ? "downloading" : s == FeatureStatus.UNAVAILABLE ? "unsupported" : "unavailable";
            call.resolve(result(s == FeatureStatus.AVAILABLE, reason));
        });
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
                if (featureStatus() != FeatureStatus.AVAILABLE) { call.reject("unavailable"); return; }
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
                GenerateContentResponse r = f.get();
                String out = r.getCandidates().isEmpty() ? "" : r.getCandidates().get(0).getText();
                Logger.info(TAG, "judged in " + (System.currentTimeMillis() - t0) + " ms"); // 只記耗時，不記內容
                JSObject ret = new JSObject();
                ret.put("engine", "gemini-nano");
                ret.put("result", out == null ? "" : out);
                call.resolve(ret);
            } catch (Exception e) {
                Logger.warn(TAG, "judge failed: " + e.getClass().getSimpleName());
                call.reject("judge failed");
            }
        });
    }

    private static JSObject result(boolean available, String reason) {
        JSObject o = new JSObject();
        o.put("available", available);
        o.put("engine", "gemini-nano");
        o.put("reason", reason);
        return o;
    }
}
