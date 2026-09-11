plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.jmsocean.qc"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jmsocean.qc"
        minSdk = 26
        targetSdk = 34
        versionCode = 11
        versionName = "1.1.0"

        // Base URL of the JMS API. Change here to point at LOCAL / staging / prod.
        //  - Production (https, reachable anywhere):          https://jmsocean.cloud/  ← active
        //  - LOCAL factory server (no geofence, shop-floor): http://192.168.1.173:3001/
        //  - Staging (http, VPN/office):                      http://72.62.228.195:9093/
        // NOTE: MAIN enforces a GPS geofence at /api/login (admins bypass); non-admins
        // must be at the factory. Switch back to the LOCAL URL for shop-floor LAN builds.
        buildConfigField("String", "BASE_URL", "\"https://jmsocean.cloud/\"")
    }

    // Release signing reads from env / CI secrets — NEVER commit a keystore or
    // password. Set KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD.
    signingConfigs {
        create("release") {
            val kfile = System.getenv("KEYSTORE_FILE")
            if (kfile != null && file(kfile).exists()) {
                storeFile = file(kfile)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            // Only sign when the keystore env is present (local/CI with secrets);
            // otherwise Gradle produces an unsigned release for inspection.
            if (System.getenv("KEYSTORE_FILE") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.02")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.2")

    // Networking + JSON
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")

    // Image loading for captured-photo previews
    implementation("io.coil-kt:coil-compose:2.7.0")

    // Location — geofence login gate (server requires GPS at /api/login)
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
