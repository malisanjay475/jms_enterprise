package com.jmsocean.chat.ui

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.ChatUser
import com.jmsocean.chat.data.Live
import com.jmsocean.chat.data.Message
import com.jmsocean.chat.data.ReplyQuote
import com.jmsocean.chat.data.Session
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.time.Instant
import java.util.UUID

class ConversationViewModel(app: Application) : AndroidViewModel(app) {
    lateinit var convId: String
        private set
    val messages = MutableStateFlow<List<Message>>(emptyList()) // oldest first
    val title = MutableStateFlow("")
    val isGroup = MutableStateFlow(false)
    val members = MutableStateFlow<List<String>>(emptyList())
    val online = MutableStateFlow(false)
    val typing = MutableStateFlow<String?>(null)
    val loading = MutableStateFlow(true)
    val loadingOlder = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)
    val replyTo = MutableStateFlow<Message?>(null)
    private var hasMore = false
    private var typingClear: Job? = null
    private var lastTypingSent = 0L
    private var started = false

    fun start(id: String) {
        if (started) return
        started = true
        convId = id
        load()
        viewModelScope.launch {
            Live.events.collect { ev ->
                when (ev.type) {
                    "message" -> ev.message?.takeIf { it.conversation_sync_id == convId }?.let { m ->
                        upsert(m)
                        if (!Session.isMe(m.sender)) {
                            if (typing.value == m.sender) typing.value = null
                            Api.markRead(convId)
                        }
                    }
                    "message_update" -> ev.message?.takeIf { it.conversation_sync_id == convId }?.let { upsert(it) }
                    "receipt" -> if (ev.conversation_sync_id == convId) applyReceipt(ev.username ?: "", ev.kind ?: "", ev.message_sync_ids ?: emptyList())
                    "typing" -> if (ev.conversation_sync_id == convId && !Session.isMe(ev.username)) {
                        typing.value = ev.username
                        typingClear?.cancel()
                        typingClear = viewModelScope.launch { delay(4000); typing.value = null }
                    }
                    "conversation", "reconnect" -> refresh()
                }
            }
        }
        viewModelScope.launch {
            runCatching { Api.users() }.onSuccess { list: List<ChatUser> ->
                if (!isGroup.value) online.value = list.any { u -> u.online && members.value.any { it.equals(u.username, true) && !Session.isMe(it) } }
            }
        }
    }

    private fun load() {
        viewModelScope.launch {
            runCatching { Api.messages(convId) }
                .onSuccess { r ->
                    messages.value = r.messages
                    hasMore = r.has_more
                    isGroup.value = r.type == "group"
                    members.value = r.members
                    title.value = r.title ?: r.members.firstOrNull { !Session.isMe(it) } ?: "Chat"
                    error.value = null
                    Api.markRead(convId)
                }
                .onFailure { error.value = it.message }
            loading.value = false
        }
    }

    /** After a reconnect: fetch the newest page and merge it in. */
    private fun refresh() {
        viewModelScope.launch {
            runCatching { Api.messages(convId) }.onSuccess { r -> r.messages.forEach { upsert(it) } }
        }
    }

    fun loadOlder() {
        if (!hasMore || loadingOlder.value) return
        val oldest = messages.value.firstOrNull()?.server_ts ?: return
        loadingOlder.value = true
        viewModelScope.launch {
            runCatching { Api.messages(convId, oldest) }.onSuccess { r ->
                hasMore = r.has_more
                val known = messages.value.map { it.sync_id }.toHashSet()
                messages.value = r.messages.filter { it.sync_id !in known } + messages.value
            }
            loadingOlder.value = false
        }
    }

    private fun upsert(m: Message) {
        val list = messages.value
        val i = list.indexOfFirst { it.sync_id == m.sync_id }
        messages.value = if (i >= 0) {
            val old = list[i]
            // live copies carry no receipts: keep the ones we have
            list.toMutableList().also {
                it[i] = m.copy(delivered_to = m.delivered_to ?: old.delivered_to, read_by = m.read_by ?: old.read_by)
            }
        } else (list + m).sortedBy { it.server_ts ?: "9999" }
    }

    private fun applyReceipt(user: String, kind: String, ids: List<String>) {
        if (ids.isEmpty()) return
        val set = ids.toHashSet()
        messages.value = messages.value.map { m ->
            if (m.sync_id !in set) m else {
                val d = (m.delivered_to ?: emptyList()).let { if (it.any { u -> u.equals(user, true) }) it else it + user }
                val r = if (kind == "read") (m.read_by ?: emptyList()).let { if (it.any { u -> u.equals(user, true) }) it else it + user } else m.read_by
                m.copy(delivered_to = d, read_by = r)
            }
        }
    }

    fun onTyping() {
        val now = System.currentTimeMillis()
        if (now - lastTypingSent < 2500) return
        lastTypingSent = now
        viewModelScope.launch { Api.typing(convId) }
    }

    fun setReply(m: Message?) { replyTo.value = m }

    private fun quoteOf(m: Message?) = m?.let {
        ReplyQuote(it.sync_id, it.sender, it.kind, it.body.ifBlank { it.attachment?.file_name ?: "" })
    }

    fun sendText(text: String) {
        val body = text.trim()
        if (body.isEmpty()) return
        val reply = replyTo.value
        replyTo.value = null
        val id = UUID.randomUUID().toString()
        val local = Message(
            sync_id = id, conversation_sync_id = convId, sender = Session.username ?: "", body = body,
            server_ts = Instant.now().toString(), reply_to_sync_id = reply?.sync_id, reply_to = quoteOf(reply), pending = true
        )
        messages.value = messages.value + local
        viewModelScope.launch { deliver(local) { Api.send(convId, body, reply?.sync_id, id) } }
    }

    fun retry(m: Message) {
        if (!m.failed || m.attachment != null) return
        replace(m.sync_id) { it.copy(failed = false, pending = true) }
        viewModelScope.launch { deliver(m) { Api.send(convId, m.body, m.reply_to_sync_id, m.sync_id) } }
    }

    fun sendFile(uri: Uri, caption: String) {
        val ctx = getApplication<Application>()
        val reply = replyTo.value
        replyTo.value = null
        viewModelScope.launch {
            val cr = ctx.contentResolver
            val mime = cr.getType(uri) ?: "application/octet-stream"
            var name = "file"
            var size = 0L
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    name = c.getString(0) ?: name
                    size = c.getLong(1)
                }
            }
            if (size > 10L * 1024 * 1024) { error.value = "File is too big (max 10 MB)."; return@launch }
            val tmp = File(ctx.cacheDir, "upload-${System.nanoTime()}")
            val ok = runCatching { cr.openInputStream(uri)!!.use { input -> tmp.outputStream().use { input.copyTo(it) } } }.isSuccess
            if (!ok) { error.value = "Could not read the file."; return@launch }
            val id = UUID.randomUUID().toString()
            val local = Message(
                sync_id = id, conversation_sync_id = convId, sender = Session.username ?: "",
                body = caption.ifBlank { "📎 $name" }, server_ts = Instant.now().toString(), pending = true,
                reply_to = quoteOf(reply)
            )
            messages.value = messages.value + local
            deliver(local) { Api.sendFile(convId, tmp, name, mime, caption, reply?.sync_id, id) }
            tmp.delete()
        }
    }

    private suspend fun deliver(local: Message, send: suspend () -> Message) {
        runCatching { send() }
            .onSuccess { sent -> replace(local.sync_id) { sent } }
            .onFailure { e ->
                replace(local.sync_id) { it.copy(pending = false, failed = true) }
                error.value = e.message
            }
    }

    private fun replace(id: String, f: (Message) -> Message) {
        messages.value = messages.value.map { if (it.sync_id == id) f(it) else it }
    }

    fun clearError() { error.value = null }
}
