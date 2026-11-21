package tw.abang.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
 * 語音問阿幫（M14-01）：Android SpeechRecognizer 把你說的話轉成文字。JS 端：public/js/voice.js（外掛名 AbangVoice）。
 * 手機上優先：API 31 以上且 isOnDeviceRecognitionAvailable → createOnDeviceSpeechRecognizer（語音不離開手機）；
 * API 33 以上再用 checkRecognitionSupport 確認這個語言的語言包已裝好（沒裝好、支援下載時請系統背景下載，這次先用系統辨識）。
 * 不能在手機上辨識時用一般的 SpeechRecognizer＋EXTRA_PREFER_OFFLINE，並照實回報 onDevice: false（系統可能經網路）。
 * 事件：partial { text }、level { level: 0–1 }、final { text, onDevice }、error { code, message }、engine { onDevice, engine }（手機上的語言包不能用、改系統辨識時）。
 * 權限 RECORD_AUDIO：第一次 start() 才要。不錄音存檔、不上傳；log 只記錯誤代碼，不記辨識內容。
 */
@CapacitorPlugin(name = "AbangVoice", permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) })
public class AbangVoicePlugin extends Plugin {
    private static final String TAG = "AbangVoice";
    /** SpeechRecognizer 一定要在主執行緒建立與呼叫 */
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    /** 第幾段：取消或重新開始後，舊的回呼不算 */
    private int session = 0;
    private boolean onDevice = false;
    private boolean heard = false;
    private boolean fellBack = false;
    private String lang = "zh-TW";
    private long lastLevelAt = 0;
    /** API 33 以上查過的「手機上的語言包」：已安裝、可下載（查不到是 null，就照 isOnDeviceRecognitionAvailable） */
    private List<String> installedLangs = null;
    private List<String> downloadableLangs = null;
    private boolean downloadAsked = false;

    static String normLang(String s) { return s != null && s.toLowerCase().startsWith("en") ? "en-US" : "zh-TW"; }

    private static boolean hasLang(List<String> list, String lang) {
        if (list == null) return false;
        String want = lang.toLowerCase().replace('_', '-');
        String base = want.substring(0, 2);
        for (String l : list) {
            String x = l.toLowerCase().replace('_', '-');
            // zh-TW 也接受 cmn-Hant-TW／zh-Hant-TW 這類寫法；en-US 接受 en-US
            if (x.equals(want)) return true;
            if (base.equals("zh") && (x.equals("cmn-hant-tw") || x.equals("zh-hant-tw"))) return true;
        }
        return false;
    }

    private boolean deviceRecognizer() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
    }

    /** 這個語言能不能在手機上辨識（API 33 以上看語言包；31、32 只能先試，失敗再改系統辨識） */
    private boolean useOnDevice(String lang) {
        if (!deviceRecognizer()) return false;
        if (installedLangs == null) return true;
        return hasLang(installedLangs, lang);
    }

    private Intent intent(String lang) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true); // 系統辨識也盡量在手機上（不保證，所以回報 onDevice: false）
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        return i;
    }

    private String permission() {
        PermissionState p = getPermissionState("microphone");
        return p == null ? "prompt" : p.toString();
    }

    @PluginMethod
    public void available(PluginCall call) {
        String lang = normLang(call.getString("lang"));
        main.post(() -> {
            boolean sys = SpeechRecognizer.isRecognitionAvailable(getContext());
            boolean dev = deviceRecognizer();
            JSObject o = new JSObject();
            o.put("lang", lang);
            o.put("permission", permission());
            o.put("osVersion", Build.VERSION.RELEASE);
            if (dev && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // 查手機上的語言包（只查一次就記住；查不到就照 isOnDeviceRecognitionAvailable）
                SpeechRecognizer probe;
                try { probe = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()); }
                catch (Exception e) { finishAvailable(call, o, sys, dev, lang); return; }
                final SpeechRecognizer p = probe;
                p.checkRecognitionSupport(intent(lang), getContext().getMainExecutor(), new RecognitionSupportCallback() {
                    @Override public void onSupportResult(RecognitionSupport s) {
                        installedLangs = new ArrayList<>(s.getInstalledOnDeviceLanguages());
                        downloadableLangs = new ArrayList<>(s.getSupportedOnDeviceLanguages());
                        downloadableLangs.addAll(s.getPendingOnDeviceLanguages());
                        p.destroy();
                        JSArray langs = new JSArray();
                        for (String l : installedLangs) langs.put(l);
                        o.put("onDeviceLanguages", langs);
                        if (!hasLang(installedLangs, lang) && hasLang(downloadableLangs, lang)) o.put("onDeviceDownloadable", true);
                        finishAvailable(call, o, sys, dev, lang);
                    }
                    @Override public void onError(int error) { p.destroy(); finishAvailable(call, o, sys, dev, lang); }
                });
                return;
            }
            finishAvailable(call, o, sys, dev, lang);
        });
    }

    private void finishAvailable(PluginCall call, JSObject o, boolean sys, boolean dev, String lang) {
        boolean here = dev && useOnDevice(lang);
        o.put("available", here || sys);
        o.put("onDevice", here);
        o.put("engine", here ? "android-ondevice" : "android-system");
        if (!here && !sys) o.put("reason", "no-service");
        call.resolve(o);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "micPermission"); return; }
        begin(call);
    }

    @PermissionCallback
    private void micPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("麥克風權限沒有打開", "permission");
    }

    private void begin(PluginCall call) {
        String l = normLang(call.getString("lang"));
        main.post(() -> {
            teardown();
            boolean dev = useOnDevice(l);
            if (!dev && deviceRecognizer() && downloadableLangs != null && hasLang(downloadableLangs, l) && !downloadAsked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                downloadAsked = true; // 請系統下載這個語言的手機上語言包（下次就能在手機上辨識）；這次先用系統辨識
                try { SpeechRecognizer r = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()); r.triggerModelDownload(intent(l)); r.destroy(); }
                catch (Exception e) { Logger.warn(TAG, "triggerModelDownload：" + e.getClass().getSimpleName()); }
            }
            if (!dev && !SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("這支手機沒有語音辨識服務", "no-service"); return; }
            if (!listen(l, dev)) { call.reject("語音辨識開不起來", "no-service"); return; }
            fellBack = false;
            JSObject o = new JSObject();
            o.put("onDevice", dev);
            o.put("engine", dev ? "android-ondevice" : "android-system");
            o.put("lang", l);
            call.resolve(o);
        });
    }

    /** 建立辨識器並開始聽（主執行緒） */
    private boolean listen(String l, boolean dev) {
        final int my = ++session;
        try { rec = dev ? SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext()) : SpeechRecognizer.createSpeechRecognizer(getContext()); }
        catch (Exception e) { Logger.warn(TAG, "create：" + e.getClass().getSimpleName()); rec = null; return false; }
        onDevice = dev; lang = l; heard = false; lastLevelAt = 0;
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
                heard = true;
                JSObject o = new JSObject();
                o.put("text", t);
                notifyListeners("partial", o);
            }
            @Override public void onResults(Bundle b) {
                if (my != session) return;
                JSObject o = new JSObject();
                o.put("text", first(b));
                o.put("onDevice", onDevice);
                teardown();
                notifyListeners("final", o);
            }
            @Override public void onError(int error) {
                if (my != session) return;
                // 手機上的辨識器說這個語言不能用（語言包沒裝好）：還沒聽到字就改用系統辨識，照實回報
                if (onDevice && !heard && !fellBack && (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) && SpeechRecognizer.isRecognitionAvailable(getContext())) {
                    Logger.info(TAG, "on-device language unavailable, using system recognizer");
                    teardown();
                    fellBack = true;
                    if (listen(lang, false)) {
                        JSObject e = new JSObject();
                        e.put("onDevice", false);
                        e.put("engine", "android-system");
                        notifyListeners("engine", e);
                        return;
                    }
                }
                Logger.warn(TAG, "error " + error); // 只記代碼
                teardown();
                JSObject o = new JSObject();
                o.put("code", code(error));
                o.put("message", message(error));
                notifyListeners("error", o);
            }
        });
        try { rec.startListening(intent(l)); }
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
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED: case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE: return "language";
            case SpeechRecognizer.ERROR_CLIENT: return "client";
            default: return "service"; // ERROR_SERVER、ERROR_SERVER_DISCONNECTED、ERROR_CANNOT_CHECK_SUPPORT…
        }
    }

    /** 中文說明（JS 依 code 用字典顯示；這段給 log 以外的除錯與沒有字典時） */
    static String message(int e) {
        switch (code(e)) {
            case "network": return "語音辨識連不上";
            case "audio": return "麥克風收不到聲音";
            case "no-speech": return "沒有聽到聲音";
            case "no-match": return "沒聽清楚";
            case "busy": return "語音辨識正在忙";
            case "permission": return "麥克風權限沒有打開";
            case "language": return "語音辨識不支援這個語言";
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

    /** App 到背景：不在背景開著麥克風 */
    @Override
    protected void handleOnPause() {
        main.post(() -> { session++; teardown(); });
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> { session++; teardown(); });
        super.handleOnDestroy();
    }
}
