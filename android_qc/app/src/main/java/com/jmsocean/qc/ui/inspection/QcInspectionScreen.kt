package com.jmsocean.qc.ui.inspection

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QcInspectionScreen(
    onBack: () -> Unit,
    vm: QcInspectionViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val ctx = LocalContext.current

    var pendingPhoto by remember { mutableStateOf<File?>(null) }
    val camLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) pendingPhoto?.let { vm.setFfPhoto(it) }
    }
    fun captureFf() {
        val dir = File(ctx.cacheDir, "images").apply { mkdirs() }
        val f = File(dir, "ff_${System.currentTimeMillis()}.jpg")
        pendingPhoto = f
        val uri: Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
        camLauncher.launch(uri)
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                ),
                title = { Text("QC Inspection", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
                }
            )
        }
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp)
        ) {
            val job = s.job

            // Header
            SectionCard {
                Text(job?.Mould?.takeIf { it.isNotBlank() }?.let { "Mould: $it" } ?: "Mould: —",
                    fontWeight = FontWeight.Bold, fontSize = 14.sp)
                job?.clientName?.takeIf { it.isNotBlank() }?.let {
                    Text(it, fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurface)
                }
                Text(
                    buildString {
                        append("OR ${job?.orderNumber?.ifBlank { "—" } ?: "—"}")
                        job?.JobCardNo?.takeIf { it.isNotBlank() }?.let { append("  |  JC $it") }
                    },
                    fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                job?.mouldNo?.takeIf { it.isNotBlank() }?.let {
                    Text("Mould No: $it", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            // Colour balance
            if (s.balances.isNotEmpty()) {
                Spacer(Modifier.size(10.dp))
                SectionCard {
                    Label("Colour balance")
                    Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                        HCell("Colour", 1.4f); HCell("Plan", 1f); HCell("Made", 1f, Good); HCell("Bal", 1f, Warn)
                    }
                    s.balances.forEach { b ->
                        Row(Modifier.fillMaxWidth().padding(top = 3.dp)) {
                            VCell(b.colour, 1.4f, bold = true)
                            VCell("${b.planQty}", 1f)
                            VCell("${b.produced}", 1f, Good)
                            VCell("${b.balance}", 1f, Warn)
                        }
                    }
                }
            }

            // Shift-team gate — compulsory before any inspection entry
            if (s.teamChecked && !s.teamOk) {
              Spacer(Modifier.size(10.dp))
              SectionCard {
                Label("QC Supervisor — required for this shift")
                Text(
                    "One QC supervisor covers the whole ${s.shift} shift on ${s.machine.ifBlank { "this machine" }}. Record the name once before inspection.",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 4.dp)
                )
                OutlinedTextField(
                    value = s.supName, onValueChange = vm::setSupName,
                    label = { Text("QC Supervisor name") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                s.teamError?.let { Text(it, color = Crit, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) }
                Spacer(Modifier.size(8.dp))
                Button(onClick = vm::saveShiftTeam, enabled = !s.savingTeam, modifier = Modifier.fillMaxWidth()) {
                    if (s.savingTeam) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else Text("Save QC supervisor", color = MaterialTheme.colorScheme.onPrimary)
                }
              }
              Spacer(Modifier.size(24.dp))
            } else {

            // Setup: STD vs Actual (2x/shift)
            Spacer(Modifier.size(10.dp))
            SectionCard {
                Label("One-time setup · STD vs Actual")
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("1st half", "2nd half").forEach {
                        FilterChip(selected = s.setupPeriod == it, onClick = { vm.setPeriod(it) }, label = { Text(it) })
                    }
                }
                Spacer(Modifier.size(8.dp))
                StdActualRow("Weight (kg)", s.stdWeight, s.actWeight, vm::setActWeight)
                StdActualRow("Cycle Time (s)", s.stdCT, s.actCT, vm::setActCT)
                StdActualRow("Cavity", s.stdCavity, s.actCavity, vm::setActCavity)
                Spacer(Modifier.size(8.dp))
                OutlinedButton(onClick = vm::saveSetup, enabled = !s.savingSetup, modifier = Modifier.fillMaxWidth()) {
                    if (s.savingSetup) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    else Text("Save setup")
                }
                s.setupMsg?.let { Text(it, color = Good, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
            }

            // Date / Shift / Slot
            Spacer(Modifier.size(10.dp))
            SectionCard {
                Label("Date · Shift · Hour slot")
                Text(s.date, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 2.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("Day", "Night").forEach {
                        FilterChip(selected = s.shift == it, onClick = { vm.setShift(it) }, label = { Text(it) })
                    }
                }
                Spacer(Modifier.size(6.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    INSPECT_SLOTS.forEach {
                        FilterChip(selected = s.slot == it, onClick = { vm.setSlot(it) }, label = { Text(it) })
                    }
                }
                if (s.colours.isNotEmpty()) {
                    Spacer(Modifier.size(6.dp))
                    Label("Colour")
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        s.colours.forEach { c ->
                            FilterChip(selected = s.colour == c.colour, onClick = { vm.setColour(c.colour) }, label = { Text(c.colour) })
                        }
                    }
                }
            }

            // Visual & Colour (2-hourly)
            Spacer(Modifier.size(10.dp))
            SectionCard {
                Label("Visual & Colour check (every 2h)")
                CheckBlock(
                    title = "Visual", ok = s.visualOk, onOk = { vm.setVisualOk(true) }, onNot = { vm.setVisualOk(false) },
                    defect = s.visualDefect, onDefect = vm::setVisualDefect,
                    remarks = s.visualRemarks, onRemarks = vm::setVisualRemarks
                )
                Spacer(Modifier.size(10.dp))
                CheckBlock(
                    title = "Colour", ok = s.colourOk, onOk = { vm.setColourOk(true) }, onNot = { vm.setColourOk(false) },
                    defect = s.colourDefect, onDefect = vm::setColourDefect,
                    remarks = s.colourRemarks, onRemarks = vm::setColourRemarks
                )
            }

            // Function / Fitment (4-hourly)
            if (s.ffApplies) {
                Spacer(Modifier.size(10.dp))
                SectionCard {
                    Label("Function / Fitment (every 4h)")
                    OkNotOk(s.ffOk, { vm.setFfOk(true) }, { vm.setFfOk(false) })
                    if (s.ffOk == false) {
                        Spacer(Modifier.size(6.dp))
                        OutlinedTextField(
                            value = s.ffRemarks, onValueChange = vm::setFfRemarks,
                            label = { Text("Remarks") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                        )
                    }
                    Spacer(Modifier.size(8.dp))
                    OutlinedButton(onClick = { captureFf() }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (s.ffPhoto != null) "📷 Photo captured ✓" else "📷 Add photo (optional)")
                    }
                }
            }

            if (s.error != null) { Spacer(Modifier.size(8.dp)); Text(s.error!!, color = Crit, fontSize = 13.sp) }
            if (s.message != null) { Spacer(Modifier.size(8.dp)); Text(s.message!!, color = Good, fontSize = 13.sp) }

            Spacer(Modifier.size(14.dp))
            Button(
                onClick = vm::submitCheck, enabled = s.canSubmit,
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                if (s.submitting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text("Save slot check", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimary)
            }
            Spacer(Modifier.size(24.dp))
            } // end else (shift-team gate)
        }
    }
}

@Composable
private fun SectionCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()
    ) { Column(Modifier.padding(12.dp), content = content) }
}

@Composable
private fun Label(t: String) =
    Text(t, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)

@Composable
private fun androidx.compose.foundation.layout.RowScope.HCell(t: String, w: Float, color: androidx.compose.ui.graphics.Color? = null) =
    Text(t, Modifier.weight(w), fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
        color = color ?: MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun androidx.compose.foundation.layout.RowScope.VCell(t: String, w: Float, color: androidx.compose.ui.graphics.Color? = null, bold: Boolean = false) =
    Text(t, Modifier.weight(w), fontSize = 12.5.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium,
        color = color ?: MaterialTheme.colorScheme.onSurface)

@Composable
private fun StdActualRow(label: String, std: String, act: String, onAct: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1.2f)) {
            Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("STD: ${std.ifBlank { "—" }}", fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        OutlinedTextField(
            value = act, onValueChange = onAct, label = { Text("Actual") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun OkNotOk(ok: Boolean?, onOk: () -> Unit, onNot: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = ok == true, onClick = onOk, label = { Text("OK") })
        FilterChip(selected = ok == false, onClick = onNot, label = { Text("Not OK") })
    }
}

@Composable
private fun CheckBlock(
    title: String, ok: Boolean?, onOk: () -> Unit, onNot: () -> Unit,
    defect: String, onDefect: (String) -> Unit, remarks: String, onRemarks: (String) -> Unit
) {
    Text(title, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp, bottom = 4.dp))
    OkNotOk(ok, onOk, onNot)
    if (ok == false) {
        Spacer(Modifier.size(6.dp))
        DefectDropdown(defect, onDefect)
        Spacer(Modifier.size(6.dp))
        OutlinedTextField(
            value = remarks, onValueChange = onRemarks, label = { Text("Remarks") }, singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun DefectDropdown(value: String, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text(value.ifBlank { "Select defect ▾" }, modifier = Modifier.weight(1f))
            Icon(Icons.Default.ArrowDropDown, contentDescription = null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            QC_DEFECTS.forEach { d ->
                DropdownMenuItem(text = { Text(d) }, onClick = { onSelect(d); open = false })
            }
        }
    }
}
