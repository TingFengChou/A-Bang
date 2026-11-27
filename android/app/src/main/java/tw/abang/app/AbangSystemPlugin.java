package tw.abang.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 系統功能（外掛名 AbangSystem）。只開系統畫面，不讀、不改任何設定或資料；最後一步都由使用者在系統畫面上確認。
 * - openSettings（S1c）：定位權限被拒絕時開本 App 的設定頁，定位服務關閉時開系統的定位設定。JS 端：public/js/location-help.js
 * - addCalendarEvent（ADR-0021）：開行事曆 App 的新增行程畫面（ACTION_INSERT），使用者按儲存才寫入；不需要行事曆權限，阿幫不讀行事曆。
 *   Android 拿不到使用者有沒有按儲存，所以回 opened。
 * - share（ADR-0021）：開系統分享選單（ACTION_SEND chooser），使用者自己選對象。
 *   JS 端：public/js/device-actions.js（內容由 core/device-actions.js 產生，不經模型）
 */
@CapacitorPlugin(name = "AbangSystem")
public class AbangSystemPlugin extends Plugin {
    @PluginMethod
    public void openSettings(PluginCall call) {
        String target = call.getString("target", "app");
        Intent intent = "location".equals(target)
            ? new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        try {
            getActivity().startActivity(intent); // 用 Activity 開：按返回回到阿幫
            call.resolve();
        } catch (Exception e) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS)); // 少數機型（Go、TV）沒有定位設定頁
                call.resolve();
            } catch (Exception e2) {
                call.reject("無法開啟設定");
            }
        }
    }

    @PluginMethod
    public void addCalendarEvent(PluginCall call) {
        String title = call.getString("title");
        Double start = call.getDouble("start");
        Double end = call.getDouble("end");
        if (title == null || title.isEmpty() || start == null || end == null || end <= start || end - start > 24 * 3600 * 1000d) {
            call.reject("行程資料不完整", "invalid");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start.longValue())
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.longValue())
            .putExtra(CalendarContract.Events.TITLE, title);
        String location = call.getString("location");
        String notes = call.getString("notes");
        if (location != null) intent.putExtra(CalendarContract.Events.EVENT_LOCATION, location);
        if (notes != null) intent.putExtra(CalendarContract.Events.DESCRIPTION, notes);
        try {
            getActivity().startActivity(intent);
            JSObject r = new JSObject();
            r.put("opened", true);
            call.resolve(r);
        } catch (ActivityNotFoundException e) {
            call.reject("找不到行事曆 App", "no-app");
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("沒有要分享的內容", "invalid");
            return;
        }
        String url = call.getString("url");
        if (url != null && url.startsWith("https://")) text = text + "\n" + url; // 只收 https
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        String title = call.getString("title");
        if (title != null) send.putExtra(Intent.EXTRA_SUBJECT, title);
        try {
            getActivity().startActivity(Intent.createChooser(send, title != null ? title : "分享"));
            JSObject r = new JSObject();
            r.put("opened", true);
            call.resolve(r);
        } catch (ActivityNotFoundException e) {
            call.reject("沒有可以分享的 App", "no-app");
        }
    }
}
