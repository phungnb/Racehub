package vn.racehub.app;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Android 15+ (targetSdk 35+) bắt buộc tràn viền; bật chính thức trên mọi phiên bản để hành vi đồng nhất.
        // Phần đệm theo thanh hệ thống do Capacitor xử lý (adjustMarginsForEdgeToEdge = 'force' trong capacitor.config.ts).
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
