package com.jmsocean.qc.ui.verify

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.Ist
import com.jmsocean.qc.data.remote.QueueJob
import com.jmsocean.qc.data.remote.VerifySlot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class VerifyUiState(
    val machine: String = "",
    val machines: List<String> = emptyList(),
    val jobContext: QueueJob? = null,
    val date: String = Ist.date(),
    val shift: String = Ist.shift(),
    val slots: List<VerifySlot> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val busySlot: String? = null,   // hour_slot currently submitting
    val message: String? = null
) {
    val pendingCount: Int get() = slots.count { !it.qc_verified }
}

class VerifyViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(VerifyUiState(machine = session.machine))
    val state: StateFlow<VerifyUiState> = _state.asStateFlow()

    init {
        loadMachines()
        loadContext()
        load()
    }

    private fun loadMachines() {
        viewModelScope.launch {
            repo.machines().onSuccess { list -> _state.update { it.copy(machines = list) } }
        }
    }

    private fun loadContext() {
        val m = _state.value.machine
        if (m.isBlank()) return
        viewModelScope.launch {
            repo.queue(m).onSuccess { jobs ->
                _state.update { it.copy(jobContext = jobs.firstOrNull()) }
            }
        }
    }

    fun selectMachine(m: String) {
        session.machine = m
        _state.update { it.copy(machine = m) }
        loadContext()
        load()
    }

    fun setShift(shift: String) {
        _state.update { it.copy(shift = shift) }
        load()
    }

    fun load() {
        val s = _state.value
        if (s.machine.isBlank()) {
            _state.update { it.copy(error = "Pick a machine on the Queue screen first.") }
            return
        }
        _state.update { it.copy(loading = true, error = null, message = null) }
        viewModelScope.launch {
            repo.verifyPending(s.machine, s.date, s.shift)
                .onSuccess { list -> _state.update { it.copy(loading = false, slots = list) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun submit(slot: VerifySlot, good: Int, reject: Int, remarks: String) {
        val s = _state.value
        _state.update { it.copy(busySlot = slot.hour_slot, error = null, message = null) }
        viewModelScope.launch {
            repo.verifySubmit(s.machine, s.date, s.shift, slot.hour_slot, good, reject, remarks)
                .onSuccess {
                    _state.update { it.copy(busySlot = null, message = "Slot ${slot.hour_slot} verified.") }
                    load()
                }
                .onFailure { e -> _state.update { it.copy(busySlot = null, error = e.message) } }
        }
    }

    fun submitDeviation(slot: VerifySlot, good: Int, reject: Int, desc: String, remarks: String) {
        val s = _state.value
        _state.update { it.copy(busySlot = slot.hour_slot, error = null, message = null) }
        val note = "DEVIATION: $desc" + (if (remarks.isNotBlank()) " | $remarks" else "")
        viewModelScope.launch {
            repo.verifySubmit(
                s.machine, s.date, s.shift, slot.hour_slot, good, reject, note,
                statusOverride = "Deviation"
            ).onSuccess {
                _state.update { it.copy(busySlot = null, message = "Deviation recorded for ${slot.hour_slot}.") }
                load()
            }.onFailure { e -> _state.update { it.copy(busySlot = null, error = e.message) } }
        }
    }

    fun placeHold(slot: VerifySlot, reason: String, qty: Int?, remarks: String) {
        val s = _state.value
        _state.update { it.copy(busySlot = slot.hour_slot, error = null, message = null) }
        viewModelScope.launch {
            repo.placeHold(
                machine = s.machine, date = s.date, shift = s.shift,
                slot = slot.hour_slot, jobCardNo = slot.job_card_no ?: "",
                qtyOnHold = qty, reason = reason, remarks = remarks
            ).onSuccess {
                _state.update { it.copy(busySlot = null, message = "HOLD placed on ${slot.hour_slot}. Scanning blocked.") }
                load()
            }.onFailure { e -> _state.update { it.copy(busySlot = null, error = e.message) } }
        }
    }
}
