package tw.abang.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.ModelDownloadListener;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;

/**
 * 語音問阿幫（M14-01）：Android 手機上的 SpeechRecognizer 把你說的話轉成文字。JS 端：public/js/voice.js（外掛名 AbangVoice）。
 * 只在手機上辨識（產品負責人 2026-11-21：語言包要協助用戶裝，除非真的手機無法支援；不退回系統／雲端辨識）：
 * - API 31 以上且 isOnDeviceRecognitionAvailable → createOnDeviceSpeechRecognizer；否則回報不能用（reason os／no-ondevice）。
 * - API 33 以上用 checkRecognitionSupport 看這個語言：已安裝 → 能用；下載中 → downloading；可下載 → language-download（JS 第一次按麥克風就呼叫 download）；都不是 → language。
 * - download()：triggerModelDownload；API 34 以上用 ModelDownloadListener 回報 download 事件（progress／scheduled／done／error），33 只能由 JS 再問 available。
 * - API 31、32 查不到語言包：先試，辨識器說語言不能用時回 error language-missing（JS 說怎麼到設定下載）。
 * 事件：partial { text }、level { level: 0–1 }、final { text, onDevice }、error { code, message }、download { status, percent }。
 * 權限 RECORD_AUDIO：第一次 start() 才要。不錄音存檔、不上傳；log 只記錯誤代碼，不記辨識內容。
 */
@CapacitorPlugin(name = "AbangVoice", permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) })
public class AbangVoicePlugin extends Plugin {
    private static final String TAG = "AbangVoice";
    /** SpeechRecognizer 一定要在主執行緒建立與呼叫 */
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    /** 第幾段：取消或重新開始後，舊的回呼不算 */
    private volatile int session = 0;
    private String lang = "zh-TW";
    private long lastLevelAt = 0;
    /** API 33 以上查過的手機上語言包（查不到是 null：照 isOnDeviceRecognitionAvailable 先試） */
    private List<String> installedLangs = null;
    /** 正在跳麥克風權限框：這時 Activity 會 onPause，不能當成使用者離開而拆掉（審查 1） */
    private volatile boolean askingPermission = false;
    /** Android 13 請系統下載語言包用的辨識器：馬上 destroy 可能中斷下載，晚一點再拆（審查 4，待實機驗證） */
    private SpeechRecognizer dlRec = null;
    private static final long DL_REC_KEEP_MS = 10 * 60_000;
    /** 長按中央鍵：放開才結束，停頓收尾拉長到 8 秒（JS 遇到提早結束會接著聽、累加文字） */
    private static final long HOLD_SILENCE_MS = 8000L;

    static String normLang(String s) { return s != null && s.toLowerCase().startsWith("en") ? "en-US" : "zh-TW"; }

    private static boolean hasLang(List<String> list, String lang) {
        if (list == null) return false;
        String want = lang.toLowerCase().replace('_', '-');
        boolean zh = want.startsWith("zh");
        for (String l : list) {
            String x = l.toLowerCase().replace('_', '-');
            // zh-TW 也接受 cmn-Hant-TW／zh-Hant-TW 這類寫法
            if (x.equals(want)) return true;
            if (zh && (x.equals("cmn-hant-tw") || x.equals("zh-hant-tw"))) return true;
        }
        return false;
    }

    private boolean deviceRecognizer() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }

    /** 這個語言現在能不能在手機上辨識（API 33 以上看語言包；31、32 只能先試） */
    private boolean ready(String l) {
        if (!deviceRecognizer()) return false;
        return installedLangs == null || hasLang(installedLangs, l);
    }

    private Intent intent(String l) { return intent(l, false); }

    private Intent intent(String l, boolean hold) {
        long silence = hold ? HOLD_SILENCE_MS : 1500L;
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, l);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, silence);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, silence);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        return i;
    }

    private String permission() {
        PermissionState p = getPermissionState("microphone");
        return p == null ? "prompt" : p.toString();
    }

    @PluginMethod
    public void available(PluginCall call) {
        String l = normLang(call.getString("lang"));
        main.post(() -> {
            JSObject o = new JSObject();
            o.put("lang", l);
            o.put("engine", "android-ondevice");
            o.put("permission", permission());
            o.put("osVersion", Build.VERSION.RELEASE);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) { done(call, o, false, "os"); return; }
            if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) { done(call, o, false, "no-ondevice"); return; }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) { done(call, o, true, null); return; } // 查不到語言包：先試
            // 查語言包：有些機型會丟例外、或回呼一直不來（審查 3）→ 失敗就「先試」，最多等 3 秒
            final boolean[] over = { false };
            final SpeechRecognizer[] probe = { null };
            Runnable fallback = () -> {
                if (over[0]) return;
                over[0] = true;
                destroyQuietly(probe[0]);
                done(call, o, true, null);
            };
            try {
                probe[0] = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
                final SpeechRecognizer p = probe[0];
                main.postDelayed(fallback, 3000);
                p.checkRecognitionSupport(intent(l), getContext().getMainExecutor(), new RecognitionSupportCallback() {
                    @Override public void onSupportResult(RecognitionSupport s) {
                        if (over[0]) return;
                        over[0] = true;
                        main.removeCallbacks(fallback);
                        destroyQuietly(p);
                        installedLangs = new ArrayList<>(s.getInstalledOnDeviceLanguages());
                        JSArray langs = new JSArray();
                        for (String x : installedLangs) langs.put(x);
                        o.put("onDeviceLanguages", langs);
                        if (hasLang(installedLangs, l)) { releaseDlRec(); done(call, o, true, null); }
                        else if (hasLang(s.getPendingOnDeviceLanguages(), l)) done(call, o, false, "downloading");
                        else if (hasLang(s.getSupportedOnDeviceLanguages(), l)) done(call, o, false, "language-download");
                        else done(call, o, false, "language");
                    }
                    @Override public void onError(int error) { main.removeCallbacks(fallback); fallback.run(); } // 查不到：先試
                });
            } catch (Exception e) {
                Logger.warn(TAG, "checkRecognitionSupport：" + e.getClass().getSimpleName());
                main.removeCallbacks(fallback);
                fallback.run();
            }
        });
    }

    private static void destroyQuietly(SpeechRecognizer r) {
        if (r == null) return;
        try { r.destroy(); } catch (Exception e) { /* 已結束 */ }
    }

    private void releaseDlRec() { destroyQuietly(dlRec); dlRec = null; }

    private static void done(PluginCall call, JSObject o, boolean ok, String reason) {
        o.put("available", ok);
        o.put("onDevice", ok);
        if (reason != null) o.put("reason", reason);
        call.resolve(o);
    }

    /** 請系統下載這個語言的手機上語言包（第一次按麥克風時，產品負責人同意自動下載） */
    @PluginMethod
    public void download(PluginCall call) {
        String l = normLang(call.getString("lang"));
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !deviceRecognizer()) { call.reject("這支手機不能下載手機上的語音包", "no-service"); return; }
        main.post(() -> {
            SpeechRecognizer r;
            try { r = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()); }
            catch (Exception e) { call.reject("語音辨識開不起來", "no-service"); return; }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    final SpeechRecognizer d = r;
                    r.triggerModelDownload(intent(l), getContext().getMainExecutor(), new ModelDownloadListener() {
                        @Override public void onProgress(int percent) { emit("progress", percent); }
                        @Override public void onSuccess() { installedLangs = null; emit("done", -1); d.destroy(); }
                        @Override public void onScheduled() { emit("scheduled", -1); d.destroy(); }
                        @Override public void onError(int error) { Logger.warn(TAG, "download error " + error); emit("error", -1); d.destroy(); }
                    });
                    JSObject o = new JSObject();
                    o.put("progress", true);
                    call.resolve(o);
                } else {
                    r.triggerModelDownload(intent(l)); // Android 13：沒有進度回呼，JS 每 3 秒再問 available
                    releaseDlRec();
                    dlRec = r; // 馬上 destroy 可能中斷下載：留著，語言包裝好（available 查到）或 10 分鐘後再拆
                    main.postDelayed(() -> { if (dlRec == r) releaseDlRec(); }, DL_REC_KEEP_MS);
                    JSObject o = new JSObject();
                    o.put("progress", false);
                    call.resolve(o);
                }
            } catch (Exception e) {
                Logger.warn(TAG, "triggerModelDownload：" + e.getClass().getSimpleName());
                try { r.destroy(); } catch (Exception x) { /* 已結束 */ }
                call.reject("語音包沒有開始下載", "service");
            }
        });
    }

    private void emit(String status, int percent) {
        JSObject o = new JSObject();
        o.put("status", status);
        if (percent >= 0) o.put("percent", percent);
        notifyListeners("download", o);
    }

    /** 開手機的語音輸入設定（下載語言包）；打不開就開系統設定 */
    @PluginMethod
    public void openSettings(PluginCall call) {
        for (String action : new String[] { Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_SETTINGS }) {
            try {
                Intent i = new Intent(action);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
                return;
            } catch (Exception e) { /* 下一個 */ }
        }
        call.reject("打不開設定");
    }

    /** 這次 start 的號碼：權限框之後、begin 之前若被 cancel（session 變了）就不開麥克風（審查 1） */
    private volatile int startToken = 0;

    @PluginMethod
    public void start(PluginCall call) {
        startToken = ++session;
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            askingPermission = true; // 權限框會讓 Activity onPause：不要當成離開
            requestPermissionForAlias("microphone", call, "micPermission");
            return;
        }
        begin(call, startToken);
    }

    @PermissionCallback
    private void micPermission(PluginCall call) {
        askingPermission = false;
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call, startToken);
        else call.reject("麥克風權限沒有打開", "permission");
    }

    private void begin(PluginCall call, int token) {
        String l = normLang(call.getString("lang"));
        boolean hold = Boolean.TRUE.equals(call.getBoolean("hold", false));
        main.post(() -> {
            if (token != session) { call.reject("已經取消", "client"); return; } // 等權限框時被取消：不開麥克風
            teardown();
            if (!ready(l)) { call.reject("這支手機現在不能在手機上辨識這個語言", deviceRecognizer() ? "language-missing" : "no-service"); return; } // 不退回系統／雲端辨識
            if (!listen(l, hold)) { call.reject("語音辨識開不起來", "no-service"); return; }
            JSObject o = new JSObject();
            o.put("onDevice", true);
            o.put("engine", "android-ondevice");
            o.put("lang", l);
            call.resolve(o);
        });
    }

    /** 建立手機上的辨識器並開始聽（主執行緒） */
    private boolean listen(String l, boolean hold) {
        final int my = ++session;
        try { rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()); }
        catch (Exception e) { Logger.warn(TAG, "create：" + e.getClass().getSimpleName()); rec = null; return false; }
        lang = l; lastLevelAt = 0;
        rec.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle b) { }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onBufferReceived(byte[] buffer) { } // 不保存聲音
            @Override public void onEndOfSpeech() { }
            @Override public void onEvent(int type, Bundle b) { }
            @Override public void onRmsChanged(float rms) {
                if (my != session) return;
                long now = System.currentTimeMillis();
                if (now - lastLevelAt < 80) return; // 給動畫用，一秒十幾次就夠
                lastLevelAt = now;
                JSObject o = new JSObject();
                o.put("level", Math.max(0f, Math.min(1f, (rms + 2f) / 12f))); // rmsdB 大約 -2～10
                notifyListeners("level", o);
            }
            @Override public void onPartialResults(Bundle b) {
                if (my != session) return;
                String t = first(b);
                if (t.isEmpty()) return;
                JSObject o = new JSObject();
                o.put("text", t);
                notifyListeners("partial", o);
            }
            @Override public void onResults(Bundle b) {
                if (my != session) return;
                JSObject o = new JSObject();
                o.put("text", first(b));
                o.put("onDevice", true);
                teardown();
                notifyListeners("final", o);
            }
            @Override public void onError(int error) {
                if (my != session) return;
                Logger.warn(TAG, "error " + error); // 只記代碼
                teardown();
                JSObject o = new JSObject();
                o.put("code", code(error));
                o.put("message", message(error));
                notifyListeners("error", o);
            }
        });
        try { rec.startListening(intent(l, hold)); }
        catch (Exception e) { Logger.warn(TAG, "startListening：" + e.getClass().getSimpleName()); teardown(); return false; }
        return true;
    }

    private static String first(Bundle b) {
        ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return r == null || r.isEmpty() || r.get(0) == null ? "" : r.get(0).trim();
    }

    /** SpeechRecognizer 錯誤碼 → JS 的錯誤種類（voice.js VOICE_ERRORS） */
    static String code(int e) {
        switch (e) {
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: case SpeechRecognizer.ERROR_NETWORK: return "network";
            case SpeechRecognizer.ERROR_AUDIO: return "audio";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "no-speech";
            case SpeechRecognizer.ERROR_NO_MATCH: return "no-match";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS: return "busy";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "permission";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED: case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE: return "language-missing"; // 語言包沒裝好（JS 說怎麼下載）
            case SpeechRecognizer.ERROR_CLIENT: return "client";
            default: return "service"; // ERROR_SERVER、ERROR_SERVER_DISCONNECTED、ERROR_CANNOT_CHECK_SUPPORT…
        }
    }

    /** 中文說明（JS 依 code 用字典顯示；這段是沒有字典時的備用） */
    static String message(int e) {
        switch (code(e)) {
            case "network": return "語音辨識連不上";
            case "audio": return "麥克風收不到聲音";
            case "no-speech": return "沒有聽到聲音";
            case "no-match": return "沒聽清楚";
            case "busy": return "語音辨識正在忙";
            case "permission": return "麥克風權限沒有打開";
            case "language-missing": return "還沒有這個語言的手機上語音包";
            case "client": return "語音辨識被中斷";
            default: return "語音辨識出了問題";
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> { if (rec != null) { try { rec.stopListening(); } catch (Exception e) { /* 已結束 */ } } call.resolve(); });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> { session++; teardown(); call.resolve(); });
    }

    private void teardown() {
        if (rec == null) return;
        try { rec.cancel(); } catch (Exception e) { /* 已結束 */ }
        try { rec.destroy(); } catch (Exception e) { /* 已結束 */ }
        rec = null;
    }

    /** App 到背景：不在背景開著麥克風，並告訴 JS（畫面不卡在聽）；權限框造成的 onPause 不算（審查 1、6） */
    @Override
    protected void handleOnPause() {
        if (!askingPermission) main.post(() -> {
            boolean was = rec != null;
            session++;
            teardown();
            if (was) {
                JSObject o = new JSObject();
                o.put("code", "client");
                o.put("message", "App 到背景，停止聽");
                notifyListeners("error", o);
            }
        });
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> { session++; teardown(); releaseDlRec(); });
        super.handleOnDestroy();
    }
}
