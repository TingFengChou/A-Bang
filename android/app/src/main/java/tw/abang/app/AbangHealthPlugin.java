package tw.abang.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.aggregate.AggregateMetric;
import androidx.health.connect.client.aggregate.AggregationResultGroupedByDuration;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.request.AggregateGroupByDurationRequest;
import androidx.health.connect.client.time.TimeRangeFilter;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;
import kotlin.Result;
import kotlin.coroutines.Continuation;
import kotlin.coroutines.CoroutineContext;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.coroutines.intrinsics.IntrinsicsKt;

/**
 * 健康與運動（ADR-0018）：從 Health Connect 讀步數與運動時間（今天與近 7 天），只讀不寫。JS 端：public/js/health.js（外掛名 AbangHealth）。
 * 健康資料只在手機上：回傳給 WebView 的只有每日的日期、步數、運動分鐘（不漏 Health Connect 的原始欄位、資料來源 App），
 * JS 也只在手機上判斷，不送伺服器；這裡不寫 log（只記錯誤類別，不記數字）。
 * - status()：Health Connect 能不能用（not-installed／update-needed／os）與權限（granted／partial／prompt／denied）
 * - requestPermission()：跳 Health Connect 的權限畫面（READ_STEPS、READ_EXERCISE），允許由使用者自己按
 * - summary({ days })：每日步數（StepsRecord.COUNT_TOTAL）與運動分鐘（ExerciseSessionRecord.EXERCISE_DURATION_TOTAL），
 *   依台灣時間每天切（跟 JS 的 core/health-nudge.js twDate 一致）；有權限而且查得到時，沒有紀錄的那天是 0，查不到是 null
 * - openSettings({ target })：manage 開 Health Connect 的權限管理；install 開 Play 商店安裝或更新 Health Connect。只開畫面，不改設定。
 * 權限 rationale（隱私說明）畫面：HealthRationaleActivity（AndroidManifest 的 intent filter）。
 * Health Connect 的 API 是 Kotlin suspend 函式：這裡用 Continuation 從 Java 呼叫（await）。
 */
@CapacitorPlugin(name = "AbangHealth")
public class AbangHealthPlugin extends Plugin {
    private static final String TAG = "AbangHealth";
    private static final String HC_PACKAGE = "com.google.android.apps.healthdata";
    static final String READ_STEPS = "android.permission.health.READ_STEPS";
    static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";
    private static final Set<String> PERMS = new HashSet<>(java.util.Arrays.asList(READ_STEPS, READ_EXERCISE));
    /** 使用者在這次 App 執行中被拒過（Health Connect 不會告訴我們「被拒」與「還沒問」的差別） */
    private volatile boolean deniedOnce = false;

    // ───── Kotlin suspend → Java ─────
    @SuppressWarnings("rawtypes")
    private interface Suspend { Object invoke(Continuation c); }

    @SuppressWarnings({ "unchecked", "rawtypes" })
    private static <T> void await(Suspend fn, Consumer<T> ok, Consumer<Throwable> fail) {
        Continuation<T> cont = new Continuation<T>() {
            @Override public CoroutineContext getContext() { return EmptyCoroutineContext.INSTANCE; }
            @Override public void resumeWith(Object result) {
                if (result instanceof Result.Failure) fail.accept(((Result.Failure) result).exception);
                else {
                    try { ok.accept((T) result); } catch (Throwable t) { fail.accept(t); }
                }
            }
        };
        try {
            Object r = fn.invoke(cont);
            if (r != IntrinsicsKt.getCOROUTINE_SUSPENDED()) cont.resumeWith(r); // 沒有暫停：直接拿到結果
        } catch (Throwable t) {
            fail.accept(t);
        }
    }

    /** Health Connect 能不能用：null＝可以；否則是原因 */
    private String unavailableReason() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "os";
        int s;
        try { s = HealthConnectClient.getSdkStatus(getContext(), HC_PACKAGE); } catch (Throwable t) { return "not-installed"; }
        if (s == HealthConnectClient.SDK_AVAILABLE) return null;
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update-needed";
        return Build.VERSION.SDK_INT >= 34 ? "os" : "not-installed"; // Android 14 起內建，不能用就是系統不支援
    }

    private HealthConnectClient client() { return HealthConnectClient.getOrCreate(getContext(), HC_PACKAGE); }

    private JSObject base(String permission) {
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
        PermissionController pc = client().getPermissionController();
        AbangHealthPlugin.<Set<String>>await(pc::getGrantedPermissions, then, (t) -> { Logger.error(TAG, "granted: " + t.getClass().getSimpleName(), null); call.resolve(unavailable("failed")); });
    }
    private String permOf(Set<String> granted) {
        boolean s = granted.contains(READ_STEPS), e = granted.contains(READ_EXERCISE);
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
            if (g.containsAll(PERMS)) { call.resolve(base("granted")); return; }
            try {
                ActivityResultContract<Set<String>, Set<String>> c = PermissionController.createRequestPermissionResultContract(HC_PACKAGE);
                startActivityForResult(call, c.createIntent(getContext(), PERMS), "permissionResult");
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
        withGranted(call, (g) -> {
            LocalDate today = LocalDate.now(TW);
            Instant from = today.minusDays(days - 1).atStartOfDay(TW).toInstant();
            Instant to = Instant.now();
            JSObject[] rows = new JSObject[days];
            for (int i = 0; i < days; i++) {
                rows[i] = new JSObject();
                rows[i].put("date", today.minusDays(days - 1 - i).toString());
                rows[i].put("steps", JSObject.NULL);
                rows[i].put("exerciseMin", JSObject.NULL);
            }
            Runnable done = () -> {
                JSArray arr = new JSArray();
                for (JSObject r : rows) arr.put(r);
                JSObject out = new JSObject();
                out.put("source", "health-connect");
                out.put("days", arr);
                call.resolve(out);
            };
            boolean steps = g.contains(READ_STEPS), ex = g.contains(READ_EXERCISE);
            Runnable readExercise = () -> {
                if (!ex) { done.run(); return; }
                aggregate(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL, from, to, (list) -> {
                    for (JSObject r : rows) r.put("exerciseMin", 0);
                    for (AggregationResultGroupedByDuration p : list) {
                        Duration d = p.getResult().get(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL);
                        put(rows, today, days, p.getStartTime(), "exerciseMin", d == null ? null : (Object) Math.round(d.getSeconds() / 60.0));
                    }
                    done.run();
                }, (t) -> done.run());
            };
            if (!steps) { readExercise.run(); return; }
            aggregate(StepsRecord.COUNT_TOTAL, from, to, (list) -> {
                for (JSObject r : rows) r.put("steps", 0);
                for (AggregationResultGroupedByDuration p : list) {
                    Long n = p.getResult().get(StepsRecord.COUNT_TOTAL);
                    put(rows, today, days, p.getStartTime(), "steps", n);
                }
                readExercise.run();
            }, (t) -> readExercise.run());
        });
    }

    private static final ZoneId TW = ZoneId.of("Asia/Taipei");

    private static void put(JSObject[] rows, LocalDate today, int days, Instant start, String key, Object v) {
        LocalDate date = start.atZone(TW).toLocalDate();
        int i = days - 1 - (int) java.time.temporal.ChronoUnit.DAYS.between(date, today);
        if (i >= 0 && i < days && v != null) rows[i].put(key, v);
    }

    private void aggregate(AggregateMetric<?> metric, Instant from, Instant to, Consumer<List<AggregationResultGroupedByDuration>> ok, Consumer<Throwable> fail) {
        Set<AggregateMetric<?>> metrics = Collections.singleton(metric);
        AggregateGroupByDurationRequest req = new AggregateGroupByDurationRequest(metrics, TimeRangeFilter.between(from, to), Duration.ofDays(1), Collections.emptySet());
        AbangHealthPlugin.<List<AggregationResultGroupedByDuration>>await((c) -> client().aggregateGroupByDuration(req, c), ok, (t) -> { Logger.error(TAG, "aggregate: " + t.getClass().getSimpleName(), null); fail.accept(t); });
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String target = call.getString("target", "manage");
        try {
            Intent i;
            if ("install".equals(target)) {
                i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + HC_PACKAGE + "&url=healthconnect%3A%2F%2Fonboarding"));
                i.setPackage("com.android.vending");
            } else {
                i = HealthConnectClient.getHealthConnectManageDataIntent(getContext(), HC_PACKAGE);
            }
            getActivity().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + HC_PACKAGE)));
                call.resolve();
            } catch (Exception e2) {
                call.reject("無法開啟 Health Connect");
            }
        } catch (Throwable t) {
            call.reject("無法開啟 Health Connect");
        }
    }
}
