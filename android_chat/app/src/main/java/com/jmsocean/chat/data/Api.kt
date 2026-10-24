package com.jmsocean.chat.data

import com.jmsocean.chat.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

class ApiError(message: String, val status: Int = 0) : IOException(message)

/** The MAIN server's chat API. Every call sends the chat session as a Bearer token. */
object Api {
    val base: String = BuildConfig.BASE_URL.trimEnd('/')

    val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false; isLenient = true }
    private val JSON = "application/json".toMediaType()

    /** Emits when the server says the session is gone (401): the app shows Login. */
    private val _signedOut = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val signedOut = _signedOut.asSharedFlow()

    private val auth = Interceptor { chain ->
        val b = chain.request().newBuilder()
        Session.token?.let { b.header("Authorization", "Bearer $it") }
        b.header("User-Agent", "JMSChatApp/${BuildConfig.VERSION_NAME} (Android)")
        chain.proceed(b.build())
    }

    val client: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(auth)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /** For the live stream: no read timeout (the server sends a heartbeat every 20 s). */
    val streamClient: OkHttpClient = client.newBuilder().readTimeout(0, TimeUnit.SECONDS).build()

    private suspend fun call(method: String, path: String, body: RequestBody? = null): String = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(base + path).method(method, body).build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (resp.code == 401 && Session.signedIn) {
                Session.clear()
                _signedOut.tryEmit(Unit)
            }
            if (!resp.isSuccessful) {
                val msg = runCatching { json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
                throw ApiError(msg ?: "Server error (${resp.code})", resp.code)
            }
            text
        }
    }

    private suspend inline fun <reified T> get(path: String): T = json.decodeFromString(call("GET", path))
    private suspend inline fun <reified T> post(path: String, body: JsonObject): T =
        json.decodeFromString(call("POST", path, body.toString().toRequestBody(JSON)))

    // ---- sign-in ----
    suspend fun login(username: String, password: String): LoginReply {
        val body = buildJsonObject { put("username", username); put("password", password) }
        return try {
            post("/api/chat-app/login", body)
        } catch (e: ApiError) {
            LoginReply(ok = false, error = e.message)
        }
    }

    suspend fun logout() { runCatching { call("POST", "/api/chat-app/logout", "{}".toRequestBody(JSON)) } }

    // ---- chat ----
    suspend fun me(): Me = get("/api/chat/me")
    suspend fun users(): List<ChatUser> = get<UsersReply>("/api/chat/users").users
    suspend fun conversations(): List<Conversation> = get<ConversationsReply>("/api/chat/conversations").conversations
    suspend fun unread(): Int = get<UnreadReply>("/api/chat/unread").unread

    suspend fun messages(convId: String, before: String? = null): MessagesReply =
        get("/api/chat/conversations/$convId/messages" + (before?.let { "?before=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""))

    suspend fun openDirect(username: String): Conversation =
        post<ConversationReply>("/api/chat/conversations", buildJsonObject { put("username", username) }).conversation
            ?: throw ApiError("Could not open the chat.")

    suspend fun createGroup(title: String, members: List<String>): Conversation =
        post<ConversationReply>("/api/chat/groups", buildJsonObject {
            put("title", title)
            putJsonArray("members") { members.forEach { add(it) } }
        }).conversation ?: throw ApiError("Could not create the group.")

    suspend fun send(convId: String, text: String, replyTo: String?, syncId: String = UUID.randomUUID().toString()): Message =
        post<MessageReply>("/api/chat/messages", buildJsonObject {
            put("conversation_sync_id", convId)
            put("body", text)
            put("sync_id", syncId)
            put("client_ts", Instant.now().toString())
            if (replyTo != null) put("reply_to_sync_id", replyTo)
        }).message ?: throw ApiError("Message not sent.")

    suspend fun sendFile(convId: String, file: File, fileName: String, mime: String, caption: String, replyTo: String?, syncId: String): Message {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("conversation_sync_id", convId)
            .addFormDataPart("sync_id", syncId)
            .addFormDataPart("body", caption)
            .apply { if (replyTo != null) addFormDataPart("reply_to_sync_id", replyTo) }
            .addFormDataPart("file", fileName, file.asRequestBodyCompat(mime))
            .build()
        return json.decodeFromString<MessageReply>(call("POST", "/api/chat/attachments", form)).message
            ?: throw ApiError("File not sent.")
    }

    suspend fun markRead(convId: String) {
        runCatching { call("POST", "/api/chat/read", buildJsonObject { put("conversation_sync_id", convId) }.toString().toRequestBody(JSON)) }
    }

    suspend fun typing(convId: String) {
        runCatching { call("POST", "/api/chat/typing", buildJsonObject { put("conversation_sync_id", convId) }.toString().toRequestBody(JSON)) }
    }

    suspend fun registerPush(token: String) {
        runCatching {
            call("POST", "/api/chat/fcm/register", buildJsonObject {
                put("token", token); put("app_version", BuildConfig.VERSION_NAME)
            }.toString().toRequestBody(JSON))
        }
    }

    suspend fun unregisterPush(token: String) {
        runCatching { call("POST", "/api/chat/fcm/unregister", buildJsonObject { put("token", token) }.toString().toRequestBody(JSON)) }
    }

    suspend fun pushStatus(): PushStatus = get("/api/chat/fcm/status")

    // ---- urgent / announcement / poll ----
    suspend fun sendSpecial(convId: String, text: String, urgent: Boolean = false, announcement: Boolean = false,
                            poll: Triple<String, List<String>, Boolean>? = null): Message =
        post<MessageReply>("/api/chat/messages", buildJsonObject {
            put("conversation_sync_id", convId)
            put("body", text)
            put("sync_id", UUID.randomUUID().toString())
            put("client_ts", Instant.now().toString())
            if (urgent) put("urgent", true)
            if (announcement) put("announcement", true)
            if (poll != null) put("poll", buildJsonObject {
                put("question", poll.first)
                putJsonArray("options") { poll.second.forEach { add(it) } }
                put("multi", poll.third)
            })
        }).message ?: throw ApiError("Message not sent.")

    suspend fun vote(messageId: String, options: List<Int>): Message =
        json.decodeFromString<MessageReply>(call("POST", "/api/chat/messages/$messageId/vote", jsonBody("options" to options))).message
            ?: throw ApiError("Vote not saved.")

    suspend fun pins(convId: String): List<Message> = get<PinsReply>("/api/chat/conversations/$convId/pins").pins
    suspend fun pinMessage(messageId: String, on: Boolean) { call(if (on) "POST" else "DELETE", "/api/chat/messages/$messageId/pin", if (on) "{}".toRequestBody(JSON) else null) }

    // ---- tasks ----
    suspend fun createTodo(convId: String, messageId: String?, title: String, assignee: String, dueAt: String?) {
        call("POST", "/api/chat/todos", jsonBody("conversation_sync_id" to convId, "message_sync_id" to messageId,
            "title" to title, "assignee" to assignee, "due_at" to dueAt))
    }
    suspend fun todos(): List<Todo> = get<TodosReply>("/api/chat/todos").todos
    suspend fun todoDone(id: String, done: Boolean) { call("POST", "/api/chat/todos/$id/done", jsonBody("done" to done)) }

    // ---- scheduled ----
    suspend fun schedule(convId: String, text: String, sendAt: String) {
        call("POST", "/api/chat/scheduled", jsonBody("conversation_sync_id" to convId, "body" to text, "send_at" to sendAt))
    }

    // ---- quiet hours ----
    suspend fun chatSettings(): ChatSettings = get("/api/chat/settings")
    suspend fun saveQuiet(from: String, to: String): ChatSettings =
        json.decodeFromString(call("PUT", "/api/chat/settings", jsonBody("quiet_from" to from, "quiet_to" to to)))

    private fun jsonBody(vararg kv: Pair<String, Any?>) = buildJsonObject {
        kv.forEach { (k, v) ->
            when (v) {
                null -> Unit
                is Boolean -> put(k, v)
                is Number -> put(k, v)
                is List<*> -> putJsonArray(k) { v.forEach { if (it is Number) add(it) else add(it.toString()) } }
                else -> put(k, v.toString())
            }
        }
    }.toString().toRequestBody(JSON)

    // ---- reactions, stars, info, forward ----
    suspend fun react(messageId: String, emoji: String): List<Reaction> =
        json.decodeFromString<ReactReply>(call("POST", "/api/chat/messages/$messageId/react", jsonBody("emoji" to emoji))).reactions

    suspend fun star(messageId: String, on: Boolean) { call("POST", "/api/chat/messages/$messageId/star", jsonBody("on" to on)) }
    suspend fun starred(): List<FoundMessage> = get<FoundReply>("/api/chat/starred").results
    suspend fun messageInfo(messageId: String): MessageInfo = get("/api/chat/messages/$messageId/info")

    suspend fun forward(messageId: String, to: List<String>): List<Message> =
        json.decodeFromString<ForwardReply>(call("POST", "/api/chat/forward", jsonBody("message_sync_id" to messageId, "to" to to))).messages

    suspend fun search(q: String, conversation: String? = null): List<FoundMessage> =
        get<FoundReply>("/api/chat/search?q=" + java.net.URLEncoder.encode(q, "UTF-8") +
            (conversation?.let { "&conversation=$it" } ?: "")).results

    // ---- voice calls ----
    suspend fun startCall(to: String): CallReply =
        json.decodeFromString(call("POST", "/api/chat/calls", jsonBody("to" to to)))

    /** accept / decline / end. accept also returns the ICE servers. */
    suspend fun callAction(id: String, action: String): CallReply =
        json.decodeFromString(call("POST", "/api/chat/calls/$id/$action", "{}".toRequestBody(JSON)))

    suspend fun callSignal(id: String, kind: String, data: String) {
        call("POST", "/api/chat/calls/$id/signal", jsonBody("kind" to kind, "data" to data))
    }

    suspend fun callSignals(id: String, after: Long): CallSignalsReply = get("/api/chat/calls/$id/signals?after=$after")

    suspend fun callLog(): List<CallInfo> = get<CallLogReply>("/api/chat/calls").calls

    // ---- pin / archive ----
    suspend fun pin(convId: String, on: Boolean) { call("POST", "/api/chat/conversations/$convId/pin", jsonBody("on" to on)) }
    suspend fun archive(convId: String, on: Boolean) { call("POST", "/api/chat/conversations/$convId/archive", jsonBody("on" to on)) }

    // ---- groups ----
    suspend fun renameGroup(convId: String, title: String) { call("PATCH", "/api/chat/groups/$convId", jsonBody("title" to title)) }
    suspend fun addMembers(convId: String, users: List<String>) { call("POST", "/api/chat/groups/$convId/members", jsonBody("members" to users)) }
    suspend fun removeMember(convId: String, user: String) {
        call("DELETE", "/api/chat/groups/$convId/members/" + java.net.URLEncoder.encode(user, "UTF-8"))
    }
    suspend fun setGroupAdmin(convId: String, user: String, admin: Boolean) {
        call("POST", "/api/chat/groups/$convId/members/" + java.net.URLEncoder.encode(user, "UTF-8") + "/admin", jsonBody("admin" to admin))
    }
    suspend fun leaveGroup(convId: String) { call("POST", "/api/chat/groups/$convId/leave", "{}".toRequestBody(JSON)) }

    // ---- shared JMS work (link cards) ----
    suspend fun setTask(messageId: String, status: String): TaskStatus =
        json.decodeFromString<TaskReply>(call("POST", "/api/chat/tasks/$messageId", jsonBody("status" to status))).task ?: TaskStatus(status)

    /** Ask the server to push a test notification to my phones. Throws with the reason. */
    suspend fun pushTest() { call("POST", "/api/chat/fcm/test", "{}".toRequestBody(JSON)) }

    fun fileUrl(attachmentId: String) = "$base/api/chat/files/$attachmentId"

    /** Profile photo URL; null when the user has none. `v` changes with each new photo. */
    fun avatarUrl(username: String, v: String?) =
        v?.let { "$base/api/chat/avatars/${java.net.URLEncoder.encode(username, "UTF-8")}?v=$it" }

    // ---- profiles ----
    suspend fun myProfile(): Profile = get<ProfileReply>("/api/chat/profile").profile ?: Profile()
    suspend fun profileOf(username: String): Profile =
        get<ProfileReply>("/api/chat/profile/" + java.net.URLEncoder.encode(username, "UTF-8")).profile ?: Profile(username = username)

    suspend fun saveAbout(about: String): Profile = withContext(Dispatchers.IO) {
        json.decodeFromString<ProfileReply>(call("PUT", "/api/chat/profile", buildJsonObject { put("about", about) }.toString().toRequestBody(JSON))).profile ?: Profile()
    }

    suspend fun uploadPhoto(file: File, mime: String): Profile {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("photo", file.name, file.asRequestBodyCompat(mime)).build()
        return json.decodeFromString<ProfileReply>(call("POST", "/api/chat/profile/photo", form)).profile ?: Profile()
    }

    suspend fun removePhoto(): Profile = json.decodeFromString<ProfileReply>(call("DELETE", "/api/chat/profile/photo")).profile ?: Profile()

    // ---- edit / delete / mute ----
    suspend fun editMessage(id: String, body: String): Message =
        json.decodeFromString<MessageReply>(call("PATCH", "/api/chat/messages/$id", buildJsonObject { put("body", body) }.toString().toRequestBody(JSON))).message
            ?: throw ApiError("Not edited.")

    suspend fun deleteMessage(id: String): Message =
        json.decodeFromString<MessageReply>(call("DELETE", "/api/chat/messages/$id")).message ?: throw ApiError("Not deleted.")

    /** how: 8h, 1w, always or off. */
    suspend fun mute(convId: String, how: String) {
        call("POST", "/api/chat/conversations/$convId/mute", buildJsonObject { put("for", how) }.toString().toRequestBody(JSON))
    }

    // ---- self-update feed (static, no session needed) ----
    suspend fun appVersion(): AppVersion? = runCatching {
        withContext(Dispatchers.IO) {
            client.newCall(Request.Builder().url("$base/qc-app/chat/version.json?t=${System.currentTimeMillis()}").build())
                .execute().use { r -> if (r.isSuccessful) json.decodeFromString<AppVersion>(r.body!!.string()) else null }
        }
    }.getOrNull()

    fun downloadTo(url: String, dest: File): Boolean {
        client.newCall(Request.Builder().url(url).build()).execute().use { r ->
            if (!r.isSuccessful) return false
            dest.outputStream().use { out -> r.body!!.byteStream().copyTo(out) }
        }
        return true
    }
}

private fun File.asRequestBodyCompat(mime: String): RequestBody {
    val type = mime.toMediaType()
    val bytes = readBytes()
    return bytes.toRequestBody(type)
}
