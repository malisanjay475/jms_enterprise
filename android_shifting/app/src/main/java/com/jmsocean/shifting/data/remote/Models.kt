package com.jmsocean.shifting.data.remote

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * The JMS API wraps every response as { ok, error?, data }. `data` varies per
 * endpoint, so it stays a raw JsonElement and the repository maps it (numbers
 * arrive as JSON numbers or as strings from Postgres NUMERIC, so mapping by hand
 * is safer than strict data classes).
 */
@Serializable
data class ApiEnvelope(
    val ok: Boolean = false,
    val error: String? = null,
    val data: JsonElement? = null,
    /** /api/shifting/line-team: lines still without a saved shift team. */
    val required: List<String>? = null
)

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    // App-access check on the server: the user needs the Shifting Supervisor App.
    val requested_app: String = "shifting_supervisor_app",
    val geo_lat: Double? = null,
    val geo_lng: Double? = null,
    val geo_acc: Double? = null
)

@Serializable
data class ScanEntryRequest(
    val scan: String,
    val toLocation: String,
    val quantity: Double? = null,
    val weightKg: Double? = null
)

@Serializable
data class ManualEntryRequest(
    val planId: String,
    val quantity: Int,
    val toLocation: String,
    val machine: String? = null,
    val weightKg: Double? = null
)

@Serializable
data class LineTeamRequest(
    val line: String,
    val dpr_date: String,
    val shift: String,
    val supervisor: String,
    val incharge: String
)

@Serializable
data class AppVersion(
    val versionCode: Int = 0,
    val versionName: String = "",
    val apk: String = "",          // filename under /qc-app/shifting/
    val notes: String? = null
)

// ── UI models (mapped by ShiftingRepository) ─────────────────────────────────

data class QcHold(
    val machine: String,
    val date: String,
    val shift: String,
    val slot: String,
    val reason: String
)

data class ColourRow(
    val colour: String,
    val itemName: String,
    val planQty: Double,
    val producedQty: Double = 0.0,
    val qcApprovedQty: Double = 0.0,
    val shiftedQty: Double,
    val pendingQty: Double,
    val floorBalanceQty: Double = 0.0,
    val isScannedColour: Boolean = false
)

/** What a scanned label resolves to (GET /api/shifting/scan-label). */
data class LabelInfo(
    val labelUid: String,
    val planCode: String,
    val orderNo: String,
    val jcNo: String,
    val machine: String,
    val line: String,
    val mouldName: String,
    val itemName: String,
    val clientName: String,
    val colour: String,
    val labelNo: Int,
    val totalLabels: Int,
    val labelQty: Double,
    val labelPendingQty: Double,
    val colourPlanQty: Double,
    val colourPendingQty: Double,
    val totalProduced: Double,
    val totalShifted: Double,
    val shopFloorQty: Double,
    /** kg per piece from the Mould Master; 0 when the mould has no weight. */
    val unitWeightKg: Double,
    val alreadyShifted: Boolean,
    val qcHold: QcHold?,
    val qcHoldMessage: String,
    val colours: List<ColourRow>,
    // Produced / QC verified / ready of the scanned colour (server: shifting availability)
    val colourProduced: Double = 0.0,
    val colourVerified: Double = 0.0,
    val colourNotVerified: Double = 0.0,
    val colourReady: Double = 0.0,
    val holdQty: Double = 0.0,
    val verificationEnforced: Boolean = false,
    /** NOT_PRODUCED / NOT_VERIFIED when the label cannot be shifted now; blank otherwise. */
    val blockCode: String = "",
    val blockMessage: String = ""
) {
    val blocked: Boolean get() = alreadyShifted || qcHold != null || blockCode.isNotBlank()

    /** Most that may be shifted from this label now (label left, and QC-verified ready). */
    val maxShiftQty: Int
        get() = if (verificationEnforced) minOf(labelPendingQty, colourReady).toInt() else labelPendingQty.toInt()
}

data class Job(
    val planId: String,
    val planCode: String,
    val machine: String,
    val line: String,
    val orderNo: String,
    val jcNo: String,
    val itemName: String,
    val mouldName: String,
    val status: String,
    val planQty: Double,
    val produced: Double,
    val qcApproved: Double,
    val shifted: Double,
    val labelsPrinted: Int,
    val labelledQty: Double,
    /** kg per piece from the Mould Master; 0 when the mould has no weight. */
    val unitWeightKg: Double = 0.0,
    val verified: Double = 0.0,
    val notVerified: Double = 0.0,
    /** QC verified - shifted: what may be shifted now. */
    val readyQty: Double = 0.0,
    val holdQty: Double = 0.0,
    val onHold: Boolean = false,
    val clientName: String = "",
    val verificationEnforced: Boolean = false
) {
    /** Most that may be shifted now: QC-verified ready where enforced, else shop-floor balance. */
    val maxShiftQty: Double get() = if (verificationEnforced) minOf(readyQty, floorBalance) else floorBalance
    val isRunning: Boolean get() = status.equals("running", ignoreCase = true)
    val floorBalance: Double get() = (produced - shifted).coerceAtLeast(0.0)
    val pending: Double get() = ((if (qcApproved > 0) qcApproved else produced) - shifted).coerceAtLeast(0.0)
}

data class JobDetail(
    val planId: String,
    val planCode: String,
    val status: String,
    val machine: String,
    val orderNo: String,
    val jcNo: String,
    val productName: String,
    val mouldName: String,
    val planQty: Double,
    val produced: Double,
    val qcApproved: Double,
    val shifted: Double,
    val floorBalance: Double,
    val pending: Double,
    val colours: List<ColourRow>,
    val recent: List<ShiftEntry>
)

/** One job's availability, colour-wise (GET /api/shifting/availability). */
data class Availability(
    val planId: String,
    val planCode: String,
    val machine: String,
    val status: String,
    val orderNo: String,
    val jcNo: String,
    val clientName: String,
    val itemName: String,
    val mouldName: String,
    val planQty: Double,
    val unitWeightKg: Double,
    val verificationEnforced: Boolean,
    val produced: Double,
    val verified: Double,
    val notVerified: Double,
    val shifted: Double,
    val ready: Double,
    val holdQty: Double,
    val holdCount: Int,
    val holdReasons: List<String>,
    val colours: List<AvailColour>
) {
    val maxShiftQty: Double get() = if (verificationEnforced) ready else (produced - shifted).coerceAtLeast(0.0)
}

data class AvailColour(
    val colour: String,
    val planQty: Double,
    val produced: Double,
    val verified: Double,
    val notVerified: Double,
    val shifted: Double,
    val ready: Double
)

data class ShiftEntry(
    val id: String,
    val machine: String,
    val itemName: String,
    val colour: String,
    val quantity: Double,
    val weightKg: Double,
    val toLocation: String,
    val shiftedBy: String,
    val createdAt: String,
    val labelNo: Int,
    val totalLabels: Int,
    val scanMode: String,
    val planId: String = "",
    val orderNo: String = "",
    val jcNo: String = "",
    val clientName: String = ""
)

data class ShiftSummary(
    val from: String,
    val to: String,
    val shift: String,
    val qty: Double,
    val kg: Double,
    val entries: Int,
    val labels: Int,
    val manual: Int,
    val byMachine: List<SummaryRow>,
    val bySupervisor: List<SummaryRow>,
    val byLocation: List<SummaryRow>
)

/** Shifting Supervisor + Incharge saved for one line in the current shift. */
data class LineTeam(
    val line: String,
    val supervisor: String,
    val incharge: String
) {
    val done: Boolean get() = supervisor.isNotBlank() && incharge.isNotBlank()
}

data class LineTeamStatus(
    val teams: List<LineTeam>,
    /** Lines still missing a team; the app stays locked until this is empty. */
    val required: List<String>
)

data class SummaryRow(
    val title: String,
    val subtitle: String,
    val qty: Double,
    val kg: Double,
    val count: Int
)
