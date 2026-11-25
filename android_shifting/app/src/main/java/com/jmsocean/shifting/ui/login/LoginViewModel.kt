package com.jmsocean.shifting.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.Factory
import com.jmsocean.shifting.data.FactoryServer
import com.jmsocean.shifting.data.LocationProvider
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
    val success: Boolean = false,
    val factory: Factory? = FactoryServer.selected
)

class LoginViewModel : ViewModel() {
    private val repo = ShiftingApp.instance.repository

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onUsername(v: String) = _state.update { it.copy(username = v, error = null) }
    fun onPassword(v: String) = _state.update { it.copy(password = v, error = null) }

    /** Switches the server. The login and the last "Send To" belong to the old factory. */
    fun onFactory(f: Factory) {
        if (_state.value.loading || f == FactoryServer.selected) return
        if (f != FactoryServer.current) {
            repo.logout()
            ShiftingApp.instance.session.lastLocation = ""
        }
        FactoryServer.select(f)
        _state.update { it.copy(factory = f, error = null) }
    }

    /** @param locationPermitted whether the user granted location (drives the GPS fetch). */
    fun login(locationPermitted: Boolean) {
        val s = _state.value
        if (s.factory == null) {
            _state.update { it.copy(error = "Select your factory first.") }
            return
        }
        if (s.username.isBlank() || s.password.isBlank()) {
            _state.update { it.copy(error = "Enter username & password.") }
            return
        }
        _state.update { it.copy(loading = true, error = null, statusLine = "Finding the ${s.factory.label} server…") }
        viewModelScope.launch {
            if (!FactoryServer.findServer()) {
                _state.update {
                    it.copy(
                        loading = false, statusLine = null,
                        error = "Can't reach the ${s.factory.label} server (${s.factory.host}). Connect the phone to that factory's Wi-Fi and try again."
                    )
                }
                return@launch
            }
            _state.update { it.copy(statusLine = "Getting location…") }
            val geo = if (locationPermitted) LocationProvider.current(ShiftingApp.instance) else null
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
