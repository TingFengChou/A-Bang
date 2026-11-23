package tw.abang.app;

import android.content.Context;
import android.content.Intent;
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
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
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
 * 健康與運動（ADR-0018）：Health Connect 與 java.time 都只在這個類別裡（AbangHealthPlugin 在 Android 9 以上才呼叫），
 * 舊 Android 載入外掛時不會碰到 API 26 以上才有的類別。這裡沒有會在類別初始化時跑的 static 欄位（只有編譯期字串常數）。
 * 每日加總用 aggregateGroupByDuration（Instant＋1 天），切日固定用 Asia/Taipei（跟 JS 的 core/health-nudge.js twDate 一致）；
 * 有權限而且查得到時，沒有紀錄的那天是 0，查不到是 null。Kotlin suspend 函式用 Continuation 從 Java 呼叫（await）。
 */
final class HealthConnectReader {
    static final String HC_PACKAGE = "com.google.android.apps.healthdata";
    static final String READ_STEPS = "android.permission.health.READ_STEPS";
    static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";

    private HealthConnectReader() {}

    private static Set<String> perms() { return new HashSet<>(Arrays.asList(READ_STEPS, READ_EXERCISE)); }
    private static HealthConnectClient client(Context ctx) { return HealthConnectClient.getOrCreate(ctx, HC_PACKAGE); }

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

    /** null＝可以用；否則是原因（呼叫前已確定 Android 9 以上） */
    static String unavailableReason(Context ctx) {
        int s;
        try { s = HealthConnectClient.getSdkStatus(ctx, HC_PACKAGE); } catch (Throwable t) { return "not-installed"; }
        if (s == HealthConnectClient.SDK_AVAILABLE) return null;
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update-needed";
        return android.os.Build.VERSION.SDK_INT >= 34 ? "os" : "not-installed"; // Android 14 起內建，不能用就是系統不支援
    }

    static void granted(Context ctx, Consumer<Set<String>> ok, Consumer<Throwable> fail) {
        try {
            PermissionController pc = client(ctx).getPermissionController();
            HealthConnectReader.<Set<String>>await(pc::getGrantedPermissions, ok, fail);
        } catch (Throwable t) {
            fail.accept(t);
        }
    }

    static Intent permissionIntent(Context ctx) {
        ActivityResultContract<Set<String>, Set<String>> c = PermissionController.createRequestPermissionResultContract(HC_PACKAGE);
        return c.createIntent(ctx, perms());
    }

    static Intent manageIntent(Context ctx) { return HealthConnectClient.getHealthConnectManageDataIntent(ctx, HC_PACKAGE); }

    /** 每日步數與運動分鐘（最近 days 天，台灣時間切日） */
    static void summary(Context ctx, int days, Set<String> granted, Consumer<JSObject> done) {
        ZoneId tw = ZoneId.of("Asia/Taipei");
        LocalDate today = LocalDate.now(tw);
        Instant from = today.minusDays(days - 1).atStartOfDay(tw).toInstant();
        Instant to = Instant.now();
        JSObject[] rows = new JSObject[days];
        for (int i = 0; i < days; i++) {
            rows[i] = new JSObject();
            rows[i].put("date", today.minusDays(days - 1 - i).toString());
            rows[i].put("steps", JSObject.NULL);
            rows[i].put("exerciseMin", JSObject.NULL);
        }
        Runnable finish = () -> {
            JSArray arr = new JSArray();
            for (JSObject r : rows) arr.put(r);
            JSObject out = new JSObject();
            out.put("source", "health-connect");
            out.put("days", arr);
            done.accept(out);
        };
        boolean steps = granted.contains(READ_STEPS), ex = granted.contains(READ_EXERCISE);
        Runnable readExercise = () -> {
            if (!ex) { finish.run(); return; }
            aggregate(ctx, ExerciseSessionRecord.EXERCISE_DURATION_TOTAL, from, to, (list) -> {
                for (JSObject r : rows) r.put("exerciseMin", 0);
                for (AggregationResultGroupedByDuration p : list) {
                    Duration d = p.getResult().get(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL);
                    put(rows, today, tw, days, p.getStartTime(), "exerciseMin", d == null ? null : (Object) Math.round(d.getSeconds() / 60.0));
                }
                finish.run();
            }, (t) -> finish.run());
        };
        if (!steps) { readExercise.run(); return; }
        aggregate(ctx, StepsRecord.COUNT_TOTAL, from, to, (list) -> {
            for (JSObject r : rows) r.put("steps", 0);
            for (AggregationResultGroupedByDuration p : list) {
                Long n = p.getResult().get(StepsRecord.COUNT_TOTAL);
                put(rows, today, tw, days, p.getStartTime(), "steps", n);
            }
            readExercise.run();
        }, (t) -> readExercise.run());
    }

    private static void put(JSObject[] rows, LocalDate today, ZoneId tw, int days, Instant start, String key, Object v) {
        LocalDate date = start.atZone(tw).toLocalDate();
        int i = days - 1 - (int) ChronoUnit.DAYS.between(date, today);
        if (i >= 0 && i < days && v != null) rows[i].put(key, v);
    }

    private static void aggregate(Context ctx, AggregateMetric<?> metric, Instant from, Instant to, Consumer<List<AggregationResultGroupedByDuration>> ok, Consumer<Throwable> fail) {
        try {
            Set<AggregateMetric<?>> metrics = Collections.singleton(metric);
            AggregateGroupByDurationRequest req = new AggregateGroupByDurationRequest(metrics, TimeRangeFilter.between(from, to), Duration.ofDays(1), Collections.emptySet());
            HealthConnectReader.<List<AggregationResultGroupedByDuration>>await((c) -> client(ctx).aggregateGroupByDuration(req, c), ok, (t) -> { Logger.error(AbangHealthPlugin.TAG, "aggregate: " + t.getClass().getSimpleName(), null); fail.accept(t); });
        } catch (Throwable t) {
            fail.accept(t);
        }
    }
}
