package com.jmsocean.qc.ui.qcentry

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.Ist
import com.jmsocean.qc.data.parseColourLines
import com.jmsocean.qc.data.remote.ColourBalance
import com.jmsocean.qc.data.remote.ColourLine
import com.jmsocean.qc.data.remote.QueueJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

val HOUR_SLOTS = listOf(
    "07-08", "08-09", "09-10", "10-11", "11-12", "12-01",
    "01-02", "02-03", "03-04", "04-05", "05-06", "06-07"
)

// Defect (reject) reasons — code + label, mirrors the web QC supervisor form.
val REJECT_REASONS = listOf(
    "A" to "Short Moulding", "B" to "Shrinkage Mark", "C" to "Silver Streak/Colour Variation/Trail",
    "D" to "Flow Mark/Weld Line", "E" to "Fitment Issue", "F" to "Dent Mark/Air Bubble", "G" to "Warpage",
    "H" to "Black/Water Marks", "I" to "Startup Pcs/Color Change Pcs", "J" to "Bottom bulging issue",
    "K" to "Scratch", "L" to "Over Lapping", "M" to "Punching Hole Issue"
)

// Downtime reasons — code + label, mirrors the web QC supervisor form.
val DOWNTIME_REASONS = listOf(
    "1" to "Manpower Shortage", "2" to "Mould Change Over", "3" to "Accessories Shortage",
    "4" to "Material Shortage", "5" to "M/C Under Maintenance (Water/Oil/Air Leakage)",
    "6" to "Nozzle Block/Change", "7" to "Mould Problem", "8" to "Power Failure/Pre Heating",
    "9" to "Color Change Time", "10" to "Process Setting", "11" to "Mould Trial", "12" to "Crane/Hrtc"
)

/** One reject row: a defect code (A–M) + quantity. */
data class RejectRow(val code: String = "", val qty: String = "")

/** One downtime row: a reason code (1–12) + minutes. */
data class DowntimeRow(val code: String = "", val min: String = "")

data class QcEntryUiState(
    val job: QueueJob? = null,
    val date: String = Ist.date(),
    val shift: String = Ist.shift(),
    val slot: String = HOUR_SLOTS.first(),
    val shots: String = "",
    val rejectRows: List<RejectRow> = emptyList(),
    val downtimeRows: List<DowntimeRow> = emptyList(),
    val colours: List<ColourLine> = emptyList(),
    val colour: String = "",
    val balances: List<ColourBalance> = emptyList(),
    val remarks: String = "",
    val checkingFpa: Boolean = true,
    val fpaDone: Boolean = false,
    val submitting: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    val submitted: Boolean = false
) {
    val totalReject: Int
        get() = rejectRows.sumOf { it.qty.toIntOrNull() ?: 0 }
    val totalDowntime: Int
        get() = downtimeRows.sumOf { it.min.toIntOrNull() ?: 0 }
    val goodQty: Int
        get() = ((shots.toIntOrNull() ?: 0) - totalReject).coerceAtLeast(0)
    val canSubmit: Boolean
        get() = fpaDone && !submitting && (shots.toIntOrNull() ?: -1) >= 0 && shots.isNotBlank()
}

class QcEntryViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(
        QcEntryUiState(
            job = repo.activeJob,
            colours = parseColourLines(repo.activeJob?.colourDetails),
            colour = parseColourLines(repo.activeJob?.colourDetails).firstOrNull()?.colour ?: ""
        )
    )
    val state: StateFlow<QcEntryUiState> = _state.asStateFlow()

    init {
        checkFpa()
        loadBalances()
    }

    private fun loadBalances() {
        val planId = _state.value.job?.PlanID ?: return
        // Real colour names live on the job (ColourDetails → colourName); the LOCAL
        // backend may return "(none)". Fill names in by position so the table reads right.
        val localNames = parseColourLines(_state.value.job?.colourDetails).map { it.colour }
        viewModelScope.launch {
            repo.colourBalance(planId).onSuccess { list ->
                val named = list.mapIndexed { i, b ->
                    if (b.colour.isBlank() || b.colour.equals("(none)", ignoreCase = true)) {
                        b.copy(colour = localNames.getOrNull(i) ?: b.colour)
                    } else b
                }
                _state.update { it.copy(balances = named) }
            }
        }
    }

    /** Re-pull balances after a successful save so produced/pending update live. */
    private fun refreshBalances() = loadBalances()

    private fun checkFpa() {
        val job = _state.value.job
        if (job == null || (job.PlanID.isNullOrBlank() && job.JobCardNo.isNullOrBlank())) {
            _state.update { it.copy(checkingFpa = false, error = "No active job.") }
            return
        }
        viewModelScope.launch {
            repo.fpaStatus(job.PlanID ?: "", job.JobCardNo ?: "")
                .onSuccess { done -> _state.update { it.copy(checkingFpa = false, fpaDone = done) } }
                .onFailure { _state.update { it.copy(checkingFpa = false, fpaDone = false) } }
        }
    }

    fun setShift(v: String) = _state.update { it.copy(shift = v) }
    fun setSlot(v: String) = _state.update { it.copy(slot = v) }
    fun setShots(v: String) = _state.update { it.copy(shots = v.filter(Char::isDigit), error = null) }
    fun setColour(v: String) = _state.update { it.copy(colour = v) }
    fun setRemarks(v: String) = _state.update { it.copy(remarks = v) }

    // ── Reject-reason rows ──────────────────────────────────────────────────
    fun addRejectRow() = _state.update { it.copy(rejectRows = it.rejectRows + RejectRow(), error = null) }
    fun removeRejectRow(i: Int) = _state.update {
        it.copy(rejectRows = it.rejectRows.filterIndexed { idx, _ -> idx != i })
    }
    fun setRejectCode(i: Int, code: String) = _state.update {
        it.copy(rejectRows = it.rejectRows.mapIndexed { idx, r -> if (idx == i) r.copy(code = code) else r })
    }
    fun setRejectQty(i: Int, qty: String) = _state.update {
        it.copy(rejectRows = it.rejectRows.mapIndexed { idx, r -> if (idx == i) r.copy(qty = qty.filter(Char::isDigit)) else r }, error = null)
    }

    // ── Downtime-reason rows ────────────────────────────────────────────────
    fun addDowntimeRow() = _state.update { it.copy(downtimeRows = it.downtimeRows + DowntimeRow()) }
    fun removeDowntimeRow(i: Int) = _state.update {
        it.copy(downtimeRows = it.downtimeRows.filterIndexed { idx, _ -> idx != i })
    }
    fun setDowntimeCode(i: Int, code: String) = _state.update {
        it.copy(downtimeRows = it.downtimeRows.mapIndexed { idx, r -> if (idx == i) r.copy(code = code) else r })
    }
    fun setDowntimeMin(i: Int, min: String) = _state.update {
        it.copy(downtimeRows = it.downtimeRows.mapIndexed { idx, r -> if (idx == i) r.copy(min = min.filter(Char::isDigit)) else r })
    }

    fun submit() {
        val s = _state.value
        val job = s.job ?: return
        if (!s.canSubmit) {
            _state.update { it.copy(error = if (!s.fpaDone) "Do FPA first." else "Enter shots.") }
            return
        }
        // Build breakup strings "code:qty|code:qty" (only rows with a code + positive value).
        val rejectBreakup = s.rejectRows
            .filter { it.code.isNotBlank() && (it.qty.toIntOrNull() ?: 0) > 0 }
            .joinToString("|") { "${it.code}:${it.qty.toInt()}" }
        val downtimeBreakup = s.downtimeRows
            .filter { it.code.isNotBlank() && (it.min.toIntOrNull() ?: 0) > 0 }
            .joinToString("|") { "${it.code}:${it.min.toInt()}" }

        _state.update { it.copy(submitting = true, error = null, message = null) }
        viewModelScope.launch {
            repo.submitDpr(
                job = job, date = s.date, shift = s.shift, hourSlot = s.slot,
                shots = s.shots.toIntOrNull() ?: 0,
                rejectQty = s.totalReject,
                downtimeMin = s.totalDowntime,
                colour = s.colour, remarks = s.remarks,
                rejectBreakup = rejectBreakup,
                downtimeBreakup = downtimeBreakup
            ).onSuccess {
                _state.update {
                    it.copy(
                        submitting = false, submitted = true,
                        message = "Saved slot ${s.slot}.",
                        shots = "", rejectRows = emptyList(), downtimeRows = emptyList(), remarks = ""
                    )
                }
                refreshBalances()
            }.onFailure { e ->
                _state.update { it.copy(submitting = false, error = e.message ?: "Save failed") }
            }
        }
    }
}
