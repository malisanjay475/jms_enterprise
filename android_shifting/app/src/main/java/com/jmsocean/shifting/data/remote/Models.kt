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
    val data: JsonElement? = null
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
    val machine: String? = null
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
    val alreadyShifted: Boolean,
    val qcHold: QcHold?,
    val qcHoldMessage: String,
    val colours: List<ColourRow>
) {
    val blocked: Boolean get() = alreadyShifted || qcHold != null
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
    val labelledQty: Double
) {
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
    val scanMode: String
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

data class SummaryRow(
    val title: String,
    val subtitle: String,
    val qty: Double,
    val kg: Double,
    val count: Int
)
