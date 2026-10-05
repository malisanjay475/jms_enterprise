package com.jmsocean.shifting.ui.summary

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
import com.jmsocean.shifting.data.remote.ShiftSummary
import com.jmsocean.shifting.data.remote.SummaryRow
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.EmptyNote
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.common.MetricRow
import com.jmsocean.shifting.ui.common.kg
import com.jmsocean.shifting.ui.common.qty
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate

data class MyShiftUiState(
    val date: LocalDate,
    val shift: String,
    val loading: Boolean = false,
    val error: String? = null,
    val summary: ShiftSummary? = null
)

class MyShiftViewModel : ViewModel() {
    private val repo = ShiftingApp.instance.repository
    private val _state = MutableStateFlow(ShiftClock.current().let { MyShiftUiState(date = it.date, shift = it.shift) })
    val state: StateFlow<MyShiftUiState> = _state.asStateFlow()

    init {
        load()
        NetworkWatcher.onNetworkBack(viewModelScope) { if (_state.value.error != null) load() }
    }

    fun load() {
        val s = _state.value
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.summary(s.date.toString(), s.shift)
                .onSuccess { sum -> _state.update { it.copy(loading = false, summary = sum) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Could not load the shift report", summary = null) } }
        }
    }

    fun setShift(shift: String) { _state.update { it.copy(shift = shift) }; load() }

    fun shiftDay(delta: Long) {
        val next = _state.value.date.plusDays(delta)
        if (next.isAfter(ShiftClock.current().date)) return
        _state.update { it.copy(date = next) }
        load()
    }
}

@Composable
fun MyShiftScreen(onMenu: () -> Unit, vm: MyShiftViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Shift Summary",
                subtitle = "${s.shift} shift · ${ShiftClock.prettyDate(s.date)}",
                onMenu = onMenu,
                actions = { IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Reload") } }
            )
        }
    ) { pad ->
        Column(
            Modifier
                .padding(pad)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.shiftDay(-1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Previous day") }
                Text(ShiftClock.prettyDate(s.date), Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                IconButton(onClick = { vm.shiftDay(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Next day") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Day", "Night").forEach { sh ->
                    FilterChip(selected = s.shift == sh, onClick = { vm.setShift(sh) }, label = { Text("$sh shift") })
                }
            }
            if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            s.error?.let { ErrorCard(it, onRetry = { vm.load() }) }

            val sum = s.summary ?: return@Column
            MetricRow(
                Triple("Shifted pcs", qty(sum.qty), MaterialTheme.colorScheme.primary),
                Triple("Weight kg", kg(sum.kg), Color.Unspecified)
            )
            MetricRow(
                Triple("Entries", sum.entries.toString(), Color.Unspecified),
                Triple("Label scans", sum.labels.toString(), Color.Unspecified),
                Triple("Manual", sum.manual.toString(), Color.Unspecified)
            )
            if (sum.entries == 0) {
                EmptyNote("Nothing shifted in this shift yet.")
                return@Column
            }
            Section("By machine", sum.byMachine)
            Section("By supervisor", sum.bySupervisor)
            Section("By destination", sum.byLocation)
        }
    }
}

@Composable
private fun Section(title: String, rows: List<SummaryRow>) {
    if (rows.isEmpty()) return
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            rows.forEachIndexed { i, r ->
                if (i > 0) HorizontalDivider()
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(r.title.ifBlank { "—" }, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        if (r.subtitle.isNotBlank()) Text(r.subtitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(qty(r.qty), fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                        if (r.kg > 0) Text("${kg(r.kg)} kg", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
