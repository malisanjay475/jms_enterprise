package com.jmsocean.qc.ui.compliance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.Ist
import com.jmsocean.qc.data.remote.ComplianceGrid
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ComplianceUiState(
    val date: String = Ist.date(),
    val shift: String = Ist.shift(),
    val grid: ComplianceGrid? = null,
    val loading: Boolean = false,
    val error: String? = null
)

class ComplianceViewModel : ViewModel() {
    private val repo = QcApp.instance.repository

    private val _state = MutableStateFlow(ComplianceUiState())
    val state: StateFlow<ComplianceUiState> = _state.asStateFlow()

    init { load() }

    fun setShift(v: String) {
        _state.update { it.copy(shift = v) }
        load()
    }

    fun load() {
        val s = _state.value
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.compliance(s.date, s.shift, null)
                .onSuccess { g -> _state.update { it.copy(loading = false, grid = g) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message) } }
        }
    }
}
