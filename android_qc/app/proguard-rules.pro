# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class com.jmsocean.qc.** {
    kotlinx.serialization.KSerializer serializer(...);
}
