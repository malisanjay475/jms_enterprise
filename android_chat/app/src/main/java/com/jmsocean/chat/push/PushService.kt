package com.jmsocean.chat.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Firebase push. The server (src/modules/chat/chatFcm.js) sends data-only messages:
 * { type: chat, title, body, sender, conversation_sync_id, message_sync_id, is_group }.
 */
class PushService : FirebaseMessagingService() {
    /** The sender's profile photo, round, for the notification (null when none or slow). */
    private fun senderPhoto(sender: String): android.graphics.Bitmap? {
        if (sender.isBlank()) return null
        return runCatching {
            val req = okhttp3.Request.Builder()
                .url("${Api.base}/api/chat/avatars/${Api.pathSeg(sender)}").build()
            Api.client.newBuilder().callTimeout(3, java.util.concurrent.TimeUnit.SECONDS).build()
                .newCall(req).execute().use { r ->
                    if (!r.isSuccessful) return null
                    val src = android.graphics.BitmapFactory.decodeStream(r.body!!.byteStream()) ?: return null
                    val size = minOf(src.width, src.height)
                    val out = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
                    val c = android.graphics.Canvas(out)
                    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
                    c.drawCircle(size / 2f, size / 2f, size / 2f, paint)
                    paint.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN)
                    c.drawBitmap(src, ((size - src.width) / 2).toFloat(), ((size - src.height) / 2).toFloat(), paint)
                    out
                }
        }.getOrNull()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        if (Session.signedIn) scope.launch { Api.registerPush(token) }
    }

    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        if (!Session.signedIn) return
        if (d["type"] == "test") {
            Notifier.show(this, "test", "JMS Chat", "JMS Chat", d["body"] ?: "Notifications are working", false)
            return
        }
        // Name request (to admins) or the decision (to the person).
        if (d["type"] == "notice") {
            Notifier.show(this, "notice", d["title"] ?: "JMS Chat", "JMS Chat", d["body"] ?: "", false)
            return
        }
        if (d["type"] == "call") {
            val id = d["call_id"] ?: return
            val caller = d["caller"] ?: "Someone"
            if (com.jmsocean.chat.call.CallEngine.busy) return // already on a call; the server marks it missed
            com.jmsocean.chat.call.CallEngine.ringing(id, caller)
            com.jmsocean.chat.call.CallNotifications.showIncoming(this, id, caller)
            return
        }
        if (d["type"] == "call_end") {
            val id = d["call_id"] ?: return
            com.jmsocean.chat.call.CallNotifications.cancelIncoming(this, id)
            com.jmsocean.chat.call.CallEngine.remoteEnded(id, d["reason"] ?: "ended")
            return
        }
        if (d["type"] == "group_call") {
            val room = d["room_id"] ?: return
            val conv = d["conversation_sync_id"] ?: return
            if (com.jmsocean.chat.call.GroupCallEngine.active || com.jmsocean.chat.call.CallEngine.busy) return
            com.jmsocean.chat.call.CallNotifications.showGroupInvite(this, room, conv, d["title"] ?: "Group", d["caller"] ?: "Someone")
            return
        }
        if (d["type"] != "chat") return
        val conv = d["conversation_sync_id"] ?: return
        val sender = d["sender"] ?: ""
        // 📻 walkie-talkie: play it out loud when walkie-talkie is on for this chat
        if (d["ptt"] == "1") d["file_id"]?.takeIf { it.isNotBlank() && com.jmsocean.chat.data.Walkie.isOn(this, conv) }?.let {
            com.jmsocean.chat.data.Walkie.play(this, it)
        }
        Notifier.show(
            this, conv,
            title = d["title"] ?: "JMS Chat",
            sender = d["sender_name"]?.ifBlank { null } ?: sender,
            text = d["body"] ?: "",
            isGroup = d["is_group"] == "1",
            senderPhoto = senderPhoto(sender),
            urgent = d["urgent"] == "1"
        )
    }
}
