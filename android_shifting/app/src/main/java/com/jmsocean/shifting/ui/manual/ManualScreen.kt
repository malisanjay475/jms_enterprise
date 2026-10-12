package com.jmsocean.shifting.ui.manual

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import com.jmsocean.shifting.data.remote.AvailColour
import com.jmsocean.shifting.data.remote.Availability
import com.jmsocean.shifting.data.remote.BoardJob
import com.jmsocean.shifting.data.remote.Job
import com.jmsocean.shifting.data.remote.MachineApproved
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.EmptyNote
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.common.InfoChip
import com.jmsocean.shifting.ui.common.JobBreakdownCard
import com.jmsocean.shifting.ui.common.JobSummaryCard
import com.jmsocean.shifting.ui.common.Pill
import com.jmsocean.shifting.ui.common.PickerField
import com.jmsocean.shifting.ui.common.PackQtyFields
import com.jmsocean.shifting.ui.common.SfgBlockCard
import com.jmsocean.shifting.ui.common.packText
import com.jmsocean.shifting.ui.common.packsForQty
import com.jmsocean.shifting.ui.common.cleanDecimal
import com.jmsocean.shifting.ui.common.kg
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

/** Manual screen views: the machine board (pending jobs per machine) or the line / machine form. */
enum class ManualView { MACHINES, FORM }

/** Board filter, same as the web Manual Entry page. */
enum class BoardView(val label: String) {
    PENDING("Pending"), READY("Ready to shift"), NOSFG("SFG std not set"), ALL("All machines")
}

/** One machine on the board with the jobs the current filter shows under it. */
data class BoardRow(val machine: MachineApproved, val jobs: List<BoardJob>)

/** Line header + its machines. */
data class BoardSection(val line: String, val rows: List<BoardRow>) {
    val approved: Double get() = rows.sumOf { it.machine.approvedQty }
    val jobCount: Int get() = rows.sumOf { it.jobs.size }
}

data class ManualUiState(
    val view: ManualView = ManualView.MACHINES,
    val board: List<MachineApproved> = emptyList(),
    val boardLoading: Boolean = false,
    val boardError: String? = null,
    val boardView: BoardView = BoardView.PENDING,
    val boardLine: String = "",
    val search: String = "",
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
    /** Colour of the material being shifted (one of the job's produced colours). */
    val colour: String = "",
    val weight: String = "",
    val quantity: String = "",
    /** Full SFG packs (LD bag / crate …); packs, quantity and weight fill each other. */
    val packs: String = "",
    val saving: Boolean = false,
    val message: ManualMessage? = null
) {
    /** Most that can be shifted now: of the picked colour, else of the whole job. */
    val maxQty: Double
        get() = avail?.let { a -> a.colourNamed(colour)?.let { a.colourMax(it) } ?: a.maxShiftQty } ?: job?.maxShiftQty ?: 0.0

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

    /** Lines on the board, in the server's order (Line, then machine number). */
    val boardLines: List<String> get() = board.map { it.line }.distinct()

    /** Board rows after the filter, line chip and search, grouped by line. */
    val boardSections: List<BoardSection>
        get() {
            val q = search.trim()
            val rows = board.mapNotNull { m ->
                if (boardLine.isNotBlank() && m.line != boardLine) return@mapNotNull null
                var jobs = m.pendingJobs
                when (boardView) {
                    BoardView.READY -> jobs = jobs.filter { it.approved > 0 }
                    BoardView.NOSFG -> jobs = jobs.filter { !it.hasSfgStd }
                    else -> Unit
                }
                val machineHit = q.isBlank() || m.machine.contains(q, ignoreCase = true)
                if (!machineHit) jobs = jobs.filter { it.matches(q) }
                when {
                    boardView != BoardView.ALL && jobs.isEmpty() -> null
                    boardView == BoardView.ALL && !machineHit && jobs.isEmpty() -> null
                    else -> BoardRow(m, jobs)
                }
            }
            val sections = mutableListOf<BoardSection>()
            rows.forEach { r ->
                val last = sections.lastOrNull()
                if (last != null && last.line == r.machine.line) sections[sections.lastIndex] = last.copy(rows = last.rows + r)
                else sections += BoardSection(r.machine.line, listOf(r))
            }
            return sections
        }

    // Totals for the KPI strip (whole board, not filtered).
    val kpiApproved: Double get() = board.sumOf { it.approvedQty }
    val kpiMachines: Int get() = board.count { it.approvedQty > 0 }
    val kpiPending: Int get() = board.sumOf { it.pendingJobs.size }
    val kpiReady: Int get() = board.sumOf { m -> m.pendingJobs.count { it.approved > 0 } }
    val kpiNoSfg: Int get() = board.sumOf { m -> m.pendingJobs.count { !it.hasSfgStd } }
}

class ManualViewModel : ViewModel() {
    private val app = ShiftingApp.instance
    private val repo = app.repository

    private val _state = MutableStateFlow(
        ManualUiState(
            location = app.session.lastLocation,
            boardView = if (app.session.approvedOnly) BoardView.READY else BoardView.PENDING
        )
    )
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
                .onSuccess { list ->
                    _state.update { s ->
                        s.copy(boardLoading = false, board = list, boardLine = s.boardLine.takeIf { l -> list.any { it.line == l } }.orEmpty())
                    }
                }
                .onFailure { e -> _state.update { it.copy(boardLoading = false, boardError = e.message ?: "Could not load machines") } }
        }
    }

    fun reload() {
        load()
        loadBoard()
    }

    fun setView(v: ManualView) = _state.update { it.copy(view = v) }

    fun setBoardView(v: BoardView) {
        app.session.approvedOnly = v == BoardView.READY
        _state.update { it.copy(boardView = v) }
    }

    fun setBoardLine(line: String) = _state.update { it.copy(boardLine = if (it.boardLine == line) "" else line) }

    fun setSearch(q: String) = _state.update { it.copy(search = q.take(40)) }

    /** Board tap: that job (or the machine's best job) with the same details and shift form as the form view. */
    fun openJob(m: MachineApproved, planId: String? = null) {
        val line = _state.value.jobs.firstOrNull { it.machine == m.machine }?.line?.takeIf { it.isNotBlank() } ?: m.line
        _state.update {
            it.copy(view = ManualView.FORM, line = line, machine = m.machine, planId = "", avail = null, colour = "", weight = "", quantity = "", packs = "", message = null)
        }
        // The board's job is kept even while the job list is still loading; load() picks it up.
        val pick = planId?.takeIf { it.isNotBlank() } ?: m.bestPlanId.ifBlank { _state.value.machineJobs.firstOrNull()?.planId.orEmpty() }
        if (pick.isNotBlank()) selectJob(pick)
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
                .onSuccess { a ->
                    _state.update {
                        if (it.planId == planId) it.copy(availLoading = false, avail = a, colour = a.defaultColour(it.colour)) else it
                    }
                }
                .onFailure { e -> _state.update { it.copy(availLoading = false, availError = e.message ?: "Could not load the job") } }
        }
    }

    fun setLine(line: String) = _state.update {
        it.copy(line = line, machine = "", planId = "", avail = null, colour = "", weight = "", quantity = "", packs = "", message = null)
    }

    fun setMachine(machine: String) = _state.update {
        it.copy(machine = machine, planId = "", avail = null, colour = "", weight = "", quantity = "", packs = "", message = null)
    }

    fun selectJob(planId: String) {
        _state.update { it.copy(planId = planId, avail = null, colour = "", weight = "", quantity = "", packs = "", message = null) }
        loadAvailability(planId)
    }

    fun setColour(colour: String) = _state.update { it.copy(colour = colour, message = null) }

    fun setLocation(loc: String) {
        app.session.lastLocation = loc
        _state.update { it.copy(location = loc, message = null) }
    }

    private fun unitWeight(): Double = _state.value.avail?.unitWeightKg?.takeIf { it > 0 } ?: _state.value.job?.unitWeightKg ?: 0.0

    private fun sfgStd(): Double = _state.value.avail?.sfgStd ?: 0.0

    private fun packsText(q: Int): String = packsForQty(q, sfgStd()).takeIf { it > 0 }?.toString().orEmpty()

    fun setWeight(v: String) {
        val clean = cleanDecimal(v)
        val unit = unitWeight()
        _state.update {
            val q = if (unit > 0) qtyForKg(clean.toDoubleOrNull() ?: 0.0, unit) else it.quantity.toIntOrNull() ?: 0
            it.copy(
                weight = clean, message = null,
                quantity = if (unit > 0) q.takeIf { n -> n > 0 }?.toString().orEmpty() else it.quantity,
                packs = packsText(q)
            )
        }
    }

    fun setQuantity(v: String) {
        val clean = v.filter(Char::isDigit).take(7)
        val unit = unitWeight()
        val q = clean.toIntOrNull() ?: 0
        _state.update {
            it.copy(quantity = clean, message = null, weight = if (unit > 0) kgForQty(q, unit) else it.weight, packs = packsText(q))
        }
    }

    /** Number of full SFG packs; quantity = packs × SFG std, weight follows. */
    fun setPacks(v: String) {
        val clean = v.filter(Char::isDigit).take(5)
        val std = sfgStd()
        val q = if (std > 0) ((clean.toIntOrNull() ?: 0) * std).toInt() else 0
        val unit = unitWeight()
        _state.update {
            it.copy(
                packs = clean, message = null,
                quantity = q.takeIf { n -> n > 0 }?.toString().orEmpty(),
                weight = if (unit > 0) kgForQty(q, unit) else it.weight
            )
        }
    }

    fun shift() {
        val s = _state.value
        val job = s.job
        val a = s.avail
        val q = s.quantity.toIntOrNull() ?: 0
        val max = s.maxQty.toInt()
        val colour = a?.colourNamed(s.colour)
        val of = colour?.let { " of ${it.colour}" }.orEmpty()
        val fail: ManualMessage? = when {
            job == null -> ManualMessage(false, "Pick the line, machine and job.")
            a != null && !a.hasSfgStd ->
                ManualMessage(false, "Mould Master has no SFG Std Packing for ${a.mouldName.ifBlank { "this mould" }}. Fill it in Mould Master, then shift.", "SFG STD NOT SET")
            a != null && a.produced <= 0 -> ManualMessage(false, "No production is entered in DPR for this job.", "NOT PRODUCED")
            a != null && a.shiftColours.size > 1 && colour == null -> ManualMessage(false, "Pick the colour of the material you are shifting.")
            s.location.isBlank() -> ManualMessage(false, "Pick where the material is going (Send To).")
            q <= 0 -> ManualMessage(false, "Enter the packs, the quantity or the weight.")
            q > max && a?.verificationEnforced == true ->
                ManualMessage(false, "Only ${qty(max.toDouble())} QC-verified pcs$of are ready to shift.", "NOT QC VERIFIED")
            q > max -> ManualMessage(false, "Only ${qty(max.toDouble())} pcs$of are on the shop floor for this job.")
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
            repo.manualShift(job.planId, job.machine, q, s.location, weight, colour?.colour)
                .onSuccess {
                    _beep.tryEmit(true)
                    _state.update {
                        it.copy(
                            saving = false, quantity = "", weight = "", packs = "",
                            message = ManualMessage(
                                true,
                                "Shifted ${qty(q.toDouble())} pcs" +
                                    (a?.let { packText(q.toDouble(), it.sfgStd, it.packName) }?.takeIf { it.isNotBlank() }?.let { " ($it)" } ?: "") +
                                    "${colour?.let { " " + it.colour }.orEmpty()} from ${job.machine} → ${s.location}"
                            )
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
                Tab(selected = s.view == ManualView.FORM, onClick = { vm.setView(ManualView.FORM) }, text = { Text(if (s.machine.isBlank()) "Line / Machine" else s.machine, maxLines = 1, overflow = TextOverflow.Ellipsis) })
            }
            if (s.view == ManualView.MACHINES) {
                MachineBoard(
                    s,
                    onView = vm::setBoardView,
                    onLine = vm::setBoardLine,
                    onSearch = vm::setSearch,
                    onOpen = vm::openJob,
                    onRetry = { vm.loadBoard() }
                )
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

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PickerField("Line", s.lines, s.line, vm::setLine, Modifier.weight(1f), placeholder = "Select line")
                    PickerField(
                        "Machine", s.machines, s.machine, vm::setMachine, Modifier.weight(1.4f),
                        placeholder = if (s.line.isBlank()) "Line first" else "Select machine",
                        enabled = s.line.isNotBlank()
                    )
                }

                if (s.machine.isNotBlank()) {
                    if (s.machineJobs.isEmpty() && !s.loading) {
                        Text("No job on this machine in the last 3 days.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else if (s.machineJobs.size > 1 || job == null) {
                        SectionLabel("Jobs on ${s.machine}")
                        s.machineJobs.forEach { j -> JobChoice(j, selected = j.planId == s.planId, onClick = { vm.selectJob(j.planId) }) }
                    }
                }

                if (job != null) {
                    if (s.availLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                    s.availError?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
                    a?.let { JobSummaryCard(it) }

                    if (a != null && !a.hasSfgStd) {
                        SfgBlockCard(a.mouldName)
                    } else {
                        ShiftFormCard(s, a, job, vm)
                    }
                    a?.let { JobBreakdownCard(it) }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}

/** Colour rows, Send To, packs / pcs / kg and the Shift button. */
@Composable
private fun ShiftFormCard(s: ManualUiState, a: Availability?, job: Job, vm: ManualViewModel) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.35f))
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Column {
                Text("Manual shift", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                if (a != null) {
                    val max = s.maxQty
                    Text(
                        "Up to ${qty(max)} pcs" +
                            packText(max, a.sfgStd, a.packName).takeIf { it.isNotBlank() }?.let { " ($it)" }.orEmpty() +
                            " · ${qty(a.sfgStd)} pcs / ${a.packName}" +
                            (a.unitWeightKg.takeIf { it > 0 }?.let { " · ${kg(it)} kg/pc" } ?: ""),
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            val colours = a?.shiftColours.orEmpty()
            if (a != null && colours.isNotEmpty()) {
                SectionLabel("Colour")
                colours.forEach { c ->
                    ColourOption(a, c, selected = c.colour.equals(s.colour, ignoreCase = true), onClick = { vm.setColour(c.colour) })
                }
            }
            PickerField("Send To", s.locations, s.location, vm::setLocation, Modifier.fillMaxWidth(), placeholder = "Select location")
            if (a != null) {
                PackQtyFields(
                    packs = s.packs,
                    weight = s.weight,
                    quantity = s.quantity,
                    sfgStd = a.sfgStd,
                    packName = a.packName,
                    unitWeightKg = a.unitWeightKg.takeIf { it > 0 } ?: job.unitWeightKg,
                    onPacks = vm::setPacks,
                    onWeight = vm::setWeight,
                    onQuantity = vm::setQuantity,
                    maxQty = s.maxQty.toInt()
                )
            }
            val q = s.quantity.toIntOrNull() ?: 0
            Button(
                onClick = { vm.shift() },
                enabled = !s.saving && a != null,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    when {
                        s.saving -> "Saving…"
                        a == null -> "Loading job…"
                        a.shiftColours.size > 1 && a.colourNamed(s.colour) == null -> "Pick the colour first"
                        s.location.isBlank() -> "Pick Send To first"
                        q <= 0 -> "Enter packs, pcs or kg"
                        else -> "Shift ${qty(q.toDouble())} pcs → ${s.location}"
                    },
                    fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

/** One colour of the job: tap to pick; shows what is ready in pcs and packs. */
@Composable
private fun ColourOption(a: Availability, c: AvailColour, selected: Boolean, onClick: () -> Unit) {
    val max = a.colourMax(c)
    val shape = RoundedCornerShape(10.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .border(
                if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                shape
            )
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (selected) {
            Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(c.colour, Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Column(horizontalAlignment = Alignment.End) {
            Text("${qty(max)} ready", fontWeight = FontWeight.Bold, fontSize = 13.sp, color = if (max > 0) Good else Steel)
            packText(max, a.sfgStd, a.packName).takeIf { it.isNotBlank() }?.let {
                Text(it, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSurfaceVariant, letterSpacing = 0.5.sp)
}

/**
 * Machines view (same as the web Manual Entry): totals, search, filter (pending / ready /
 * SFG std not set / all machines) and line chips, then a card per machine with its pending jobs.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MachineBoard(
    s: ManualUiState,
    onView: (BoardView) -> Unit,
    onLine: (String) -> Unit,
    onSearch: (String) -> Unit,
    onOpen: (MachineApproved, String?) -> Unit,
    onRetry: () -> Unit
) {
    val sections = s.boardSections
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item(key = "top") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (s.boardLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                s.boardError?.let { ErrorCard(it, onRetry = onRetry) }
                KpiStrip(s, onNoSfg = { onView(BoardView.NOSFG) })
                OutlinedTextField(
                    value = s.search,
                    onValueChange = onSearch,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("Machine, item, OR, JC, mould, party") },
                    leadingIcon = { Icon(Icons.Default.Search, null) },
                    trailingIcon = {
                        if (s.search.isNotEmpty()) IconButton(onClick = { onSearch("") }) { Icon(Icons.Default.Clear, contentDescription = "Clear") }
                    },
                    shape = RoundedCornerShape(12.dp)
                )
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BoardView.values().forEach { v ->
                        FilterChip(selected = s.boardView == v, onClick = { onView(v) }, label = { Text(v.label) })
                    }
                }
                if (s.boardLines.size > 1) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = s.boardLine.isBlank(), onClick = { onLine("") }, label = { Text("All lines") })
                        s.boardLines.forEach { l ->
                            FilterChip(selected = s.boardLine == l, onClick = { onLine(l) }, label = { Text(l.ifBlank { "No line" }) })
                        }
                    }
                }
            }
        }
        if (!s.boardLoading && s.boardError == null && sections.isEmpty()) {
            item(key = "empty") {
                EmptyNote(
                    when {
                        s.search.isNotBlank() -> "Nothing matches your search."
                        s.boardView == BoardView.READY -> "No job has QC approved qty waiting to be shifted."
                        s.boardView == BoardView.NOSFG -> "Every pending job has an SFG std."
                        s.boardView == BoardView.ALL -> "No machines."
                        else -> "No job is waiting to be shifted."
                    }
                )
            }
        }
        sections.forEachIndexed { i, sec ->
            stickyHeader(key = "line-$i-${sec.line}") { LineHeader(sec) }
            items(sec.rows, key = { "m-${it.machine.machine}" }) { r -> MachineCard(r, onOpen) }
        }
    }
}

/** Swipeable totals: QC approved pcs, jobs pending, ready to shift, SFG std not set (tap = show them). */
@Composable
private fun KpiStrip(s: ManualUiState, onNoSfg: () -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Kpi("QC approved", qty(s.kpiApproved), "pcs on ${s.kpiMachines} machine${if (s.kpiMachines == 1) "" else "s"}", Good)
        Kpi("Jobs pending", qty(s.kpiPending.toDouble()), "material on floor")
        Kpi("Ready to shift", qty(s.kpiReady.toDouble()), "jobs QC approved")
        Kpi(
            "SFG std not set", qty(s.kpiNoSfg.toDouble()),
            if (s.kpiNoSfg > 0) "jobs blocked · tap" else "all jobs have a std",
            if (s.kpiNoSfg > 0) Crit else Color.Unspecified,
            onClick = if (s.kpiNoSfg > 0) onNoSfg else null
        )
    }
}

@Composable
private fun Kpi(label: String, value: String, sub: String, valueColor: Color = Color.Unspecified, onClick: (() -> Unit)? = null) {
    val alert = valueColor == Crit
    Card(
        modifier = Modifier.widthIn(min = 132.dp).let { if (onClick != null) it.clickable(onClick = onClick) else it },
        colors = CardDefaults.cardColors(containerColor = if (alert) Crit.copy(alpha = 0.08f) else MaterialTheme.colorScheme.surface),
        border = if (alert) BorderStroke(1.dp, Crit.copy(alpha = 0.35f)) else null
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
            Text(label.uppercase(), fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            Text(
                value, fontSize = 20.sp, fontWeight = FontWeight.Black, maxLines = 1,
                color = if (valueColor == Color.Unspecified) MaterialTheme.colorScheme.onSurface else valueColor
            )
            Text(sub, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

@Composable
private fun LineHeader(sec: BoardSection) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(sec.line.ifBlank { "No line" }, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(8.dp))
        Text(
            "${sec.rows.size} machine${if (sec.rows.size == 1) "" else "s"} · ${sec.jobCount} job${if (sec.jobCount == 1) "" else "s"} · ${qty(sec.approved)} pcs approved",
            Modifier.weight(1f), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End, maxLines = 1, overflow = TextOverflow.Ellipsis
        )
    }
}

/** Machine header (QC approved, on floor, QC HOLD) and a block per pending job with a Shift button. */
@Composable
private fun MachineCard(r: BoardRow, onOpen: (MachineApproved, String?) -> Unit) {
    val m = r.machine
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = if (m.onHold) BorderStroke(1.5.dp, Crit.copy(alpha = 0.6f)) else null
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .let { if (m.jobs > 0) it.clickable { onOpen(m, null) } else it }
                .padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(m.machine, Modifier.weight(1f, fill = false), fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (m.onHold) {
                        Spacer(Modifier.width(6.dp))
                        Pill("QC HOLD", Crit.copy(alpha = 0.15f), Crit)
                    }
                }
                Text(
                    "${qty(m.onFloorQty)} on floor · ${r.jobs.size} job${if (r.jobs.size == 1) "" else "s"} pending",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1
                )
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    qty(m.approvedQty), fontWeight = FontWeight.Black, fontSize = 20.sp,
                    color = if (m.approvedQty > 0) Good else MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text("QC APPROVED", fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (r.jobs.isEmpty()) {
            Text(
                if (m.jobs > 0) "No job waiting to be shifted." else "No job in the last 3 days.",
                Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp),
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        r.jobs.forEach { j ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            BoardJobBlock(j, onShift = { onOpen(m, j.planId) })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BoardJobBlock(j: BoardJob, onShift: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clickable(onClick = onShift).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Text(j.title, Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(6.dp))
            StatusPill(j.onHold, j.isRunning, j.status)
        }
        Text(
            listOf(
                j.orderNo.takeIf { it.isNotBlank() }?.let { "OR $it" },
                j.jcNo.takeIf { it.isNotBlank() }?.let { "JC $it" },
                j.planCode.takeIf { it.isNotBlank() }
            ).filterNotNull().joinToString(" · ").ifBlank { "—" },
            fontSize = 12.sp, fontWeight = FontWeight.SemiBold
        )
        Text(
            listOf(j.mouldName, j.clientName).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "—" },
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis
        )
        FlowRow(
            Modifier.padding(top = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (j.hasSfgStd) {
                InfoChip(
                    "SFG", "${qty(j.sfgStd)} / ${j.packName}" + if (j.sfgBagSize.isNotBlank()) " · ${j.sfgBagSize}" else "",
                    background = Good.copy(alpha = 0.14f), content = Good
                )
            } else {
                InfoChip("", "SFG STD NOT SET", background = Crit.copy(alpha = 0.14f), content = Crit)
            }
            j.colours.filter { it.colour.isNotBlank() && it.produced > 0 }.forEach { c -> ColourChip(c.colour, c.ready.coerceAtLeast(0.0), Good) }
            if (j.unassignedShifted > 0) ColourChip("No colour shifted", j.unassignedShifted, Warn)
        }
        Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(qty(j.approved), fontWeight = FontWeight.Black, fontSize = 18.sp, color = if (j.approved > 0) Good else MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(4.dp))
                    Text("pcs approved", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 2.dp))
                }
                packText(j.approved, j.sfgStd, j.packName).takeIf { it.isNotBlank() }?.let {
                    Text(it, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
                Text("${qty(j.onFloor)} on floor", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (j.hasSfgStd && j.approved > 0) {
                Button(onClick = onShift, shape = RoundedCornerShape(10.dp)) {
                    Text("Shift", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, null, Modifier.size(16.dp))
                }
            } else {
                FilledTonalButton(onClick = onShift, shape = RoundedCornerShape(10.dp)) { Text("Open") }
            }
        }
    }
}

/** "● BLACK 1,178" — colour and its ready qty (grey when nothing is ready). */
@Composable
private fun ColourChip(name: String, value: Double, dot: Color) {
    val zero = value <= 0
    Row(
        Modifier
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(7.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(7.dp).background(if (zero) Steel.copy(alpha = 0.4f) else dot, CircleShape))
        Spacer(Modifier.width(5.dp))
        Text(name, fontSize = 12.sp, color = if (zero) Steel else MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.width(4.dp))
        Text(qty(value), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (zero) Steel else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun StatusPill(onHold: Boolean, running: Boolean, status: String) {
    when {
        onHold -> Pill("QC HOLD", Crit.copy(alpha = 0.15f), Crit)
        running -> Pill("Running", Good.copy(alpha = 0.15f), Good)
        else -> Pill(status.ifBlank { "Closed" }, Steel.copy(alpha = 0.15f), Steel)
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
            if (m.ok) {
                Icon(Icons.Default.CheckCircle, null, tint = Color.White, modifier = Modifier.size(32.dp))
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
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f) else MaterialTheme.colorScheme.surface
        ),
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    j.itemName.ifBlank { j.mouldName }.ifBlank { "—" }, Modifier.weight(1f),
                    fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.width(6.dp))
                StatusPill(j.onHold, j.isRunning, j.status)
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
