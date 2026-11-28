package tw.abang.app;

import android.content.Intent;
import android.content.SharedPreferences;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 到站提醒常駐服務的開關（JS：public/js/native-watch.js，外掛名 AbangWatch）。
 * start：開始盯（AbangWatchService，通知列常駐、到點響鈴）；stop：停止；status：現在有沒有在盯、有沒有已經提醒過。
 * startAlight／stopAlight／alightStatus：下車提醒（AbangAlightService，跟到站提醒可以同時進行）。
 * startLeave／stopLeave（2026-11-28 第十四輪）：出發倒數——台鐵、高鐵、末班車的出門提醒設好時，通知列一則倒數到該出門的時間
 *   （系統 chronometer 自己走，不用前景服務、不連網）；出門時間過 1 分自動消失（之後由原本排好的出門通知接手）。JS：public/js/leave-activity.js
 */
@CapacitorPlugin(name = "AbangWatch")
public class AbangWatchPlugin extends Plugin {
    static final int LEAVE_NID = 7300;

    @PluginMethod
    public void startLeave(PluginCall call) {
        String title = call.getString("title");
        String text = call.getString("text");
        double leave = call.getData().optDouble("leaveAt", Double.NaN); // 毫秒從 JS 過來是整數（Long）：直接讀數字（同 addCalendarEvent）
        long now = System.currentTimeMillis();
        if (title == null || title.isEmpty() || text == null || text.isEmpty() || Double.isNaN(leave) || (long) leave <= now || (long) leave - now > 12L * 3600 * 1000) { call.reject("參數不完整"); return; }
        android.content.Context ctx = getContext();
        if (!androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()) { call.reject("通知沒有開"); return; }
        AbangWatchService.ensureChannels(ctx);
        boolean en = "en".equals(call.getString("lang"));
        android.content.Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new android.content.Intent(ctx, MainActivity.class);
        open.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
        android.app.PendingIntent pi = android.app.PendingIntent.getActivity(ctx, 3, open, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        androidx.core.app.NotificationCompat.Builder b = new androidx.core.app.NotificationCompat.Builder(ctx, AbangWatchService.CH_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_abang)
            .setContentTitle((en ? "Time to leave · " : "出發倒數・") + title)
            .setContentText(text)
            .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(text + (en ? "\nFrom the timetable; counts down without data." : "\n照時刻表算的，不用連網也會倒數。")))
            .setWhen((long) leave)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setTimeoutAfter((long) leave - now + 60_000)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(pi);
        try {
            androidx.core.app.NotificationManagerCompat.from(ctx).notify(LEAVE_NID, b.build());
            call.resolve();
        } catch (SecurityException e) {
            call.reject("通知沒有開");
        }
    }

    @PluginMethod
    public void stopLeave(PluginCall call) {
        androidx.core.app.NotificationManagerCompat.from(getContext()).cancel(LEAVE_NID);
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String apiBase = call.getString("apiBase");
        String route = call.getString("routeName");
        String stop = call.getString("stop");
        if (apiBase == null || !apiBase.matches("^https?://.+") || route == null || stop == null) { call.reject("參數不完整"); return; }
        Intent i = new Intent(getContext(), AbangWatchService.class);
        i.putExtra("apiBase", apiBase.replaceAll("/+$", ""));
        i.putExtra("city", call.getString("city"));
        i.putExtra("routeName", route);
        i.putExtra("stop", stop);
        i.putExtra("lang", call.getString("lang", "zh"));
        Integer dir = call.getInt("direction");
        if (dir != null) i.putExtra("direction", dir);
        Integer lead = call.getInt("leadSec", 180);
        i.putExtra("leadSec", lead == null ? 180 : lead);
        Long until = call.getLong("until");
        if (until != null) i.putExtra("until", until);
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("無法啟動提醒服務");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try { getContext().startService(new Intent(getContext(), AbangWatchService.class).setAction(AbangWatchService.ACTION_STOP)); } catch (Exception ignored) { /* 沒在跑 */ }
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("active", AbangWatchService.active);
        r.put("firedAt", AbangWatchService.firedAt);
        r.put("endedAt", AbangWatchService.endedAt);
        r.put("etaSec", AbangWatchService.lastEta);
        r.put("text", AbangWatchService.lastText);
        call.resolve(r);
    }

    @PluginMethod
    public void startAlight(PluginCall call) {
        String apiBase = call.getString("apiBase");
        String route = call.getString("routeName");
        String board = call.getString("board");
        String dest = call.getString("dest");
        Long boardAt = call.getLong("boardAt");
        Integer rideSec = call.getInt("rideSec");
        if (apiBase == null || !apiBase.matches("^https?://.+") || route == null || board == null || dest == null || boardAt == null || rideSec == null) { call.reject("參數不完整"); return; }
        Intent i = new Intent(getContext(), AbangAlightService.class);
        i.putExtra("apiBase", apiBase.replaceAll("/+$", ""));
        i.putExtra("city", call.getString("city"));
        i.putExtra("routeName", route);
        i.putExtra("board", board);
        i.putExtra("dest", dest);
        i.putExtra("plate", call.getString("plate"));
        i.putExtra("lang", call.getString("lang", "zh"));
        i.putExtra("boardAt", boardAt);
        i.putExtra("rideSec", rideSec);
        Integer dir = call.getInt("direction");
        if (dir != null) i.putExtra("direction", dir);
        Integer bs = call.getInt("boardSeq");
        if (bs != null) i.putExtra("boardSeq", bs);
        Integer ds = call.getInt("destSeq");
        if (ds != null) i.putExtra("destSeq", ds);
        Long until = call.getLong("until");
        if (until != null) i.putExtra("until", until);
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("無法啟動提醒服務");
        }
    }

    @PluginMethod
    public void stopAlight(PluginCall call) {
        if (AbangAlightService.active) {
            try { getContext().startService(new Intent(getContext(), AbangAlightService.class).setAction(AbangAlightService.ACTION_STOP)); } catch (Exception ignored) { /* 沒在跑 */ }
        }
        call.resolve();
    }

    @PluginMethod
    public void alightStatus(PluginCall call) {
        SharedPreferences p = AbangAlightService.prefs(getContext());
        JSObject r = new JSObject();
        r.put("active", AbangAlightService.active);
        r.put("firedAt", p.getLong("firedAt", 0));
        r.put("endedAt", p.getLong("endedAt", 0));
        r.put("etaSec", AbangAlightService.lastEta);
        r.put("text", AbangAlightService.lastText);
        call.resolve(r);
    }
}
