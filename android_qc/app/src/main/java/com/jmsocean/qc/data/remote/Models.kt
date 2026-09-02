package com.jmsocean.qc.data.remote

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

/** A queue row, tolerant of the API's mixed field names. */
@Serializable
data class QueueJob(
    val PlanID: String? = null,
    val JobCardNo: String? = null,
    val Mould: String? = null,
    val machine_priority: String? = null,
    val fpa_status: String? = null,
    // common alternates the API may use for the product name
    val item_name: String? = null,
    val ItemName: String? = null,
    val SFG_Name: String? = null,
    // order number, again under a few possible keys
    val OrderNo: String? = null,
    val order_no: String? = null
) {
    val productName: String
        get() = item_name ?: ItemName ?: SFG_Name ?: "Job"

    val orderNumber: String
        get() = OrderNo ?: order_no ?: ""
}

/** Response of GET /api/qc/fpa/status. */
@Serializable
data class FpaStatus(
    val ok: Boolean = false,
    val done: Boolean = false,
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
    val hour_slot: String = "",
    val qc_verified: Boolean = false,
    val verify_status: String? = null,
    val sup_good_qty: Int? = null,
    val sup_reject_qty: Int? = null,
    val qc_good_qty: Int? = null,
    val qc_reject_qty: Int? = null,
    val verified_by: String? = null,
    val verified_at: String? = null,
    val job_card_no: String? = null
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
    val status_override: String? = null
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
    val remarks: String = ""
)

/** The self-update feed hosted on the LOCAL server: /qc-app/version.json */
@Serializable
data class AppVersion(
    val versionCode: Int = 0,
    val versionName: String = "",
    val apk: String = "",          // filename under /qc-app/, e.g. "jms-qc.apk"
    val notes: String? = null
)
