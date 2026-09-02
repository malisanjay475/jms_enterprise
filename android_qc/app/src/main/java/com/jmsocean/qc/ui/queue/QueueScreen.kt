package com.jmsocean.qc.ui.queue

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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AssistChip
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.data.remote.QueueJob
import com.jmsocean.qc.ui.theme.Accent
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueueScreen(
    onLogout: () -> Unit,
    vm: QueueViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }

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
                actions = {
                    IconButton(onClick = { vm.loadJobs() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    TextButton(onClick = { vm.logout(); onLogout() }) {
                        Text("Log out", color = MaterialTheme.colorScheme.error)
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
                    items(s.jobs) { job -> JobCard(job) }
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
private fun JobCard(job: QueueJob) {
    val fpaDone = job.fpa_status?.equals("done", ignoreCase = true) == true
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
                Text(job.productName, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                job.machine_priority?.let { p ->
                    val c = when (p.uppercase()) {
                        "P1" -> Crit; "P2", "P3" -> Warn; else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                    Text(p, color = c, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                buildString {
                    job.JobCardNo?.let { append("JC $it") }
                    job.PlanID?.let { append(" · $it") }
                    job.Mould?.let { append(" · Mould $it") }
                },
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(onClick = {}, label = { Text("📋 QC") }, enabled = fpaDone)
                AssistChip(
                    onClick = {},
                    label = { Text(if (fpaDone) "📷 FPA ✓" else "📷 FPA") }
                )
            }
            if (fpaDone) {
                Text("FPA done", color = Good, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}
