package tw.abang.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AbangEdgeAIPlugin.class); // App 專用外掛：裝置端 AI 判斷（ADR-0014）
        registerPlugin(AbangSystemPlugin.class); // 開啟 App 設定（S1c）
        super.onCreate(savedInstanceState);
    }
}
