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

data class QcEntryUiState(
    val job: QueueJob? = null,
    val date: String = Ist.date(),
    val shift: String = Ist.shift(),
    val slot: String = HOUR_SLOTS.first(),
    val shots: String = "",
    val reject: String = "",
    val downtime: String = "",
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
    val goodQty: Int
        get() {
            val s = shots.toIntOrNull() ?: 0
            val r = reject.toIntOrNull() ?: 0
            return (s - r).coerceAtLeast(0)
        }
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
        viewModelScope.launch {
            repo.colourBalance(planId).onSuccess { list ->
                _state.update { it.copy(balances = list) }
            }
        }
    }

    /** Re-pull balances after a successful save so produced/pending update live. */
    private fun refreshBalances() = loadBalances()

    private fun checkFpa() {
        val job = _state.value.job
        if (job?.JobCardNo.isNullOrBlank()) {
            _state.update { it.copy(checkingFpa = false, error = "No active job.") }
            return
        }
        viewModelScope.launch {
            repo.fpaStatus(job!!.JobCardNo!!, session.machine)
                .onSuccess { done -> _state.update { it.copy(checkingFpa = false, fpaDone = done) } }
                .onFailure { _state.update { it.copy(checkingFpa = false, fpaDone = false) } }
        }
    }

    fun setShift(v: String) = _state.update { it.copy(shift = v) }
    fun setSlot(v: String) = _state.update { it.copy(slot = v) }
    fun setShots(v: String) = _state.update { it.copy(shots = v.filter(Char::isDigit), error = null) }
    fun setReject(v: String) = _state.update { it.copy(reject = v.filter(Char::isDigit), error = null) }
    fun setDowntime(v: String) = _state.update { it.copy(downtime = v.filter(Char::isDigit)) }
    fun setColour(v: String) = _state.update { it.copy(colour = v) }
    fun setRemarks(v: String) = _state.update { it.copy(remarks = v) }

    fun submit() {
        val s = _state.value
        val job = s.job ?: return
        if (!s.canSubmit) {
            _state.update { it.copy(error = if (!s.fpaDone) "Do FPA first." else "Enter shots.") }
            return
        }
        _state.update { it.copy(submitting = true, error = null, message = null) }
        viewModelScope.launch {
            repo.submitDpr(
                job = job, date = s.date, shift = s.shift, hourSlot = s.slot,
                shots = s.shots.toIntOrNull() ?: 0,
                reject = s.reject.toIntOrNull() ?: 0,
                downtimeMin = s.downtime.toIntOrNull() ?: 0,
                colour = s.colour, remarks = s.remarks
            ).onSuccess {
                _state.update {
                    it.copy(
                        submitting = false, submitted = true,
                        message = "Saved slot ${s.slot}.",
                        shots = "", reject = "", downtime = "", remarks = ""
                    )
                }
                refreshBalances()
            }.onFailure { e ->
                _state.update { it.copy(submitting = false, error = e.message ?: "Save failed") }
            }
        }
    }
}
