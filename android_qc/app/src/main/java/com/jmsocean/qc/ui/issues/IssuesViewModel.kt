package com.jmsocean.qc.ui.issues

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.remote.ColourBalance
import com.jmsocean.qc.data.remote.FactoryPerson
import com.jmsocean.qc.data.remote.QueueJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

/**
 * Raised Memo capture flow: pick machine → active plan (which is running) →
 * see job info → add media + remarks → @mention a Moulding person → submit.
 */
data class MemoUiState(
    // step 1: machine + its active plans
    val machines: List<String> = emptyList(),
    val machine: String = "",
    val jobs: List<QueueJob> = emptyList(),
    val loadingJobs: Boolean = false,
    // step 2: chosen job + its colour balance
    val job: QueueJob? = null,
    val balances: List<ColourBalance> = emptyList(),
    // step 3: the memo body
    val description: String = "",
    val severity: String = "Medium",
    val remarks: String = "",
    val images: List<File> = emptyList(),
    val video: File? = null,
    // step 4: @mention
    val people: List<FactoryPerson> = emptyList(),
    val mentioned: FactoryPerson? = null,
    // status
    val submitting: Boolean = false,
    val error: String? = null,
    val message: String? = null
) {
    val canSubmit: Boolean
        get() = !submitting && machine.isNotBlank() && description.isNotBlank()
}

class IssuesViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(MemoUiState(machine = session.machine))
    val state: StateFlow<MemoUiState> = _state.asStateFlow()

    init {
        loadMachines()
        loadPeople()
        if (_state.value.machine.isNotBlank()) loadJobs(_state.value.machine)
    }

    private fun loadMachines() = viewModelScope.launch {
        repo.machines().onSuccess { list -> _state.update { it.copy(machines = list) } }
    }

    private fun loadPeople() = viewModelScope.launch {
        repo.factoryPeople().onSuccess { list -> _state.update { it.copy(people = list) } }
    }

    fun setMachine(m: String) {
        _state.update { it.copy(machine = m, job = null, balances = emptyList(), jobs = emptyList()) }
        loadJobs(m)
    }

    private fun loadJobs(machine: String) {
        if (machine.isBlank()) return
        _state.update { it.copy(loadingJobs = true, error = null) }
        viewModelScope.launch {
            repo.queue(machine)
                .onSuccess { list -> _state.update { it.copy(loadingJobs = false, jobs = list) } }
                .onFailure { e -> _state.update { it.copy(loadingJobs = false, error = e.message) } }
        }
    }

    fun selectJob(job: QueueJob) {
        _state.update { it.copy(job = job, balances = emptyList()) }
        repo.activeJob = job
        val planId = job.PlanID ?: return
        viewModelScope.launch {
            repo.colourBalance(planId).onSuccess { list -> _state.update { it.copy(balances = list) } }
        }
    }

    fun clearJob() = _state.update { it.copy(job = null, balances = emptyList()) }

    fun setDescription(v: String) = _state.update { it.copy(description = v) }
    fun setSeverity(v: String) = _state.update { it.copy(severity = v) }
    fun setRemarks(v: String) = _state.update { it.copy(remarks = v) }

    /** Mic result: append the recognised speech to whatever is already typed. */
    fun appendSpeech(text: String) {
        if (text.isBlank()) return
        _state.update { it.copy(remarks = (it.remarks.trim() + " " + text.trim()).trim()) }
    }

    fun addImage(f: File) = _state.update { it.copy(images = it.images + f) }
    fun removeImage(f: File) = _state.update { it.copy(images = it.images - f) }
    fun setVideo(f: File?) = _state.update { it.copy(video = f) }
    fun setMentioned(p: FactoryPerson?) = _state.update { it.copy(mentioned = p) }

    fun submit(onDone: (String) -> Unit) {
        val s = _state.value
        if (!s.canSubmit) {
            _state.update { it.copy(error = "Pick a machine and describe the memo.") }
            return
        }
        _state.update { it.copy(submitting = true, error = null, message = null) }
        viewModelScope.launch {
            repo.createMemo(
                machine = s.machine,
                job = s.job,
                description = s.description.trim(),
                severity = s.severity,
                remarks = s.remarks.trim(),
                mentionedName = s.mentioned?.name ?: "",
                mentionedRole = s.mentioned?.role_code ?: "",
                images = s.images,
                video = s.video
            ).onSuccess { memoNo ->
                _state.update {
                    MemoUiState(
                        machines = it.machines,
                        machine = it.machine,
                        jobs = it.jobs,
                        people = it.people,
                        message = if (memoNo.isNotBlank()) "Memo $memoNo raised." else "Memo raised."
                    )
                }
                onDone(memoNo)
            }.onFailure { e ->
                _state.update { it.copy(submitting = false, error = e.message ?: "Could not raise memo") }
            }
        }
    }

    fun clearMessage() = _state.update { it.copy(message = null, error = null) }
}
