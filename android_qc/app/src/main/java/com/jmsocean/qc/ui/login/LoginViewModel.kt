package com.jmsocean.qc.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.LocationProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val loading: Boolean = false,
    val statusLine: String? = null,
    val error: String? = null,
    val success: Boolean = false
)

class LoginViewModel : ViewModel() {
    private val repo = QcApp.instance.repository

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onUsername(v: String) = _state.update { it.copy(username = v, error = null) }
    fun onPassword(v: String) = _state.update { it.copy(password = v, error = null) }

    /** @param locationPermitted whether the user granted location (drives the GPS fetch). */
    fun login(locationPermitted: Boolean) {
        val s = _state.value
        if (s.username.isBlank() || s.password.isBlank()) {
            _state.update { it.copy(error = "Enter username & password.") }
            return
        }
        _state.update { it.copy(loading = true, error = null, statusLine = "Getting location…") }
        viewModelScope.launch {
            val geo = if (locationPermitted) LocationProvider.current(QcApp.instance) else null
            _state.update {
                it.copy(
                    statusLine = when {
                        geo != null -> "Location acquired · signing in…"
                        else -> "Signing in…"
                    }
                )
            }
            repo.login(s.username.trim(), s.password, geo)
                .onSuccess { _state.update { st -> st.copy(loading = false, statusLine = null, success = true) } }
                .onFailure { e ->
                    _state.update {
                        it.copy(loading = false, statusLine = null, error = e.message ?: "Login failed")
                    }
                }
        }
    }
}
