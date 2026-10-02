package com.jmsocean.qc.ui.compliance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.Ist
import com.jmsocean.qc.data.remote.QcMatrix
import com.jmsocean.qc.data.remote.QcmSlot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

enum class CellKind { OK, BAD, DUE, MISSED, UPCOMING, IDLE }

data class SlotCell(val kind: CellKind, val late: Boolean = false, val entry: QcmSlot? = null)

data class MachineRow(
    val machine: String,
    val job: String,
    val jobSub: String,
    val active: Boolean,
    val setupHalves: Int,
    val cells: List<SlotCell>,
    val done: Int,
    val due: Int,
    val fpa: String?,
    val memoHold: String?
)

data class LineCard(
    val line: String,
    val supervisor: String,
    val incharge: String,
    val savedBy: String,
    val teamSaved: Boolean,
    val rows: List<MachineRow>,
    val done: Int, val due: Int, val missed: Int, val notOk: Int,
    val setupDone: Int, val setupDue: Int
)

data class ComplianceUiState(
    val date: String = Ist.productionDate(),
    val shift: String = Ist.productionShift(),
    val slotLabels: List<String> = emptyList(),
    val cards: List<LineCard> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val selected: QcmSlot? = null
) {
    val done get() = cards.sumOf { it.done }
    val due get() = cards.sumOf { it.due }
    val missed get() = cards.sumOf { it.missed }
    val notOk get() = cards.sumOf { it.notOk }
    val setupDone get() = cards.sumOf { it.setupDone }
    val setupDue get() = cards.sumOf { it.setupDue }

    /** Shift date (production date) and the day before it. */
    val dateOptions: List<Pair<String, String>>
        get() {
            val today = Ist.productionDate()
            return listOf(today to "This shift", dayBefore(today) to "Day before")
        }
}

private val ZONE = TimeZone.getTimeZone("Asia/Kolkata")
private fun fmt() = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = ZONE }
private fun dayBefore(d: String): String {
    val cal = Calendar.getInstance(ZONE).apply { time = fmt().parse(d) ?: time; add(Calendar.DAY_OF_MONTH, -1) }
    return fmt().format(cal.time)
}

/** IST start (ms) of 2-hour slot [i] of date/shift: Day 08:00, Night 20:00. */
private fun slotStart(date: String, shift: String, i: Int): Long {
    val f = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).apply { timeZone = ZONE }
    val base = f.parse("$date ${if (shift == "Night") "20:00" else "08:00"}")?.time ?: 0L
    return base + i * 7_200_000L
}

private fun parseTs(s: String?): Long? = try {
    if (s.isNullOrBlank()) null else java.time.Instant.parse(s).toEpochMilli()
} catch (_: Exception) { null }

private fun isBad(v: String?) = v != null && Regex("not\\s*ok", RegexOption.IGNORE_CASE).containsMatchIn(v)

class ComplianceViewModel : ViewModel() {
    private val repo = QcApp.instance.repository

    private val _state = MutableStateFlow(ComplianceUiState())
    val state: StateFlow<ComplianceUiState> = _state.asStateFlow()

    init { load() }

    fun setShift(v: String) { _state.update { it.copy(shift = v) }; load() }
    fun setDate(v: String) { _state.update { it.copy(date = v) }; load() }
    fun select(e: QcmSlot?) = _state.update { it.copy(selected = e) }

    fun load() {
        val s = _state.value
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.qcSummary(s.date, s.shift)
                .onSuccess { m ->
                    _state.update { st ->
                        if (st.date != s.date || st.shift != s.shift) st
                        else st.copy(loading = false, slotLabels = labels(m), cards = build(m, s.date, s.shift))
                    }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Could not load QC compliance") } }
        }
    }

    private fun labels(m: QcMatrix) = m.slotLabels.ifEmpty { listOf("08-10", "10-12", "12-02", "02-04", "04-06", "06-08") }

    /** Same rules as the web QC summary: line cards in Line → machine order, team per line. */
    private fun build(m: QcMatrix, date: String, shift: String): List<LineCard> {
        val sl = labels(m)
        val now = System.currentTimeMillis()
        val slots = m.slots.filter { it.date == date && it.shift == shift }.groupBy { it.machine to it.slot }
        val setups = m.setups.filter { it.date == date && it.shift == shift }.groupBy { it.machine }
        val fpa = m.fpa.filter { it.date == date && it.shift == shift }.groupBy { it.machine }
        val holds = m.holds.filter { it.status == "ACTIVE" }.map { it.machine }.toSet()
        val plans = m.plans.associateBy { it.machine }
        val norm = { s: String -> s.lowercase().replace(Regex("[\\s\\-_]"), "") }

        return m.machines.groupBy { it.line }.map { (line, ms) ->
            val names = ms.map { it.machine }
            // Team: per-line save, else the older per-machine names of this line's machines.
            val t = m.teams.firstOrNull { it.date == date && it.shift == shift && norm(it.line) == norm(line) }
            var sup = t?.qc_supervisor.orEmpty()
            var inc = t?.qc_incharge.orEmpty()
            if (sup.isBlank() && inc.isBlank()) {
                m.machineTeams.filter { it.date == date && it.shift == shift && it.machine in names && !it.employee_name.isNullOrBlank() }
                    .forEach { x ->
                        val r = x.role.orEmpty().lowercase()
                        if ("incharge" in r) inc = x.employee_name!! else if ("supervisor" in r) sup = x.employee_name!!
                    }
            }
            var missed = 0; var notOk = 0; var sDone = 0; var sDue = 0
            val rows = names.map { mc ->
                val plan = plans[mc]
                val entries = sl.map { slots[mc to it]?.firstOrNull() }
                val halves = setups[mc].orEmpty().map { it.setup_period }.toSet().size.coerceAtMost(2)
                val active = plan != null || entries.any { it != null } || halves > 0
                var done = 0; var due = 0
                val cells = sl.indices.map { i ->
                    val start = slotStart(date, shift, i); val end = start + 7_200_000L
                    val e = entries[i]
                    when {
                        e != null -> {
                            done++; due++
                            val bad = isBad(e.visual_status) || isBad(e.colour_status) || isBad(e.ff_status)
                            if (bad) notOk++
                            val late = parseTs(e.entered_at)?.let { it - end > 15 * 60_000L } ?: false
                            SlotCell(if (bad) CellKind.BAD else CellKind.OK, late, e)
                        }
                        !active -> SlotCell(CellKind.IDLE)
                        now > end -> { due++; missed++; SlotCell(CellKind.MISSED) }
                        now >= start -> SlotCell(CellKind.DUE)
                        else -> SlotCell(CellKind.UPCOMING)
                    }
                }
                if (active) { sDue += 2; sDone += halves }
                val first = entries.firstOrNull { it != null }
                val f = fpa[mc].orEmpty()
                val fpaTxt = when {
                    f.isEmpty() -> null
                    f.any { it.fpa_approval_status == "Rejected" } -> "FPA rejected"
                    f.any { it.fpa_approval_status == "Pending" } -> "FPA pending"
                    else -> "FPA ok"
                }
                MachineRow(
                    machine = mc,
                    job = first?.item_name ?: plan?.item_name ?: plan?.mould_name ?: "",
                    jobSub = listOfNotNull(first?.order_no ?: plan?.order_no, first?.job_card_no).filter { it.isNotBlank() }.joinToString(" | "),
                    active = active, setupHalves = halves, cells = cells, done = done, due = due,
                    fpa = fpaTxt, memoHold = if (mc in holds) "ON HOLD" else null
                )
            }
            LineCard(
                line = line, supervisor = sup, incharge = inc, savedBy = t?.saved_by.orEmpty(),
                teamSaved = sup.isNotBlank() || inc.isNotBlank(), rows = rows,
                done = rows.sumOf { it.done }, due = rows.sumOf { it.due }, missed = missed, notOk = notOk,
                setupDone = sDone, setupDue = sDue
            )
        }
    }
}
