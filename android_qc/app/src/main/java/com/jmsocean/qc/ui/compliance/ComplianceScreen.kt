package com.jmsocean.qc.ui.compliance

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.data.remote.QcmSlot
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

private val Blue = Color(0xFF1D4ED8)
private val MACHINE_W = 128.dp
private val SETUP_W = 46.dp
private val SLOT_W = 58.dp
private val SUM_W = 70.dp

/**
 * QC Compliance — same layout as the web DPR Compliance Summary (Process = QC):
 * totals bar, one card per line with the QC team, one row per machine with its
 * job, QC Setup (x/2), the six 2-hour checks and a summary.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComplianceScreen(
    onMenu: () -> Unit,
    vm: ComplianceViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                ),
                title = { Text("QC Compliance", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, contentDescription = "Menu") }
                },
                actions = {
                    IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh") }
                }
            )
        }
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(12.dp)) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                s.dateOptions.forEach { (d, label) ->
                    FilterChip(selected = s.date == d, onClick = { vm.setDate(d) }, label = { Text("$label · ${d.substring(5)}") })
                }
                listOf("Day", "Night").forEach {
                    FilterChip(selected = s.shift == it, onClick = { vm.setShift(it) }, label = { Text(it) })
                }
            }
            Spacer(Modifier.height(8.dp))
            TotalsBar(s)
            Spacer(Modifier.height(8.dp))

            when {
                s.loading && s.cards.isEmpty() -> Box(Modifier.fillMaxWidth().padding(40.dp), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                s.error != null -> Text(s.error!!, color = Crit)
                s.cards.isEmpty() -> Text("No machines for this shift.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> {
                    // One horizontal scroll for the whole matrix so every line card's columns line up.
                    Column(Modifier.horizontalScroll(rememberScrollState())) {
                        HeaderRow(s.slotLabels, s.shift)
                        s.cards.forEach { card ->
                            LineCardView(card, s.slotLabels, onCell = vm::select)
                            Spacer(Modifier.height(10.dp))
                        }
                    }
                }
            }
        }
    }

    s.selected?.let { e -> SlotDialog(e, onClose = { vm.select(null) }) }
}

@Composable
private fun TotalsBar(s: ComplianceUiState) {
    val pct = if (s.due > 0) "${s.done * 100 / s.due}%" else "—"
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    ) {
        Row(Modifier.fillMaxWidth().padding(10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Stat("Filled", pct, if (s.due > 0 && s.done < s.due) Crit else Good)
            Stat("Done", "${s.done}/${s.due}", MaterialTheme.colorScheme.onSurface)
            Stat("Missed", "${s.missed}", Crit)
            Stat("Not OK", "${s.notOk}", Crit)
            Stat("Setup", "${s.setupDone}/${s.setupDue}", Blue)
        }
    }
}

@Composable
private fun Stat(label: String, value: String, c: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label.uppercase(), fontSize = 10.sp, color = c, fontWeight = FontWeight.SemiBold)
        Text(value, fontSize = 16.sp, color = c, fontWeight = FontWeight.Bold)
    }
}

/** Slot label with AM/PM: Day 08 AM → 08 PM, Night 08 PM → 08 AM. */
private fun slotLabel(slot: String, i: Int, shift: String): String {
    val p = slot.split("-")
    if (p.size != 2) return slot
    val day = shift != "Night"
    val st = if ((i <= 1) == day) "AM" else "PM"
    val en = if (i == 1) (if (st == "AM") "PM" else "AM") else st
    return "${p[0]}$st–${p[1]}$en"
}

@Composable
private fun HeaderRow(slots: List<String>, shift: String) {
    Row(
        Modifier.clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
    ) {
        HCell("Machine / Job", MACHINE_W, TextAlign.Start)
        HCell("Setup", SETUP_W)
        slots.forEachIndexed { i, sl -> HCell(slotLabel(sl, i, shift), SLOT_W) }
        HCell("Summary", SUM_W)
    }
}

@Composable
private fun HCell(text: String, w: Dp, align: TextAlign = TextAlign.Center) {
    Box(Modifier.width(w).height(34.dp).padding(horizontal = 4.dp), contentAlignment = if (align == TextAlign.Start) Alignment.CenterStart else Alignment.Center) {
        Text(text, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, textAlign = align, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LineCardView(card: LineCard, slots: List<String>, onCell: (QcmSlot) -> Unit) {
    val totalW = MACHINE_W + SETUP_W + SLOT_W * slots.size + SUM_W
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.width(totalW)
    ) {
        Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)).padding(horizontal = 10.dp, vertical = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(card.line, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                val pct = if (card.due > 0) "${card.done * 100 / card.due}%" else "—"
                Text("Filled: $pct", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = if (card.due > 0 && card.done < card.due) Crit else Good)
                Text("Missed: ${card.missed}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Crit)
                Text("Not OK: ${card.notOk}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Crit)
                Text("Setup: ${card.setupDone}/${card.setupDue}", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Blue)
            }
            if (card.teamSaved) {
                Text(
                    "QC Supervisor: ${card.supervisor.ifBlank { "-" }}  |  QC Incharge: ${card.incharge.ifBlank { "-" }}" +
                        if (card.savedBy.isNotBlank()) "  |  Entered by: ${card.savedBy}" else "",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Text("QC Shift Personnel Not Entered", fontSize = 11.sp, color = Crit, fontWeight = FontWeight.SemiBold)
            }
        }
        card.rows.forEach { MachineRowView(it, onCell) }
    }
}

@Composable
private fun MachineRowView(r: MachineRow, onCell: (QcmSlot) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.width(MACHINE_W).padding(horizontal = 6.dp, vertical = 5.dp)) {
            Text(r.machine, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (r.job.isNotBlank()) {
                Text(r.job, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (r.jobSub.isNotBlank()) Text(r.jobSub, fontSize = 9.sp, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            } else {
                Text("No running plan", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Box(Modifier.width(SETUP_W), contentAlignment = Alignment.Center) {
            if (!r.active) Text("—", color = MaterialTheme.colorScheme.outline)
            else {
                val c = when (r.setupHalves) { 2 -> Good; 1 -> Warn; else -> Crit }
                Text(
                    "${r.setupHalves}/2", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(c.copy(alpha = 0.14f)).padding(horizontal = 5.dp, vertical = 2.dp)
                )
            }
        }
        r.cells.forEach { SlotCellView(it, onCell) }
        Column(Modifier.width(SUM_W).padding(horizontal = 4.dp)) {
            Text(
                if (r.due > 0) "${r.done}/${r.due}" else "—", fontSize = 11.sp, fontWeight = FontWeight.Bold,
                color = if (r.due > 0 && r.done < r.due) Crit else Good
            )
            r.fpa?.let {
                Text(it, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = when { "ok" in it -> Good; "rejected" in it -> Crit; else -> Warn })
            }
            r.memoHold?.let { Text(it, fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Crit) }
        }
    }
}

@Composable
private fun SlotCellView(c: SlotCell, onCell: (QcmSlot) -> Unit) {
    val (bg, fg, label) = when (c.kind) {
        CellKind.OK -> Triple(Good.copy(alpha = 0.14f), Good, "✔ OK")
        CellKind.BAD -> Triple(Crit.copy(alpha = 0.12f), Crit, "✘ Not OK")
        CellKind.MISSED -> Triple(Crit.copy(alpha = 0.08f), Crit, "Missed")
        CellKind.DUE -> Triple(Warn.copy(alpha = 0.14f), Warn, "Due")
        CellKind.UPCOMING, CellKind.IDLE -> Triple(Color.Transparent, MaterialTheme.colorScheme.outline, "—")
    }
    val mod = Modifier.width(SLOT_W).height(40.dp).padding(1.dp).clip(RoundedCornerShape(4.dp)).background(bg)
    Box(if (c.entry != null) mod.clickable { onCell(c.entry) } else mod, contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(label, color = fg, fontWeight = FontWeight.Bold, fontSize = 10.sp)
            if (c.late) Text("late", color = Warn, fontSize = 8.sp)
        }
    }
}

@Composable
private fun SlotDialog(e: QcmSlot, onClose: () -> Unit) {
    fun st(s: String?, p: String?, rm: String?): String = when {
        s.isNullOrBlank() -> "Not checked"
        Regex("not\\s*ok", RegexOption.IGNORE_CASE).containsMatchIn(s) -> "Not OK" + (p?.let { " — $it" } ?: "") + (rm?.let { " ($it)" } ?: "")
        else -> "OK"
    }
    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = { TextButton(onClick = onClose) { Text("Close") } },
        title = { Text("${e.machine} · ${e.slot} · ${e.shift}", fontSize = 16.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(
                    "Product" to (e.item_name ?: "—"),
                    "Mould" to (e.mould_name ?: "—"),
                    "Job card" to (e.job_card_no ?: "—"),
                    "Colour" to (e.colour ?: "—"),
                    "Visual" to st(e.visual_status, e.visual_problem, e.visual_remarks),
                    "Colour check" to st(e.colour_status, e.colour_problem, e.colour_remarks),
                    "Function / Fit" to st(e.ff_status, e.ff_problem, null),
                    "Entered by" to (e.entered_by ?: "—")
                ).forEach { (k, v) ->
                    Row {
                        Text(k, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(96.dp))
                        Text(v, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (v.startsWith("Not OK")) Crit else MaterialTheme.colorScheme.onSurface)
                    }
                }
            }
        }
    )
}
