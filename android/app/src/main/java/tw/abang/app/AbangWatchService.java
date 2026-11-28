package tw.abang.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * 到站提醒的常駐服務（2026-11-22 產品負責人：提醒很重要，要做成常駐服務）。
 * App 關掉、螢幕關著也每 20 秒查一次真實到站時間（POST {apiBase}/api/v1/tools/bus_route_eta，跟畫面用同一個工具），
 * 通知列常駐顯示「307 往撫遠街：約 5 分到「臺北車站」」，到了「到站前 N 分」才響鈴提醒，然後結束。
 * 只送路線、站名、方向給阿幫伺服器（跟 App 畫面查詢一樣），不送位置、不記錄內容。
 */
public class AbangWatchService extends Service {
    static final String CH_ONGOING = "abang-watch-v2"; // v2：一般通知區（不放在「靜音」），沒有聲音、不震動
    static final String CH_ALERT = "abang-watch-alert";
    static final int ONGOING_ID = 7101;
    static final int ALERT_ID = 7102;
    static final String ACTION_STOP = "tw.abang.app.WATCH_STOP";
    static final long POLL_MS = 20_000;

    /** 給外掛查狀態（同一個行程裡） */
    static volatile boolean active = false;
    static volatile long firedAt = 0;
    /** 末班已過、今日未營運：提醒自動取消的時間（0＝沒有）；App 回到前景時畫面跟著收掉 */
    static volatile long endedAt = 0;
    static volatile int lastEta = -1;
    static volatile String lastText = "";

    private final Handler h = new Handler(Looper.getMainLooper());
    private ExecutorService io;
    private String apiBase, city, route, stop, lang;
    private int direction = -1, leadSec = 180;
    private long until;
    private boolean first = true;
    private int skip = -1;

    /** 第幾次設定（重新設定後，舊的查詢結果與到點提醒不用） */
    private int gen = 0;
    /** 兩次查詢之間到點的提醒（每次查完重排，車延誤時不會提早響） */
    private Runnable pendingAlert = null;

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!active) return;
            if (System.currentTimeMillis() > until) { stopNow(); return; }
            final int g = gen;
            io.execute(() -> {
                JSONObject focus = fetch();
                h.post(() -> { if (g == gen) handle(focus); }); // 重新設定（換路線、換站）後，舊的查詢結果不用（審查 2026-11-23）
            });
            h.postDelayed(this, POLL_MS);
        }
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            if (active && intent != null) endedAt = System.currentTimeMillis(); // 使用者在通知按「停止」：App 回前景時畫面跟著收掉（審查 2026-11-23）
            stopNow();
            return START_NOT_STICKY;
        }
        apiBase = intent.getStringExtra("apiBase");
        city = intent.getStringExtra("city");
        route = intent.getStringExtra("routeName");
        stop = intent.getStringExtra("stop");
        lang = intent.getStringExtra("lang");
        direction = intent.getIntExtra("direction", -1);
        leadSec = Math.max(60, intent.getIntExtra("leadSec", 180));
        until = intent.getLongExtra("until", System.currentTimeMillis() + 90 * 60_000L);
        first = true; skip = -1; firedAt = 0; endedAt = 0; lastEta = -1;
        if (apiBase == null || route == null || stop == null) { stopNow(); return START_NOT_STICKY; }
        channels();
        Notification n = ongoing(en() ? ("Watching bus " + route + " at " + stop) : ("正在幫您盯 " + route + "（" + stop + "）"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(ONGOING_ID, n);
        if (io == null) io = Executors.newSingleThreadExecutor();
        active = true;
        gen++;
        h.removeCallbacksAndMessages(null); // 舊的查詢、還沒響的到點提醒都清掉
        h.post(poll);
        return START_NOT_STICKY; // 系統殺掉就算了：不在使用者不知道的時候重開
    }

    private boolean en() { return "en".equals(lang); }

    private void channels() { ensureChannels(this); }

    /** 通知頻道（到站提醒與下車提醒共用：進行中 CH_ONGOING、響鈴 CH_ALERT） */
    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        nm.deleteNotificationChannel("abang-watch"); // 舊版（靜音區）
        NotificationChannel a = new NotificationChannel(CH_ONGOING, "公車到站追蹤（進行中）", NotificationManager.IMPORTANCE_DEFAULT);
        a.setDescription("到站提醒、下車提醒進行中時常駐顯示公車還要多久");
        a.setShowBadge(false);
        a.setSound(null, null);
        a.enableVibration(false);
        nm.createNotificationChannel(a);
        NotificationChannel b = new NotificationChannel(CH_ALERT, "公車快到站", NotificationManager.IMPORTANCE_HIGH);
        b.setDescription("到站前提醒您出門、快到下車站時提醒您下車");
        b.enableVibration(true);
        b.setVibrationPattern(new long[] { 0, 300, 150, 300 });
        nm.createNotificationChannel(b);
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification ongoing(String text) {
        lastText = text;
        Intent s = new Intent(this, AbangWatchService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, s, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CH_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_abang)
            .setContentTitle(en() ? "Abang: bus arrival reminder" : "阿幫：到站提醒進行中")
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
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(ONGOING_ID, ongoing(text));
    }

    private JSONObject fetch() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(apiBase + "/api/v1/tools/bus_route_eta").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(10_000);
            c.setReadTimeout(15_000);
            c.setDoOutput(true);
            c.setRequestProperty("content-type", "application/json");
            JSONObject body = new JSONObject();
            if (city != null) body.put("city", city);
            body.put("routeName", route);
            body.put("stop", stop);
            if (direction >= 0) body.put("direction", direction);
            try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            if (c.getResponseCode() != 200) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line; while ((line = r.readLine()) != null) sb.append(line);
            }
            JSONObject data = new JSONObject(sb.toString()).optJSONObject("data");
            return data == null ? null : data.optJSONObject("focus");
        } catch (Exception e) {
            return null; // 連不上：下次再試（通知列照實說）
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void handle(JSONObject f) {
        if (!active) return;
        if (f == null) { update(en() ? "Can't reach Abang right now; retrying…" : "暫時查不到到站時間，稍後再試…"); return; }
        if (pendingAlert != null) { h.removeCallbacks(pendingAlert); pendingAlert = null; } // 查到新資料才重新決定（車延誤：舊的提早提醒取消；查不到就照原本的時間響）
        int status = f.optInt("status", 0);
        String label = f.optString("label", "");
        String st = f.optString("stopName", stop);
        String statusText = f.optString("statusText", "");
        if (status == 3 || status == 4) { // 末班已過、今日未營運：這班不會來了，提醒自動取消並說一聲（產品負責人 2026-11-22：過期的提醒要清掉）
            ended(st, status == 3);
            stopNow();
            return;
        }
        if (status != 0 || f.isNull("etaSec")) { // 尚未發車、交管不停靠：照實說，繼續盯
            update(en() ? ("Bus " + route + " " + label + ": " + statusText + " (" + st + ")") : (route + " " + label + "：" + statusText + "（" + st + "）"));
            return;
        }
        int eta = f.optInt("etaSec", -1);
        lastEta = eta;
        int left = eta - leadSec;
        if (skip >= 0) { // 這班設的時候已經趕不上：等下一班
            if (eta > skip + 60) { skip = -1; } else { skip = eta; update(text(eta, st, label) + (en() ? " · waiting for the next bus" : "・這班來不及，等下一班")); return; }
        } else if (first && left <= 0) {
            first = false; skip = eta;
            update(text(eta, st, label) + (en() ? " · waiting for the next bus" : "・這班來不及，等下一班"));
            return;
        }
        first = false;
        if (left <= 0) { alert(eta, st); stopNow(); return; }
        update(text(eta, st, label) + (en() ? (" · I'll remind you " + Math.round(leadSec / 60f) + " min before") : ("・到站前 " + Math.round(leadSec / 60f) + " 分提醒您")));
        if (left * 1000L < POLL_MS) { // 兩次更新之間到點：準時提醒
            pendingAlert = () -> { if (active) { alert(leadSec, st); stopNow(); } };
            h.postDelayed(pendingAlert, Math.max(0, left) * 1000L);
        }
    }

    private String text(int eta, String st, String label) {
        int m = Math.max(1, Math.round(eta / 60f));
        if (en()) return eta < 60 ? ("Bus " + route + " is arriving at " + st) : ("Bus " + route + " " + label + ": about " + m + " min to " + st);
        return eta < 60 ? (route + " 在「" + st + "」進站中") : (route + " " + label + "：約 " + m + " 分到「" + st + "」");
    }

    private void alert(int eta, String st) {
        firedAt = System.currentTimeMillis();
        int m = Math.max(1, Math.round(eta / 60f));
        String body = en()
            ? (eta < 60 ? ("Bus " + route + " is arriving at " + st + ". Go now!") : ("Bus " + route + " reaches " + st + " in about " + m + " min. Time to go!"))
            : (eta < 60 ? (route + " 在「" + st + "」進站中，快去搭！") : (route + " 約 " + m + " 分後到「" + st + "」，該出門了！"));
        Notification n = new NotificationCompat.Builder(this, CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat_abang)
            .setContentTitle(en() ? "Abang: time to go" : "阿幫：該出門了")
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .build();
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(ALERT_ID, n);
    }

    private void ended(String st, boolean lastPassed) {
        endedAt = System.currentTimeMillis();
        String body = en()
            ? ("Bus " + route + (lastPassed ? " has made its last run today" : " isn't running today") + ", so the reminder for " + st + " is cancelled. Ask Abang for another way.")
            : (route + (lastPassed ? " 末班車已經過了" : " 今天沒有營運") + "，「" + st + "」的到站提醒已取消；可以問阿幫改其他方式。");
        Notification n = new NotificationCompat.Builder(this, CH_ALERT)
            .setSmallIcon(R.drawable.ic_stat_abang)
            .setContentTitle(en() ? "Abang: reminder cancelled" : "阿幫：到站提醒已取消")
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .build();
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(ALERT_ID, n);
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
