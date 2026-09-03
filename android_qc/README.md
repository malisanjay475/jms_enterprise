# QC Ocean — Native Android

Native Kotlin + Jetpack Compose rebuild of the QC Supervisor portal
(`QCSupervisor.html`) and Quality dashboard (`Quality.html`). Calls the same
JMS `/api/*` endpoints the web pages use — the backend is unchanged.

This is a **true-native** app, separate from the Capacitor WebView wrapper in
`../mobile-qc/`.

## Current status — Phase 1 slice

Working end-to-end: **Login → Machine picker → Job Queue** against the live API.
Later phases add FPA camera, Verify, QC Report, Issues, Quality dashboard,
offline sync, and push. See the full plan in the build spec.

## Get an installable APK (no Android Studio needed)

1. Push this folder to GitHub.
2. GitHub → **Actions** → **Build QC Android APK** → **Run workflow**.
3. When it finishes, download the **`jms-qc-debug-apk`** artifact — that zip
   contains `app-debug.apk`.
4. Copy the APK to an Android phone, enable *Install unknown apps* for your
   file manager, and tap to install.

## Which server does it talk to?

Set in `app/build.gradle.kts` → `BASE_URL`:

| Target | Value |
|--------|-------|
| Production (https, anywhere) | `https://jmsocean.cloud/` ← default |
| Staging (office/VPN)         | `http://72.62.228.195:9093/` |
| LOCAL factory server         | `http://192.168.1.173:3001/` |

Cleartext (http) is already allowed for the staging IP and LOCAL subnet in
`res/xml/network_security_config.xml`.

## Build locally (optional)

Requires JDK 17 + Android SDK (Android Studio installs both):

```bash
cd android_qc
gradle assembleDebug        # or ./gradlew once a wrapper is added
# output: app/build/outputs/apk/debug/app-debug.apk
```

## Stack

Kotlin · Jetpack Compose · Material 3 · Retrofit + OkHttp (cookie-session auth)
· kotlinx.serialization · Navigation Compose. Hilt, Room, WorkManager, CameraX,
ML Kit and FCM arrive in later phases.
