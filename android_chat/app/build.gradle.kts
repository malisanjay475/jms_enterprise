plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.jmsocean.chat"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.jmsocean.chat"
        minSdk = 26
        targetSdk = 34
        // versionCode is set by CI (APP_VERSION_CODE = 1000 + run number). Local builds: 1.
        versionCode = System.getenv("APP_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = "1.0.0"

        // JMS Chat always talks to the MAIN server: everyone signs in there with the
        // chat-only login (/api/chat-app/login), from anywhere, no geofence.
        buildConfigField("String", "BASE_URL", "\"https://jmsocean.cloud/\"")
    }

    // Release signing from env / CI secrets — NEVER commit a keystore or password.
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
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
