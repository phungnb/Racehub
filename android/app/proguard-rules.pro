# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# --- RaceHub: luật cho R8 (minifyEnabled true) ---
# Capacitor tự kèm luật giữ plugin (@CapacitorPlugin, extends Plugin, @PluginMethod).
# Giữ thêm rõ ràng các plugin đang dùng + cầu JS để R8 không đổi tên/xóa (gọi qua reflection):
-keep class com.getcapacitor.** { *; }
-keep class com.equimaps.capacitor_background_geolocation.** { *; }
-keep class com.getcapacitor.community.tts.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
# Giữ số dòng để đọc stack trace trong Play Console (kèm file mapping tự tải lên cùng AAB)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-dontwarn org.apache.cordova.**
