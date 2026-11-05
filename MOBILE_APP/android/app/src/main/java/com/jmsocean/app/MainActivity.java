package com.jmsocean.app;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

import java.util.ArrayList;
import java.util.List;

/**
 * JMS Ocean Enterprise Mobile App - Main Native Activity.
 *
 * Provides:
 * 1. Runtime permission gating (Camera, Fine/Coarse Location for geofence login, Storage/Media).
 * 2. Hardware Back-Button navigation (closing drawers/modals, history back, double-tap exit).
 * 3. Cookie enablement so HttpOnly session login works inside the WebView.
 * 4. Optional LOCAL/MAIN server override via SharedPreferences (JmsOcean/server_url).
 * 5. JS bridge helpers for server switch without rebuilding the APK.
 */
public class MainActivity extends BridgeActivity {

    private static final int PERM_REQUEST = 1001;
    private static final String PREFS = "JmsOcean";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String DEFAULT_SERVER = "https://jmsocean.cloud/";

    private boolean doubleBackToExitPressedOnce = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Optional runtime server override (factory LOCAL IP). When unset, capacitor.config.json
        // server.url (MAIN cloud) is used via CapConfig.loadDefault inside Bridge.
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String overrideUrl = prefs.getString(PREF_SERVER_URL, null);
        if (overrideUrl != null && overrideUrl.trim().length() > 0) {
            String url = overrideUrl.trim();
            if (!url.endsWith("/")) url = url + "/";
            this.config = new CapConfig.Builder(getApplicationContext())
                    .setServerUrl(url)
                    .setAllowMixedContent(true)
                    .setCaptureInput(true)
                    .setAndroidScheme("https")
                    .create();
        }

        super.onCreate(savedInstanceState);
        enableWebViewCookies();
        attachServerBridge();
        requestRuntimePermissions();
    }

    private void enableWebViewCookies() {
        try {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
            }
        } catch (Exception ignored) {
            // Cookie APIs can throw on older WebView providers; login still may work same-origin.
        }
    }

    private void attachServerBridge() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        webView.addJavascriptInterface(new ServerBridge(), "JmsOceanNative");
    }

    /**
     * Exposed to the ERP web shell as window.JmsOceanNative for dual MAIN/LOCAL switching.
     */
    private class ServerBridge {
        @JavascriptInterface
        public String getServerUrl() {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String override = prefs.getString(PREF_SERVER_URL, null);
            if (override != null && override.trim().length() > 0) return override.trim();
            return DEFAULT_SERVER;
        }

        @JavascriptInterface
        public void setServerUrl(String url) {
            if (url == null) return;
            String cleaned = url.trim();
            if (cleaned.length() == 0) return;
            if (!cleaned.matches("(?i)^https?://.+")) return;
            if (!cleaned.endsWith("/")) cleaned = cleaned + "/";

            getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(PREF_SERVER_URL, cleaned)
                    .apply();

            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "Switching server…", Toast.LENGTH_SHORT).show();
                recreate();
            });
        }

        @JavascriptInterface
        public void clearServerOverride() {
            getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit()
                    .remove(PREF_SERVER_URL)
                    .apply();
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "Using MAIN cloud server…", Toast.LENGTH_SHORT).show();
                recreate();
            });
        }
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
                    "  try {" +
                    "    if (window.JPSMS && window.JPSMS.closeSidebar) {" +
                    "      var sb = document.querySelector('.sidebar.mobile-open');" +
                    "      if (sb) { window.JPSMS.closeSidebar(); return true; }" +
                    "    }" +
                    "  } catch (e) {}" +
                    "  const sb = document.querySelector('.sidebar.mobile-open');" +
                    "  if (sb) { sb.classList.remove('mobile-open'); document.body.classList.remove('mobile-sidebar-open'); return true; }" +
                    "  const modal = document.querySelector('.modal-overlay.active, .modal.show, .modal-backdrop.show');" +
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
