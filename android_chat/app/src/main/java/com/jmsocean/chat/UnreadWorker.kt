package com.jmsocean.chat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * While the app is closed, checks /api/chat/unread with the chat session cookie (every
 * 15 minutes, the Android minimum) and shows a notification when the count goes up.
 * While the app is open, messages arrive live in the page.
 */
class UnreadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (MainActivity.inForeground) return@withContext Result.success()
        val base = BuildConfig.BASE_URL
        val cookie = CookieManager.getInstance().getCookie(base) ?: return@withContext Result.success()
        val unread = runCatching {
            val conn = URL(base.trimEnd('/') + "/api/chat/unread").openConnection() as HttpURLConnection
            conn.setRequestProperty("Cookie", cookie)
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            try {
                if (conn.responseCode != 200) -1
                else JSONObject(conn.inputStream.bufferedReader().readText()).optInt("unread", 0)
            } finally {
                conn.disconnect()
            }
        }.getOrDefault(-1)
        if (unread < 0) return@withContext Result.success()

        val prefs = applicationContext.getSharedPreferences("chat", Context.MODE_PRIVATE)
        val last = prefs.getInt("last_unread", 0)
        if (unread > last) notify(applicationContext, unread)
        if (unread == 0) NotificationManagerCompat.from(applicationContext).cancel(NOTIFICATION_ID)
        prefs.edit().putInt("last_unread", unread).apply()
        Result.success()
    }

    companion object {
        private const val WORK = "jms-chat-unread"
        private const val CHANNEL = "messages"
        private const val NOTIFICATION_ID = 1

        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<UnreadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(WORK)
            ctx.getSharedPreferences("chat", Context.MODE_PRIVATE).edit().putInt("last_unread", 0).apply()
        }

        /** Opening the app counts as having seen the notification. */
        fun markSeen(ctx: Context) {
            NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID)
        }

        fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, ctx.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH)
            )
        }

        private fun notify(ctx: Context, unread: Int) {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) return
            ensureChannel(ctx)
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            val text = if (unread == 1) "1 new message" else "$unread new messages"
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("JMS Chat")
                .setContentText(text)
                .setNumber(unread)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(open)
                .build()
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, n)
        }
    }
}
