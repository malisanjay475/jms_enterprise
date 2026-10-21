package com.jmsocean.chat.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.app.RemoteInput
import com.jmsocean.chat.data.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Reply / Mark as read buttons on a message notification. */
class ReplyReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val conv = intent.getStringExtra(Notifier.EXTRA_CONV) ?: return
        val app = ctx.applicationContext
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    ACTION_REPLY -> {
                        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_REPLY)?.toString()?.trim()
                        if (!text.isNullOrEmpty()) {
                            runCatching { Api.send(conv, text, null) }
                                .onSuccess { Notifier.addOwnReply(app, conv, text) }
                                .onFailure { e ->
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(app, "Reply not sent: ${e.message}", Toast.LENGTH_LONG).show()
                                    }
                                }
                        }
                    }
                    ACTION_READ -> {
                        Api.markRead(conv)
                        Notifier.clear(app, conv)
                    }
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_REPLY = "com.jmsocean.chat.REPLY"
        const val ACTION_READ = "com.jmsocean.chat.READ"
    }
}
