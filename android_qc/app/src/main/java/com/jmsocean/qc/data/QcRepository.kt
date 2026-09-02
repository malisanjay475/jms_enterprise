package com.jmsocean.qc.data

import com.jmsocean.qc.data.remote.ApiEnvelope
import com.jmsocean.qc.data.remote.LoginRequest
import com.jmsocean.qc.data.remote.Network
import com.jmsocean.qc.data.remote.QueueJob
import com.jmsocean.qc.data.remote.SessionData
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import com.jmsocean.qc.data.remote.FpaStatus
import com.jmsocean.qc.data.remote.Kpis
import com.jmsocean.qc.data.remote.MaterialIssue
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
            .distinct()
            .sortedWith(naturalMachineComparator)
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

    /** Full FPA status incl. saved image URLs, for the read-only view. */
    suspend fun fpaStatusFull(jobCardNo: String, machine: String): Result<FpaStatus> = runCatching {
        api.fpaStatus(jobCardNo = jobCardNo, machine = machine)
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

    // ── Verify + Hold ───────────────────────────────────────────────────────

    private fun sessionRef() =
        com.jmsocean.qc.data.remote.SessionRef(session.username, session.line)

    suspend fun verifyPending(
        machine: String,
        date: String,
        shift: String
    ): Result<List<com.jmsocean.qc.data.remote.VerifySlot>> = runCatching {
        val env = api.verifyPending(machine = machine, date = date, shift = shift)
        if (!env.ok) error(env.error ?: "Could not load slots")
        val arr = env.data as? JsonArray ?: JsonArray(emptyList())
        arr.map { json.decodeFromJsonElement(com.jmsocean.qc.data.remote.VerifySlot.serializer(), it) }
    }

    suspend fun verifySubmit(
        machine: String,
        date: String,
        shift: String,
        hourSlot: String,
        good: Int,
        reject: Int,
        remarks: String
    ): Result<Unit> = runCatching {
        val env = api.verifySubmit(
            com.jmsocean.qc.data.remote.VerifySubmitRequest(
                session = sessionRef(),
                machine = machine,
                dpr_date = date,
                shift = shift,
                hour_slot = hourSlot,
                qc_good_qty = good,
                qc_reject_qty = reject,
                remarks = remarks
            )
        )
        if (!env.ok) error(env.error ?: "Verify failed")
    }

    suspend fun placeHold(
        machine: String,
        date: String,
        shift: String,
        slot: String,
        jobCardNo: String,
        qtyOnHold: Int?,
        reason: String,
        remarks: String
    ): Result<Unit> = runCatching {
        val env = api.hold(
            com.jmsocean.qc.data.remote.HoldRequest(
                session = sessionRef(),
                machine = machine,
                dpr_date = date,
                shift = shift,
                slot = slot,
                job_card_no = jobCardNo,
                qty_on_hold = qtyOnHold,
                reason = reason,
                remarks = remarks
            )
        )
        if (!env.ok) error(env.error ?: "Hold failed")
    }

    // ── Issues ──────────────────────────────────────────────────────────────

    suspend fun issues(machine: String, status: String?): Result<List<MaterialIssue>> = runCatching {
        val env = api.materialIssues(machine.ifBlank { null }, status)
        if (!env.ok) error(env.error ?: "Could not load issues")
        val arr = env.data as? JsonArray ?: JsonArray(emptyList())
        arr.map { json.decodeFromJsonElement(MaterialIssue.serializer(), it) }
    }

    suspend fun createIssue(
        machine: String,
        description: String,
        severity: String,
        assignedRole: String,
        assignedName: String,
        jobCardNo: String
    ): Result<Unit> = runCatching {
        fun text(v: String): RequestBody = v.toRequestBody("text/plain".toMediaTypeOrNull())
        val sessionJson = buildJsonObject {
            put("username", session.username); put("line", session.line)
        }.toString()
        val env = api.createIssue(
            mapOf(
                "session" to text(sessionJson),
                "machine" to text(machine),
                "issue_description" to text(description),
                "severity" to text(severity),
                "assigned_to_role" to text(assignedRole),
                "assigned_to_name" to text(assignedName),
                "job_card_no" to text(jobCardNo)
            )
        )
        if (!env.ok) error(env.error ?: "Could not raise issue")
    }

    // ── Dashboard ───────────────────────────────────────────────────────────

    suspend fun dashboardKpis(date: String?, machine: String): Result<Kpis> = runCatching {
        val env = api.dashboardKpis(date, machine.ifBlank { null })
        if (!env.ok) error(env.error ?: "Could not load KPIs")
        val o = env.data as? JsonObject ?: JsonObject(emptyMap())
        fun num(k: String): Int =
            o[k]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()?.toInt() ?: 0
        Kpis(
            production = num("production"),
            accepted = num("accepted"),
            rejected = num("rejected"),
            rejectionRate = o["rejection_rate"]?.jsonPrimitive?.contentOrNull ?: "0",
            activeIssues = num("active_issues"),
            fpaDone = num("fpa_done"),
            activeHolds = num("active_holds"),
            heldMachines = num("held_machines")
        )
    }

    // ── QC hourly filling (DPR submit) ──────────────────────────────────────

    suspend fun submitDpr(
        job: QueueJob,
        date: String,
        shift: String,
        hourSlot: String,
        shots: Int,
        reject: Int,
        downtimeMin: Int,
        colour: String,
        remarks: String
    ): Result<Unit> = runCatching {
        val good = (shots - reject).coerceAtLeast(0)
        val env = api.submitDpr(
            com.jmsocean.qc.data.remote.DprSubmitRequest(
                session = sessionRef(),
                entry = com.jmsocean.qc.data.remote.DprEntry(
                    date = date, shift = shift, hourSlot = hourSlot,
                    shots = shots, goodQty = good, rejectQty = reject,
                    downtimeMin = downtimeMin, remarks = remarks,
                    planId = job.PlanID ?: "", machine = job.Machine ?: session.machine,
                    orderNo = job.orderNumber, mouldNo = job.mouldForEntry,
                    jobCardNo = job.JobCardNo ?: "", colour = colour,
                    rejectBreakup = if (reject > 0 && colour.isNotBlank()) "$colour:$reject" else "",
                    downtimeBreakup = ""
                )
            )
        )
        if (!env.ok) error(env.error ?: "Save failed")
    }

    fun logout() {
        session.clear()
        Network.cookieJar.clear()
        activeJob = null
    }
}
