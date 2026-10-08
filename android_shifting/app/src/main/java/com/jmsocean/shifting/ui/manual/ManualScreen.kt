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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import com.jmsocean.shifting.data.remote.MachineApproved
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.EmptyNote
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.common.JobAvailabilityCard
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

/** Manual screen views: the machine board (QC approved qty per machine) or the line / machine form. */
enum class ManualView { MACHINES, FORM }

data class ManualUiState(
    val view: ManualView = ManualView.MACHINES,
    val board: List<MachineApproved> = emptyList(),
    val boardLoading: Boolean = false,
    val boardError: String? = null,
    val approvedOnly: Boolean = false,
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

    /** Board rows: all machines in the server's order, or only those with approved qty. */
    val boardRows: List<MachineApproved>
        get() = if (approvedOnly) board.filter { it.approvedQty > 0 } else board
}

class ManualViewModel : ViewModel() {
    private val app = ShiftingApp.instance
    private val repo = app.repository

    private val _state = MutableStateFlow(ManualUiState(location = app.session.lastLocation, approvedOnly = app.session.approvedOnly))
    val state: StateFlow<ManualUiState> = _state.asStateFlow()

    private val _beep = MutableSharedFlow<Boolean>(extraBufferCapacity = 2)
    val beep = _beep.asSharedFlow()
    private var availJob: CoJob? = null

    init {
        load()
        loadBoard()
        loadLocations()
        NetworkWatcher.onNetworkBack(viewModelScope) {
            if (_state.value.error != null) load()
            if (_state.value.boardError != null) loadBoard()
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

    fun loadBoard() {
        _state.update { it.copy(boardLoading = true, boardError = null) }
        viewModelScope.launch {
            repo.machineBoard(days = 3)
                .onSuccess { list -> _state.update { it.copy(boardLoading = false, board = list) } }
                .onFailure { e -> _state.update { it.copy(boardLoading = false, boardError = e.message ?: "Could not load machines") } }
        }
    }

    fun reload() {
        load()
        loadBoard()
    }

    fun setView(v: ManualView) = _state.update { it.copy(view = v) }

    fun setApprovedOnly(v: Boolean) {
        app.session.approvedOnly = v
        _state.update { it.copy(approvedOnly = v) }
    }

    /** Open button on the board: the machine's job, with the same details and shift form as the form view. */
    fun openMachine(m: MachineApproved) {
        val line = _state.value.jobs.firstOrNull { it.machine == m.machine }?.line?.takeIf { it.isNotBlank() } ?: m.line
        _state.update {
            it.copy(view = ManualView.FORM, line = line, machine = m.machine, planId = "", avail = null, weight = "", quantity = "", message = null)
        }
        // The board's job is kept even while the job list is still loading; load() picks it up.
        val planId = m.bestPlanId.ifBlank { _state.value.machineJobs.firstOrNull()?.planId.orEmpty() }
        if (planId.isNotBlank()) selectJob(planId)
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
                    loadBoard()
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
                actions = { IconButton(onClick = { vm.reload() }) { Icon(Icons.Default.Refresh, contentDescription = "Reload") } }
            )
        }
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            TabRow(selectedTabIndex = s.view.ordinal) {
                Tab(selected = s.view == ManualView.MACHINES, onClick = { vm.setView(ManualView.MACHINES) }, text = { Text("Machines") })
                Tab(selected = s.view == ManualView.FORM, onClick = { vm.setView(ManualView.FORM) }, text = { Text("Line / Machine") })
            }
            if (s.view == ManualView.MACHINES) {
                MachineBoard(s, onToggle = vm::setApprovedOnly, onOpen = vm::openMachine, onRetry = { vm.loadBoard() })
                return@Column
            }
            Column(
                Modifier
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
}

/**
 * Machines view: toggle on = only machines with QC approved qty; off = every machine in the
 * standard order (Line, then machine number). Open = that machine's job details + shift form.
 */
@Composable
private fun MachineBoard(
    s: ManualUiState,
    onToggle: (Boolean) -> Unit,
    onOpen: (MachineApproved) -> Unit,
    onRetry: () -> Unit
) {
    val rows = s.boardRows
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (s.boardLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
        s.boardError?.let { ErrorCard(it, onRetry = onRetry) }
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Row(
                Modifier.fillMaxWidth().clickable { onToggle(!s.approvedOnly) }.padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Only QC approved", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text(
                        if (s.approvedOnly) "Machines with approved qty to shift" else "All machines",
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(checked = s.approvedOnly, onCheckedChange = onToggle)
            }
        }
        if (!s.boardLoading && s.boardError == null && rows.isEmpty()) {
            EmptyNote(if (s.approvedOnly) "No machine has QC approved qty waiting to be shifted." else "No machines.")
            return@Column
        }
        if (rows.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                Text("Machine", Modifier.weight(1f), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Approved", Modifier.width(84.dp), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End)
                Spacer(Modifier.width(8.dp))
                Text("Action", Modifier.width(84.dp), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
        }
        var lastLine: String? = null
        rows.forEach { m ->
            if (m.line != lastLine) {
                lastLine = m.line
                Text(
                    m.line.ifBlank { "No line" }, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 6.dp, start = 4.dp)
                )
            }
            MachineRow(m, onOpen = { onOpen(m) })
        }
    }
}

@Composable
private fun MachineRow(m: MachineApproved, onOpen: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(m.machine, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (m.onHold) {
                        Spacer(Modifier.width(6.dp))
                        Pill("QC HOLD", Crit.copy(alpha = 0.15f), Crit)
                    }
                }
                Text(
                    m.runningItem.ifBlank { if (m.jobs > 0) "${m.jobs} job(s)" else "No job in 3 days" },
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis
                )
            }
            Text(
                qty(m.approvedQty), Modifier.width(84.dp), textAlign = TextAlign.End,
                fontWeight = if (m.approvedQty > 0) FontWeight.Black else FontWeight.Normal, fontSize = 17.sp,
                color = if (m.approvedQty > 0) Good else MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.width(8.dp))
            if (m.approvedQty > 0) {
                Button(onClick = onOpen, enabled = m.jobs > 0, modifier = Modifier.width(84.dp)) { Text("Open", fontWeight = FontWeight.Bold) }
            } else {
                OutlinedButton(onClick = onOpen, enabled = m.jobs > 0, modifier = Modifier.width(84.dp)) { Text("Open") }
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
