package com.jmsocean.qc.ui.onlinereport

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.ui.theme.Accent
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnlineReportScreen(
    onMenu: () -> Unit,
    vm: OnlineReportViewModel = viewModel()
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
                title = {
                    Column {
                        Text("Online QC Report", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(
                            "2-hr checks · Visual · Colour · Function/Fitment",
                            fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = { IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, "Menu") } },
                actions = { IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, "Refresh") } }
            )
        }
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(horizontal = 16.dp)) {
            Spacer(Modifier.height(12.dp))

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Dropdown("Shift", s.shift, listOf("Day", "Night"), { vm.setShift(it) }, Modifier.weight(1f))
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    Text("${s.machine.ifBlank { "—" }} · ${s.date}", fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            s.job?.let { j ->
                Spacer(Modifier.height(6.dp))
                Text(
                    "${j.item_name ?: "—"} · ${j.mould_name ?: "—"} · JC ${j.job_card_no ?: "—"}",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Medium
                )
            }
            Spacer(Modifier.height(12.dp))

            when {
                s.loading -> Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Accent)
                }
                s.error != null -> Text(s.error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 24.dp))
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(s.slots) { slot -> SlotCard(slot, vm) }
                    item { Spacer(Modifier.height(24.dp)) }
                }
            }
        }
    }
}

@Composable
private fun SlotCard(slot: SlotUi, vm: OnlineReportViewModel) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(slot.label, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    if (slot.isFF) {
                        Spacer(Modifier.height(0.dp))
                        Text("  +F/F", fontSize = 11.sp, color = Accent, fontWeight = FontWeight.Bold)
                    }
                }
                if (slot.done) Text("✓ Done", color = Good, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(8.dp))

            CheckBlock(
                title = "👁️ Visual Check",
                status = slot.visualStatus,
                onStatus = { vm.setVisual(slot.label, it) },
                problems = VISUAL_PROBLEMS, problem = slot.visualProblem, onProblem = { vm.setVisualProblem(slot.label, it) },
                remarks = slot.visualRemarks, onRemarks = { vm.setVisualRemarks(slot.label, it) }
            )
            HorizontalDivider(Modifier.padding(vertical = 10.dp))
            CheckBlock(
                title = "🎨 Colour Check",
                status = slot.colourStatus,
                onStatus = { vm.setColour(slot.label, it) },
                problems = COLOUR_PROBLEMS, problem = slot.colourProblem, onProblem = { vm.setColourProblem(slot.label, it) },
                remarks = slot.colourRemarks, onRemarks = { vm.setColourRemarks(slot.label, it) }
            )
            if (slot.isFF) {
                HorizontalDivider(Modifier.padding(vertical = 10.dp))
                CheckBlock(
                    title = "🔧 Function / Fitment",
                    status = slot.ffStatus,
                    onStatus = { vm.setFf(slot.label, it) },
                    problems = FF_PROBLEMS, problem = slot.ffProblem, onProblem = { vm.setFfProblem(slot.label, it) },
                    remarks = null, onRemarks = {}
                )
            }

            Spacer(Modifier.height(12.dp))
            Button(onClick = { vm.saveSlot(slot.label) }, enabled = !slot.saving, modifier = Modifier.fillMaxWidth()) {
                if (slot.saving) CircularProgressIndicator(Modifier.height(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text("Save ${slot.label} entry", color = MaterialTheme.colorScheme.onPrimary)
            }
            slot.savedMsg?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = if (it.startsWith("✓")) Good else Crit, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun CheckBlock(
    title: String,
    status: String?,
    onStatus: (String) -> Unit,
    problems: List<String>,
    problem: String,
    onProblem: (String) -> Unit,
    remarks: String?,
    onRemarks: (String) -> Unit
) {
    Text(title, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    Spacer(Modifier.height(6.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatusButton("✅ OK", selected = status == OK, selColor = Good) { onStatus(OK) }
        StatusButton("❌ Not OK", selected = status == NOT_OK, selColor = Crit) { onStatus(NOT_OK) }
    }
    if (status == NOT_OK) {
        Spacer(Modifier.height(8.dp))
        Dropdown("Problem", problem, problems, onProblem, Modifier.fillMaxWidth())
        if (remarks != null) {
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = remarks, onValueChange = onRemarks,
                label = { Text("Remarks") }, singleLine = true, modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun StatusButton(label: String, selected: Boolean, selColor: Color, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        colors = if (selected)
            ButtonDefaults.outlinedButtonColors(containerColor = selColor.copy(alpha = 0.15f), contentColor = selColor)
        else ButtonDefaults.outlinedButtonColors()
    ) {
        Text(label, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Dropdown(
    label: String,
    value: String,
    options: List<String>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = value, onValueChange = {}, readOnly = true,
            label = { Text(label) }, singleLine = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor()
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { opt ->
                DropdownMenuItem(text = { Text(opt) }, onClick = { onSelect(opt); expanded = false })
            }
        }
    }
}
