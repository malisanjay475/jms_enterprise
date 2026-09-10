package com.jmsocean.qc.ui.onlinereport

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.Ist
import com.jmsocean.qc.data.remote.OnlineJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// 2-hour QC slots (mirrors the web QC supervisor Online QC Report).
data class SlotDef(val label: String, val start: Int)
val QC_SLOTS = listOf(
    SlotDef("06-07", 6), SlotDef("08-09", 8), SlotDef("10-11", 10),
    SlotDef("12-01", 12), SlotDef("02-03", 14), SlotDef("04-05", 16)
)
// Function/Fitment is checked every 4 hours — only on these slots.
val FF_SLOTS = setOf("08-09", "12-01", "04-05")

val VISUAL_PROBLEMS = listOf(
    "Short Moulding", "Sink Mark", "Flash", "Warpage", "Colour Variation",
    "Scratch", "Contamination", "Weld Line", "Air Mark", "Other"
)
val COLOUR_PROBLEMS = listOf(
    "Colour Variation", "Contamination", "Fading", "Mixing Error", "Colour Change Residue", "Other"
)
val FF_PROBLEMS = listOf(
    "Dimension Out of Tolerance", "Assembly Issue", "Functional Failure", "Loose Fit", "Tight Fit", "Other"
)

const val OK = "OK"
const val NOT_OK = "NOT_OK"

/** One slot's editable check state. */
data class SlotUi(
    val label: String,
    val isFF: Boolean,
    val visualStatus: String? = null,
    val visualProblem: String = VISUAL_PROBLEMS.first(),
    val visualRemarks: String = "",
    val colourStatus: String? = null,
    val colourProblem: String = COLOUR_PROBLEMS.first(),
    val colourRemarks: String = "",
    val ffStatus: String? = null,
    val ffProblem: String = FF_PROBLEMS.first(),
    val done: Boolean = false,
    val saving: Boolean = false,
    val savedMsg: String? = null
)

/** STD-vs-Act setup, filled twice per shift (period 1 = start, 2 = mid). */
data class PeriodInput(
    val actWeight: String = "", val actCT: String = "", val actCavity: String = "",
    val done: Boolean = false, val saving: Boolean = false, val msg: String? = null
)
data class SetupUi(
    val available: Boolean = false,   // job has a JC → setup applies
    val stdWeight: String = "", val stdCT: String = "", val stdCavity: String = "",
    val p1: PeriodInput = PeriodInput(),
    val p2: PeriodInput = PeriodInput()
)

data class OnlineReportUiState(
    val machine: String = "",
    val machines: List<String> = emptyList(),
    val setup: SetupUi = SetupUi(),
    val date: String = Ist.date(),
    val shift: String = Ist.shift(),
    val loading: Boolean = false,
    val error: String? = null,
    val job: OnlineJob? = null,
    val slots: List<SlotUi> = QC_SLOTS.map { SlotUi(it.label, it.label in FF_SLOTS) }
)

class OnlineReportViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    // When opened from a job's QC → Checks, use that job's machine + context;
    // when opened from the drawer, fall back to the session machine.
    private val activeJob = repo.activeJob
    private val seededJob: OnlineJob? = activeJob?.let {
        OnlineJob(
            job_card_no = it.JobCardNo,
            order_no = it.OrderNo,
            item_name = it.productName,
            mould_name = it.mouldForEntry
        )
    }

    private val _state = MutableStateFlow(
        OnlineReportUiState(
            machine = activeJob?.Machine?.takeIf { it.isNotBlank() } ?: session.machine,
            job = seededJob
        )
    )
    val state: StateFlow<OnlineReportUiState> = _state.asStateFlow()

    init { loadMachines(); load(); loadSetup() }

    private fun loadMachines() = viewModelScope.launch {
        repo.machines().onSuccess { list ->
            _state.update { it.copy(machines = list.sortedWith(com.jmsocean.qc.data.machineQueueComparator)) }
        }
    }

    fun setMachine(v: String) { _state.update { it.copy(machine = v) }; load(); loadSetup() }
    fun setShift(v: String) { _state.update { it.copy(shift = v) }; load(); loadSetup() }

    private fun loadSetup() {
        val jc = activeJob?.JobCardNo?.takeIf { it.isNotBlank() } ?: run {
            _state.update { it.copy(setup = SetupUi(available = false)) }; return
        }
        val s = _state.value
        val mould = activeJob?.mouldForEntry ?: ""
        viewModelScope.launch {
            repo.jobSetup(jc, s.date, s.shift, s.machine, mould).onSuccess { d ->
                _state.update {
                    it.copy(setup = SetupUi(
                        available = true,
                        stdWeight = d.stdWeight, stdCT = d.stdCycleTime, stdCavity = d.stdCavity,
                        p1 = PeriodInput(
                            actWeight = d.period1?.actWeight ?: "", actCT = d.period1?.actCycleTime ?: "",
                            actCavity = d.period1?.actCavity ?: "", done = d.period1 != null
                        ),
                        p2 = PeriodInput(
                            actWeight = d.period2?.actWeight ?: "", actCT = d.period2?.actCycleTime ?: "",
                            actCavity = d.period2?.actCavity ?: "", done = d.period2 != null
                        )
                    ))
                }
            }
        }
    }

    private fun editPeriod(period: Int, f: (PeriodInput) -> PeriodInput) = _state.update { st ->
        val su = st.setup
        st.copy(setup = if (period == 1) su.copy(p1 = f(su.p1).copy(msg = null)) else su.copy(p2 = f(su.p2).copy(msg = null)))
    }
    fun setSetupWeight(period: Int, v: String) = editPeriod(period) { it.copy(actWeight = v) }
    fun setSetupCT(period: Int, v: String) = editPeriod(period) { it.copy(actCT = v) }
    fun setSetupCavity(period: Int, v: String) = editPeriod(period) { it.copy(actCavity = v.filter(Char::isDigit)) }

    fun saveSetup(period: Int) {
        val s = _state.value
        val jc = activeJob?.JobCardNo?.takeIf { it.isNotBlank() } ?: return
        val su = s.setup
        val p = if (period == 1) su.p1 else su.p2
        editPeriod(period) { it.copy(saving = true, msg = null) }
        viewModelScope.launch {
            repo.saveJobSetup(
                jobCardNo = jc, machine = s.machine, date = s.date, shift = s.shift, period = period,
                stdWeight = su.stdWeight, stdCycleTime = su.stdCT, stdCavity = su.stdCavity,
                actWeight = p.actWeight, actCycleTime = p.actCT, actCavity = p.actCavity
            ).onSuccess { editPeriod(period) { it.copy(saving = false, done = true, msg = "✓ Saved") } }
                .onFailure { e -> editPeriod(period) { it.copy(saving = false, msg = e.message ?: "Save failed") } }
        }
    }

    fun load() {
        val s = _state.value
        if (s.machine.isBlank()) {
            _state.update { it.copy(error = "Select a machine on the Job Queue first.") }
            return
        }
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.onlineReport(s.machine, s.date, s.shift)
                .onSuccess { r ->
                    val saved = r.data.associateBy { it.slot }
                    val slots = QC_SLOTS.map { def ->
                        val sv = saved[def.label]
                        val isFF = def.label in FF_SLOTS
                        SlotUi(
                            label = def.label,
                            isFF = isFF,
                            visualStatus = sv?.visual_status,
                            visualProblem = sv?.visual_problem ?: VISUAL_PROBLEMS.first(),
                            visualRemarks = sv?.visual_remarks ?: "",
                            colourStatus = sv?.colour_status,
                            colourProblem = sv?.colour_problem ?: COLOUR_PROBLEMS.first(),
                            colourRemarks = sv?.colour_remarks ?: "",
                            ffStatus = sv?.ff_status,
                            ffProblem = sv?.ff_problem ?: FF_PROBLEMS.first(),
                            done = sv != null && (sv.visual_status != null || sv.colour_status != null || sv.ff_status != null)
                        )
                    }
                    _state.update { it.copy(loading = false, slots = slots, job = r.job ?: seededJob) }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message) } }
        }
    }

    private fun edit(label: String, f: (SlotUi) -> SlotUi) = _state.update { st ->
        st.copy(slots = st.slots.map { if (it.label == label) f(it).copy(savedMsg = null) else it })
    }

    fun setVisual(label: String, status: String) = edit(label) { it.copy(visualStatus = status) }
    fun setVisualProblem(label: String, v: String) = edit(label) { it.copy(visualProblem = v) }
    fun setVisualRemarks(label: String, v: String) = edit(label) { it.copy(visualRemarks = v) }
    fun setColour(label: String, status: String) = edit(label) { it.copy(colourStatus = status) }
    fun setColourProblem(label: String, v: String) = edit(label) { it.copy(colourProblem = v) }
    fun setColourRemarks(label: String, v: String) = edit(label) { it.copy(colourRemarks = v) }
    fun setFf(label: String, status: String) = edit(label) { it.copy(ffStatus = status) }
    fun setFfProblem(label: String, v: String) = edit(label) { it.copy(ffProblem = v) }

    fun saveSlot(label: String) {
        val s = _state.value
        val slot = s.slots.firstOrNull { it.label == label } ?: return
        if (slot.visualStatus == null && slot.colourStatus == null && slot.ffStatus == null) {
            edit(label) { it.copy(savedMsg = "Mark at least one check.") }
            return
        }
        _state.update { st -> st.copy(slots = st.slots.map { if (it.label == label) it.copy(saving = true, savedMsg = null) else it }) }
        viewModelScope.launch {
            repo.saveOnlineSlot(
                machine = s.machine, date = s.date, shift = s.shift, slot = label, job = s.job,
                visualStatus = slot.visualStatus, visualProblem = slot.visualProblem, visualRemarks = slot.visualRemarks,
                colourStatus = slot.colourStatus, colourProblem = slot.colourProblem, colourRemarks = slot.colourRemarks,
                ffStatus = if (slot.isFF) slot.ffStatus else null, ffProblem = slot.ffProblem
            ).onSuccess {
                _state.update { st ->
                    st.copy(slots = st.slots.map {
                        if (it.label == label) it.copy(saving = false, done = true, savedMsg = "✓ Saved") else it
                    })
                }
            }.onFailure { e ->
                _state.update { st ->
                    st.copy(slots = st.slots.map {
                        if (it.label == label) it.copy(saving = false, savedMsg = e.message ?: "Save failed") else it
                    })
                }
            }
        }
    }
}
