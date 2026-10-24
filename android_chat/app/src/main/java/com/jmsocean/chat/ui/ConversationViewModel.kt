package com.jmsocean.chat.ui

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.chat.data.Api
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
    val editing = MutableStateFlow<Message?>(null)
    val peer = MutableStateFlow<String?>(null)
    val peerPhoto = MutableStateFlow<String?>(null)
    val lastSeen = MutableStateFlow<String?>(null)
    val mutedUntil = MutableStateFlow<String?>(null)
    val myRole = MutableStateFlow<String?>(null)
    val pins = MutableStateFlow<List<Message>>(emptyList())
    /** message id -> (label, text) for translations and voice-note text shown under bubbles */
    val extras = MutableStateFlow<Map<String, Pair<String, String>>>(emptyMap())
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
                    "reaction" -> if (ev.conversation_sync_id == convId) ev.message_sync_id?.let { id ->
                        replace(id) { it.copy(reactions = ev.reactions) }
                    }
                    "task" -> if (ev.conversation_sync_id == convId) ev.message_sync_id?.let { id ->
                        replace(id) { it.copy(task = com.jmsocean.chat.data.TaskStatus(ev.status ?: "open", ev.by)) }
                    }
                    "conversation", "reconnect" -> refresh()
                }
            }
        }
        // Direct chat: the other person's photo, online / last seen (refreshed every 30 s).
        viewModelScope.launch {
            while (true) {
                peer.value?.let { p ->
                    runCatching { Api.profileOf(p) }.onSuccess { pr ->
                        online.value = pr.online
                        lastSeen.value = pr.last_seen_at
                        peerPhoto.value = pr.photo_v
                    }
                }
                delay(30_000)
            }
        }
        viewModelScope.launch {
            runCatching { Api.conversations() }.onSuccess { list -> mutedUntil.value = list.firstOrNull { it.sync_id == convId }?.muted_until }
        }
    }

    private fun load() {
        viewModelScope.launch {
            runCatching { Api.messages(convId) }
                .onSuccess { r ->
                    messages.value = r.messages
                    hasMore = r.has_more
                    isGroup.value = r.type == "group"
                    myRole.value = r.my_role
                    loadPins()
                    members.value = r.members
                    title.value = r.title ?: r.members.firstOrNull { !Session.isMe(it) } ?: "Chat"
                    if (r.type != "group") r.members.firstOrNull { !Session.isMe(it) }?.let { p ->
                        if (peer.value == null) {
                            peer.value = p
                            runCatching { Api.profileOf(p) }.onSuccess { pr ->
                                online.value = pr.online; lastSeen.value = pr.last_seen_at; peerPhoto.value = pr.photo_v
                            }
                        }
                    }
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

    fun setReply(m: Message?) { editing.value = null; replyTo.value = m }

    fun startEdit(m: Message?) { replyTo.value = null; editing.value = m }

    /** Own text messages can be edited within 15 minutes (the server's window). */
    fun canEdit(m: Message): Boolean {
        if (!Session.isMe(m.sender) || m.deleted || m.kind != "text" || m.pending || m.failed) return false
        val t = parseTs(m.server_ts) ?: return false
        return java.time.Duration.between(t.toInstant(), Instant.now()).toMinutes() < 15
    }

    fun delete(m: Message) {
        viewModelScope.launch {
            runCatching { Api.deleteMessage(m.sync_id) }.onSuccess { upsert(it) }.onFailure { error.value = it.message }
        }
    }

    fun mute(how: String) {
        viewModelScope.launch {
            runCatching { Api.mute(convId, how) }
                .onSuccess { mutedUntil.value = if (how == "off") null else "muted" }
                .onFailure { error.value = it.message }
        }
    }

    /** Several photos / videos picked at once (album): sent one after another, in order. */
    fun sendMany(uris: List<Uri>) {
        uris.take(10).forEach { sendFile(it, "") }
    }

    /** Compress to 480p first (a 1-minute clip ~8 MB), then send. */
    private suspend fun sendVideo(uri: Uri, name: String) {
        val ctx = getApplication<Application>()
        val placeholderId = UUID.randomUUID().toString()
        val local = Message(
            sync_id = placeholderId, conversation_sync_id = convId, sender = Session.username ?: "",
            body = "🎥 Preparing video…", server_ts = Instant.now().toString(), pending = true
        )
        messages.value = messages.value + local
        val out = File(ctx.cacheDir, "video-${System.nanoTime()}.mp4")
        val small = com.jmsocean.chat.data.VideoCompress.to480p(ctx, uri, out)
        if (small == null) {
            replace(placeholderId) { it.copy(pending = false, failed = true, body = "🎥 Video could not be prepared") }
            error.value = "Could not prepare that video."
            return
        }
        if (small.length() > 10L * 1024 * 1024) {
            small.delete()
            replace(placeholderId) { it.copy(pending = false, failed = true, body = "🎥 Video too long (about 1 minute max)") }
            error.value = "Video is too long. Send up to about 1 minute."
            return
        }
        messages.value = messages.value.filterNot { it.sync_id == placeholderId }
        sendLocalFile(small, name.substringBeforeLast('.') + ".mp4", "video/mp4", "", "🎥 Video")
    }

    /** A voice note just recorded (already a small file). */
    fun sendVoice(file: File, mime: String) = sendLocalFile(file, file.name, mime, "", "🎤 Voice message")

    /** A camera shot: shrunk to ~1600 px first so it sends fast. */
    fun sendCameraPhoto(file: File) {
        viewModelScope.launch {
            val small = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                com.jmsocean.chat.data.Media.shrinkPhoto(file, File(getApplication<Application>().cacheDir, "send-${System.nanoTime()}.jpg"))
            } ?: file
            sendLocalFile(small, "IMG_${System.currentTimeMillis()}.jpg", "image/jpeg", "", "📷 Photo")
        }
    }

    private fun sendLocalFile(file: File, name: String, mime: String, caption: String, placeholder: String) {
        val reply = replyTo.value
        replyTo.value = null
        val id = UUID.randomUUID().toString()
        val local = Message(
            sync_id = id, conversation_sync_id = convId, sender = Session.username ?: "",
            body = placeholder, server_ts = Instant.now().toString(), pending = true, reply_to = quoteOf(reply)
        )
        messages.value = messages.value + local
        viewModelScope.launch {
            deliver(local) { Api.sendFile(convId, file, name, mime, caption, reply?.sync_id, id) }
            file.delete()
        }
    }

    private fun quoteOf(m: Message?) = m?.let {
        ReplyQuote(it.sync_id, it.sender, it.kind, it.body.ifBlank { it.attachment?.file_name ?: "" })
    }

    fun sendText(text: String) {
        val body = text.trim()
        if (body.isEmpty()) return
        // "/" = JMS Bot command (/dpr, /job, /order, /help)
        if (body.startsWith("/") && editing.value == null) {
            viewModelScope.launch { runCatching { Api.command(convId, body) }.onSuccess { upsert(it) }.onFailure { error.value = it.message } }
            return
        }
        editing.value?.let { m ->
            editing.value = null
            if (body == m.body) return
            replace(m.sync_id) { it.copy(body = body, edited_at = Instant.now().toString()) }
            viewModelScope.launch {
                runCatching { Api.editMessage(m.sync_id, body) }.onSuccess { upsert(it) }
                    .onFailure { e -> replace(m.sync_id) { m }; error.value = e.message }
            }
            return
        }
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
            var mime = cr.getType(uri) ?: "application/octet-stream"
            var name = "file"
            var size = 0L
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    name = c.getString(0) ?: name
                    size = c.getLong(1)
                }
            }
            if (mime.startsWith("video/")) { sendVideo(uri, name); return@launch }
            if (size > 10L * 1024 * 1024 && !mime.startsWith("image/")) { error.value = "File is too big (max 10 MB)."; return@launch }
            val tmp = File(ctx.cacheDir, "upload-${System.nanoTime()}")
            val ok = runCatching { cr.openInputStream(uri)!!.use { input -> tmp.outputStream().use { input.copyTo(it) } } }.isSuccess
            if (!ok) { error.value = "Could not read the file."; return@launch }
            // Photos (not GIFs) are shrunk before sending, like WhatsApp: much faster.
            var upload = tmp
            if (mime.startsWith("image/") && mime != "image/gif") {
                val small = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.jmsocean.chat.data.Media.shrinkPhoto(tmp, File(ctx.cacheDir, "send-${System.nanoTime()}.jpg"))
                }
                if (small != null) { tmp.delete(); upload = small; mime = "image/jpeg"; name = name.substringBeforeLast('.') + ".jpg" }
            }
            val id = UUID.randomUUID().toString()
            val local = Message(
                sync_id = id, conversation_sync_id = convId, sender = Session.username ?: "",
                body = caption.ifBlank { "📎 $name" }, server_ts = Instant.now().toString(), pending = true,
                reply_to = quoteOf(reply)
            )
            messages.value = messages.value + local
            deliver(local) { Api.sendFile(convId, upload, name, mime, caption, reply?.sync_id, id) }
            upload.delete()
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

    fun ack(m: Message) {
        viewModelScope.launch {
            runCatching { Api.ack(m.sync_id) }
                .onSuccess { r -> replace(m.sync_id) { it.copy(alert = it.alert?.copy(acked_by = r.acked_by, acked_at = r.acked_at)) } }
                .onFailure { error.value = it.message }
        }
    }

    fun raiseTicket(m: Message, machine: String, problem: String, priority: String, done: (String) -> Unit) {
        viewModelScope.launch {
            runCatching { Api.raiseTicket(convId, m.sync_id, machine, problem, priority) }
                .onSuccess { done(it.ticket_no); refresh() }.onFailure { error.value = it.message }
        }
    }

    fun postHandover(running: String, problems: String, qc: String, notes: String) {
        viewModelScope.launch { runCatching { Api.handover(convId, running, problems, qc, notes) }.onSuccess { upsert(it) }.onFailure { error.value = it.message } }
    }

    fun checkIn(lat: Double, lng: Double, acc: Float) {
        viewModelScope.launch { runCatching { Api.checkin(convId, lat, lng, acc) }.onSuccess { upsert(it) }.onFailure { error.value = it.message } }
    }

    fun translate(m: Message, to: String, label: String) {
        extras.value = extras.value + (m.sync_id to ("🌐 $label" to "Translating…"))
        viewModelScope.launch {
            runCatching { Api.translate(m.sync_id, to) }
                .onSuccess { t -> extras.value = extras.value + (m.sync_id to ("🌐 $label" to t)) }
                .onFailure { e -> extras.value = extras.value - m.sync_id; error.value = e.message }
        }
    }

    fun transcribe(m: Message) {
        extras.value = extras.value + (m.sync_id to ("📝 Voice message as text" to "Writing it down…"))
        viewModelScope.launch {
            runCatching { Api.transcribe(m.sync_id) }
                .onSuccess { t -> extras.value = extras.value + (m.sync_id to ("📝 Voice message as text" to t)) }
                .onFailure { e -> extras.value = extras.value - m.sync_id; error.value = e.message }
        }
    }

    fun loadPins() { viewModelScope.launch { runCatching { Api.pins(convId) }.onSuccess { pins.value = it } } }

    fun togglePin(m: Message) {
        val on = pins.value.none { it.sync_id == m.sync_id }
        viewModelScope.launch { runCatching { Api.pinMessage(m.sync_id, on) }.onSuccess { loadPins() }.onFailure { error.value = it.message } }
    }

    fun vote(m: Message, picks: List<Int>) {
        viewModelScope.launch { runCatching { Api.vote(m.sync_id, picks) }.onSuccess { upsert(it) }.onFailure { error.value = it.message } }
    }

    fun sendSpecial(text: String, urgent: Boolean = false, announcement: Boolean = false, poll: Triple<String, List<String>, Boolean>? = null) {
        viewModelScope.launch {
            runCatching { Api.sendSpecial(convId, text, urgent, announcement, poll) }.onSuccess { upsert(it) }.onFailure { error.value = it.message }
        }
    }

    fun makeTask(m: Message, title: String, assignee: String, due: String?, done: () -> Unit) {
        viewModelScope.launch {
            runCatching { Api.createTodo(convId, m.sync_id, title, assignee, due) }.onSuccess { done(); refresh() }.onFailure { error.value = it.message }
        }
    }

    fun schedule(text: String, at: String, done: () -> Unit) {
        viewModelScope.launch { runCatching { Api.schedule(convId, text, at) }.onSuccess { done() }.onFailure { error.value = it.message } }
    }

    /** My reaction (or "" to remove). Shown at once, then the server's list wins. */
    fun react(m: Message, emoji: String) {
        val me = Session.username ?: return
        val mine = (m.reactions ?: emptyList()).map { r -> r.copy(users = r.users.filterNot { it.equals(me, true) }) }
            .filter { it.users.isNotEmpty() }
        val next = if (emoji.isEmpty()) mine else {
            val hit = mine.firstOrNull { it.emoji == emoji }
            if (hit != null) mine.map { if (it.emoji == emoji) it.copy(users = it.users + me) else it }
            else mine + com.jmsocean.chat.data.Reaction(emoji, listOf(me))
        }
        replace(m.sync_id) { it.copy(reactions = next) }
        viewModelScope.launch {
            runCatching { Api.react(m.sync_id, emoji) }
                .onSuccess { rx -> replace(m.sync_id) { it.copy(reactions = rx) } }
                .onFailure { error.value = it.message }
        }
    }

    fun myReaction(m: Message): String? =
        m.reactions?.firstOrNull { r -> r.users.any { Session.isMe(it) } }?.emoji

    fun star(m: Message) {
        val on = !m.starred
        replace(m.sync_id) { it.copy(starred = on) }
        viewModelScope.launch {
            runCatching { Api.star(m.sync_id, on) }.onFailure { e -> replace(m.sync_id) { it.copy(starred = !on) }; error.value = e.message }
        }
    }

    fun setTask(m: Message, status: String) {
        viewModelScope.launch {
            runCatching { Api.setTask(m.sync_id, status) }
                .onSuccess { t -> replace(m.sync_id) { it.copy(task = t) } }
                .onFailure { error.value = it.message }
        }
    }

    // ---- search inside this chat ----
    val searchResults = MutableStateFlow<List<Message>?>(null)
    private var searchJob: Job? = null
    fun search(q: String) {
        searchJob?.cancel()
        if (q.trim().length < 2) { searchResults.value = null; return }
        searchJob = viewModelScope.launch {
            delay(300)
            runCatching { Api.search(q.trim(), convId) }.onSuccess { r -> searchResults.value = r.map { it.message } }
        }
    }
}
