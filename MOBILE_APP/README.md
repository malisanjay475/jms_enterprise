# JMS Ocean — Complete Native Mobile App (Android & Play Store Ready)

Native Android application for **JMS Ocean Enterprise**, providing 100% feature parity with the web platform (`https://jmsocean.cloud`), an off-canvas drawer sidebar with dynamic role-based access control, camera barcode scanning, and Android 14/15 Google Play Store compliance.

---

## 1. Overview & Key Capabilities

- **100% Web Feature Parity**: Every module and screen—Planning Board, DPR Daily Reports, Machine Timelines, Quality Control, Supervisor Portals, Shifting Barcodes, Masters, HR Performance, and Management—is accessible inside the native app.
- **Responsive Mobile Drawer Sidebar**:
  - Opens via a persistent top-left hamburger menu (`☰`), a dedicated bottom-nav **Menu** button, or by swiping right from the left screen edge.
  - Features real-time search filtering across all 25+ ERP modules.
  - Smooth accordion sub-menus with animated chevrons.
  - Factory unit switcher, user profile avatar, role badge, and active screen indicators.
- **Strict Access Control (RBAC)**: Only displays modules the logged-in user has permissions for (`user.permissions`, `__apps`, role hierarchies).
- **Native Hardware Integration**:
  - **Camera Barcode & QR Scanner**: Fast native camera barcode scanning for shifting and QC verification.
  - **GPS Geolocation**: High-accuracy `FusedLocationProvider` coordinates for factory geofenced sign-in on MAIN production servers.
  - **Hardware Back Navigation**: Closes open sidebars/modals, navigates browser history, and prompts double-tap to exit on the home dashboard.
- **Dual Server Support**: Connects to the Cloud VPS (`https://jmsocean.cloud`) or factory LOCAL servers (`http://192.168.1.173:3001`) with cleartext HTTP allowed on local factory subnets.

---

## 2. Instant APK via GitHub Actions (No Android Studio Required)

You do not need to configure Android Studio locally to test on a physical phone:

1. Push your changes to GitHub (`develop` or `main`).
2. Go to **GitHub** → **Actions** → **Build JMS Ocean Mobile (APK & AAB for Play Store)**.
3. Click **Run workflow**.
4. When the build finishes:
   - Download **`jms-ocean-debug-apk`**: Contains `app-debug.apk` that can be directly installed on any Android phone.
   - Download **`jms-ocean-playstore-aab`**: Contains `app-release.aab` ready for Google Play Store upload.

---

## 3. Local Development & Build

### Prerequisites
- Node.js 20+
- JDK 17+ (e.g. Eclipse Temurin or Android Studio bundled JDK)
- Android SDK (API Level 34 or 35)

### Setup & Sync
```bash
cd MOBILE_APP
npm install
npx cap sync android
```

### Open in Android Studio
```bash
npx cap open android
```

### Command-Line Builds
```bash
cd MOBILE_APP/android

# Build Debug APK (outputs to app/build/outputs/apk/debug/app-debug.apk)
./gradlew assembleDebug

# Build Production AAB for Google Play Store (outputs to app/build/outputs/bundle/release/app-release.aab)
./gradlew bundleRelease
```

---

## 4. Google Play Store Release Step-by-Step

### Step 1: Generate a Release Keystore
Run this command in a secure location on your machine:
```bash
keytool -genkey -v -keystore jms-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias jms-ocean
```
Keep `jms-release-key.jks` and your passwords safe. **Do not commit keystore files into Git.**

### Step 2: Configure Signing in `MOBILE_APP/android/app/build.gradle`
Add signing credentials to the release build type:
```groovy
android {
    ...
    signingConfigs {
        release {
            storeFile file("path/to/jms-release-key.jks")
            storePassword System.getenv("JMS_KEYSTORE_PASSWORD")
            keyAlias "jms-ocean"
            keyPassword System.getenv("JMS_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

### Step 3: Build the Android App Bundle (`.aab`)
```bash
cd MOBILE_APP/android
./gradlew bundleRelease
```
The bundle is generated at:
`app/build/outputs/bundle/release/app-release.aab`

### Step 4: Google Play Console Submission
1. Log in to [Google Play Console](https://play.google.com/console).
2. Create an App named **JMS Ocean** (Language: English, Type: App, Free).
3. **Internal Testing**: Upload `app-release.aab` to test with factory managers and supervisors.
4. Complete the Store Presence:
   - **App Icon**: 512x512 PNG.
   - **Feature Graphic**: 1024x500 PNG.
   - **Screenshots**: Upload phone screenshots (Dashboard, Planning Board, DPR, QC, Sidebar).
   - **Privacy Policy URL**: Host privacy policy covering camera and geolocation access.
   - **App Content & Data Safety**: Mark that the app accesses camera (for barcode scanning) and location (for factory login verification).
5. Promote from Internal Testing to **Closed/Open Testing** or **Production**.

---

## 5. Directory Structure

```
MOBILE_APP/
├── package.json              # Capacitor dependencies & build scripts
├── capacitor.config.json     # App ID, cloud server URL, splash/status styling
├── www/
│   └── index.html            # Offline launcher & dual-server switcher
└── android/                  # Android Studio Native Project
    ├── app/
    │   ├── build.gradle      # Package ID (com.jmsocean.app), Target SDK 34/35
    │   └── src/main/
    │       ├── AndroidManifest.xml # Permissions (Camera, Location, Storage)
    │       ├── java/com/jmsocean/app/
    │       │   └── MainActivity.java # Back-button handler, runtime permissions
    │       └── res/          # Branded icons, colors, splash screen styles
    └── gradlew               # Gradle wrapper executable
```
