package com.jmsocean.chat.call

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.jmsocean.chat.R

/** Keeps the microphone and the call alive while the app is in the background. */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        CallNotifications.ensureChannels(this)
        val n = ongoing(this)
        val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
        runCatching { ServiceCompat.startForeground(this, CallNotifications.ONGOING_ID, n, type) }
            .onFailure { stopSelf() }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        fun start(ctx: Context) {
            runCatching { ContextCompat.startForegroundService(ctx, Intent(ctx, CallService::class.java)) }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, CallService::class.java)) }
        }

        private fun ongoing(ctx: Context): Notification {
            val s = CallEngine.state.value
            val group = GroupCallEngine.state.value.takeIf { GroupCallEngine.active }
            val open = PendingIntent.getActivity(
                ctx, 1, Intent(ctx, if (group != null) GroupCallActivity::class.java else CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            val end = PendingIntent.getBroadcast(
                ctx, 2, Intent(ctx, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_END),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            return NotificationCompat.Builder(ctx, CallNotifications.CHANNEL_ONGOING)
                .setSmallIcon(R.drawable.ic_stat_chat)
                .setContentTitle(group?.title ?: s.peer.ifBlank { "JMS Chat" })
                .setContentText(if (group != null) "Group call" else "Voice call")
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setContentIntent(open)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Hang up", end)
                .setUsesChronometer(true)
                .build()
        }
    }
}
