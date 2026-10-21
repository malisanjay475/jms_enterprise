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
