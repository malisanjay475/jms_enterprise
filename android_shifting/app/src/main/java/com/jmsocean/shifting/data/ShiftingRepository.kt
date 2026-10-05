package com.jmsocean.shifting.data

import com.jmsocean.shifting.data.remote.ApiEnvelope
import com.jmsocean.shifting.data.remote.ColourRow
import com.jmsocean.shifting.data.remote.Job
import com.jmsocean.shifting.data.remote.JobDetail
import com.jmsocean.shifting.data.remote.LabelInfo
import com.jmsocean.shifting.data.remote.LineTeam
import com.jmsocean.shifting.data.remote.LineTeamRequest
import com.jmsocean.shifting.data.remote.LineTeamStatus
import com.jmsocean.shifting.data.remote.LoginRequest
import com.jmsocean.shifting.data.remote.ManualEntryRequest
import com.jmsocean.shifting.data.remote.Network
import com.jmsocean.shifting.data.remote.QcHold
import com.jmsocean.shifting.data.remote.ScanEntryRequest
import com.jmsocean.shifting.data.remote.ShiftEntry
import com.jmsocean.shifting.data.remote.ShiftSummary
import com.jmsocean.shifting.data.remote.SummaryRow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import retrofit2.Response

/** Thrown when the server says the login session is gone (HTTP 401). */
class SessionExpiredException(message: String) : Exception(message)

/** Single source of truth for the screens: wraps the API + session. */
class ShiftingRepository(private val session: SessionStore) {

    private val api get() = Network.api
    private val json get() = Network.json

    private val _sessionExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** Emits when any call gets a 401, so the app can send the user back to login. */
    val sessionExpired: SharedFlow<Unit> = _sessionExpired.asSharedFlow()

    /**
     * Runs a call and returns `data`, or throws with the server's own message.
     * 4xx/5xx bodies are parsed too, so the shifter sees "QC HOLD on …" rather than "HTTP 409".
     */
    private suspend fun call(block: suspend () -> Response<ApiEnvelope>): JsonElement? {
        val resp = block()
        val env: ApiEnvelope? = resp.body()
            ?: resp.errorBody()?.string()?.takeIf { it.isNotBlank() }
                ?.let { runCatching { json.decodeFromString(ApiEnvelope.serializer(), it) }.getOrNull() }
        if (resp.code() == 401) {
            _sessionExpired.tryEmit(Unit)
            throw SessionExpiredException(env?.error ?: "Your login has expired. Please log in again.")
        }
        if (env == null) error("Server error (HTTP ${resp.code()})")
        if (!resp.isSuccessful || !env.ok) error(env.error ?: "Request failed (HTTP ${resp.code()})")
        return env.data
    }

    // ── Auth ────────────────────────────────────────────────────────────────

    suspend fun login(username: String, password: String, geo: Geo?): Result<Unit> = runCatching {
        val data = call {
            api.login(
                LoginRequest(
                    username = username, password = password,
                    geo_lat = geo?.lat, geo_lng = geo?.lng, geo_acc = geo?.acc
                )
            )
        } as? JsonObject
        session.username = data?.str("username").orEmpty().ifBlank { username }
        session.line = data?.str("line").orEmpty()
    }

    fun logout() {
        Network.cookieJar.clear()
        session.clearLogin()
    }

    // ── Locations ───────────────────────────────────────────────────────────

    suspend fun locations(): Result<List<String>> = runCatching {
        (call { api.locations() } as? JsonArray).orEmpty()
            .mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim() }
            .filter { it.isNotBlank() }
    }

    // ── Scan ────────────────────────────────────────────────────────────────

    suspend fun lookupLabel(scan: String): Result<LabelInfo> = runCatching {
        val o = call { api.scanLabel(scan) } as? JsonObject ?: error("Label not found.")
        val hold = (o["qc_hold"] as? JsonObject)?.let {
            QcHold(
                machine = it.str("machine"), date = it.str("dpr_date"), shift = it.str("shift"),
                slot = it.str("slot"), reason = it.str("reason")
            )
        }
        LabelInfo(
            labelUid = o.str("label_uid"),
            planCode = o.str("plan_code"),
            orderNo = o.str("order_no"),
            jcNo = o.str("jc_no"),
            machine = o.str("machine_name"),
            line = o.str("line"),
            mouldName = o.str("mould_name"),
            itemName = o.str("item_name"),
            clientName = o.str("client_name"),
            colour = o.str("colour"),
            labelNo = o.num("label_no").toInt(),
            totalLabels = o.num("total_labels").toInt(),
            labelQty = o.num("label_qty"),
            labelPendingQty = o.numOrNull("label_pending_qty") ?: o.num("label_qty"),
            colourPlanQty = o.num("colour_plan_qty"),
            colourPendingQty = o.num("colour_pending_qty"),
            totalProduced = o.num("total_produced"),
            totalShifted = o.num("total_shifted"),
            shopFloorQty = o.num("shop_floor_qty"),
            unitWeightKg = o.num("unit_weight_kg"),
            alreadyShifted = o.bool("already_shifted"),
            qcHold = hold,
            qcHoldMessage = o.str("qc_hold_message"),
            colours = o.arr("colour_summary").map { r ->
                ColourRow(
                    colour = r.str("colour"), itemName = r.str("item_name"),
                    planQty = r.num("plan_qty"), shiftedQty = r.num("shifted_qty"),
                    pendingQty = r.num("pending_qty"), isScannedColour = r.bool("is_scanned_colour")
                )
            }
        )
    }

    /** Shift a scanned label. Date/shift come from the server clock. Returns the saved quantity. */
    suspend fun shiftLabel(scan: String, toLocation: String, quantity: Double?, weightKg: Double?): Result<Double> = runCatching {
        val o = call {
            api.scanEntry(ScanEntryRequest(scan = scan, toLocation = toLocation, quantity = quantity, weightKg = weightKg))
        } as? JsonObject
        o?.num("quantity") ?: (quantity ?: 0.0)
    }

    // ── Jobs ────────────────────────────────────────────────────────────────

    /** Jobs of the user's own line (Jobs screen), or of every line when [allLines] (Manual shift). */
    suspend fun jobs(days: Int, allLines: Boolean = false): Result<List<Job>> = runCatching {
        val line = if (allLines) null else session.line.ifBlank { null }
        (call { api.jobs(days = days, line = line) } as? JsonArray).orEmpty()
            .mapNotNull { it as? JsonObject }
            .map { o ->
                Job(
                    planId = o.str("plan_id"),
                    planCode = o.str("plan_code"),
                    machine = o.str("machine"),
                    line = o.str("line"),
                    orderNo = o.str("order_no"),
                    jcNo = o.str("jc_no"),
                    itemName = o.str("item_name"),
                    mouldName = o.str("mould_name"),
                    status = o.str("status"),
                    planQty = o.num("plan_qty"),
                    produced = o.num("total_produced"),
                    qcApproved = o.num("total_qc_approved"),
                    shifted = o.num("total_shifted"),
                    labelsPrinted = o.num("total_labels_printed").toInt(),
                    labelledQty = o.num("total_labelled_qty"),
                    unitWeightKg = o.num("unit_weight_kg")
                )
            }
    }

    suspend fun jobDetail(planId: String): Result<JobDetail> = runCatching {
        val o = call { api.jobDetails(planId) } as? JsonObject ?: error("Job not found.")
        val t = o["totals"] as? JsonObject ?: JsonObject(emptyMap())
        JobDetail(
            planId = o.str("plan_id"),
            planCode = o.str("plan_code"),
            status = o.str("status"),
            machine = o.str("machine"),
            orderNo = o.str("order_no"),
            jcNo = o.str("jc_no"),
            productName = o.str("product_name"),
            mouldName = o.str("mould_name"),
            planQty = t.numOrNull("plan_qty") ?: o.num("plan_qty"),
            produced = t.num("produced_qty"),
            qcApproved = t.num("qc_approved_qty"),
            shifted = t.num("shifted_qty"),
            floorBalance = t.num("shop_floor_balance_qty"),
            pending = t.num("shifting_pending_qty"),
            colours = o.arr("colours").map { r ->
                ColourRow(
                    colour = r.str("colour"), itemName = r.str("item_name"),
                    planQty = r.num("plan_qty"), producedQty = r.num("produced_qty"),
                    qcApprovedQty = r.num("qc_approved_qty"), shiftedQty = r.num("shifted_qty"),
                    pendingQty = r.num("shifting_pending_qty"), floorBalanceQty = r.num("shop_floor_balance_qty")
                )
            },
            recent = o.arr("recent_scans").map { it.toShiftEntry(machineFallback = o.str("machine")) }
        )
    }

    suspend fun manualShift(planId: String, machine: String, quantity: Int, toLocation: String, weightKg: Double? = null): Result<Unit> = runCatching {
        call {
            api.manualEntry(
                ManualEntryRequest(planId = planId, quantity = quantity, toLocation = toLocation, machine = machine, weightKg = weightKg)
            )
        }
        Unit
    }

    // ── Shift team (Shifting Supervisor + Incharge per line) ────────────────

    suspend fun lineTeam(date: String, shift: String): Result<LineTeamStatus> = runCatching {
        var required: List<String> = emptyList()
        val data = call {
            api.lineTeam(date = date, shift = shift, lineAccess = session.line).also { r ->
                required = r.body()?.required.orEmpty()
            }
        }
        val teams = (data as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map {
            LineTeam(line = it.str("line"), supervisor = it.str("supervisor"), incharge = it.str("incharge"))
        }
        LineTeamStatus(teams = teams, required = required)
    }

    suspend fun saveLineTeam(line: String, date: String, shift: String, supervisor: String, incharge: String): Result<Unit> = runCatching {
        call { api.saveLineTeam(LineTeamRequest(line = line, dpr_date = date, shift = shift, supervisor = supervisor, incharge = incharge)) }
        Unit
    }

    // ── Recent + summary ────────────────────────────────────────────────────

    suspend fun recent(limit: Int = 60): Result<List<ShiftEntry>> = runCatching {
        (call { api.logs(limit) } as? JsonArray).orEmpty()
            .mapNotNull { it as? JsonObject }
            .map { it.toShiftEntry() }
    }

    suspend fun summary(date: String, shift: String): Result<ShiftSummary> = runCatching {
        val o = call { api.shiftReport(from = date, to = date, shift = shift) } as? JsonObject ?: error("No report data.")
        val t = o["totals"] as? JsonObject ?: JsonObject(emptyMap())
        val byLocation = mutableMapOf<String, Double>()
        o.arr("summary").forEach { s ->
            (s["by_location"] as? JsonObject)?.forEach { (loc, v) ->
                byLocation[loc] = (byLocation[loc] ?: 0.0) + ((v as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull() ?: 0.0)
            }
        }
        ShiftSummary(
            from = date, to = date, shift = shift,
            qty = t.num("qty"), kg = t.num("kg"),
            entries = t.num("entries").toInt(), labels = t.num("labels").toInt(), manual = t.num("manual").toInt(),
            byMachine = o.arr("by_machine").map { r ->
                SummaryRow(
                    title = r.str("machine"),
                    subtitle = listOf(r.str("item_name"), r.str("colour"), "→ " + r.str("location"))
                        .filter { it.isNotBlank() && it != "→ " }.joinToString(" · "),
                    qty = r.num("qty"), kg = r.num("kg"), count = r.num("entries").toInt()
                )
            },
            bySupervisor = o.arr("by_supervisor").map { r ->
                SummaryRow(
                    title = r.str("supervisor"), subtitle = "${r.num("labels").toInt()} label scans",
                    qty = r.num("qty"), kg = r.num("kg"), count = r.num("entries").toInt()
                )
            },
            byLocation = byLocation.entries
                .sortedByDescending { it.value }
                .map { (loc, q) -> SummaryRow(title = loc, subtitle = "", qty = q, kg = 0.0, count = 0) }
        )
    }

    private fun JsonElement.toShiftEntry(machineFallback: String = ""): ShiftEntry {
        val o = this as? JsonObject ?: JsonObject(emptyMap())
        return ShiftEntry(
            id = o.str("id"),
            machine = o.str("machine").ifBlank { o.str("machine_code") }.ifBlank { machineFallback },
            itemName = o.str("item_name"),
            colour = o.str("colour"),
            quantity = o.num("quantity"),
            weightKg = o.num("weight_kg"),
            toLocation = o.str("to_location"),
            shiftedBy = o.str("shifted_by"),
            createdAt = o.str("created_at"),
            labelNo = o.num("label_no").toInt(),
            totalLabels = o.num("total_labels").toInt(),
            scanMode = o.str("scan_mode")
        )
    }
}

// ── Tolerant JSON readers (numbers may be JSON numbers or numeric strings) ────

internal fun JsonObject.str(key: String): String {
    val v = this[key] ?: return ""
    if (v is JsonNull) return ""
    return (v as? JsonPrimitive)?.contentOrNull?.trim() ?: ""
}

internal fun JsonObject.numOrNull(key: String): Double? {
    val p = this[key] as? JsonPrimitive ?: return null
    if (p is JsonNull) return null
    return p.doubleOrNull ?: p.contentOrNull?.trim()?.toDoubleOrNull()
}

internal fun JsonObject.num(key: String): Double = numOrNull(key) ?: 0.0

internal fun JsonObject.bool(key: String): Boolean {
    val p = this[key] as? JsonPrimitive ?: return false
    return p.booleanOrNull ?: (p.contentOrNull == "true")
}

internal fun JsonObject.arr(key: String): List<JsonObject> =
    (this[key] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
