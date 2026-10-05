package com.jmsocean.shifting.ui.manual

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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.NetworkWatcher
import com.jmsocean.shifting.data.ScanFeedback
import com.jmsocean.shifting.data.remote.Job
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.common.MetricRow
import com.jmsocean.shifting.ui.common.PickerField
import com.jmsocean.shifting.ui.common.WeightQtyFields
import com.jmsocean.shifting.ui.common.cleanDecimal
import com.jmsocean.shifting.ui.common.kgForQty
import com.jmsocean.shifting.ui.common.qty
import com.jmsocean.shifting.ui.common.qtyForKg
import com.jmsocean.shifting.ui.theme.Crit
import com.jmsocean.shifting.ui.theme.Good
import com.jmsocean.shifting.ui.theme.Warn
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private fun firstNumber(s: String): Int = Regex("\\d+").find(s)?.value?.toIntOrNull() ?: Int.MAX_VALUE
private fun lastNumber(s: String): Int = Regex("\\d+").findAll(s).lastOrNull()?.value?.toIntOrNull() ?: Int.MAX_VALUE

data class ManualUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val jobs: List<Job> = emptyList(),
    val line: String = "",
    val machine: String = "",
    val planId: String = "",
    val locations: List<String> = emptyList(),
    val location: String = "",
    val weight: String = "",
    val quantity: String = "",
    val saving: Boolean = false,
    val message: String? = null,
    val messageOk: Boolean = true
) {
    val lines: List<String>
        get() = jobs.map { it.line }.filter { it.isNotBlank() }.distinct()
            .sortedWith(compareBy({ it.substringBefore('-').trim() }, { firstNumber(it) }, { it }))

    /** Machines of the line, Line then machine number (DPR Compliance order). */
    val machines: List<String>
        get() = jobs.filter { it.line == line }.map { it.machine }.filter { it.isNotBlank() }.distinct()
            .sortedWith(compareBy({ lastNumber(it) }, { it }))

    /** Jobs on the machine: running first, then those with material still on the floor. */
    val machineJobs: List<Job>
        get() = jobs.filter { it.line == line && it.machine == machine }
            .sortedWith(compareBy({ !it.isRunning }, { -it.floorBalance }))

    val job: Job? get() = machineJobs.firstOrNull { it.planId == planId }
}

class ManualViewModel : ViewModel() {
    private val app = ShiftingApp.instance
    private val repo = app.repository

    private val _state = MutableStateFlow(ManualUiState(location = app.session.lastLocation))
    val state: StateFlow<ManualUiState> = _state.asStateFlow()

    private val _beep = MutableSharedFlow<Boolean>(extraBufferCapacity = 2)
    val beep = _beep.asSharedFlow()

    init {
        load()
        loadLocations()
        NetworkWatcher.onNetworkBack(viewModelScope) {
            if (_state.value.error != null) load()
            if (_state.value.locations.isEmpty()) loadLocations()
        }
    }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            repo.jobs(days = 3, allLines = true)
                .onSuccess { list ->
                    _state.update { s ->
                        val n = s.copy(loading = false, jobs = list)
                        // Start on the user's own line the first time.
                        val line = s.line.takeIf { it in n.lines }
                            ?: n.lines.firstOrNull { it.equals(app.session.line, ignoreCase = true) }.orEmpty()
                        val m = n.copy(line = line)
                        val machine = s.machine.takeIf { it in m.machines }.orEmpty()
                        val mm = m.copy(machine = machine)
                        mm.copy(planId = s.planId.takeIf { id -> mm.machineJobs.any { it.planId == id } } ?: mm.machineJobs.firstOrNull()?.planId.orEmpty())
                    }
                }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Could not load jobs") } }
        }
    }

    private fun loadLocations() {
        viewModelScope.launch {
            repo.locations().onSuccess { list ->
                _state.update { s ->
                    s.copy(locations = list, location = s.location.takeIf { l -> list.any { it.equals(l, ignoreCase = true) } }.orEmpty())
                }
            }
        }
    }

    fun setLine(line: String) = _state.update { it.copy(line = line, machine = "", planId = "", weight = "", quantity = "", message = null) }

    fun setMachine(machine: String) = _state.update { s ->
        val n = s.copy(machine = machine, weight = "", quantity = "", message = null)
        n.copy(planId = n.machineJobs.firstOrNull()?.planId.orEmpty())
    }

    fun setJob(planId: String) = _state.update { it.copy(planId = planId, weight = "", quantity = "", message = null) }

    fun setLocation(loc: String) {
        app.session.lastLocation = loc
        _state.update { it.copy(location = loc, message = null) }
    }

    fun setWeight(v: String) {
        val clean = cleanDecimal(v)
        val unit = _state.value.job?.unitWeightKg ?: 0.0
        _state.update {
            it.copy(
                weight = clean, message = null,
                quantity = if (unit > 0) qtyForKg(clean.toDoubleOrNull() ?: 0.0, unit).takeIf { q -> q > 0 }?.toString().orEmpty() else it.quantity
            )
        }
    }

    fun setQuantity(v: String) {
        val clean = v.filter(Char::isDigit).take(7)
        val unit = _state.value.job?.unitWeightKg ?: 0.0
        _state.update {
            it.copy(quantity = clean, message = null, weight = if (unit > 0) kgForQty(clean.toIntOrNull() ?: 0, unit) else it.weight)
        }
    }

    fun shift() {
        val s = _state.value
        val job = s.job
        val q = s.quantity.toIntOrNull() ?: 0
        val fail = when {
            job == null -> "Pick the line and machine."
            s.location.isBlank() -> "Pick where the material is going (Send To)."
            q <= 0 -> "Enter the weight or the quantity."
            q > job.floorBalance -> "Only ${qty(job.floorBalance)} pcs are on the shop floor for this job."
            else -> null
        }
        if (fail != null || job == null) {
            _state.update { it.copy(message = fail, messageOk = false) }
            _beep.tryEmit(false)
            return
        }
        val weight = s.weight.toDoubleOrNull()?.takeIf { it > 0 }
        _state.update { it.copy(saving = true, message = null) }
        viewModelScope.launch {
            repo.manualShift(job.planId, job.machine, q, s.location, weight)
                .onSuccess {
                    _beep.tryEmit(true)
                    _state.update {
                        it.copy(
                            saving = false, quantity = "", weight = "", messageOk = true,
                            message = "Shifted ${qty(q.toDouble())} pcs from ${job.machine} → ${s.location}"
                        )
                    }
                    load()
                }
                .onFailure { e ->
                    _beep.tryEmit(false)
                    _state.update { it.copy(saving = false, message = e.message ?: "Shift failed.", messageOk = false) }
                }
        }
    }
}

@Composable
fun ManualScreen(onMenu: () -> Unit, vm: ManualViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    LaunchedEffect(Unit) { vm.beep.collect { ok -> if (ok) ScanFeedback.success(ctx) else ScanFeedback.error(ctx) } }
    val job = s.job

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Manual Shift",
                subtitle = "Material without a label",
                onMenu = onMenu,
                actions = { IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Reload") } }
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
            s.error?.let { ErrorCard(it, onRetry = { vm.load() }) }

            s.message?.let {
                Card(colors = CardDefaults.cardColors(containerColor = if (s.messageOk) Good else Crit)) {
                    Text(it, Modifier.padding(14.dp), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }

            PickerField("Line", s.lines, s.line, vm::setLine, Modifier.fillMaxWidth(), placeholder = "Select line")
            PickerField(
                "Machine", s.machines, s.machine, vm::setMachine, Modifier.fillMaxWidth(),
                placeholder = if (s.line.isBlank()) "Pick the line first" else "Select machine",
                enabled = s.line.isNotBlank()
            )
            if (s.machineJobs.size > 1) {
                PickerField(
                    "Job", s.machineJobs.map { it.planId }, s.planId, vm::setJob, Modifier.fillMaxWidth(),
                    optionLabel = { id ->
                        s.machineJobs.firstOrNull { it.planId == id }?.let { j ->
                            "${j.itemName.ifBlank { j.mouldName }} · ${if (j.isRunning) "Running" else j.status} · floor ${qty(j.floorBalance)}"
                        } ?: id
                    }
                )
            }
            if (s.machine.isNotBlank() && s.machineJobs.isEmpty() && !s.loading) {
                Text("No job on this machine in the last 3 days.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            if (job != null) {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(job.itemName.ifBlank { job.mouldName }.ifBlank { "—" }, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(
                            listOf(job.orderNo, job.jcNo, if (job.isRunning) "Running" else job.status).filter { it.isNotBlank() }.joinToString(" · "),
                            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        MetricRow(
                            Triple("Produced", qty(job.produced), Color.Unspecified),
                            Triple("Shifted", qty(job.shifted), MaterialTheme.colorScheme.primary),
                            Triple("On floor", qty(job.floorBalance), if (job.floorBalance > 0) Warn else Color.Unspecified)
                        )
                    }
                }

                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        PickerField("Send To", s.locations, s.location, vm::setLocation, Modifier.fillMaxWidth(), placeholder = "Select location")
                        WeightQtyFields(
                            weight = s.weight,
                            quantity = s.quantity,
                            unitWeightKg = job.unitWeightKg,
                            onWeight = vm::setWeight,
                            onQuantity = vm::setQuantity,
                            maxQty = job.floorBalance.toInt()
                        )
                        val q = s.quantity.toIntOrNull() ?: 0
                        Button(
                            onClick = { vm.shift() },
                            enabled = !s.saving,
                            modifier = Modifier.fillMaxWidth().height(54.dp)
                        ) {
                            Text(
                                when {
                                    s.saving -> "Saving…"
                                    s.location.isBlank() -> "Pick Send To first"
                                    q <= 0 -> "Enter weight or quantity"
                                    else -> "Shift ${qty(q.toDouble())} pcs → ${s.location}"
                                },
                                fontWeight = FontWeight.Bold, fontSize = 16.sp
                            )
                        }
                    }
                }
            }
        }
    }
}
