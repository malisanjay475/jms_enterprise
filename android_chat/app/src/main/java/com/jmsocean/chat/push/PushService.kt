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
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        if (Session.signedIn) scope.launch { Api.registerPush(token) }
    }

    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        if (d["type"] != "chat" || !Session.signedIn) return
        val conv = d["conversation_sync_id"] ?: return
        Notifier.show(
            this, conv,
            title = d["title"] ?: "JMS Chat",
            sender = d["sender"] ?: "",
            text = d["body"] ?: "",
            isGroup = d["is_group"] == "1"
        )
    }
}
