package com.jmsocean.shifting.ui.team

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.NetworkWatcher
import com.jmsocean.shifting.data.ShiftClock
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.theme.Good
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TeamDraft(val supervisor: String = "", val incharge: String = "")

data class ShiftTeamUiState(
    val date: String = "",
    val shift: String = "",
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null,
    val lines: List<String> = emptyList(),
    val required: List<String> = emptyList(),
    val drafts: Map<String, TeamDraft> = emptyMap(),
    val saving: String? = null,
    val saveError: String? = null
) {
    /** Unlocked once the server says no line of this user is missing its team. */
    val unlocked: Boolean get() = loaded && required.isEmpty()
}

class ShiftTeamViewModel : ViewModel() {
    private val repo = ShiftingApp.instance.repository
    private val _state = MutableStateFlow(ShiftTeamUiState())
    val state: StateFlow<ShiftTeamUiState> = _state.asStateFlow()

    init {
        NetworkWatcher.onNetworkBack(viewModelScope) { if (_state.value.error != null) load() }
    }

    /** Loads the team of the current shift; a new shift (08:00 / 20:00) locks the app again. */
    fun load() {
        val slot = ShiftClock.current()
        _state.update { it.copy(loading = true, error = null, date = slot.dateText, shift = slot.shift) }
        viewModelScope.launch {
            repo.lineTeam(slot.dateText, slot.shift)
                .onSuccess { st ->
                    _state.update { s ->
                        s.copy(
                            loading = false, loaded = true,
                            lines = st.teams.map { it.line },
                            required = st.required,
                            drafts = st.teams.associate { t ->
                                t.line to (s.drafts[t.line]?.takeIf { d -> d.supervisor.isNotBlank() || d.incharge.isNotBlank() }
                                    ?: TeamDraft(t.supervisor, t.incharge))
                            }
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Could not load the shift team") } }
        }
    }

    /** Re-checks when the shift changes while the app is open. */
    fun checkShift() {
        val slot = ShiftClock.current()
        val s = _state.value
        if (s.loaded && (s.date != slot.dateText || s.shift != slot.shift)) load()
    }

    fun reset() = _state.update { ShiftTeamUiState() }

    fun edit(line: String, supervisor: String? = null, incharge: String? = null) = _state.update { s ->
        val d = s.drafts[line] ?: TeamDraft()
        s.copy(
            saveError = null,
            drafts = s.drafts + (line to d.copy(
                supervisor = (supervisor ?: d.supervisor).take(80),
                incharge = (incharge ?: d.incharge).take(80)
            ))
        )
    }

    fun save(line: String) {
        val s = _state.value
        val d = s.drafts[line] ?: TeamDraft()
        if (d.supervisor.isBlank() || d.incharge.isBlank()) {
            _state.update { it.copy(saveError = "Enter both Shifting Supervisor and Shifting Incharge for $line.") }
            return
        }
        _state.update { it.copy(saving = line, saveError = null) }
        viewModelScope.launch {
            repo.saveLineTeam(line, s.date, s.shift, d.supervisor.trim(), d.incharge.trim())
                .onSuccess { _state.update { it.copy(saving = null) }; load() }
                .onFailure { e -> _state.update { it.copy(saving = null, saveError = e.message ?: "Could not save") } }
        }
    }
}

/**
 * Shift team screen. As a [gate] it covers the whole app until every line of the
 * user has its team saved; from the menu it lets the team be changed.
 */
@Composable
fun ShiftTeamScreen(
    vm: ShiftTeamViewModel,
    gate: Boolean,
    onMenu: (() -> Unit)? = null,
    onLogout: (() -> Unit)? = null
) {
    val s by vm.state.collectAsStateWithLifecycle()
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Shift Team",
                subtitle = "${s.shift.ifBlank { "—" }} shift · ${s.date}",
                onMenu = onMenu,
                actions = {
                    IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Reload") }
                    if (onLogout != null) IconButton(onClick = onLogout) { Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Log out") }
                }
            )
        }
    ) { pad ->
        Column(
            Modifier
                .padding(pad)
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (gate) {
                Text(
                    "Save the Shifting team of your line for this shift to start shifting.",
                    fontSize = 14.sp, fontWeight = FontWeight.SemiBold
                )
            }
            s.error?.let { ErrorCard(it, onRetry = { vm.load() }) }
            s.saveError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
            if (s.loaded && s.lines.isEmpty()) {
                Text(
                    "No production line is set on your login. Ask the admin to set your line.",
                    fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            s.lines.forEach { line ->
                val d = s.drafts[line] ?: TeamDraft()
                val missing = line in s.required
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(line, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(
                            if (missing) "Not saved for this shift" else "Saved",
                            fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                            color = if (missing) MaterialTheme.colorScheme.error else Good
                        )
                        OutlinedTextField(
                            value = d.supervisor,
                            onValueChange = { vm.edit(line, supervisor = it) },
                            label = { Text("Shifting Supervisor") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                            modifier = Modifier.fillMaxWidth()
                        )
                        OutlinedTextField(
                            value = d.incharge,
                            onValueChange = { vm.edit(line, incharge = it) },
                            label = { Text("Shifting Incharge") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                            modifier = Modifier.fillMaxWidth()
                        )
                        Button(
                            onClick = { vm.save(line) },
                            enabled = s.saving == null,
                            modifier = Modifier.fillMaxWidth().height(50.dp)
                        ) {
                            Text(if (s.saving == line) "Saving…" else if (missing) "Save and start" else "Update team", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
