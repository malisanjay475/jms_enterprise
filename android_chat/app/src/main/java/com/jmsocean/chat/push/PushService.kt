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
                .url("${Api.base}/api/chat/avatars/${java.net.URLEncoder.encode(sender, "UTF-8")}").build()
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
        if (d["type"] != "chat") return
        val conv = d["conversation_sync_id"] ?: return
        val sender = d["sender"] ?: ""
        Notifier.show(
            this, conv,
            title = d["title"] ?: "JMS Chat",
            sender = sender,
            text = d["body"] ?: "",
            isGroup = d["is_group"] == "1",
            senderPhoto = senderPhoto(sender)
        )
    }
}
