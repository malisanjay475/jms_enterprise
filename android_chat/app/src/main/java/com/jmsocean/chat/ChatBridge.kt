package com.jmsocean.chat

import android.content.Context
import android.webkit.JavascriptInterface

/** window.JMSChatNative: chat_app.html tells the app when the user signs in or out. */
class ChatBridge(private val ctx: Context) {
    @JavascriptInterface
    fun onSignedIn(username: String) = UnreadWorker.schedule(ctx.applicationContext)

    @JavascriptInterface
    fun onSignedOut() = UnreadWorker.cancel(ctx.applicationContext)
}
