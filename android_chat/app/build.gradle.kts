plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

fun env(name: String) = (System.getenv(name) ?: "").trim()

android {
    namespace = "com.jmsocean.chat"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jmsocean.chat"
        minSdk = 26
        targetSdk = 34
        // versionCode is set by CI (APP_VERSION_CODE = 1000 + run number) so it always
        // increases and phones auto-update. Local builds fall back to 1.
        versionCode = System.getenv("APP_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = "2.1.0"

        // JMS Chat always talks to the MAIN server: everyone signs in there with the
        // chat-only login (/api/chat-app/login), from anywhere, no geofence.
        // Self-update reads the server's /qc-app/chat/ feed.
        buildConfigField("String", "BASE_URL", "\"https://jmsocean.cloud/\"")

        // Firebase (push). Public app identifiers from the Firebase console, passed by CI
        // (secrets FCM_APP_ID / FCM_API_KEY / FCM_PROJECT_ID / FCM_SENDER_ID). Empty =
        // the app works without push. No google-services.json / plugin needed.
        buildConfigField("String", "FCM_APP_ID", "\"${env("FCM_APP_ID")}\"")
        buildConfigField("String", "FCM_API_KEY", "\"${env("FCM_API_KEY")}\"")
        buildConfigField("String", "FCM_PROJECT_ID", "\"${env("FCM_PROJECT_ID")}\"")
        buildConfigField("String", "FCM_SENDER_ID", "\"${env("FCM_SENDER_ID")}\"")
    }

    // Release signing reads from env / CI secrets — NEVER commit a keystore or password.
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
            if (System.getenv("KEYSTORE_FILE") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
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
    // Firebase brings an old Fragment in; activity-result APIs need >= 1.3.0 (lint).
    implementation("androidx.fragment:fragment-ktx:1.8.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-process:2.8.6")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.2")

    // Networking + live events (SSE) + JSON
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Chat photos
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")

    // Push (Firebase Cloud Messaging), initialised in code from BuildConfig
    implementation(platform("com.google.firebase:firebase-bom:33.4.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
}
