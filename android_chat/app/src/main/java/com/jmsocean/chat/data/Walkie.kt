package com.jmsocean.chat.data

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper

/**
 * 📻 Walkie-talkie (push-to-talk). Per chat, kept on this phone only: when it is on, the
 * mic sends clips marked ptt and clips from others play out loud by themselves, also
 * when the app is in the background (from the push). Clips play one after another.
 */
object Walkie {
    private const val PREFS = "walkie"
    private val main = Handler(Looper.getMainLooper())
    private val queue = ArrayDeque<String>()
    private var mp: MediaPlayer? = null

    fun isOn(ctx: Context, convId: String) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(convId, false)

    fun set(ctx: Context, convId: String, on: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply { if (on) putBoolean(convId, true) else remove(convId) }.apply()
    }

    /** Queue one clip (attachment id). Not while on a call. */
    fun play(ctx: Context, fileId: String) {
        val app = ctx.applicationContext
        main.post {
            if (com.jmsocean.chat.call.CallEngine.busy || com.jmsocean.chat.call.GroupCallEngine.active) return@post
            queue.addLast(fileId)
            if (mp == null) next(app)
        }
    }

    private fun next(ctx: Context) {
        val id = queue.removeFirstOrNull() ?: return
        val p = MediaPlayer()
        mp = p
        runCatching {
            p.setAudioAttributes(
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
            )
            p.setDataSource(ctx, Uri.parse(Api.fileUrl(id)), mapOf("Authorization" to "Bearer ${Session.token}"))
            p.setOnPreparedListener { it.start() }
            p.setOnCompletionListener { done(ctx, it) }
            p.setOnErrorListener { mpl, _, _ -> done(ctx, mpl); true }
            p.prepareAsync()
        }.onFailure { done(ctx, p) }
    }

    private fun done(ctx: Context, p: MediaPlayer) {
        runCatching { p.release() }
        if (mp === p) mp = null
        next(ctx)
    }
}
