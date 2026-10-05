package com.jmsocean.shifting.ui.manual

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.NetworkWatcher
import com.jmsocean.shifting.data.ScanFeedback
import com.jmsocean.shifting.data.remote.Availability
import com.jmsocean.shifting.data.remote.Job
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.common.MetricRow
import com.jmsocean.shifting.ui.common.Pill
import com.jmsocean.shifting.ui.common.PickerField
import com.jmsocean.shifting.ui.common.WeightQtyFields
import com.jmsocean.shifting.ui.common.cleanDecimal
import com.jmsocean.shifting.ui.common.kgForQty
import com.jmsocean.shifting.ui.common.qty
import com.jmsocean.shifting.ui.common.qtyForKg
import com.jmsocean.shifting.ui.scan.blockTitle
import com.jmsocean.shifting.ui.theme.Crit
import com.jmsocean.shifting.ui.theme.Good
import com.jmsocean.shifting.ui.theme.Steel
import com.jmsocean.shifting.ui.theme.Warn
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private fun firstNumber(s: String): Int = Regex("\\d+").find(s)?.value?.toIntOrNull() ?: Int.MAX_VALUE
private fun lastNumber(s: String): Int = Regex("\\d+").findAll(s).lastOrNull()?.value?.toIntOrNull() ?: Int.MAX_VALUE

data class ManualMessage(val ok: Boolean, val text: String, val title: String = "")

data class ManualUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val jobs: List<Job> = emptyList(),
    val line: String = "",
    val machine: String = "",
    val planId: String = "",
    val avail: Availability? = null,
    val availLoading: Boolean = false,
    val availError: String? = null,
    val locations: List<String> = emptyList(),
    val location: String = "",
    val weight: String = "",
    val quantity: String = "",
    val saving: Boolean = false,
    val message: ManualMessage? = null
) {
    val lines: List<String>
        get() = jobs.map { it.line }.filter { it.isNotBlank() }.distinct()
            .sortedWith(compareBy({ it.substringBefore('-').trim() }, { firstNumber(it) }, { it }))

    /** Machines of the line, in machine-number order (DPR Compliance order). */
    val machines: List<String>
        get() = jobs.filter { it.line == line }.map { it.machine }.filter { it.isNotBlank() }.distinct()
            .sortedWith(compareBy({ lastNumber(it) }, { it }))

    /** Jobs on the machine: running first, then the most ready to shift. */
    val machineJobs: List<Job>
        get() = jobs.filter { it.line == line && it.machine == machine }
            .sortedWith(compareBy({ !it.isRunning }, { -it.readyQty }, { -it.floorBalance }))

    val job: Job? get() = machineJobs.firstOrNull { it.planId == planId }
}

class ManualViewModel : ViewModel() {
    private val app = ShiftingApp.instance
    private val repo = app.repository

    private val _state = MutableStateFlow(ManualUiState(location = app.session.lastLocation))
    val state: StateFlow<ManualUiState> = _state.asStateFlow()

    private val _beep = MutableSharedFlow<Boolean>(extraBufferCapacity = 2)
    val beep = _beep.asSharedFlow()
    private var availJob: CoJob? = null

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
                        m.copy(machine = s.machine.takeIf { it in m.machines }.orEmpty())
                    }
                    _state.value.planId.takeIf { it.isNotBlank() }?.let { loadAvailability(it) }
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

    private fun loadAvailability(planId: String) {
        availJob?.cancel()
        _state.update { it.copy(availLoading = true, availError = null) }
        availJob = viewModelScope.launch {
            repo.availability(planId)
                .onSuccess { a -> _state.update { if (it.planId == planId) it.copy(availLoading = false, avail = a) else it } }
                .onFailure { e -> _state.update { it.copy(availLoading = false, availError = e.message ?: "Could not load the job") } }
        }
    }

    fun setLine(line: String) = _state.update {
        it.copy(line = line, machine = "", planId = "", avail = null, weight = "", quantity = "", message = null)
    }

    fun setMachine(machine: String) = _state.update {
        it.copy(machine = machine, planId = "", avail = null, weight = "", quantity = "", message = null)
    }

    fun selectJob(planId: String) {
        _state.update { it.copy(planId = planId, avail = null, weight = "", quantity = "", message = null) }
        loadAvailability(planId)
    }

    fun setLocation(loc: String) {
        app.session.lastLocation = loc
        _state.update { it.copy(location = loc, message = null) }
    }

    private fun unitWeight(): Double = _state.value.avail?.unitWeightKg?.takeIf { it > 0 } ?: _state.value.job?.unitWeightKg ?: 0.0

    fun setWeight(v: String) {
        val clean = cleanDecimal(v)
        val unit = unitWeight()
        _state.update {
            it.copy(
                weight = clean, message = null,
                quantity = if (unit > 0) qtyForKg(clean.toDoubleOrNull() ?: 0.0, unit).takeIf { q -> q > 0 }?.toString().orEmpty() else it.quantity
            )
        }
    }

    fun setQuantity(v: String) {
        val clean = v.filter(Char::isDigit).take(7)
        val unit = unitWeight()
        _state.update {
            it.copy(quantity = clean, message = null, weight = if (unit > 0) kgForQty(clean.toIntOrNull() ?: 0, unit) else it.weight)
        }
    }

    fun shift() {
        val s = _state.value
        val job = s.job
        val a = s.avail
        val q = s.quantity.toIntOrNull() ?: 0
        val max = (a?.maxShiftQty ?: job?.maxShiftQty ?: 0.0).toInt()
        val fail: ManualMessage? = when {
            job == null -> ManualMessage(false, "Pick the line, machine and job.")
            a != null && a.produced <= 0 -> ManualMessage(false, "No production is entered in DPR for this job.", "NOT PRODUCED")
            s.location.isBlank() -> ManualMessage(false, "Pick where the material is going (Send To).")
            q <= 0 -> ManualMessage(false, "Enter the weight or the quantity.")
            q > max && a?.verificationEnforced == true ->
                ManualMessage(false, "Only ${qty(max.toDouble())} QC-verified pcs are ready to shift (not verified ${qty(a.notVerified)}).", "NOT QC VERIFIED")
            q > max -> ManualMessage(false, "Only ${qty(max.toDouble())} pcs are on the shop floor for this job.")
            else -> null
        }
        if (fail != null || job == null) {
            _state.update { it.copy(message = fail) }
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
                            saving = false, quantity = "", weight = "",
                            message = ManualMessage(true, "Shifted ${qty(q.toDouble())} pcs from ${job.machine} → ${s.location}")
                        )
                    }
                    load()
                }
                .onFailure { e ->
                    _beep.tryEmit(false)
                    val msg = e.message ?: "Shift failed."
                    val title = blockTitle(msg)
                    _state.update {
                        it.copy(saving = false, message = ManualMessage(false, if (title.isBlank()) msg else msg.substringAfter(": ", msg), title))
                    }
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
    val a = s.avail

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
            s.message?.let { MessageCard(it) }

            PickerField("Line", s.lines, s.line, vm::setLine, Modifier.fillMaxWidth(), placeholder = "Select line")
            PickerField(
                "Machine", s.machines, s.machine, vm::setMachine, Modifier.fillMaxWidth(),
                placeholder = if (s.line.isBlank()) "Pick the line first" else "Select machine",
                enabled = s.line.isNotBlank()
            )

            if (s.machine.isNotBlank()) {
                if (s.machineJobs.isEmpty() && !s.loading) {
                    Text("No job on this machine in the last 3 days.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Text("Jobs on ${s.machine}", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    s.machineJobs.forEach { j -> JobChoice(j, selected = j.planId == s.planId, onClick = { vm.selectJob(j.planId) }) }
                }
            }

            if (job != null) {
                if (s.availLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                s.availError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
                a?.let { JobAvailabilityCard(it) }

                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        PickerField("Send To", s.locations, s.location, vm::setLocation, Modifier.fillMaxWidth(), placeholder = "Select location")
                        WeightQtyFields(
                            weight = s.weight,
                            quantity = s.quantity,
                            unitWeightKg = a?.unitWeightKg?.takeIf { it > 0 } ?: job.unitWeightKg,
                            onWeight = vm::setWeight,
                            onQuantity = vm::setQuantity,
                            maxQty = (a?.maxShiftQty ?: job.maxShiftQty).toInt()
                        )
                        val q = s.quantity.toIntOrNull() ?: 0
                        Button(
                            onClick = { vm.shift() },
                            enabled = !s.saving && a != null,
                            modifier = Modifier.fillMaxWidth().height(54.dp)
                        ) {
                            Text(
                                when {
                                    s.saving -> "Saving…"
                                    a == null -> "Loading job…"
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

@Composable
private fun MessageCard(m: ManualMessage) {
    Card(colors = CardDefaults.cardColors(containerColor = if (m.ok) Good else Crit)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (!m.ok && m.title.isNotBlank()) {
                Icon(Icons.Default.Block, null, tint = Color.White, modifier = Modifier.size(40.dp))
                Text(m.title, color = Color.White, fontWeight = FontWeight.Black, fontSize = 28.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(4.dp))
            }
            Text(m.text, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, textAlign = TextAlign.Center)
        }
    }
}

/** Small selectable card for one job on the machine. */
@Composable
private fun JobChoice(j: Job, selected: Boolean, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    j.itemName.ifBlank { j.mouldName }.ifBlank { "—" }, Modifier.weight(1f),
                    fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.width(6.dp))
                when {
                    j.onHold -> Pill("QC HOLD", Crit.copy(alpha = 0.15f), Crit)
                    j.isRunning -> Pill("Running", Good.copy(alpha = 0.15f), Good)
                    else -> Pill(j.status.ifBlank { "Closed" }, Steel.copy(alpha = 0.15f), Steel)
                }
            }
            Text(
                listOf(j.orderNo, j.jcNo, j.clientName).filter { it.isNotBlank() }.joinToString(" · "),
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                "Produced ${qty(j.produced)} · Verified ${qty(j.verified)} · Shifted ${qty(j.shifted)} · Ready ${qty(j.readyQty)}",
                fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                color = if (j.readyQty > 0) Good else MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/** Selected job: OR / party, totals and the colour-wise table. */
@Composable
private fun JobAvailabilityCard(a: Availability) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(a.itemName.ifBlank { a.mouldName }.ifBlank { "—" }, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text("OR: ${a.orderNo.ifBlank { "—" }}   JC: ${a.jcNo.ifBlank { "—" }}", fontSize = 13.sp)
            Text("Party: ${a.clientName.ifBlank { "—" }}", fontSize = 13.sp)
            Text(
                listOf(a.machine, a.planCode, a.status, "Plan ${qty(a.planQty)}").filter { it.isNotBlank() }.joinToString(" · "),
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            MetricRow(
                Triple("Produced", qty(a.produced), Color.Unspecified),
                Triple("QC verified", qty(a.verified), Good),
                Triple("Not verified", qty(a.notVerified), if (a.notVerified > 0) Crit else Color.Unspecified)
            )
            MetricRow(
                Triple("Shifted", qty(a.shifted), MaterialTheme.colorScheme.primary),
                Triple("Ready (floor)", qty(a.ready), if (a.ready > 0) Good else Color.Unspecified),
                Triple("On QC hold", if (a.holdCount > 0 && a.holdQty <= 0) "Yes" else qty(a.holdQty), if (a.holdCount > 0) Crit else Color.Unspecified)
            )
            if (a.holdCount > 0) {
                Text(
                    "QC HOLD on ${a.machine}: ${a.holdReasons.joinToString("; ").ifBlank { "no reason given" }}",
                    color = Crit, fontWeight = FontWeight.SemiBold, fontSize = 13.sp
                )
            }
            if (!a.verificationEnforced) {
                Text("QC verification data is not on this server; only production is checked.", fontSize = 11.sp, color = Warn)
            }
            if (a.colours.isNotEmpty()) {
                HorizontalDivider()
                Text("Colour-wise", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Row(Modifier.fillMaxWidth()) {
                    listOf("Colour" to 2.2f, "Prod" to 1f, "QC ok" to 1f, "Not ver." to 1f, "Shifted" to 1f, "Ready" to 1f).forEach { (h, w) ->
                        Text(h, Modifier.weight(w), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                a.colours.forEach { c ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(c.colour.ifBlank { "—" }, Modifier.weight(2.2f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 2)
                        Text(qty(c.produced), Modifier.weight(1f), fontSize = 12.sp)
                        Text(qty(c.verified), Modifier.weight(1f), fontSize = 12.sp, color = Good)
                        Text(qty(c.notVerified), Modifier.weight(1f), fontSize = 12.sp, color = if (c.notVerified > 0) Crit else Color.Unspecified)
                        Text(qty(c.shifted), Modifier.weight(1f), fontSize = 12.sp)
                        Text(qty(c.ready), Modifier.weight(1f), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (c.ready > 0) Good else Color.Unspecified)
                    }
                }
            }
        }
    }
}
