package com.jmsocean.qc.ui.team

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.Ist
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One line's QC team as shown / edited on the QC Shift Team screen. */
data class LineTeamRow(
    val line: String,
    val supervisor: String = "",
    val incharge: String = "",
    val savedBy: String = "",
    val saved: Boolean = false,
    val saving: Boolean = false,
    val error: String? = null
)

data class ShiftTeamUiState(
    val date: String = Ist.productionDate(),
    val shift: String = Ist.productionShift(),
    val rows: List<LineTeamRow> = emptyList(),
    val required: Set<String> = emptySet(),
    val allAccess: Boolean = false,
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null
) {
    /** The app stays locked until every one of the user's own lines has a saved team. */
    val unlocked: Boolean get() = loaded && required.isEmpty()
}

/**
 * QC shift team per line (like the Moulding shift team). Shared by the whole app:
 * MainActivity shows the screen instead of everything else until [ShiftTeamUiState.unlocked],
 * and re-checks when the shift changes (08:10 / 20:10 IST).
 */
class ShiftTeamViewModel : ViewModel() {
    private val repo = QcApp.instance.repository

    private val _state = MutableStateFlow(ShiftTeamUiState())
    val state: StateFlow<ShiftTeamUiState> = _state.asStateFlow()

    init {
        // Shift change → new date/shift → the new shift's team must be saved again.
        viewModelScope.launch {
            while (true) {
                delay(60_000)
                val (d, sh) = Ist.production()
                val s = _state.value
                if (d != s.date || sh != s.shift) {
                    _state.update { ShiftTeamUiState(date = d, shift = sh) }
                    if (QcApp.instance.session.isLoggedIn) load()
                }
            }
        }
    }

    fun load() {
        val (d, sh) = Ist.production()
        _state.update { it.copy(date = d, shift = sh, loading = true, error = null) }
        viewModelScope.launch {
            repo.lineTeam(d, sh)
                .onSuccess { r ->
                    _state.update { st ->
                        val edits = st.rows.associateBy { it.line }
                        st.copy(
                            loading = false, loaded = true, allAccess = r.all_access,
                            required = r.required.toSet(),
                            rows = r.data.map { t ->
                                val saved = t.qc_supervisor.isNotBlank() && t.qc_incharge.isNotBlank()
                                val old = edits[t.line]
                                LineTeamRow(
                                    line = t.line,
                                    // keep what the user is typing on a not-yet-saved line
                                    supervisor = if (!saved && old != null) old.supervisor else t.qc_supervisor,
                                    incharge = if (!saved && old != null) old.incharge else t.qc_incharge,
                                    savedBy = t.saved_by, saved = saved
                                )
                            }
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Could not load QC shift team") } }
        }
    }

    fun reset() = _state.update { ShiftTeamUiState() }

    fun setSupervisor(line: String, v: String) = editRow(line) { it.copy(supervisor = v, error = null) }
    fun setIncharge(line: String, v: String) = editRow(line) { it.copy(incharge = v, error = null) }

    /** Saved lines become editable again (to correct a name). */
    fun edit(line: String) = editRow(line) { it.copy(saved = false) }

    fun save(line: String) {
        val row = _state.value.rows.firstOrNull { it.line == line } ?: return
        if (row.supervisor.isBlank() || row.incharge.isBlank()) {
            editRow(line) { it.copy(error = "Enter both QC Supervisor and QC Incharge.") }; return
        }
        val s = _state.value
        editRow(line) { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            repo.saveLineTeam(line, s.date, s.shift, row.supervisor.trim(), row.incharge.trim())
                .onSuccess {
                    editRow(line) { it.copy(saving = false, saved = true, supervisor = it.supervisor.trim(), incharge = it.incharge.trim()) }
                    _state.update { it.copy(required = it.required - line) }
                }
                .onFailure { e -> editRow(line) { it.copy(saving = false, error = e.message ?: "Save failed. Check connection.") } }
        }
    }

    private fun editRow(line: String, f: (LineTeamRow) -> LineTeamRow) =
        _state.update { st -> st.copy(rows = st.rows.map { if (it.line == line) f(it) else it }) }
}
