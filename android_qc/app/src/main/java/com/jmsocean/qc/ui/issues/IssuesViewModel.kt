package com.jmsocean.qc.ui.issues

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.remote.MaterialIssue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class IssuesUiState(
    val machine: String = "",
    val filter: String = "all",                 // all | OPEN | ACKNOWLEDGED | RESOLVED
    val issues: List<MaterialIssue> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val creating: Boolean = false,
    val createError: String? = null,
    val message: String? = null
)

class IssuesViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(IssuesUiState(machine = session.machine))
    val state: StateFlow<IssuesUiState> = _state.asStateFlow()

    init { load() }

    fun setFilter(f: String) {
        _state.update { it.copy(filter = f) }
        load()
    }

    fun load() {
        _state.update { it.copy(loading = true, error = null, message = null) }
        viewModelScope.launch {
            val status = _state.value.filter.takeIf { it != "all" }
            repo.issues(_state.value.machine, status)
                .onSuccess { list -> _state.update { it.copy(loading = false, issues = list) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun create(
        description: String,
        severity: String,
        assignedRole: String,
        assignedName: String,
        onDone: () -> Unit
    ) {
        val machine = _state.value.machine
        if (machine.isBlank()) {
            _state.update { it.copy(createError = "Pick a machine on the Queue first.") }
            return
        }
        if (description.isBlank()) {
            _state.update { it.copy(createError = "Describe the issue.") }
            return
        }
        _state.update { it.copy(creating = true, createError = null) }
        viewModelScope.launch {
            repo.createIssue(machine, description, severity, assignedRole, assignedName, "")
                .onSuccess {
                    _state.update { it.copy(creating = false, message = "Issue raised.") }
                    onDone()
                    load()
                }
                .onFailure { e -> _state.update { it.copy(creating = false, createError = e.message) } }
        }
    }
}
