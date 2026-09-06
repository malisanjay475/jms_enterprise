package com.jmsocean.qc.ui.verify

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.AlertDialog
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
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.data.remote.VerifySlot
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VerifyScreen(
    onMenu: () -> Unit,
    vm: VerifyViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()
    var holdFor by remember { mutableStateOf<VerifySlot?>(null) }
    var deviationFor by remember { mutableStateOf<VerifySlot?>(null) }

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
                        Text("Verify Entries", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(
                            "${s.machine.ifBlank { "—" }} · ${s.date}",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onMenu) {
                        Icon(Icons.Default.Menu, contentDescription = "Menu")
                    }
                }
            )
        }
    ) { pad ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(pad)
                .padding(horizontal = 16.dp)
        ) {
            Spacer(Modifier.size(12.dp))

            // Machine picker
            var menuOpen by remember { mutableStateOf(false) }
            Box {
                OutlinedButton(onClick = { menuOpen = true }) {
                    Text(s.machine.ifBlank { "Select machine ▾" })
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (s.machines.isEmpty()) DropdownMenuItem(text = { Text("No machines") }, onClick = {})
                    s.machines.forEach { m ->
                        DropdownMenuItem(text = { Text(m) }, onClick = { menuOpen = false; vm.selectMachine(m) })
                    }
                }
            }

            // Job context header
            s.jobContext?.let { j ->
                Spacer(Modifier.size(10.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(j.productName, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text(
                            buildString {
                                j.clientName?.let { append(it) }
                                j.orderNumber.takeIf { it.isNotBlank() }?.let { append(if (isEmpty()) "OR $it" else " · OR $it") }
                                j.JobCardNo?.let { append(" · JC $it") }
                            },
                            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(Modifier.size(12.dp))

            // Shift toggle
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Day", "Night").forEach { sh ->
                    FilterChip(
                        selected = s.shift == sh,
                        onClick = { if (s.shift != sh) vm.setShift(sh) },
                        label = { Text(sh) }
                    )
                }
            }

            if (s.message != null) {
                Spacer(Modifier.size(10.dp))
                Text(s.message!!, color = Good, fontSize = 13.sp)
            }
            if (s.error != null) {
                Spacer(Modifier.size(10.dp))
                Text(s.error!!, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            }

            Spacer(Modifier.size(12.dp))

            when {
                s.loading -> Box(Modifier.fillMaxWidth().padding(30.dp), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                s.slots.isEmpty() -> Text(
                    "No DPR entries for this shift yet.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(s.slots) { slot ->
                        SlotCard(
                            slot = slot,
                            busy = s.busySlot == slot.hour_slot,
                            onVerify = { g, r, rmk -> vm.submit(slot, g, r, rmk) },
                            onHold = { holdFor = slot },
                            onDeviation = { deviationFor = slot }
                        )
                    }
                }
            }
        }
    }

    holdFor?.let { slot ->
        HoldDialog(
            slot = slot,
            onDismiss = { holdFor = null },
            onConfirm = { reason, qty, rmk ->
                vm.placeHold(slot, reason, qty, rmk)
                holdFor = null
            }
        )
    }

    deviationFor?.let { slot ->
        DeviationDialog(
            slot = slot,
            onDismiss = { deviationFor = null },
            onConfirm = { good, reject, desc, rmk ->
                vm.submitDeviation(slot, good, reject, desc, rmk)
                deviationFor = null
            }
        )
    }
}

@Composable
private fun SlotCard(
    slot: VerifySlot,
    busy: Boolean,
    onVerify: (Int, Int, String) -> Unit,
    onHold: () -> Unit,
    onDeviation: () -> Unit
) {
    val isDisc = slot.verify_status.equals("Discrepancy", ignoreCase = true)
    val badgeColor = when {
        slot.qc_verified && !isDisc -> Good
        slot.qc_verified && isDisc -> Warn
        else -> Crit
    }
    val badgeText = when {
        slot.qc_verified && !isDisc -> "✓ Verified"
        slot.qc_verified && isDisc -> "⚠ Discrepancy"
        else -> "Overdue"
    }

    var good by remember(slot.hour_slot, slot.qc_verified) {
        mutableStateOf((slot.qc_good_qty ?: slot.sup_good_qty)?.toString() ?: "")
    }
    var reject by remember(slot.hour_slot, slot.qc_verified) {
        mutableStateOf((slot.qc_reject_qty ?: slot.sup_reject_qty)?.toString() ?: "")
    }
    var remarks by remember(slot.hour_slot) { mutableStateOf("") }
    var expanded by remember(slot.hour_slot, slot.qc_verified) { mutableStateOf(!slot.qc_verified) }

    // Compact card that echoes the web Verify slot (red outline when pending).
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.5.dp, if (slot.qc_verified) MaterialTheme.colorScheme.outline else Crit),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(12.dp)) {
            // Header: slot + status
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(slot.hour_slot, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                StatusPill(badgeText, badgeColor)
            }
            Spacer(Modifier.size(8.dp))

            // Supervisor figures — compact two-up
            Row(Modifier.fillMaxWidth()) {
                SupStat("Sup Good", slot.sup_good_qty, Modifier.weight(1f))
                SupStat("Sup Reject", slot.sup_reject_qty, Modifier.weight(1f))
            }
            if (slot.qc_verified && slot.verified_by != null) {
                Spacer(Modifier.size(4.dp))
                Text(
                    "By ${slot.verified_by}${slot.verified_at?.let { " · $it" } ?: ""}",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (slot.qc_verified && !expanded) {
                TextButton(onClick = { expanded = true }, contentPadding = PaddingValues(0.dp)) { Text("Re-verify") }
            }

            if (expanded) {
                Spacer(Modifier.size(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = good, onValueChange = { good = it.filter(Char::isDigit) },
                        label = { Text("QC Good") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = reject, onValueChange = { reject = it.filter(Char::isDigit) },
                        label = { Text("QC Reject") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f)
                    )
                }
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = remarks, onValueChange = { remarks = it },
                    label = { Text("Remarks (optional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.size(10.dp))

                // Verify — full width primary
                Button(
                    onClick = {
                        val g = good.toIntOrNull(); val r = reject.toIntOrNull()
                        if (g != null && r != null) onVerify(g, r, remarks)
                    },
                    enabled = !busy && good.toIntOrNull() != null && reject.toIntOrNull() != null,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().height(44.dp)
                ) {
                    if (busy) CircularProgressIndicator(
                        Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary
                    ) else Text("✓ Verify This Slot", fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.size(8.dp))

                // HOLD | Deviation — secondary row
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = onHold, enabled = !busy,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, Crit),
                        modifier = Modifier.weight(1f).height(40.dp)
                    ) { Text("● HOLD", color = Crit, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
                    OutlinedButton(
                        onClick = onDeviation, enabled = !busy,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, Warn),
                        modifier = Modifier.weight(1f).height(40.dp)
                    ) { Text("⚠ Deviation", color = Warn, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

@Composable
private fun StatusPill(text: String, color: androidx.compose.ui.graphics.Color) {
    Box(
        Modifier
            .border(1.dp, color, RoundedCornerShape(999.dp))
            .padding(horizontal = 9.dp, vertical = 2.dp)
    ) {
        Text(text, color = color, fontWeight = FontWeight.Bold, fontSize = 11.sp)
    }
}

@Composable
private fun SupStat(label: String, value: Int?, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
        Text("${value ?: 0}", fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun DeviationDialog(
    slot: VerifySlot,
    onDismiss: () -> Unit,
    onConfirm: (good: Int, reject: Int, desc: String, remarks: String) -> Unit
) {
    var good by remember { mutableStateOf((slot.sup_good_qty ?: 0).toString()) }
    var reject by remember { mutableStateOf((slot.sup_reject_qty ?: 0).toString()) }
    var desc by remember { mutableStateOf("") }
    var remarks by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Deviation · ${slot.hour_slot}") },
        text = {
            Column {
                Text(
                    "Record a deviation for this slot (logged against the QC verification).",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.size(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = good, onValueChange = { good = it.filter(Char::isDigit) },
                        label = { Text("Good") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = reject, onValueChange = { reject = it.filter(Char::isDigit) },
                        label = { Text("Reject") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f)
                    )
                }
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = desc, onValueChange = { desc = it },
                    label = { Text("Deviation description") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = remarks, onValueChange = { remarks = it },
                    label = { Text("Remarks (optional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(good.toIntOrNull() ?: 0, reject.toIntOrNull() ?: 0, desc.trim(), remarks) },
                enabled = desc.isNotBlank()
            ) { Text("Submit Deviation") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable
private fun HoldDialog(
    slot: VerifySlot,
    onDismiss: () -> Unit,
    onConfirm: (reason: String, qty: Int?, remarks: String) -> Unit
) {
    var reason by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("") }
    var remarks by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Place QC HOLD · ${slot.hour_slot}") },
        text = {
            Column {
                Text(
                    "Blocks scanner shifting for this slot until released.",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.size(10.dp))
                OutlinedTextField(
                    value = reason, onValueChange = { reason = it },
                    label = { Text("Reason") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = qty, onValueChange = { qty = it.filter(Char::isDigit) },
                    label = { Text("Qty on hold (optional)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.size(8.dp))
                OutlinedTextField(
                    value = remarks, onValueChange = { remarks = it },
                    label = { Text("Remarks (optional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(reason.trim(), qty.toIntOrNull(), remarks) },
                enabled = reason.isNotBlank()
            ) { Text("Place HOLD") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
