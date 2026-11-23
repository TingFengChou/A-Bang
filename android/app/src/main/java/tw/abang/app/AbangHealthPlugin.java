package tw.abang.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Set;
import java.util.function.Consumer;

/**
 * 健康與運動（ADR-0018）：從 Health Connect 讀步數與運動時間（今天與近 7 天），只讀不寫。JS 端：public/js/health.js（外掛名 AbangHealth）。
 * 健康資料只在手機上：回傳給 WebView 的只有每日的日期、步數、運動分鐘（不漏 Health Connect 的原始欄位、資料來源 App），
 * JS 也只在手機上判斷，不送伺服器；這裡不寫 log（只記錯誤類別，不記數字）。
 * - status()：Health Connect 能不能用（not-installed／update-needed／os）與權限（granted／partial／prompt／denied）
 * - requestPermission()：跳 Health Connect 的權限畫面（READ_STEPS、READ_EXERCISE），允許由使用者自己按
 * - summary({ days })：每日步數與運動分鐘（HealthConnectReader：aggregateGroupByDuration，固定以 Asia/Taipei 切日）
 * - openSettings({ target })：manage 開 Health Connect 的權限管理；install 開 Play 商店安裝或更新 Health Connect。只開畫面，不改設定。
 * 權限 rationale（隱私說明）畫面：HealthRationaleActivity（AndroidManifest 的 intent filter）。
 *
 * **Android 7（API 24、25）一開 App 不能閃退**：Capacitor 註冊外掛時會用反射讀這個類別的方法，類別初始化也會跑 static 欄位。
 * 所以這個類別的欄位、方法簽名、static 初始化都**不碰** java.time 與 Health Connect 的類別；那些都在 HealthConnectReader，
 * 只有在 Android 9（API 28，Health Connect 能裝的最低版本）以上才會呼叫到（MIN_SDK）。
 */
@CapacitorPlugin(name = "AbangHealth")
public class AbangHealthPlugin extends Plugin {
    static final String TAG = "AbangHealth";
    /** Health Connect（Google Play 上的 App）需要 Android 9 以上 */
    static final int MIN_SDK = 28;
    /** 使用者在這次 App 執行中被拒過（Health Connect 不會告訴我們「被拒」與「還沒問」的差別） */
    private volatile boolean deniedOnce = false;

    /** Health Connect 能不能用：null＝可以；否則是原因 */
    private String unavailableReason() {
        if (Build.VERSION.SDK_INT < MIN_SDK) return "os";
        return HealthConnectReader.unavailableReason(getContext());
    }

    private static JSObject base(String permission) {
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("permission", permission);
        r.put("source", "health-connect");
        return r;
    }
    private static JSObject unavailable(String reason) {
        JSObject r = new JSObject();
        r.put("available", false);
        r.put("reason", reason);
        r.put("source", "health-connect");
        return r;
    }

    private void withGranted(PluginCall call, Consumer<Set<String>> then) {
        HealthConnectReader.granted(getContext(), then, (t) -> { Logger.error(TAG, "granted: " + t.getClass().getSimpleName(), null); call.resolve(unavailable("failed")); });
    }
    private String permOf(Set<String> granted) {
        boolean s = granted.contains(HealthConnectReader.READ_STEPS), e = granted.contains(HealthConnectReader.READ_EXERCISE);
        return s && e ? "granted" : s || e ? "partial" : deniedOnce ? "denied" : "prompt";
    }

    @PluginMethod
    public void status(PluginCall call) {
        String why = unavailableReason();
        if (why != null) { call.resolve(unavailable(why)); return; }
        withGranted(call, (g) -> call.resolve(base(permOf(g))));
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String why = unavailableReason();
        if (why != null) { call.resolve(unavailable(why)); return; }
        withGranted(call, (g) -> {
            if ("granted".equals(permOf(g))) { call.resolve(base("granted")); return; }
            try {
                startActivityForResult(call, HealthConnectReader.permissionIntent(getContext()), "permissionResult");
            } catch (Throwable t) {
                Logger.error(TAG, "request: " + t.getClass().getSimpleName(), null);
                call.resolve(unavailable("failed"));
            }
        });
    }

    @ActivityCallback
    private void permissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        // 以 Health Connect 實際給的權限為準（結果 Intent 在不同版本格式不同）
        withGranted(call, (g) -> {
            String p = permOf(g);
            if ("prompt".equals(p)) { deniedOnce = true; p = "denied"; }
            call.resolve(base(p));
        });
    }

    @PluginMethod
    public void summary(PluginCall call) {
        String why = unavailableReason();
        if (why != null) { call.reject("unavailable", why); return; }
        int days = Math.max(1, Math.min(7, call.getInt("days", 7)));
        withGranted(call, (g) -> HealthConnectReader.summary(getContext(), days, g, call::resolve));
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String target = call.getString("target", "manage");
        try {
            Intent i;
            if ("install".equals(target)) {
                i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + HealthConnectReader.HC_PACKAGE + "&url=healthconnect%3A%2F%2Fonboarding"));
                i.setPackage("com.android.vending");
            } else {
                if (Build.VERSION.SDK_INT < MIN_SDK) { call.reject("無法開啟 Health Connect"); return; }
                i = HealthConnectReader.manageIntent(getContext());
            }
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + HealthConnectReader.HC_PACKAGE)));
                call.resolve();
            } catch (Exception e2) {
                call.reject("無法開啟 Health Connect");
            }
        } catch (Throwable t) {
            call.reject("無法開啟 Health Connect");
        }
    }
}
