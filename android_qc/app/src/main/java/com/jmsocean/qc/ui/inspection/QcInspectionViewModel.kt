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

/** 2-hourly QC inspection checkpoints. Function/Fitment is done on the 4-hourly ones. */
val INSPECT_SLOTS = listOf("08", "10", "12", "14", "16", "18")
val FF_SLOTS = setOf("08", "12", "16")

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
    val date: String = Ist.date(),
    val shift: String = Ist.shift(),
    val slot: String = currentSlot(),
    // colour
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
    val savingTeam: Boolean = false,
    val teamError: String? = null,
    // status
    val submitting: Boolean = false,
    val error: String? = null,
    val message: String? = null
) {
    val ffApplies: Boolean get() = slot in FF_SLOTS
    val canSubmit: Boolean get() = !submitting && (visualOk != null || colourOk != null || (ffApplies && ffOk != null))
}

private fun currentSlot(): String {
    val h = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Kolkata"))
        .get(java.util.Calendar.HOUR_OF_DAY)
    return INSPECT_SLOTS.lastOrNull { it.toInt() <= h } ?: INSPECT_SLOTS.first()
}

class QcInspectionViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(
        QcInspectUiState(
            job = repo.activeJob,
            machine = session.machine,
            colours = parseColourLines(repo.activeJob?.colourDetails),
            colour = parseColourLines(repo.activeJob?.colourDetails).firstOrNull()?.colour ?: ""
        )
    )
    val state: StateFlow<QcInspectUiState> = _state.asStateFlow()

    init {
        loadBalances()
        loadSetup()
        loadShiftTeam()
    }

    private fun loadShiftTeam() {
        val s = _state.value
        if (s.machine.isBlank()) { _state.update { it.copy(teamChecked = true, teamOk = false) } ; return }
        viewModelScope.launch {
            repo.shiftTeam(s.machine, s.date, s.shift)
                .onSuccess { members ->
                    // One QC supervisor per shift (machine + date + shift). If it's already
                    // recorded, pull the name so it stays visible on the setup card.
                    val sup = members.firstOrNull {
                        it.role?.contains("Supervisor", true) == true && !it.employee_name.isNullOrBlank()
                    }
                    _state.update {
                        it.copy(
                            teamChecked = true,
                            teamOk = sup != null,
                            supName = sup?.employee_name?.trim() ?: it.supName
                        )
                    }
                }
                .onFailure { _state.update { it.copy(teamChecked = true, teamOk = false) } }
        }
    }

    fun setSupName(v: String) = _state.update { it.copy(supName = v) }

    fun saveShiftTeam() {
        val s = _state.value
        if (s.supName.isBlank()) {
            _state.update { it.copy(teamError = "Enter the QC Supervisor name for this shift.") }; return
        }
        _state.update { it.copy(savingTeam = true, teamError = null) }
        viewModelScope.launch {
            repo.addShiftTeam(s.machine, s.date, s.shift, "QC Supervisor", s.supName.trim())
                .onSuccess { _state.update { it.copy(savingTeam = false, teamOk = true) } }
                .onFailure { _state.update { it.copy(savingTeam = false, teamError = "Could not save. Check connection.") } }
        }
    }

    /** Re-open the shift-team card to change the QC supervisor for this shift. */
    fun editShiftSupervisor() = _state.update { it.copy(teamOk = false) }

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

    fun setShift(v: String) { _state.update { it.copy(shift = v) }; loadSetup() }
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
        if (!s.canSubmit) { _state.update { it.copy(error = "Fill at least one check.") }; return }
        _state.update { it.copy(submitting = true, error = null, message = null) }
        viewModelScope.launch {
            repo.submitSlotCheck(
                machine = s.machine, date = s.date, shift = s.shift, slot = s.slot, job = job,
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
                        visualOk = null, visualDefect = "", visualRemarks = "",
                        colourOk = null, colourDefect = "", colourRemarks = "",
                        ffOk = null, ffRemarks = "", ffPhoto = null
                    )
                }
            }.onFailure { e -> _state.update { it.copy(submitting = false, error = e.message ?: "Save failed") } }
        }
    }
}
