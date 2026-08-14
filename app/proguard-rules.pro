# Firebase Emergency/App Check classes are retained because release uses R8 resource shrinking.
-keepattributes Signature,*Annotation*
-keep class com.google.firebase.** { *; }
-dontwarn org.conscrypt.**
-keepclassmembers class vn.pickpack1291.baohang.data.** { *; }

