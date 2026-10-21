# kotlinx.serialization models
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class com.jmsocean.chat.data.**$$serializer { *; }
-keepclassmembers class com.jmsocean.chat.data.** { *** Companion; kotlinx.serialization.KSerializer serializer(...); }
