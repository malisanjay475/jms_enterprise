package com.jmsocean.chat.call

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.jmsocean.chat.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Ringing (full-screen when locked) and ongoing-call notifications. */
object CallNotifications {
    const val CHANNEL_RING = "calls_ring"
    const val CHANNEL_ONGOING = "calls_ongoing"
    const val ONGOING_ID = 7001
    const val EXTRA_CALL = "call_id"
    const val EXTRA_CALLER = "caller"
    const val EXTRA_ACCEPT = "accept"

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_RING, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            )
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 800, 600, 800, 600, 800)
        })
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ONGOING, "Ongoing call", NotificationManager.IMPORTANCE_LOW))
    }

    private fun id(callId: String) = 8000 + (callId.hashCode() and 0xfff)

    fun showIncoming(ctx: Context, callId: String, caller: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannels(ctx)
        fun activity(accept: Boolean, req: Int) = PendingIntent.getActivity(
            ctx, req,
            Intent(ctx, CallActivity::class.java)
                .putExtra(EXTRA_CALL, callId).putExtra(EXTRA_CALLER, caller).putExtra(EXTRA_ACCEPT, accept)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val decline = PendingIntent.getBroadcast(
            ctx, id(callId) + 1,
            Intent(ctx, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_DECLINE).putExtra(EXTRA_CALL, callId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL_RING)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setContentTitle(caller)
            .setContentText("Incoming voice call · JMS Chat")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(50_000)
            .setFullScreenIntent(activity(false, id(callId) + 2), true)
            .setContentIntent(activity(false, id(callId) + 3))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", decline)
            .addAction(android.R.drawable.ic_menu_call, "Answer", activity(true, id(callId) + 4))
            .build()
        n.flags = n.flags or android.app.Notification.FLAG_INSISTENT // ring until answered
        NotificationManagerCompat.from(ctx).notify(id(callId), n)
    }

    fun cancelIncoming(ctx: Context, callId: String) {
        NotificationManagerCompat.from(ctx).cancel(id(callId))
    }

    /** Someone started a group call: a normal (not ringing) notification with Join. */
    fun showGroupInvite(ctx: Context, roomId: String, convId: String, title: String, caller: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannels(ctx)
        val join = PendingIntent.getActivity(
            ctx, id(roomId) + 5,
            GroupCallActivity.intent(ctx, convId, title),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL_RING)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setContentTitle(title)
            .setContentText("📞 $caller started a group call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000)
            .setContentIntent(join)
            .addAction(android.R.drawable.ic_menu_call, "Join", join)
            .build()
        NotificationManagerCompat.from(ctx).notify(id(roomId), n)
    }

    fun cancelGroupInvite(ctx: Context, roomId: String) {
        NotificationManagerCompat.from(ctx).cancel(id(roomId))
    }
}

/** Decline / Hang up buttons on call notifications. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            ACTION_DECLINE -> {
                val id = intent.getStringExtra(CallNotifications.EXTRA_CALL) ?: return
                CallNotifications.cancelIncoming(ctx, id)
                if (CallEngine.state.value.callId == id) CallEngine.decline(ctx)
                else {
                    val pending = goAsync()
                    CoroutineScope(Dispatchers.IO).launch {
                        try { runCatching { com.jmsocean.chat.data.Api.callAction(id, "decline") } } finally { pending.finish() }
                    }
                }
            }
            ACTION_END -> if (GroupCallEngine.active) GroupCallEngine.leave() else CallEngine.hangUp()
        }
    }

    companion object {
        const val ACTION_DECLINE = "com.jmsocean.chat.CALL_DECLINE"
        const val ACTION_END = "com.jmsocean.chat.CALL_END"
    }
}
