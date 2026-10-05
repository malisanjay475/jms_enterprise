package com.jmsocean.shifting.ui.recent

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.NetworkWatcher
import com.jmsocean.shifting.data.ShiftClock
import com.jmsocean.shifting.data.remote.ShiftEntry
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.EmptyNote
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.common.kg
import com.jmsocean.shifting.ui.common.qty
import com.jmsocean.shifting.ui.jobs.EntryRow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Shifting of one job in the loaded entries, colour-wise and machine-wise. */
data class JobGroup(
    val key: String,
    val itemName: String,
    val orderNo: String,
    val jcNo: String,
    val clientName: String,
    val machines: List<Pair<String, Double>>,
    val colours: List<ColourTotal>,
    val qty: Double,
    val kg: Double,
    val entries: Int,
    val labels: Int,
    val lastAt: String
)

data class ColourTotal(val colour: String, val qty: Double, val kg: Double, val entries: Int)

data class RecentUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val entries: List<ShiftEntry> = emptyList(),
    val search: String = "",
    val byJob: Boolean = true
) {
    val filtered: List<ShiftEntry>
        get() {
            val q = search.trim().lowercase()
            if (q.isEmpty()) return entries
            return entries.filter { e ->
                listOf(e.machine, e.itemName, e.colour, e.orderNo, e.jcNo, e.clientName, e.toLocation, e.shiftedBy)
                    .any { it.lowercase().contains(q) }
            }
        }

    val groups: List<JobGroup>
        get() = filtered
            .groupBy { e -> e.planId.ifBlank { "${e.orderNo}|${e.itemName}" } }
            .map { (key, list) ->
                val first = list.first()
                JobGroup(
                    key = key,
                    itemName = list.firstNotNullOfOrNull { it.itemName.ifBlank { null } }.orEmpty(),
                    orderNo = list.firstNotNullOfOrNull { it.orderNo.ifBlank { null } }.orEmpty(),
                    jcNo = list.firstNotNullOfOrNull { it.jcNo.ifBlank { null } }.orEmpty(),
                    clientName = list.firstNotNullOfOrNull { it.clientName.ifBlank { null } }.orEmpty(),
                    machines = list.groupBy { it.machine.ifBlank { "—" } }.map { (m, l) -> m to l.sumOf { it.quantity } }
                        .sortedByDescending { it.second },
                    colours = list.groupBy { it.colour.ifBlank { "Manual / no colour" } }
                        .map { (c, l) -> ColourTotal(c, l.sumOf { it.quantity }, l.sumOf { it.weightKg }, l.size) }
                        .sortedByDescending { it.qty },
                    qty = list.sumOf { it.quantity },
                    kg = list.sumOf { it.weightKg },
                    entries = list.size,
                    labels = list.count { it.totalLabels > 0 },
                    lastAt = first.createdAt
                )
            }
}

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

    fun setSearch(v: String) = _state.update { it.copy(search = v) }
    fun setByJob(v: Boolean) = _state.update { it.copy(byJob = v) }
}

@Composable
fun RecentScreen(onMenu: () -> Unit, vm: RecentViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val groups = s.groups
    val list = s.filtered
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Recent Entries",
                subtitle = "${list.size} shifts · ${groups.size} jobs · ${qty(list.sumOf { it.quantity })} pcs",
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
                item {
                    OutlinedTextField(
                        value = s.search,
                        onValueChange = vm::setSearch,
                        label = { Text("Search machine, item, colour, OR, party") },
                        leadingIcon = { Icon(Icons.Default.Search, null) },
                        trailingIcon = {
                            if (s.search.isNotEmpty()) IconButton(onClick = { vm.setSearch("") }) { Icon(Icons.Default.Close, contentDescription = "Clear") }
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = s.byJob, onClick = { vm.setByJob(true) }, label = { Text("By job") })
                        FilterChip(selected = !s.byJob, onClick = { vm.setByJob(false) }, label = { Text("Entries") })
                    }
                }
                s.error?.let { item { ErrorCard(it, onRetry = { vm.load() }) } }
                if (!s.loading && s.error == null && list.isEmpty()) {
                    item { EmptyNote(if (s.entries.isEmpty()) "No shifting entries yet." else "Nothing matches the search.") }
                }
                if (s.byJob) {
                    items(groups, key = { it.key }) { JobGroupCard(it) }
                } else {
                    items(list, key = { it.id.ifBlank { it.createdAt + it.machine } }) { EntryRow(it, showMachine = true) }
                }
            }
        }
    }
}

@Composable
private fun JobGroupCard(g: JobGroup) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(g.itemName.ifBlank { "—" }, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text("OR: ${g.orderNo.ifBlank { "—" }}   JC: ${g.jcNo.ifBlank { "—" }}", fontSize = 12.sp)
                    if (g.clientName.isNotBlank()) Text("Party: ${g.clientName}", fontSize = 12.sp)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("${qty(g.qty)} pcs", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = MaterialTheme.colorScheme.primary)
                    if (g.kg > 0) Text("${kg(g.kg)} kg", fontSize = 12.sp)
                    Text("${g.entries} entries · ${g.labels} labels", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text(
                "Machine: " + g.machines.joinToString(" · ") { (m, q) -> "$m (${qty(q)})" },
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            HorizontalDivider()
            g.colours.forEach { c ->
                Row(Modifier.fillMaxWidth()) {
                    Text(c.colour, Modifier.weight(1f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "${qty(c.qty)} pcs" + (if (c.kg > 0) " · ${kg(c.kg)} kg" else "") + " · ${c.entries}×",
                        fontSize = 12.sp
                    )
                }
            }
            Text("Last: ${ShiftClock.prettyTime(g.lastAt)}", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
