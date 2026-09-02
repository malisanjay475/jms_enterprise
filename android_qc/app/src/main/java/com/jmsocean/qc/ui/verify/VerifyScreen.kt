package com.jmsocean.qc.ui.verify

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
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
    onBack: () -> Unit,
    vm: VerifyViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()
    var holdFor by remember { mutableStateOf<VerifySlot?>(null) }

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
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
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
                            onHold = { holdFor = slot }
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
}

@Composable
private fun SlotCard(
    slot: VerifySlot,
    busy: Boolean,
    onVerify: (Int, Int, String) -> Unit,
    onHold: () -> Unit
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
        else -> "Pending"
    }

    var good by remember(slot.hour_slot, slot.qc_verified) {
        mutableStateOf((slot.qc_good_qty ?: slot.sup_good_qty)?.toString() ?: "")
    }
    var reject by remember(slot.hour_slot, slot.qc_verified) {
        mutableStateOf((slot.qc_reject_qty ?: slot.sup_reject_qty)?.toString() ?: "")
    }
    var remarks by remember(slot.hour_slot) { mutableStateOf("") }
    var expanded by remember(slot.hour_slot, slot.qc_verified) { mutableStateOf(!slot.qc_verified) }

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(slot.hour_slot, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(badgeText, color = badgeColor, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }
            Spacer(Modifier.size(6.dp))
            Text(
                "Supervisor · Good ${slot.sup_good_qty ?: "—"}  ·  Reject ${slot.sup_reject_qty ?: "—"}",
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (slot.qc_verified && slot.verified_by != null) {
                Text(
                    "By ${slot.verified_by}${slot.verified_at?.let { " · $it" } ?: ""}",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (slot.qc_verified && !expanded) {
                TextButton(onClick = { expanded = true }) { Text("Re-verify") }
            }

            if (expanded) {
                Spacer(Modifier.size(8.dp))
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
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = onHold,
                        enabled = !busy,
                        modifier = Modifier.weight(1f)
                    ) { Text("HOLD", color = Crit) }
                    Button(
                        onClick = {
                            val g = good.toIntOrNull(); val r = reject.toIntOrNull()
                            if (g != null && r != null) onVerify(g, r, remarks)
                        },
                        enabled = !busy && good.toIntOrNull() != null && reject.toIntOrNull() != null,
                        modifier = Modifier.weight(1f)
                    ) {
                        if (busy) CircularProgressIndicator(
                            Modifier.size(18.dp), strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary
                        ) else Text("Verify")
                    }
                }
            }
        }
    }
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
