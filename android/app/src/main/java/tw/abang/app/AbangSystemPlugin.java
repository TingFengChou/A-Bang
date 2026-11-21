package tw.abang.app;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 開啟系統設定（S1c）：定位權限被拒絕時開本 App 的設定頁，定位服務關閉時開系統的定位設定。
 * JS 端：public/js/location-help.js（外掛名 AbangSystem）。只開設定頁，不讀、不改任何設定。
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
}
