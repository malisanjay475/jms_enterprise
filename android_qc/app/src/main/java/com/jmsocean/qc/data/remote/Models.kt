package com.jmsocean.qc.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * The JMS API wraps every response as { ok, error?, data }.
 * `data` shape varies per endpoint, so it is kept as a raw JsonElement
 * and parsed by the repository. ignoreUnknownKeys is on globally.
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
    val requested_app: String = "qc_supervisor_app",
    val geo_lat: Double? = null,
    val geo_lng: Double? = null,
    val geo_acc: Double? = null
)

/** Parsed from login's `data` object. */
@Serializable
data class SessionData(
    val username: String = "",
    val line: String = ""
)

/** A queue row — field names mirror the /api/queue response exactly. */
@Serializable
data class QueueJob(
    @SerialName("PlanID") val PlanID: String? = null,
    @SerialName("JobCardNo") val JobCardNo: String? = null,
    @SerialName("OrderNo") val OrderNo: String? = null,
    @SerialName("Machine") val Machine: String? = null,
    @SerialName("Mould") val Mould: String? = null,
    @SerialName("Mould No") val mouldNo: String? = null,
    @SerialName("machinePriority") val machinePriority: String? = null,
    @SerialName("Client Name") val clientName: String? = null,
    @SerialName("product_name") val product_name: String? = null,
    @SerialName("SFG Name") val sfgName: String? = null,
    @SerialName("PlanQty") val planQty: Int? = null,
    @SerialName("Status") val Status: String? = null,
    @SerialName("ColourDetails") val colourDetails: JsonElement? = null,
    val fpa_status: String? = null
) {
    val productName: String
        get() = product_name ?: sfgName ?: "Job"

    val orderNumber: String
        get() = OrderNo ?: ""

    val mouldForEntry: String
        get() = mouldNo ?: Mould ?: ""
}

/** One colour line from a job's ColourDetails: name + planned qty. */
data class ColourLine(val colour: String, val planQty: Int)

/** Per-colour produced/pending from GET /api/qc/colour-balance. */
@Serializable
data class ColourBalance(
    val colour: String = "",
    val planQty: Int = 0,
    val produced: Int = 0,
    val balance: Int = 0
)

/** One saved 2-hour QC slot from GET /api/qc/online-report (qc_online_report_slots). */
@Serializable
data class OnlineSlot(
    val slot: String = "",
    val visual_status: String? = null,
    val visual_problem: String? = null,
    val visual_remarks: String? = null,
    val colour_status: String? = null,
    val colour_problem: String? = null,
    val colour_remarks: String? = null,
    val ff_status: String? = null,
    val ff_problem: String? = null,
    val ff_photo_url: String? = null,
    val entered_by: String? = null
)

/** Active-job context returned alongside the online-report slots. */
@Serializable
data class OnlineJob(
    val job_card_no: String? = null,
    val order_no: String? = null,
    val item_name: String? = null,
    val mould_name: String? = null
)

/** GET /api/qc/online-report response — { ok, data:[slots], job }. */
@Serializable
data class OnlineReportResponse(
    val ok: Boolean = false,
    val error: String? = null,
    val data: List<OnlineSlot> = emptyList(),
    val job: OnlineJob? = null
)

// Compliance grid (parsed from GET /api/qc/compliance) — plain holders.
data class ComplianceGrid(val slots: List<String>, val lines: List<ComplianceLine>)
data class ComplianceLine(val name: String, val rows: List<ComplianceRow>)
data class ComplianceRow(
    val machine: String,
    val cells: Map<String, String>,
    val qcSupervisor: String = "",
    val qcIncharge: String = ""
)

// ── QC summary matrix (GET /api/qc/summary-matrix) — same data as the web
//    DPR Compliance Summary with Process = QC.
@Serializable
data class QcmMachine(val machine: String = "", val line: String = "")

@Serializable
data class QcmSlot(
    val machine: String = "", val date: String = "", val shift: String = "", val slot: String = "",
    val job_card_no: String? = null, val order_no: String? = null, val item_name: String? = null,
    val mould_name: String? = null, val colour: String? = null,
    val visual_status: String? = null, val visual_problem: String? = null, val visual_remarks: String? = null,
    val colour_status: String? = null, val colour_problem: String? = null, val colour_remarks: String? = null,
    val ff_status: String? = null, val ff_problem: String? = null,
    val entered_by: String? = null, val entered_at: String? = null
)

@Serializable
data class QcmSetup(val machine: String = "", val date: String = "", val shift: String = "", val setup_period: Int = 1)

@Serializable
data class QcmFpa(val machine: String = "", val date: String = "", val shift: String = "", val fpa_approval_status: String = "Pending")

@Serializable
data class QcmHold(val machine: String = "", val status: String? = null)

@Serializable
data class QcmPlan(val machine: String = "", val order_no: String? = null, val item_name: String? = null, val mould_name: String? = null)

@Serializable
data class QcmTeam(
    val line: String = "", val date: String = "", val shift: String = "",
    val qc_supervisor: String? = null, val qc_incharge: String? = null, val saved_by: String? = null
)

@Serializable
data class QcmMachineTeam(
    val machine: String = "", val date: String = "", val shift: String = "",
    val role: String? = null, val employee_name: String? = null
)

@Serializable
data class QcMatrix(
    val slotLabels: List<String> = emptyList(),
    val machines: List<QcmMachine> = emptyList(),
    val slots: List<QcmSlot> = emptyList(),
    val setups: List<QcmSetup> = emptyList(),
    val fpa: List<QcmFpa> = emptyList(),
    val holds: List<QcmHold> = emptyList(),
    val plans: List<QcmPlan> = emptyList(),
    val teams: List<QcmTeam> = emptyList(),
    val machineTeams: List<QcmMachineTeam> = emptyList()
)

@Serializable
data class QcMatrixResponse(val ok: Boolean = false, val error: String? = null, val data: QcMatrix? = null)

// ── QC line team (per line + date + shift, like Moulding shift teams) ──
@Serializable
data class LineTeam(
    val line: String = "",
    val qc_supervisor: String = "",
    val qc_incharge: String = "",
    val saved_by: String = "",
    val saved_at: String? = null
)

@Serializable
data class LineTeamResponse(
    val ok: Boolean = false,
    val error: String? = null,
    val data: List<LineTeam> = emptyList(),
    val required: List<String> = emptyList(),
    val all_access: Boolean = false
)

@Serializable
data class LineTeamSaveRequest(
    val session: SessionRef,
    val line: String,
    val dpr_date: String,
    val shift: String,
    val qc_supervisor: String,
    val qc_incharge: String
)

// ── QC shift team ───────────────────────────────────────────────────────────
@Serializable
data class ShiftTeamMember(
    val role: String? = null,
    val employee_name: String? = null
)

@Serializable
data class ShiftTeamAddRequest(
    val session: SessionRef,
    val machine: String,
    val dpr_date: String,
    val shift: String,
    val role: String,
    val employee_name: String
)

// ── QC job setup (STD vs Actual) ────────────────────────────────────────────
@Serializable
data class StdValues(
    val std_weight: Double? = null,
    val std_cycle_time: Double? = null,
    val std_cavity: Int? = null
)

@Serializable
data class JobSetupRow(
    val act_weight: Double? = null,
    val act_cycle_time: Double? = null,
    val act_cavity: Int? = null
)

@Serializable
data class JobSetupResponse(
    val ok: Boolean = false,
    val error: String? = null,
    val std: StdValues? = null,
    val setup: JobSetupRow? = null,
    /** Saved setup per half: "1" = 1st half (shift start), "2" = 2nd half (mid-shift). */
    val setups: Map<String, JobSetupRow?>? = null
)

@Serializable
data class JobSetupSaveRequest(
    val session: SessionRef,
    val job_card_no: String,
    val machine: String,
    val dpr_date: String,
    val shift: String,
    val std_weight: Double? = null,
    val act_weight: Double? = null,
    val std_cycle_time: Double? = null,
    val act_cycle_time: Double? = null,
    val std_cavity: Int? = null,
    val act_cavity: Int? = null,
    /** 1 = 1st half (shift start), 2 = 2nd half (mid-shift). Without it the server saves 1st half. */
    val setup_period: Int = 1
)

/** A recent QC online-report slot check — GET /api/qc/recent-slots. */
@Serializable
data class RecentSlot(
    val slot: String = "",
    val dpr_date: String? = null,
    val shift: String? = null,
    val mould_name: String? = null,
    val item_name: String? = null,
    val visual_status: String? = null,
    val visual_problem: String? = null,
    val visual_remarks: String? = null,
    val colour_status: String? = null,
    val colour_problem: String? = null,
    val colour_remarks: String? = null,
    val ff_status: String? = null,
    val ff_problem: String? = null,
    val ff_photo_url: String? = null,
    val entered_by: String? = null,
    val entered_at: String? = null
)

/** Response of GET /api/qc/fpa/status. */
@Serializable
data class FpaStatus(
    val ok: Boolean = false,
    val done: Boolean = false,          // true only when the FPA is APPROVED
    val submitted: Boolean = false,     // an FPA exists (Pending / Approved / Rejected)
    val approval_status: String? = null, // "Pending" | "Approved" | "Rejected"
    val reject_reason: String? = null,
    val reviewed_by: String? = null,
    /** Machine the job (and this FPA) was moved from; it needs approval again here. */
    val transferred_from: String? = null,
    val error: String? = null,
    val done_by: String? = null,
    val done_at: String? = null,
    val date: String? = null,
    val shift: String? = null,
    val form_url: String? = null,
    val product_images: JsonElement? = null
)

/** A row from GET /api/qc/material-issues (qc_material_issues), tolerant of nulls. */
@Serializable
data class MaterialIssue(
    val id: Int? = null,
    val machine: String? = null,
    val job_card_no: String? = null,
    val issue_description: String? = null,
    val severity: String? = null,
    val status: String? = null,
    val assigned_to_role: String? = null,
    val assigned_to_name: String? = null,
    val created_by: String? = null,
    val created_at: String? = null,
    val media_url: String? = null
)

/** A Moulding person for the memo @mention picker (GET /api/qc/factory-people). */
@Serializable
data class FactoryPerson(
    val username: String = "",
    val role_code: String = "",
    val name: String = ""
)

/** Parsed KPI tile values from GET /api/qc/dashboard/kpis (data object). */
data class Kpis(
    val production: Int = 0,
    val accepted: Int = 0,
    val rejected: Int = 0,
    val rejectionRate: String = "0",
    val activeIssues: Int = 0,
    val fpaDone: Int = 0,
    val activeHolds: Int = 0,
    val heldMachines: Int = 0
)

// ── Verify + Hold (Phase 3) ─────────────────────────────────────────────────

@Serializable
data class SessionRef(val username: String, val line: String)

/** A slot row from GET /api/qc/verify/pending — field names match the JSON. */
@Serializable
data class VerifySlot(
    val dpr_entry_id: Int? = null,
    val hour_slot: String = "",
    val colour: String? = null,
    val entry_type: String? = null,
    /** How many DPR entries this hour has (2 = main + colour change), and this one's order. */
    val entries_in_hour: Int = 1,
    val entry_no: Int = 1,
    val qc_verified: Boolean = false,
    val verify_status: String? = null,
    val sup_good_qty: Int? = null,
    val sup_reject_qty: Int? = null,
    val qc_good_qty: Int? = null,
    val qc_reject_qty: Int? = null,
    val verified_by: String? = null,
    val verified_at: String? = null,
    val job_card_no: String? = null,
    /** Active QC hold on this entry (or its whole hour). */
    val qc_hold: Boolean = false,
    val qc_hold_reason: String? = null
)

@Serializable
data class VerifySubmitRequest(
    val session: SessionRef,
    val machine: String,
    val dpr_date: String,
    val shift: String,
    val hour_slot: String,
    val qc_good_qty: Int,
    val qc_reject_qty: Int,
    val remarks: String = "",
    val status_override: String? = null,
    /** Which entry of the hour; null = the hour's latest entry (old behaviour). */
    val dpr_entry_id: Int? = null
)

/** One entry inside a "Verify both" call. */
@Serializable
data class VerifyBatchItem(
    val machine: String,
    val dpr_date: String,
    val shift: String,
    val hour_slot: String,
    val dpr_entry_id: Int?,
    val qc_good_qty: Int,
    val qc_reject_qty: Int,
    val remarks: String = ""
)

@Serializable
data class VerifyBatchRequest(
    val session: SessionRef,
    val items: List<VerifyBatchItem>
)

// ── QC hourly filling (DPR submit) ──────────────────────────────────────────

@Serializable
data class DprEntry(
    @SerialName("Date") val date: String,
    @SerialName("Shift") val shift: String,
    @SerialName("HourSlot") val hourSlot: String,
    @SerialName("Shots") val shots: Int,
    @SerialName("GoodQty") val goodQty: Int,
    @SerialName("RejectQty") val rejectQty: Int,
    @SerialName("DowntimeMin") val downtimeMin: Int,
    @SerialName("Remarks") val remarks: String,
    @SerialName("PlanID") val planId: String,
    @SerialName("Machine") val machine: String,
    @SerialName("OrderNo") val orderNo: String,
    @SerialName("MouldNo") val mouldNo: String,
    @SerialName("JobCardNo") val jobCardNo: String,
    @SerialName("Colour") val colour: String,
    @SerialName("RejectBreakup") val rejectBreakup: String = "",
    @SerialName("DowntimeBreakup") val downtimeBreakup: String = "",
    @SerialName("EntryType") val entryType: String = "Main"
)

@Serializable
data class DprSubmitRequest(
    val session: SessionRef,
    val entry: DprEntry
)

@Serializable
data class HoldRequest(
    val session: SessionRef,
    val machine: String,
    val dpr_date: String,
    val shift: String,
    val slot: String,
    val job_card_no: String = "",
    val qty_on_hold: Int? = null,
    val reason: String,
    val remarks: String = "",
    val dpr_entry_id: Int? = null
)

/** The self-update feed hosted on the LOCAL server: /qc-app/version.json */
@Serializable
data class AppVersion(
    val versionCode: Int = 0,
    val versionName: String = "",
    val apk: String = "",          // filename under /qc-app/, e.g. "jms-qc.apk"
    val notes: String? = null
)
