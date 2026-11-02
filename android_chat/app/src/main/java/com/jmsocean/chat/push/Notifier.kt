package com.jmsocean.chat.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import com.jmsocean.chat.MainActivity
import com.jmsocean.chat.R

/**
 * WhatsApp-style message notifications: one per chat (MessagingStyle, the last few
 * lines stacked), Reply and Mark as read buttons, tapping opens that chat.
 */
object Notifier {
    const val CHANNEL = "messages"
    const val CHANNEL_URGENT = "urgent"
    const val EXTRA_CONV = "conversation_sync_id"
    const val KEY_REPLY = "reply_text"

    /** The chat on screen right now: no notification for it. */
    @Volatile var openChat: String? = null
    @Volatile var appInFront = false

    private val lines = HashMap<String, ArrayDeque<Pair<String, String>>>() // chat -> (sender, text)

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val ch = NotificationChannel(CHANNEL, ctx.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH).apply {
            description = "New JMS Chat messages"
            enableVibration(true)
        }
        ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_URGENT, "Urgent messages", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "⚠ URGENT messages: ring even when a chat is muted"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
                setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM),
                    android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build())
            })
    }

    private fun notifId(conv: String) = conv.hashCode()
    private const val GROUP = "jms_chat_messages"
    private const val SUMMARY_ID = 0x4A4D53 // "JMS"

    /**
     * The lines already shown for this chat, read back from its notification on screen. The
     * app may have been closed by Android since the last message, which empties [lines]; this
     * keeps the stack ("3 new messages") instead of showing only the newest one.
     */
    private fun restore(ctx: Context, conv: String): ArrayDeque<Pair<String, String>> {
        val out = ArrayDeque<Pair<String, String>>()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return out
        runCatching {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            val n = nm.activeNotifications.firstOrNull { it.id == notifId(conv) }?.notification ?: return out
            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)?.messages?.forEach { m ->
                out.addLast((m.person?.name?.toString() ?: "") to (m.text?.toString() ?: ""))
            }
        }
        return out
    }

    /** One "JMS Chat" summary that bundles the chats (Android shows it when 2+ chats have messages). */
    private fun updateSummary(ctx: Context) {
        val chats = synchronized(lines) { lines.size }
        val nmc = NotificationManagerCompat.from(ctx)
        if (chats < 2) { nmc.cancel(SUMMARY_ID); return }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val total = synchronized(lines) { lines.values.sumOf { it.size } }
        val open = PendingIntent.getActivity(
            ctx, SUMMARY_ID, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val summary = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setColor(0xFF075E54.toInt())
            .setContentTitle("JMS Chat")
            .setContentText("$total new messages from $chats chats")
            .setStyle(NotificationCompat.InboxStyle().setSummaryText("$total messages from $chats chats"))
            .setGroup(GROUP).setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN) // only the chat itself rings
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        nmc.notify(SUMMARY_ID, summary)
    }

    fun show(ctx: Context, conv: String, title: String, sender: String, text: String, isGroup: Boolean, senderPhoto: android.graphics.Bitmap? = null, urgent: Boolean = false) {
        if (appInFront && openChat == conv) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannel(ctx)

        val history = synchronized(lines) {
            lines.getOrPut(conv) { restore(ctx, conv) }.apply {
                addLast(sender to text)
                while (size > 6) removeFirst()
            }.toList()
        }

        val me = Person.Builder().setName("You").build()
        val style = NotificationCompat.MessagingStyle(me)
        if (isGroup) style.setConversationTitle(title.substringAfter(" in ", title)).setGroupConversation(true)
        val now = System.currentTimeMillis()
        history.forEachIndexed { i, (who, line) ->
            val person = Person.Builder().setName(who).apply {
                if (who == sender && senderPhoto != null) setIcon(androidx.core.graphics.drawable.IconCompat.createWithBitmap(senderPhoto))
            }.build()
            style.addMessage(line, now - (history.size - i), person)
        }

        val open = PendingIntent.getActivity(
            ctx, notifId(conv),
            Intent(ctx, MainActivity::class.java).putExtra(EXTRA_CONV, conv)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val replyIntent = PendingIntent.getBroadcast(
            ctx, notifId(conv),
            Intent(ctx, ReplyReceiver::class.java).setAction(ReplyReceiver.ACTION_REPLY).putExtra(EXTRA_CONV, conv),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val readIntent = PendingIntent.getBroadcast(
            ctx, notifId(conv) + 1,
            Intent(ctx, ReplyReceiver::class.java).setAction(ReplyReceiver.ACTION_READ).putExtra(EXTRA_CONV, conv),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val replyAction = NotificationCompat.Action.Builder(android.R.drawable.ic_menu_send, "Reply", replyIntent)
            .addRemoteInput(RemoteInput.Builder(KEY_REPLY).setLabel("Reply").build())
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setAllowGeneratedReplies(true)
            .build()
        val readAction = NotificationCompat.Action.Builder(android.R.drawable.ic_menu_view, "Mark as read", readIntent)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .build()

        val n = NotificationCompat.Builder(ctx, if (urgent) CHANNEL_URGENT else CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_chat)
            .setColor(0xFF075E54.toInt())
            .setStyle(style)
            .setContentTitle(title)
            .setContentText(text)
            .apply { if (senderPhoto != null && !isGroup) setLargeIcon(senderPhoto) }
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(replyAction)
            .addAction(readAction)
            .setNumber(history.size)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setGroup(GROUP)
            .setShortcutId(conv)
            .setWhen(now).setShowWhen(true)
            .build()
        NotificationManagerCompat.from(ctx).notify(notifId(conv), n)
        updateSummary(ctx)
    }

    /** After a reply from the notification: show it in the stack, without the spinner. */
    fun addOwnReply(ctx: Context, conv: String, text: String) {
        synchronized(lines) { lines[conv]?.addLast("You" to text) }
        clear(ctx, conv)
    }

    fun clear(ctx: Context, conv: String) {
        synchronized(lines) { lines.remove(conv) }
        NotificationManagerCompat.from(ctx).cancel(notifId(conv))
        updateSummary(ctx)
    }

    fun clearAll(ctx: Context) {
        synchronized(lines) { lines.clear() }
        NotificationManagerCompat.from(ctx).cancelAll()
    }
}
