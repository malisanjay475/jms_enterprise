package com.jmsocean.shifting.ui.recent

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.NetworkWatcher
import com.jmsocean.shifting.data.remote.ShiftEntry
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.EmptyNote
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.jobs.EntryRow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RecentUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val entries: List<ShiftEntry> = emptyList()
)

class RecentViewModel : ViewModel() {
    private val repo = ShiftingApp.instance.repository
    private val _state = MutableStateFlow(RecentUiState())
    val state: StateFlow<RecentUiState> = _state.asStateFlow()

    init {
        load()
        NetworkWatcher.onNetworkBack(viewModelScope) { if (_state.value.error != null) load() }
    }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.recent()
                .onSuccess { list -> _state.update { it.copy(loading = false, entries = list) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Could not load entries") } }
        }
    }
}

@Composable
fun RecentScreen(onMenu: () -> Unit, vm: RecentViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Recent Entries",
                subtitle = "Latest ${s.entries.size} shifts",
                onMenu = onMenu,
                actions = { IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Reload") } }
            )
        }
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                s.error?.let { item { ErrorCard(it, onRetry = { vm.load() }) } }
                if (!s.loading && s.error == null && s.entries.isEmpty()) item { EmptyNote("No shifting entries yet.") }
                items(s.entries, key = { it.id.ifBlank { it.createdAt + it.machine } }) { EntryRow(it, showMachine = true) }
            }
        }
    }
}
