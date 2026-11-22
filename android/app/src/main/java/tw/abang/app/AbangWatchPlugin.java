package tw.abang.app;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 到站提醒常駐服務的開關（JS：public/js/native-watch.js，外掛名 AbangWatch）。
 * start：開始盯（AbangWatchService，通知列常駐、到點響鈴）；stop：停止；status：現在有沒有在盯、有沒有已經提醒過。
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
        r.put("etaSec", AbangWatchService.lastEta);
        r.put("text", AbangWatchService.lastText);
        call.resolve(r);
    }
}
