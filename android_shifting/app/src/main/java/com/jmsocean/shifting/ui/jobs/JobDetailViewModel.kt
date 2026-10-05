package com.jmsocean.shifting.ui.jobs

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.remote.JobDetail
import com.jmsocean.shifting.ui.common.qty
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class JobDetailUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val job: JobDetail? = null,
    val locations: List<String> = emptyList(),
    val location: String = "",
    val quantity: String = "",
    val saving: Boolean = false,
    val message: String? = null,
    val messageOk: Boolean = true
)

class JobDetailViewModel(savedState: SavedStateHandle) : ViewModel() {
    private val app = ShiftingApp.instance
    private val repo = app.repository
    private val planId: String = savedState.get<String>("planId").orEmpty()

    private val _state = MutableStateFlow(JobDetailUiState(location = app.session.lastLocation))
    val state: StateFlow<JobDetailUiState> = _state.asStateFlow()

    init {
        load()
        viewModelScope.launch {
            repo.locations().onSuccess { list ->
                _state.update { s ->
                    val keep = s.location.takeIf { it.isNotBlank() && list.any { l -> l.equals(it, ignoreCase = true) } }
                    s.copy(locations = list, location = keep ?: list.firstOrNull().orEmpty())
                }
            }
        }
    }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.jobDetail(planId)
                .onSuccess { j -> _state.update { it.copy(loading = false, job = j) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Could not load job") } }
        }
    }

    fun setLocation(loc: String) {
        app.session.lastLocation = loc
        _state.update { it.copy(location = loc) }
    }

    fun setQuantity(v: String) = _state.update { it.copy(quantity = v.filter(Char::isDigit).take(7), message = null) }

    /** Manual (no-label) shift. The server checks QC hold and the shop-floor balance. */
    fun shift() {
        val s = _state.value
        val job = s.job ?: return
        val q = s.quantity.toIntOrNull() ?: 0
        when {
            q <= 0 -> return fail("Enter the quantity to shift.")
            s.location.isBlank() -> return fail("Pick where the material is going (Send To).")
            job.floorBalance > 0 && q > job.floorBalance -> return fail("Only ${qty(job.floorBalance)} pcs are on the shop floor.")
        }
        _state.update { it.copy(saving = true, message = null) }
        viewModelScope.launch {
            repo.manualShift(job.planId.ifBlank { planId }, job.machine, q, s.location)
                .onSuccess {
                    _state.update { it.copy(saving = false, quantity = "", message = "Shifted ${qty(q.toDouble())} pcs → ${s.location}", messageOk = true) }
                    load()
                }
                .onFailure { e -> _state.update { it.copy(saving = false, message = e.message ?: "Shift failed.", messageOk = false) } }
        }
    }

    private fun fail(msg: String) = _state.update { it.copy(message = msg, messageOk = false) }
}
