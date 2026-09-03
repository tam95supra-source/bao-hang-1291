import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

val localSecrets = Properties().apply {
    val file = rootProject.file("secrets.properties")
    if (file.exists()) file.inputStream().use(::load)
}

fun secret(name: String, fallback: String = ""): String =
    System.getenv(name) ?: localSecrets.getProperty(name) ?: fallback

val productionSignerFile = rootProject.file("signing/production-cert-sha256.txt")
val productionSignerSha256 = if (productionSignerFile.isFile) {
    productionSignerFile.readText().trim().lowercase()
} else {
    ""
}

val requestedOtaChannel = (project.findProperty("OTA_CHANNEL") as String?)?.trim()?.lowercase() ?: "stable"
require(requestedOtaChannel in setOf("stable", "beta")) { "OTA_CHANNEL must be stable or beta" }
val otaManifestUrl = "https://raw.githubusercontent.com/tam95supra-source/bao-hang-1291/main/ota/$requestedOtaChannel/release-manifest.json"
val appsScriptWorkerUrl = secret("APPS_SCRIPT_WORKER_URL").ifBlank { secret("GOOGLE_SHEET_WEBHOOK_URL") }

android {
    namespace = "vn.pickpack1291.baohang"
    compileSdk = 35

    defaultConfig {
        applicationId = "vn.pickpack1291.baohang"
        minSdk = 28
        targetSdk = 35
        versionCode = (project.findProperty("VERSION_CODE") as String?)?.toIntOrNull() ?: 1
        versionName = (project.findProperty("VERSION_NAME") as String?) ?: "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true

        // Client-visible configuration only. Server secrets remain outside APK/source.
        // Authorization is enforced by Firebase Auth, Neon JWT verification and RLS/RPC grants.
        buildConfigField("String", "NEON_DATA_API", "\"${secret("NEON_DATA_API", "https://ep-morning-bread-az3w94qb.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1")}\"")
        buildConfigField("String", "FIREBASE_WEB_API_KEY", "\"${secret("FIREBASE_WEB_API_KEY", "AIzaSyB-n368fntzxsuuLlvte9NXhcuX0DDbTXM")}\"")
        buildConfigField("String", "APPS_SCRIPT_WORKER_URL", "\"$appsScriptWorkerUrl\"")
        buildConfigField("String", "OTA_CHANNEL", "\"$requestedOtaChannel\"")
        buildConfigField("String", "UPDATE_MANIFEST_URL", "\"${secret("UPDATE_MANIFEST_URL", otaManifestUrl)}\"")
        buildConfigField("String", "PRODUCTION_SIGNER_SHA256", "\"$productionSignerSha256\"")
        manifestPlaceholders["otaChannel"] = requestedOtaChannel
    }

    signingConfigs {
        val storePath = secret("RELEASE_STORE_FILE")
        if (storePath.isNotBlank()) {
            create("release") {
                storeFile = file(storePath)
                storePassword = secret("RELEASE_STORE_PASSWORD")
                keyAlias = secret("RELEASE_KEY_ALIAS")
                keyPassword = secret("RELEASE_KEY_PASSWORD")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
            buildConfigField("String", "OTA_CHANNEL", "\"debug\"")
            buildConfigField("String", "UPDATE_MANIFEST_URL", "\"\"")
            manifestPlaceholders["otaChannel"] = "debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (signingConfigs.findByName("release") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions.jvmTarget = "17"

    packaging.resources.excludes += setOf(
        "META-INF/AL2.0",
        "META-INF/LGPL2.1",
        "META-INF/LICENSE*",
        "META-INF/NOTICE*",
    )
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.zxing:core:3.5.3")
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
