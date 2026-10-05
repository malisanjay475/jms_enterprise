package com.jmsocean.shifting.ui.jobs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.shifting.data.ShiftClock
import com.jmsocean.shifting.data.remote.ShiftEntry
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.common.JobAvailabilityCard
import com.jmsocean.shifting.ui.common.MetricRow
import com.jmsocean.shifting.ui.common.qty
import com.jmsocean.shifting.ui.theme.Crit
import com.jmsocean.shifting.ui.theme.Good
import com.jmsocean.shifting.ui.theme.Warn

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JobDetailScreen(onBack: () -> Unit, vm: JobDetailViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val job = s.job

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = job?.machine?.ifBlank { null } ?: "Job",
                subtitle = job?.productName?.ifBlank { job.mouldName },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                }
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
            if (job == null) return@Column

            Text(
                listOf(job.orderNo, job.jcNo, job.planCode, job.status).filter { it.isNotBlank() }.joinToString(" · "),
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            MetricRow(
                Triple("Plan", qty(job.planQty), Color.Unspecified),
                Triple("Produced", qty(job.produced), Color.Unspecified),
                Triple("QC OK", qty(job.qcApproved), Good)
            )
            MetricRow(
                Triple("Shifted", qty(job.shifted), MaterialTheme.colorScheme.primary),
                Triple("On floor", qty(job.floorBalance), if (job.floorBalance > 0) Warn else Color.Unspecified),
                Triple("Pending", qty(job.pending), Color.Unspecified)
            )

            // ── Manual shift (no label) ──────────────────────────────────
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Manual shift", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text("Use only when the material has no label.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = s.quantity,
                        onValueChange = vm::setQuantity,
                        label = { Text("Quantity (pcs)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("Send To", fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        s.locations.forEach { loc ->
                            FilterChip(
                                selected = loc.equals(s.location, ignoreCase = true),
                                onClick = { vm.setLocation(loc) },
                                label = { Text(loc) }
                            )
                        }
                    }
                    s.message?.let {
                        Text(it, color = if (s.messageOk) Good else Crit, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                    Button(
                        onClick = { vm.shift() },
                        enabled = !s.saving && s.quantity.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(52.dp)
                    ) {
                        Text(if (s.saving) "Saving…" else "Shift ${s.quantity.ifBlank { "0" }} pcs", fontWeight = FontWeight.Bold)
                    }
                }
            }

            s.avail?.let { JobAvailabilityCard(it) }

            if (job.recent.isNotEmpty()) {
                Text("Recent shifts", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                job.recent.forEach { EntryRow(it) }
            }
        }
    }
}

@Composable
fun EntryRow(e: ShiftEntry, showMachine: Boolean = false) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(Modifier.fillMaxWidth().padding(12.dp)) {
            Column(Modifier.weight(1f)) {
                val head = listOfNotNull(
                    e.machine.takeIf { showMachine && it.isNotBlank() },
                    e.colour.ifBlank { e.itemName }.ifBlank { null }
                ).joinToString(" · ")
                Text(head.ifBlank { "—" }, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                if (showMachine && e.itemName.isNotBlank() && e.colour.isNotBlank()) {
                    Text(e.itemName, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(
                    buildString {
                        append("→ ").append(e.toLocation.ifBlank { "—" })
                        if (e.totalLabels > 0) append(" · label ${e.labelNo}/${e.totalLabels}") else append(" · manual")
                        if (e.shiftedBy.isNotBlank()) append(" · ").append(e.shiftedBy)
                    },
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(ShiftClock.prettyTime(e.createdAt), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column {
                Text(qty(e.quantity), fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = MaterialTheme.colorScheme.primary)
                if (e.weightKg > 0) Text("${com.jmsocean.shifting.ui.common.kg(e.weightKg)} kg", fontSize = 11.sp)
            }
        }
    }
}
