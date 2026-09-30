package com.jmsocean.qc.ui.inspection

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
import java.io.File

/**
 * 2-hour QC inspection slots, same labels for Day (08:00 AM–08:00 PM) and
 * Night (08:00 PM–08:00 AM); the shift tells AM from PM. Function/Fitment is
 * done every 4h, on the first, third and fifth slot.
 */
val INSPECT_SLOTS = listOf("08-10", "10-12", "12-02", "02-04", "04-06", "06-08")
val FF_SLOTS = setOf("08-10", "12-02", "04-06")

/** Older app versions saved the slot as its start hour ("08", "14" …). */
private val LEGACY_SLOT = mapOf(
    "08" to "08-10", "10" to "10-12", "12" to "12-02", "14" to "02-04", "16" to "04-06", "18" to "06-08"
)

/** Minutes after shift start (08:00 / 20:00) at which each slot opens. */
private fun slotStartOffset(slot: String): Int = INSPECT_SLOTS.indexOf(slot) * 120

/**
 * Production date + shift for "now", same rule as supervisor.html: the shift
 * changes at 08:10 and 20:10 IST; before 08:10 is still yesterday's Night shift.
 */
fun autoDateShift(): Pair<String, String> {
    val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Kolkata"))
    val mins = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
    return when {
        mins in 490 until 1210 -> Ist.date() to "Day"
        mins < 490 -> Ist.yesterday() to "Night"
        else -> Ist.date() to "Night"
    }
}

/** Minutes since the start (08:00 / 20:00 IST) of [date]/[shift]; negative if it hasn't started. */
private fun minsIntoShift(date: String, shift: String): Long {
    val zone = java.util.TimeZone.getTimeZone("Asia/Kolkata")
    val fmt = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.US).apply { timeZone = zone }
    val start = fmt.parse("$date ${if (shift == "Night") "20:00" else "08:00"}") ?: return Long.MAX_VALUE
    return (System.currentTimeMillis() - start.time) / 60000
}

val QC_DEFECTS = listOf(
    "Short Moulding", "Oil Mark / White Mark", "Black Spot", "Overlapping",
    "Colour Shade", "Finishing", "Stability", "Parting Line / Shifting",
    "Flash / Burr", "Burn Mark", "Shrinkage", "Damage / Dent mark",
    "Pin Mark", "Dull Surface / Clarity", "Accessories Fitment", "Sticker",
    "Actual Product Weight", "Actual Cycle Time", "Cooling Time", "Other"
)

data class QcInspectUiState(
    val job: QueueJob? = null,
    val machine: String = "",
    val date: String = autoDateShift().first,
    val shift: String = autoDateShift().second,
    val slot: String = "",
    // slots already saved for this machine/date/shift — hidden from the dropdown
    val filledSlots: Set<String> = emptySet(),
    val slotsLoaded: Boolean = false,
    // colour — must be picked for every entry (never pre-selected)
    val colours: List<ColourLine> = emptyList(),
    val colour: String = "",
    val balances: List<ColourBalance> = emptyList(),
    // setup
    val stdWeight: String = "", val actWeight: String = "",
    val stdCT: String = "", val actCT: String = "",
    val stdCavity: String = "", val actCavity: String = "",
    val setupPeriod: String = "1st half",
    val savingSetup: Boolean = false,
    val setupMsg: String? = null,
    // checks
    val visualOk: Boolean? = null, val visualDefect: String = "", val visualRemarks: String = "",
    val colourOk: Boolean? = null, val colourDefect: String = "", val colourRemarks: String = "",
    val ffOk: Boolean? = null, val ffRemarks: String = "", val ffPhoto: File? = null,
    // shift team gate
    val teamChecked: Boolean = false,
    val teamOk: Boolean = false,
    val supName: String = "",
    val inchargeName: String = "",
    val savingTeam: Boolean = false,
    val teamError: String? = null,
    // status
    val submitting: Boolean = false,
    val error: String? = null,
    val message: String? = null
) {
    val ffApplies: Boolean get() = slot in FF_SLOTS
    val colourMissing: Boolean get() = colours.isNotEmpty() && colour.isBlank()
    val canSubmit: Boolean
        get() = !submitting && slot.isNotBlank() && !colourMissing &&
            (visualOk != null || colourOk != null || (ffApplies && ffOk != null))

    /** Today / Yesterday, like supervisor.html. */
    val dateOptions: List<Pair<String, String>>
        get() = listOf(Ist.date() to "Today", Ist.yesterday() to "Yesterday")

    /** Unfilled slots that have already opened (all of them for a past shift). */
    val openSlots: List<String>
        get() {
            val into = minsIntoShift(date, shift)
            return INSPECT_SLOTS.filter { it !in filledSlots && slotStartOffset(it) <= into }
        }
}

class QcInspectionViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(
        QcInspectUiState(
            job = repo.activeJob,
            machine = session.machine,
            colours = parseColourLines(repo.activeJob?.colourDetails)
        )
    )
    val state: StateFlow<QcInspectUiState> = _state.asStateFlow()

    init {
        loadBalances()
        loadSetup()
        loadShiftTeam()
        loadFilledSlots()
    }

    /** Reads the slots already saved for machine/date/shift and picks the latest open one. */
    private fun loadFilledSlots() {
        val s = _state.value
        if (s.machine.isBlank()) { _state.update { it.copy(slotsLoaded = true) }; return }
        _state.update { it.copy(slotsLoaded = false) }
        viewModelScope.launch {
            val filled = repo.onlineReport(s.machine, s.date, s.shift).getOrNull()?.data
                ?.map { LEGACY_SLOT[it.slot] ?: it.slot }?.toSet() ?: emptySet()
            _state.update { st ->
                if (st.date != s.date || st.shift != s.shift) return@update st
                val next = st.copy(filledSlots = filled, slotsLoaded = true)
                next.copy(slot = if (st.slot in next.openSlots) st.slot else next.openSlots.lastOrNull() ?: "")
            }
        }
    }

    fun setDate(v: String) {
        if (v == _state.value.date) return
        _state.update { it.copy(date = v, slot = "", teamChecked = false) }
        loadSetup(); loadShiftTeam(); loadFilledSlots()
    }

    private fun loadShiftTeam() {
        val s = _state.value
        if (s.machine.isBlank()) { _state.update { it.copy(teamChecked = true, teamOk = false) } ; return }
        viewModelScope.launch {
            repo.shiftTeam(s.machine, s.date, s.shift)
                .onSuccess { members ->
                    val hasSup = members.any { it.role?.contains("Supervisor", true) == true && !it.employee_name.isNullOrBlank() }
                    val hasInc = members.any { it.role?.contains("Incharge", true) == true && !it.employee_name.isNullOrBlank() }
                    _state.update { it.copy(teamChecked = true, teamOk = hasSup && hasInc) }
                }
                .onFailure { _state.update { it.copy(teamChecked = true, teamOk = false) } }
        }
    }

    fun setSupName(v: String) = _state.update { it.copy(supName = v) }
    fun setInchargeName(v: String) = _state.update { it.copy(inchargeName = v) }

    fun saveShiftTeam() {
        val s = _state.value
        if (s.supName.isBlank() || s.inchargeName.isBlank()) {
            _state.update { it.copy(teamError = "Enter both QC Supervisor and QC Incharge.") }; return
        }
        _state.update { it.copy(savingTeam = true, teamError = null) }
        viewModelScope.launch {
            val r1 = repo.addShiftTeam(s.machine, s.date, s.shift, "QC Supervisor", s.supName.trim())
            val r2 = repo.addShiftTeam(s.machine, s.date, s.shift, "QC Incharge", s.inchargeName.trim())
            if (r1.isSuccess && r2.isSuccess) {
                _state.update { it.copy(savingTeam = false, teamOk = true) }
            } else {
                _state.update { it.copy(savingTeam = false, teamError = "Could not save shift team. Check connection.") }
            }
        }
    }

    private fun loadBalances() {
        val planId = _state.value.job?.PlanID ?: return
        viewModelScope.launch {
            repo.colourBalance(planId).onSuccess { list -> _state.update { it.copy(balances = list) } }
        }
    }

    private fun loadSetup() {
        val job = _state.value.job ?: return
        val s = _state.value
        viewModelScope.launch {
            repo.jobSetup(job.JobCardNo ?: "", s.date, s.shift, s.machine, job.Mould ?: "")
                .onSuccess { r ->
                    _state.update {
                        it.copy(
                            stdWeight = r.std?.std_weight?.toString() ?: it.stdWeight,
                            stdCT = r.std?.std_cycle_time?.toString() ?: it.stdCT,
                            stdCavity = r.std?.std_cavity?.toString() ?: it.stdCavity,
                            actWeight = r.setup?.act_weight?.toString() ?: it.actWeight,
                            actCT = r.setup?.act_cycle_time?.toString() ?: it.actCT,
                            actCavity = r.setup?.act_cavity?.toString() ?: it.actCavity
                        )
                    }
                }
        }
    }

    fun setShift(v: String) {
        if (v == _state.value.shift) return
        _state.update { it.copy(shift = v, slot = "", teamChecked = false) }
        loadSetup(); loadShiftTeam(); loadFilledSlots()
    }
    fun setSlot(v: String) = _state.update { it.copy(slot = v) }
    fun setColour(v: String) = _state.update { it.copy(colour = v) }
    fun setActWeight(v: String) = _state.update { it.copy(actWeight = v) }
    fun setActCT(v: String) = _state.update { it.copy(actCT = v) }
    fun setActCavity(v: String) = _state.update { it.copy(actCavity = v.filter(Char::isDigit)) }
    fun setPeriod(v: String) = _state.update { it.copy(setupPeriod = v) }

    fun setVisualOk(v: Boolean) = _state.update { it.copy(visualOk = v) }
    fun setVisualDefect(v: String) = _state.update { it.copy(visualDefect = v) }
    fun setVisualRemarks(v: String) = _state.update { it.copy(visualRemarks = v) }
    fun setColourOk(v: Boolean) = _state.update { it.copy(colourOk = v) }
    fun setColourDefect(v: String) = _state.update { it.copy(colourDefect = v) }
    fun setColourRemarks(v: String) = _state.update { it.copy(colourRemarks = v) }
    fun setFfOk(v: Boolean) = _state.update { it.copy(ffOk = v) }
    fun setFfRemarks(v: String) = _state.update { it.copy(ffRemarks = v) }
    fun setFfPhoto(f: File) = _state.update { it.copy(ffPhoto = f) }

    fun saveSetup() {
        val job = _state.value.job ?: return
        val s = _state.value
        _state.update { it.copy(savingSetup = true, setupMsg = null, error = null) }
        viewModelScope.launch {
            repo.saveJobSetup(
                jobCardNo = job.JobCardNo ?: "", machine = s.machine, date = s.date, shift = s.shift,
                stdWeight = s.stdWeight.toDoubleOrNull(), actWeight = s.actWeight.toDoubleOrNull(),
                stdCT = s.stdCT.toDoubleOrNull(), actCT = s.actCT.toDoubleOrNull(),
                stdCavity = s.stdCavity.toIntOrNull(), actCavity = s.actCavity.toIntOrNull()
            ).onSuccess { _state.update { it.copy(savingSetup = false, setupMsg = "Setup saved (${s.setupPeriod}).") } }
                .onFailure { e -> _state.update { it.copy(savingSetup = false, error = e.message) } }
        }
    }

    fun submitCheck() {
        val job = _state.value.job ?: return
        val s = _state.value
        if (!s.canSubmit) {
            val why = when {
                s.slot.isBlank() -> "Select the hour slot."
                s.colourMissing -> "Select the colour."
                else -> "Fill at least one check."
            }
            _state.update { it.copy(error = why) }; return
        }
        _state.update { it.copy(submitting = true, error = null, message = null) }
        viewModelScope.launch {
            repo.submitSlotCheck(
                machine = s.machine, date = s.date, shift = s.shift, slot = s.slot, job = job,
                colour = s.colour.ifBlank { null },
                visualStatus = s.visualOk?.let { if (it) "OK" else "Not OK" },
                visualProblem = if (s.visualOk == false) s.visualDefect.ifBlank { null } else null,
                visualRemarks = if (s.visualOk == false) s.visualRemarks.ifBlank { null } else null,
                colourStatus = s.colourOk?.let { if (it) "OK" else "Not OK" },
                colourProblem = if (s.colourOk == false) s.colourDefect.ifBlank { null } else null,
                colourRemarks = if (s.colourOk == false) s.colourRemarks.ifBlank { null } else null,
                ffStatus = if (s.ffApplies) s.ffOk?.let { if (it) "OK" else "Not OK" } else null,
                ffProblem = if (s.ffApplies && s.ffOk == false) s.ffRemarks.ifBlank { null } else null,
                ffPhoto = if (s.ffApplies) s.ffPhoto else null
            ).onSuccess {
                _state.update {
                    it.copy(
                        submitting = false, message = "Slot ${s.slot} check saved.",
                        colour = "",
                        visualOk = null, visualDefect = "", visualRemarks = "",
                        colourOk = null, colourDefect = "", colourRemarks = "",
                        ffOk = null, ffRemarks = "", ffPhoto = null
                    )
                }
                loadFilledSlots()
            }.onFailure { e -> _state.update { it.copy(submitting = false, error = e.message ?: "Save failed") } }
        }
    }
}
