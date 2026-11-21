package tw.abang.app;

import android.os.Bundle;
import android.util.TypedValue;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Health Connect 規定的權限說明（隱私）畫面（ADR-0018）：使用者在 Health Connect 的權限畫面點「隱私權政策」或在系統的權限使用說明點 Abang 時打開。
 * Android 13 以下：ACTION_SHOW_PERMISSIONS_RATIONALE；Android 14 以上：VIEW_PERMISSION_USAGE＋HEALTH_PERMISSIONS（AndroidManifest 的 activity-alias）。
 * 只顯示說明文字（不讀資料、不連網）；完整的隱私權政策在 App 的「設定與隱私 → 隱私權政策」。
 */
public class HealthRationaleActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle(R.string.health_rationale_title);
        int pad = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20, getResources().getDisplayMetrics());
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this);
        title.setText(R.string.health_rationale_title);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        TextView body = new TextView(this);
        body.setText(R.string.health_rationale_body);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        body.setLineSpacing(0, 1.3f);
        body.setPadding(0, pad / 2, 0, pad);
        Button ok = new Button(this);
        ok.setText(R.string.health_rationale_ok);
        ok.setOnClickListener((v) -> finish());
        box.addView(title);
        box.addView(body);
        box.addView(ok);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);
    }
}
