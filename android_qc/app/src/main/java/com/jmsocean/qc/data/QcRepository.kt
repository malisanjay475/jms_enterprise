package com.jmsocean.qc.data

import com.jmsocean.qc.data.remote.ApiEnvelope
import com.jmsocean.qc.data.remote.LoginRequest
import com.jmsocean.qc.data.remote.Network
import com.jmsocean.qc.data.remote.QueueJob
import com.jmsocean.qc.data.remote.SessionData
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

/** Single source of truth for the UI. Wraps the API + session. */
class QcRepository(private val session: SessionStore) {

    private val api get() = Network.api
    private val json: Json get() = Network.json

    /** The job the supervisor tapped FPA/QC on — carries context between screens. */
    var activeJob: QueueJob? = null

    suspend fun login(
        username: String,
        password: String,
        geo: Geo? = null
    ): Result<SessionData> = runCatching {
        val resp = api.login(
            LoginRequest(
                username = username,
                password = password,
                geo_lat = geo?.lat,
                geo_lng = geo?.lng,
                geo_acc = geo?.acc
            )
        )
        // Parse both success and error bodies so the server's real message
        // (geofence / app-access / wrong password) reaches the user.
        val env: ApiEnvelope = resp.body()
            ?: resp.errorBody()?.string()?.takeIf { it.isNotBlank() }
                ?.let { runCatching { json.decodeFromString(ApiEnvelope.serializer(), it) }.getOrNull() }
            ?: error("Server error (HTTP ${resp.code()})")

        if (!env.ok) error(env.error ?: "Login failed (HTTP ${resp.code()})")

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

    /** Has FPA already been captured for this job on this machine? */
    suspend fun fpaStatus(jobCardNo: String, machine: String): Result<Boolean> = runCatching {
        val r = api.fpaStatus(jobCardNo = jobCardNo, machine = machine)
        r.ok && r.done
    }

    /**
     * Submit FPA with the physical-form photo + product reference photos.
     * Field names mirror the web multipart body exactly.
     */
    suspend fun submitFpa(
        job: QueueJob,
        formImage: File,
        productImages: List<File>,
        remarks: String,
        machine: String
    ): Result<Unit> = runCatching {
        val sessionJson = buildJsonObject {
            put("username", session.username)
            put("line", session.line)
        }.toString()

        fun text(v: String): RequestBody =
            v.toRequestBody("text/plain".toMediaTypeOrNull())

        val fields = mapOf(
            "session" to text(sessionJson),
            "date" to text(Ist.date()),
            "shift" to text(Ist.shift()),
            "hour_slot" to text(""),
            "line" to text(session.line),
            "machine" to text(machine),
            "plan_id" to text(job.PlanID ?: ""),
            "job_card_no" to text(job.JobCardNo ?: ""),
            "order_no" to text(job.orderNumber),
            "item_name" to text(job.productName),
            "mould_name" to text(job.Mould ?: ""),
            "remarks" to text(remarks),
            "supervisor" to text(session.username)
        )

        fun part(field: String, file: File): MultipartBody.Part {
            val body = file.asRequestBody("image/jpeg".toMediaTypeOrNull())
            return MultipartBody.Part.createFormData(field, file.name, body)
        }

        val env = api.submitFpa(
            fields = fields,
            formImage = part("fpa_form_image", formImage),
            productImages = productImages.map { part("fpa_product_images", it) }
        )
        if (!env.ok) error(env.error ?: "Upload failed")
    }

    fun logout() {
        session.clear()
        Network.cookieJar.clear()
        activeJob = null
    }
}
