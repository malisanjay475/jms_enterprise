package com.jmsocean.qc.ui.queue

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.data.parseColourLines
import com.jmsocean.qc.data.remote.QueueJob
import com.jmsocean.qc.ui.theme.Accent
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueueScreen(
    onMenu: () -> Unit,
    onOpenFpa: () -> Unit,
    onOpenQc: () -> Unit,
    vm: QueueViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val pendingSync by vm.pendingSync.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }
    val ctx = androidx.compose.ui.platform.LocalContext.current

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
                        Text("Job Queue", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(
                            "Line · ${s.line.ifBlank { "—" }}",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onMenu) {
                        Icon(Icons.Default.Menu, contentDescription = "Menu")
                    }
                },
                actions = {
                    IconButton(onClick = { vm.loadJobs() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        }
    ) { pad ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(pad)
                .padding(horizontal = 16.dp)
        ) {
            Spacer(Modifier.height(12.dp))

            // Offline backlog banner
            if (pendingSync > 0) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Warn.copy(alpha = 0.15f)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
                ) {
                    Row(
                        Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            "$pendingSync entr${if (pendingSync == 1) "y" else "ies"} waiting to sync",
                            fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Warn,
                            modifier = Modifier.weight(1f)
                        )
                        TextButton(onClick = { vm.syncNow() }) { Text("Sync now") }
                    }
                }
            }

            // Self-update banner
            s.update?.let { v ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = Accent),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)
                ) {
                    Row(
                        Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                "Update available · v${v.versionName}",
                                color = androidx.compose.ui.graphics.Color.White,
                                fontWeight = FontWeight.Bold, fontSize = 14.sp
                            )
                            Text(
                                v.notes?.takeIf { it.isNotBlank() } ?: "A newer version is ready to install.",
                                color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.9f),
                                fontSize = 12.sp
                            )
                            if (s.updateError != null) {
                                Text(s.updateError!!, color = androidx.compose.ui.graphics.Color.White, fontSize = 12.sp)
                            }
                        }
                        Spacer(Modifier.size(10.dp))
                        if (s.downloadingUpdate) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                strokeWidth = 2.dp,
                                color = androidx.compose.ui.graphics.Color.White
                            )
                        } else {
                            OutlinedButton(onClick = { vm.installUpdate(ctx) }) {
                                Text("Update", color = androidx.compose.ui.graphics.Color.White)
                            }
                        }
                    }
                }
            }

            // Machine picker
            Box {
                OutlinedButton(onClick = { menuOpen = true }) {
                    Text(s.selectedMachine ?: "Select machine ▾")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (s.machines.isEmpty()) {
                        DropdownMenuItem(text = { Text("No machines") }, onClick = {})
                    }
                    s.machines.forEach { m ->
                        DropdownMenuItem(
                            text = { Text(m) },
                            onClick = { menuOpen = false; vm.selectMachine(m) }
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            when {
                s.loadingJobs || s.loadingMachines -> CenterLoader()
                s.error != null -> Text(
                    s.error!!,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 24.dp)
                )
                s.jobs.isEmpty() -> Text(
                    "No queued jobs for this machine.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 24.dp)
                )
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(s.jobs) { job ->
                        JobCard(
                            job = job,
                            fpaDone = job.PlanID != null && job.PlanID in s.fpaDonePlanIds,
                            onFpa = { vm.openFpa(job); onOpenFpa() },
                            onQc = { vm.openFpa(job); onOpenQc() }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CenterLoader() {
    Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Accent)
    }
}

@Composable
private fun JobCard(job: QueueJob, fpaDone: Boolean, onFpa: () -> Unit, onQc: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Text(
                    job.productName, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                    modifier = Modifier.weight(1f)
                )
                job.machinePriority?.let { PriorityBadge(it) }
            }

            // OR No | JC No
            Spacer(Modifier.height(4.dp))
            Text(
                buildString {
                    append("OR ${job.orderNumber.ifBlank { "—" }}")
                    job.JobCardNo?.takeIf { it.isNotBlank() }?.let { append("  |  JC $it") }
                },
                fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface
            )
            // Client Name
            job.clientName?.takeIf { it.isNotBlank() }?.let {
                Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
            }
            // Mould Name · Mould No
            Spacer(Modifier.height(2.dp))
            Text(
                buildString {
                    append("Mould: ${job.Mould?.takeIf { it.isNotBlank() } ?: "—"}")
                    job.mouldNo?.takeIf { it.isNotBlank() }?.let { append("   ·   No: $it") }
                },
                fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // FPA — green + ticked once done
                if (fpaDone) {
                    Button(
                        onClick = onFpa,
                        colors = ButtonDefaults.buttonColors(containerColor = Good),
                        modifier = Modifier.weight(1f)
                    ) { Text("📷 FPA ✓", color = androidx.compose.ui.graphics.Color.White, fontWeight = FontWeight.Bold) }
                } else {
                    OutlinedButton(onClick = onFpa, modifier = Modifier.weight(1f)) { Text("📷 FPA") }
                }
                // QC — enabled only after FPA
                Button(
                    onClick = onQc,
                    enabled = fpaDone,
                    modifier = Modifier.weight(1f)
                ) { Text("📋 QC", color = MaterialTheme.colorScheme.onPrimary) }
            }
            if (!fpaDone) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "Complete FPA to enable QC",
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun PriorityBadge(p: String) {
    val (fg, bg) = when (p.uppercase()) {
        "P1" -> Crit to Crit.copy(alpha = 0.12f)
        "P2" -> Warn to Warn.copy(alpha = 0.12f)
        "P3" -> Warn to Warn.copy(alpha = 0.10f)
        else -> MaterialTheme.colorScheme.onSurfaceVariant to MaterialTheme.colorScheme.surfaceVariant
    }
    Box(
        Modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 9.dp, vertical = 3.dp)
    ) {
        Text(p.uppercase(), color = fg, fontWeight = FontWeight.Bold, fontSize = 11.sp)
    }
}
