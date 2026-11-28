package tw.abang.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * 下車提醒的常駐服務（2026-11-23，跟到站提醒 AbangWatchService 一致）。
 * App 關掉、螢幕關著也每 20 秒問阿幫伺服器 GET {apiBase}/api/v1/bus/alight（「我這台」怎麼找只寫在 core/alight.js，這裡不重寫），
 * 通知列常駐「307 坐車中・約 6 分到「市府」・快到時提醒你下車」，快到時在響鈴頻道提醒「準備下車」，然後結束；最多 3 小時。
 * 連不上伺服器：照最近一次的預估時間（沒有就照設定時的估計）準時提醒。
 * 只送路線、方向、上下車站與設定時的估計給阿幫伺服器（跟 App 畫面查詢一樣），不送位置、不記錄內容。
 */
public class AbangAlightService extends Service {
    static final int ONGOING_ID = 7103;
    static final int ALERT_ID = 7104;
    static final String ACTION_STOP = "tw.abang.app.ALIGHT_STOP";
    static final long POLL_MS = 20_000;
    static final int ALIGHT_SEC = 120; // 同 core/alight.js ALIGHT_SEC
    static final String PREFS = "abang-alight";

    /** 給外掛查狀態（同一個行程裡） */
    static volatile boolean active = false;
    static volatile int lastEta = -1;
    static volatile String lastText = "";

    private final Handler h = new Handler(Looper.getMainLooper());
    private ExecutorService io;
    private String apiBase, city, route, board, dest, plate, lang;
    private int direction = -1, boardSeq = -1, destSeq = -1;
    private long boardAt, until, deadline;
    private int rideSec;
    private volatile boolean seen = false;
    private int gen = 0; // 重新開始（換了下車站）時，上一輪還在路上的查詢結果不用

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!active) return;
            if (System.currentTimeMillis() > until) { ended(); return; }
            final long now = System.currentTimeMillis();
            final int g = gen;
            io.execute(() -> {
                JSONObject d = fetch(now);
                h.post(() -> { if (g == gen) handle(d); });
            });
            h.postDelayed(this, POLL_MS);
        }
    };
    private String pendingAlert = null;
    private final Runnable onTime = () -> { if (active && pendingAlert != null) { alert(pendingAlert); stopNow(); } };

    /** firedAt：服務響過的時間；endedAt：使用者在通知按了「停止」或超過 3 小時（0＝沒有）。存起來：App 行程被收掉後重開也知道 */
    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopNow(); return START_NOT_STICKY; }
        if (ACTION_STOP.equals(intent.getAction())) { // 通知上的「停止」或 App 取消：畫面下次查狀態就跟著收掉
            if (active) prefs(this).edit().putLong("endedAt", System.currentTimeMillis()).apply();
            stopNow();
            return START_NOT_STICKY;
        }
        apiBase = intent.getStringExtra("apiBase");
        city = intent.getStringExtra("city");
        route = intent.getStringExtra("routeName");
        board = intent.getStringExtra("board");
        dest = intent.getStringExtra("dest");
        plate = intent.getStringExtra("plate");
        lang = intent.getStringExtra("lang");
        direction = intent.getIntExtra("direction", -1);
        boardSeq = intent.getIntExtra("boardSeq", -1);
        destSeq = intent.getIntExtra("destSeq", -1);
        long now = System.currentTimeMillis();
        boardAt = intent.getLongExtra("boardAt", now);
        rideSec = Math.max(0, intent.getIntExtra("rideSec", 0));
        until = intent.getLongExtra("until", boardAt + 3 * 3600_000L);
        deadline = boardAt + rideSec * 1000L; // 設定時的估計：到下車站的時間
        seen = false; lastEta = -1; pendingAlert = null; gen++;
        prefs(this).edit().putLong("firedAt", 0).putLong("endedAt", 0).apply();
        if (apiBase == null || route == null || board == null || dest == null) { stopNow(); return START_NOT_STICKY; }
        AbangWatchService.ensureChannels(this);
        Notification n = ongoing(fallbackText(Math.round((deadline - now) / 1000f)));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(ONGOING_ID, n);
        if (io == null) io = Executors.newSingleThreadExecutor();
        active = true;
        h.removeCallbacksAndMessages(null);
        h.post(poll);
        return START_NOT_STICKY; // 系統殺掉就算了：不在使用者不知道的時候重開（App 打開時畫面會改回預排通知）
    }

    private boolean en() { return "en".equals(lang); }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 2, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification ongoing(String text) {
        lastText = text;
        Intent s = new Intent(this, AbangAlightService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 3, s, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, AbangWatchService.CH_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_abang)
            .setContentTitle(en() ? "Abang: get-off reminder" : "阿幫：下車提醒進行中")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setContentIntent(openApp())
            .addAction(0, en() ? "Stop" : "停止", stopPi)
            .build();
    }

    private void update(String text) {
        if (!active) return;
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(ONGOING_ID, ongoing(text));
    }

    private String q(String k, String v) { return "&" + k + "=" + Uri.encode(v); }

    private JSONObject fetch(long now) {
        HttpURLConnection c = null;
        try {
            StringBuilder u = new StringBuilder(apiBase).append("/api/v1/bus/alight?city=").append(Uri.encode(city == null ? "" : city));
            u.append(q("route", route)).append(q("board", board)).append(q("dest", dest));
            if (direction >= 0) u.append(q("direction", String.valueOf(direction)));
            if (boardSeq >= 0) u.append(q("boardSeq", String.valueOf(boardSeq)));
            if (destSeq >= 0) u.append(q("destSeq", String.valueOf(destSeq)));
            if (plate != null) u.append(q("plate", plate));
            u.append(q("boardAt", String.valueOf(boardAt))).append(q("rideSec", String.valueOf(rideSec)));
            u.append(q("seen", String.valueOf(seen))).append(q("now", String.valueOf(now)));
            if (en()) u.append(q("lang", "en"));
            c = (HttpURLConnection) new URL(u.toString()).openConnection();
            c.setConnectTimeout(10_000);
            c.setReadTimeout(15_000);
            if (c.getResponseCode() != 200) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line; while ((line = r.readLine()) != null) sb.append(line);
            }
            return new JSONObject(sb.toString()).optJSONObject("data");
        } catch (Exception e) {
            return null; // 連不上：照預估時間（下次再試）
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void handle(JSONObject d) {
        if (!active) return;
        long now = System.currentTimeMillis();
        if (d == null) { // 查不到：到了預估的提醒時間照樣提醒（跟預排的本機通知一樣）
            int left = Math.round((deadline - now) / 1000f);
            if (left <= ALIGHT_SEC) { alert(fallbackAlert(left)); stopNow(); return; }
            update(fallbackText(left) + (en() ? " (offline; using the last estimate)" : "（暫時查不到，照上次的預估）"));
            return;
        }
        if (d.optBoolean("ended", false)) { ended(); return; }
        seen = d.optBoolean("seen", seen);
        String alertText = d.optString("alert", fallbackAlert(ALIGHT_SEC));
        if (d.optBoolean("due", false)) { alert(alertText); stopNow(); return; }
        if (!d.isNull("etaSec")) {
            int eta = d.optInt("etaSec", -1);
            lastEta = eta;
            deadline = now + eta * 1000L;
            int left = eta - ALIGHT_SEC;
            h.removeCallbacks(onTime);
            if (left * 1000L < POLL_MS) { pendingAlert = alertText; h.postDelayed(onTime, Math.max(0, left) * 1000L); } // 兩次更新之間到點：準時提醒
        }
        update(d.optString("ongoing", fallbackText(lastEta)));
    }

    /** 連不上伺服器時的常駐文字（同 core/alight.js alightOngoingText 的口吻） */
    private String fallbackText(int sec) {
        int m = Math.max(1, Math.round(sec / 60f));
        if (en()) return "Bus " + route + " · " + (sec < 0 ? "heading to " + dest : sec < 60 ? "almost at " + dest : "about " + m + " min to " + dest) + " · I'll tell you when to get off";
        return route + " 坐車中・" + (sec < 0 ? "往「" + dest + "」" : sec < 60 ? "快到「" + dest + "」了" : "約 " + m + " 分到「" + dest + "」") + "・快到時提醒您下車";
    }

    /** 連不上伺服器時的響鈴文字（同 core/alight.js alightText） */
    private String fallbackAlert(int sec) {
        int m = Math.max(1, Math.round(sec / 60f));
        if (en()) return sec < 60 ? "Almost at " + dest + ". Get ready to get off!" : "About " + m + " min to " + dest + ". Get ready to get off.";
        return sec < 60 ? "快到「" + dest + "」了，準備下車！" : "約 " + m + " 分後到「" + dest + "」，準備下車";
    }

    private void alert(String body) {
        prefs(this).edit().putLong("firedAt", System.currentTimeMillis()).apply();
        Notification n = new NotificationCompat.Builder(this, AbangWatchService.CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat_abang)
            .setContentTitle(en() ? "Abang: get off soon" : "阿幫：準備下車")
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .build();
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(ALERT_ID, n);
    }

    /** 超過 3 小時：不響，安靜結束（同畫面上的下車提醒） */
    private void ended() {
        prefs(this).edit().putLong("endedAt", System.currentTimeMillis()).apply();
        stopNow();
    }

    private void stopNow() {
        active = false;
        h.removeCallbacksAndMessages(null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override public void onDestroy() {
        active = false;
        h.removeCallbacksAndMessages(null);
        if (io != null) io.shutdownNow();
        super.onDestroy();
    }
}
