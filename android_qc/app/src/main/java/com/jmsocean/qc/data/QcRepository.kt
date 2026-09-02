package com.jmsocean.qc.data

import com.jmsocean.qc.data.remote.ApiEnvelope
import com.jmsocean.qc.data.remote.LoginRequest
import com.jmsocean.qc.data.remote.Network
import com.jmsocean.qc.data.remote.QueueJob
import com.jmsocean.qc.data.remote.SessionData
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Single source of truth for the UI. Wraps the API + session. */
class QcRepository(private val session: SessionStore) {

    private val api get() = Network.api
    private val json: Json get() = Network.json

    suspend fun login(username: String, password: String): Result<SessionData> = runCatching {
        val env: ApiEnvelope = api.login(LoginRequest(username = username, password = password))
        if (!env.ok) error(env.error ?: "Login failed")
        val data = env.data?.let { json.decodeFromJsonElement(SessionData.serializer(), it) }
            ?: SessionData(username = username, line = "")
        session.username = data.username.ifBlank { username }
        session.line = data.line
        data
    }

    /** Machines can arrive as bare strings or objects — handle both. */
    suspend fun machines(): Result<List<String>> = runCatching {
        val env = api.machines(line = session.line)
        if (!env.ok) error(env.error ?: "Could not load machines")
        val arr = env.data as? JsonArray ?: JsonArray(emptyList())
        arr.mapNotNull { el ->
            when (el) {
                is JsonPrimitive -> el.contentOrNull
                else -> {
                    val o = el.jsonObject
                    (o["machine"] ?: o["machine_name"] ?: o["name"])
                        ?.jsonPrimitive?.contentOrNull
                }
            }
        }.filter { it.isNotBlank() }
    }

    suspend fun queue(machine: String): Result<List<QueueJob>> = runCatching {
        val env = api.queue(line = session.line, machine = machine)
        if (!env.ok) error(env.error ?: "Could not load queue")
        val arr = env.data as? JsonArray ?: JsonArray(emptyList())
        arr.map { json.decodeFromJsonElement(QueueJob.serializer(), it) }
    }

    fun logout() {
        session.clear()
        Network.cookieJar.clear()
    }
}
