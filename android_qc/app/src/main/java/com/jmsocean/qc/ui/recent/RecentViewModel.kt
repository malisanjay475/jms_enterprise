package com.jmsocean.qc.ui.recent

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.remote.RecentSlot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RecentUiState(
    val machine: String = "",
    val machines: List<String> = emptyList(),
    val entries: List<RecentSlot> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null
)

class RecentViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(RecentUiState(machine = session.machine))
    val state: StateFlow<RecentUiState> = _state.asStateFlow()

    init {
        loadMachines()
        load()
    }

    private fun loadMachines() {
        viewModelScope.launch {
            repo.machines().onSuccess { list -> _state.update { it.copy(machines = list) } }
        }
    }

    fun selectMachine(m: String) {
        session.machine = m
        _state.update { it.copy(machine = m) }
        load()
    }

    fun load() {
        val m = _state.value.machine
        if (m.isBlank()) {
            _state.update { it.copy(error = "Pick a machine first.") }
            return
        }
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.recentSlots(m)
                .onSuccess { list -> _state.update { it.copy(loading = false, entries = list) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message) } }
        }
    }
}
