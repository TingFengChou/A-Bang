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
 */
@CapacitorPlugin(name = "AbangWatch")
public class AbangWatchPlugin extends Plugin {
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
