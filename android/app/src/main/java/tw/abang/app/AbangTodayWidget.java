package tw.abang.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

/**
 * 主畫面小工具「阿幫・今天」（2026-11-28 主動助手第一版的延伸；App Functions 結合）。
 * 顯示上次打開阿幫時首頁「今天」卡算好的那幾句（public/js/today.js → today-widget.js → AbangSystem.setTodayWidget）：
 * 日子、阿幫一句話、最多兩個提醒、幾點更新的。點了打開 App（首頁就是最新的今天卡）。
 * 不在背景更新、不連網、不讀位置（跟今天卡同一個原則：只在打開 App 的那一刻算）；所以一定寫出「幾點更新」。
 * 存在 App 私有的 SharedPreferences（abang_widget），沒有座標、沒有地名以外的個資。
 */
public class AbangTodayWidget extends AppWidgetProvider {
    static final String PREFS = "abang_widget";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, views(context));
    }

    /** App 寫入新內容後呼叫：所有放在桌面上的「阿幫・今天」一起換 */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AbangTodayWidget.class));
        if (ids.length > 0) manager.updateAppWidget(ids, views(context));
    }

    static RemoteViews views(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        String title = p.getString("title", null);
        if (title == null) { // 還沒打開過 App：說怎麼開始
            v.setTextViewText(R.id.widget_title, "阿幫・今天");
            v.setViewVisibility(R.id.widget_kind, View.GONE);
            v.setTextViewText(R.id.widget_say, "打開阿幫，看今天要帶傘嗎、怎麼去最快。");
            v.setViewVisibility(R.id.widget_tip1, View.GONE);
            v.setViewVisibility(R.id.widget_tip2, View.GONE);
            v.setTextViewText(R.id.widget_foot, "點一下打開阿幫");
        } else {
            v.setTextViewText(R.id.widget_title, title);
            text(v, R.id.widget_kind, p.getString("kind", ""));
            v.setTextViewText(R.id.widget_say, p.getString("say", ""));
            text(v, R.id.widget_tip1, bullet(p.getString("tip1", "")));
            text(v, R.id.widget_tip2, bullet(p.getString("tip2", "")));
            String at = p.getString("updated", "");
            v.setTextViewText(R.id.widget_foot, at.isEmpty() ? "點一下看最新的" : at + " 打開阿幫時的資料・點一下看最新的");
        }
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root, pi);
        return v;
    }

    private static String bullet(String s) { return s == null || s.isEmpty() ? "" : "・" + s; }

    private static void text(RemoteViews v, int id, String s) {
        if (s == null || s.isEmpty()) { v.setViewVisibility(id, View.GONE); return; }
        v.setViewVisibility(id, View.VISIBLE);
        v.setTextViewText(id, s);
    }
}
