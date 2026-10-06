package com.jmsocean.qc.ui.verify

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.Ist
import com.jmsocean.qc.data.remote.ColourBalance
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
    val jobs: List<QueueJob> = emptyList(),
    val selectedJob: QueueJob? = null,
    val runningBalances: List<ColourBalance> = emptyList(),
    val date: String = Ist.productionDate(),
    val shift: String = Ist.productionShift(),
    val slots: List<VerifySlot> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val busySlot: String? = null,   // entry key (see entryKey) currently submitting
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
        // Wi-Fi back after a drop: reload whatever failed.
        com.jmsocean.qc.data.NetworkWatcher.onNetworkBack(viewModelScope) {
            val s = _state.value
            if (s.machines.isEmpty()) loadMachines()
            if (s.error != null || s.jobs.isEmpty()) loadContext()
            if (s.error != null && !s.loading) load()
        }
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
                val running = jobs.firstOrNull { it.Status.equals("RUNNING", ignoreCase = true) }
                    ?: jobs.firstOrNull()
                _state.update { it.copy(jobs = jobs, jobContext = running, selectedJob = running, runningBalances = emptyList()) }
                running?.PlanID?.let { pid ->
                    repo.colourBalance(pid).onSuccess { b -> _state.update { it.copy(runningBalances = b) } }
                }
            }
        }
    }

    fun selectMachine(m: String) {
        session.machine = m
        _state.update { it.copy(machine = m) }
        loadContext()
        load()
    }

    fun selectJob(job: QueueJob) {
        _state.update { it.copy(selectedJob = job, runningBalances = emptyList()) }
        job.PlanID?.let { pid ->
            viewModelScope.launch {
                repo.colourBalance(pid).onSuccess { b -> _state.update { it.copy(runningBalances = b) } }
            }
        }
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
        _state.update { it.copy(busySlot = entryKey(slot), error = null, message = null) }
        viewModelScope.launch {
            repo.verifySubmit(s.machine, s.date, s.shift, slot.hour_slot, good, reject, remarks,
                dprEntryId = slot.dpr_entry_id)
                .onSuccess {
                    _state.update { it.copy(busySlot = null, message = "${entryLabel(slot)} ${slot.hour_slot} verified.") }
                    load()
                }
                .onFailure { e -> _state.update { it.copy(busySlot = null, error = e.message) } }
        }
    }

    /** Verify every not-yet-verified entry of an hour with the supervisor's figures. */
    fun submitAll(entries: List<VerifySlot>) {
        val s = _state.value
        val todo = entries.filter { !it.qc_verified }
        if (todo.isEmpty()) return
        val hour = todo.first().hour_slot
        _state.update { it.copy(busySlot = hourKey(hour), error = null, message = null) }
        val items = todo.map {
            com.jmsocean.qc.data.remote.VerifyBatchItem(
                machine = s.machine, dpr_date = s.date, shift = s.shift, hour_slot = it.hour_slot,
                dpr_entry_id = it.dpr_entry_id,
                qc_good_qty = it.sup_good_qty ?: 0, qc_reject_qty = it.sup_reject_qty ?: 0
            )
        }
        viewModelScope.launch {
            repo.verifySubmitBatch(items)
                .onSuccess {
                    _state.update { it.copy(busySlot = null, message = "All ${items.size} entries of $hour verified.") }
                    load()
                }
                .onFailure { e -> _state.update { it.copy(busySlot = null, error = e.message) } }
        }
    }

    fun submitDeviation(slot: VerifySlot, good: Int, reject: Int, desc: String, remarks: String) {
        val s = _state.value
        _state.update { it.copy(busySlot = entryKey(slot), error = null, message = null) }
        val note = "DEVIATION: $desc" + (if (remarks.isNotBlank()) " | $remarks" else "")
        viewModelScope.launch {
            repo.verifySubmit(
                s.machine, s.date, s.shift, slot.hour_slot, good, reject, note,
                statusOverride = "Deviation", dprEntryId = slot.dpr_entry_id
            ).onSuccess {
                _state.update { it.copy(busySlot = null, message = "Deviation recorded for ${slot.hour_slot}.") }
                load()
            }.onFailure { e -> _state.update { it.copy(busySlot = null, error = e.message) } }
        }
    }

    fun placeHold(slot: VerifySlot, reason: String, qty: Int?, remarks: String) {
        val s = _state.value
        _state.update { it.copy(busySlot = entryKey(slot), error = null, message = null) }
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

/** Busy-state key for one DPR entry (an hour can have two: main + colour change). */
fun entryKey(slot: VerifySlot) = "${slot.hour_slot}#${slot.dpr_entry_id ?: 0}"
fun hourKey(hour: String) = "$hour#all"

/** "Main · Red" / "Colour change · Blue" — shown when an hour has more than one entry. */
fun entryLabel(slot: VerifySlot): String {
    val kind = if (slot.entry_no <= 1) "Main" else "Colour change"
    return slot.colour?.takeIf { it.isNotBlank() }?.let { "$kind · $it" } ?: kind
}
