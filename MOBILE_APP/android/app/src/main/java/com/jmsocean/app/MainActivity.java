package com.jmsocean.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

/**
 * JMS Ocean Enterprise Mobile App - Main Native Activity.
 *
 * Provides:
 * 1. Runtime permission gating (Camera, Fine/Coarse Location for geofence login, Storage/Media).
 * 2. Hardware and gesture Back-Button navigation (closing drawers/modals, history back, double-tap exit).
 * 3. Native hardware bridge support for shop-floor barcode scanning and push alerts.
 */
public class MainActivity extends BridgeActivity {

    private static final int PERM_REQUEST = 1001;
    private boolean doubleBackToExitPressedOnce = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestRuntimePermissions();
    }

    private void requestRuntimePermissions() {
        List<String> needed = new ArrayList<>();

        String[] wanted = new String[] {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA
        };
        for (String p : wanted) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                needed.add(p);
            }
        }

        // Image gallery / storage access for photo and file uploads
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_MEDIA_IMAGES);
            }
        } else {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            }
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), PERM_REQUEST);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;

            if (webView != null) {
                // If a mobile sidebar drawer or modal is open in the web app, close it first
                webView.evaluateJavascript(
                    "(function() {" +
                    "  const sb = document.querySelector('.sidebar.mobile-open');" +
                    "  if (sb) { sb.classList.remove('mobile-open'); if(window.JPSMS && window.JPSMS.closeSidebar){window.JPSMS.closeSidebar();} return true; }" +
                    "  const modal = document.querySelector('.modal-overlay.active, .modal.show');" +
                    "  if (modal) { modal.classList.remove('active', 'show'); return true; }" +
                    "  return false;" +
                    "})()",
                    value -> {
                        if ("true".equals(value)) {
                            // Handled by webview drawer/modal closure
                            return;
                        }

                        // Check history back navigation
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            handleDoubleBackToExit();
                        }
                    }
                );
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    private void handleDoubleBackToExit() {
        if (doubleBackToExitPressedOnce) {
            finish();
            return;
        }

        this.doubleBackToExitPressedOnce = true;
        Toast.makeText(this, "Press BACK again to exit JMS Ocean", Toast.LENGTH_SHORT).show();

        new Handler(Looper.getMainLooper()).postDelayed(() -> doubleBackToExitPressedOnce = false, 2000);
    }
}
