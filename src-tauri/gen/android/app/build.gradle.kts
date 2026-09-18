import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

/**
 * App version, read from tauri.conf.json.
 *
 * The Tauri CLI only writes `tauri.properties` during `tauri android init`, which
 * CI never runs, so that file is absent there and the version used to fall back
 * to the hard-coded "1.0" / versionCode 1 for every release — making it
 * impossible to tell which build is installed. Reading the config directly keeps
 * the installed version in step with the release.
 */
val tauriConfFile = file("../../../tauri.conf.json")

val appVersion: String = if (tauriConfFile.exists()) {
    Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
        .find(tauriConfFile.readText())
        ?.groupValues
        ?.get(1)
        ?: "1.0"
} else {
    "1.0"
}

val versionParts = appVersion.split(".").map { it.toIntOrNull() ?: 0 }

/** 0.8.1 -> 801, i.e. monotonic so upgrades install as upgrades. */
val appVersionCode: Int =
    versionParts.getOrElse(0) { 0 } * 10000 +
        versionParts.getOrElse(1) { 0 } * 100 +
        versionParts.getOrElse(2) { 0 }

/**
 * Two builds come out of this one project:
 *
 *   official (默认) 正式版 —— 普通对局用
 *   dev             测试版 —— 多一个「模型」入口，可以导入自己的 ONNX 模型
 *
 * The variant is selected with `-PappVariant=dev` (or by putting the property in
 * gradle.properties). Gradle product *flavors* would be the idiomatic way, but
 * `tauri android build` generates the settings/build glue and does not let us
 * pick a flavor, whereas it does run Gradle normally — so a plain property is
 * what actually reaches the build. Both variants share the same namespace and
 * Rust library; only the applicationId, label and a BuildConfig flag differ.
 */
val appVariant: String = (project.findProperty("appVariant") as String?
    ?: "official").lowercase()

val isDevVariant: Boolean = appVariant == "dev"

android {
    compileSdk = 34
    namespace = "com.jieqibox.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        manifestPlaceholders["appLabel"] =
            if (isDevVariant) "JieqiBox 测试版" else "JieqiBox"
        applicationId = if (isDevVariant) "com.jieqibox.app.dev" else "com.jieqibox.app"
        minSdk = 24
        targetSdk = 28
        versionCode = tauriProperties
            .getProperty("tauri.android.versionCode")
            ?.toIntOrNull() ?: appVersionCode
        versionName = tauriProperties.getProperty(
            "tauri.android.versionName",
            if (isDevVariant) "$appVersion-dev" else appVersion
        )

        // Read from Kotlin (and forwarded to the webview) so the same frontend
        // bundle can show the model-import entry only in the test build.
        buildConfigField("boolean", "DEV_TOOLS", isDevVariant.toString())
        buildConfigField("String", "APP_VARIANT", "\"$appVariant\"")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
    lint {
        warningsAsErrors = false
        abortOnError = false
        disable.add("ExpiredTargetSdkVersion")
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.6.1")
    // MainActivity uses DocumentFile for SAF engine file picking. It used to
    // arrive transitively via appcompat; declare it explicitly so the build
    // does not depend on how transitive dependencies happen to resolve.
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.8.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
