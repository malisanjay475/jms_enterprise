package com.jmsocean.shifting.ui.jobs

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.NetworkWatcher
import com.jmsocean.shifting.data.remote.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class JobsUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val jobs: List<Job> = emptyList(),
    val days: Int = 7,
    val search: String = "",
    val pendingOnly: Boolean = true
) {
    /** Running jobs first, then by machine (Line, then machine number). */
    val visible: List<Job>
        get() {
            val q = search.trim().lowercase()
            return jobs
                .filter { !pendingOnly || it.floorBalance > 0 || it.isRunning }
                .filter {
                    q.isEmpty() || listOf(it.machine, it.itemName, it.mouldName, it.orderNo, it.jcNo, it.planCode)
                        .any { f -> f.lowercase().contains(q) }
                }
                .sortedWith(compareBy<Job>({ !it.isRunning }, { lineKey(it.line) }, { machineNo(it.machine) }, { it.machine }))
        }
}

private fun lineKey(line: String): Int = Regex("\\d+").find(line)?.value?.toIntOrNull() ?: Int.MAX_VALUE
private fun machineNo(m: String): Int = Regex("\\d+").findAll(m).lastOrNull()?.value?.toIntOrNull() ?: Int.MAX_VALUE

class JobsViewModel : ViewModel() {
    private val app = ShiftingApp.instance
    private val repo = app.repository

    private val _state = MutableStateFlow(JobsUiState(days = app.session.jobDays))
    val state: StateFlow<JobsUiState> = _state.asStateFlow()

    init {
        load()
        NetworkWatcher.onNetworkBack(viewModelScope) { if (_state.value.error != null) load() }
    }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.jobs(_state.value.days)
                .onSuccess { list -> _state.update { it.copy(loading = false, jobs = list) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Could not load jobs") } }
        }
    }

    fun setDays(d: Int) {
        app.session.jobDays = d
        _state.update { it.copy(days = d) }
        load()
    }

    fun setSearch(v: String) = _state.update { it.copy(search = v) }
    fun setPendingOnly(v: Boolean) = _state.update { it.copy(pendingOnly = v) }
}
