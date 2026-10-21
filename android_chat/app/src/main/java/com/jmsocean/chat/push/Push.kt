package com.jmsocean.chat.push

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.jmsocean.chat.BuildConfig
import com.jmsocean.chat.data.Api
import kotlinx.coroutines.tasks.await

/** Firebase set-up from BuildConfig (no google-services.json). Off when not configured. */
object Push {
    val configured: Boolean
        get() = BuildConfig.FCM_APP_ID.isNotBlank() && BuildConfig.FCM_API_KEY.isNotBlank() &&
            BuildConfig.FCM_PROJECT_ID.isNotBlank() && BuildConfig.FCM_SENDER_ID.isNotBlank()

    fun init(ctx: Context) {
        if (!configured || FirebaseApp.getApps(ctx).isNotEmpty()) return
        runCatching {
            FirebaseApp.initializeApp(
                ctx,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FCM_APP_ID)
                    .setApiKey(BuildConfig.FCM_API_KEY)
                    .setProjectId(BuildConfig.FCM_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FCM_SENDER_ID)
                    .build()
            )
        }.onFailure { Log.w("JMSChat", "Firebase init failed: ${it.message}") }
    }

    /** Tell MAIN where to push this user's messages. Call after sign-in and at start. */
    suspend fun register(): Boolean {
        if (!configured) return false
        return runCatching { Api.registerPush(FirebaseMessaging.getInstance().token.await()) }
            .onFailure { Log.w("JMSChat", "push register failed: ${it.message}") }
            .isSuccess
    }

    /** On sign-out: stop pushes to this phone for that user. */
    suspend fun unregister() {
        if (!configured) return
        runCatching {
            val token = FirebaseMessaging.getInstance().token.await()
            Api.unregisterPush(token)
            FirebaseMessaging.getInstance().deleteToken().await()
        }
    }
}
