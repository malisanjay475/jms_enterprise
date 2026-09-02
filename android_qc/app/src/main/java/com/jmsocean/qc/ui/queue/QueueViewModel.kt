package com.jmsocean.qc.ui.queue

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.AppUpdater
import com.jmsocean.qc.data.SyncManager
import com.jmsocean.qc.data.remote.AppVersion
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
    val error: String? = null,
    // self-updater
    val update: AppVersion? = null,
    val downloadingUpdate: Boolean = false,
    val updateError: String? = null
)

class QueueViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(QueueUiState(line = session.line))
    val state: StateFlow<QueueUiState> = _state.asStateFlow()

    /** Count of writes waiting to sync (offline backlog). */
    val pendingSync: StateFlow<Int> = SyncManager.pending

    init {
        loadMachines()
        checkForUpdate()
        SyncManager.drain()
    }

    fun syncNow() = SyncManager.drain()

    private fun checkForUpdate() {
        viewModelScope.launch {
            val v = AppUpdater.checkForUpdate()
            if (v != null) _state.update { it.copy(update = v) }
        }
    }

    /** Download the newer APK and hand it to the system installer. */
    fun installUpdate(ctx: Context) {
        val v = _state.value.update ?: return
        _state.update { it.copy(downloadingUpdate = true, updateError = null) }
        viewModelScope.launch {
            val apk = AppUpdater.download(ctx, v)
            if (apk != null) {
                _state.update { it.copy(downloadingUpdate = false) }
                AppUpdater.install(ctx, apk)
            } else {
                _state.update {
                    it.copy(downloadingUpdate = false, updateError = "Download failed. Check the factory network.")
                }
            }
        }
    }

    fun dismissUpdate() = _state.update { it.copy(update = null) }

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
