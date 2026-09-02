package com.jmsocean.qc.ui.queue

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.remote.QueueJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class QueueUiState(
    val line: String = "",
    val machines: List<String> = emptyList(),
    val selectedMachine: String? = null,
    val jobs: List<QueueJob> = emptyList(),
    val loadingMachines: Boolean = false,
    val loadingJobs: Boolean = false,
    val error: String? = null
)

class QueueViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(QueueUiState(line = session.line))
    val state: StateFlow<QueueUiState> = _state.asStateFlow()

    init { loadMachines() }

    fun loadMachines() {
        _state.update { it.copy(loadingMachines = true, error = null) }
        viewModelScope.launch {
            repo.machines()
                .onSuccess { list ->
                    _state.update {
                        it.copy(loadingMachines = false, machines = list)
                    }
                    list.firstOrNull()?.let { selectMachine(it) }
                }
                .onFailure { e ->
                    _state.update { it.copy(loadingMachines = false, error = e.message) }
                }
        }
    }

    fun selectMachine(machine: String) {
        session.machine = machine
        _state.update { it.copy(selectedMachine = machine) }
        loadJobs(machine)
    }

    /** Called when the supervisor taps FPA on a job — stashes it for the FPA screen. */
    fun openFpa(job: com.jmsocean.qc.data.remote.QueueJob) {
        QcApp.instance.repository.activeJob = job
    }

    fun loadJobs(machine: String? = null) {
        val target = machine ?: _state.value.selectedMachine ?: return
        _state.update { it.copy(loadingJobs = true, error = null) }
        viewModelScope.launch {
            repo.queue(target)
                .onSuccess { jobs -> _state.update { it.copy(loadingJobs = false, jobs = jobs) } }
                .onFailure { e -> _state.update { it.copy(loadingJobs = false, error = e.message) } }
        }
    }

    fun logout() = repo.logout()
}
