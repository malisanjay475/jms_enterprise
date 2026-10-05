package com.jmsocean.shifting.ui.jobs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.shifting.data.remote.Job
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.EmptyNote
import com.jmsocean.shifting.ui.common.ErrorCard
import com.jmsocean.shifting.ui.common.MetricRow
import com.jmsocean.shifting.ui.common.Pill
import com.jmsocean.shifting.ui.common.qty
import com.jmsocean.shifting.ui.theme.Good
import com.jmsocean.shifting.ui.theme.Steel
import com.jmsocean.shifting.ui.theme.Warn

@Composable
fun JobsScreen(onMenu: () -> Unit, onOpenJob: (String) -> Unit, vm: JobsViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Jobs",
                subtitle = "${s.visible.size} jobs · last ${s.days} days",
                onMenu = onMenu,
                actions = { IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Reload") } }
            )
        }
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item {
                    OutlinedTextField(
                        value = s.search,
                        onValueChange = vm::setSearch,
                        label = { Text("Search machine, item, order") },
                        leadingIcon = { Icon(Icons.Default.Search, null) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(3, 7, 30).forEach { d ->
                            FilterChip(selected = s.days == d, onClick = { vm.setDays(d) }, label = { Text("$d days") })
                        }
                        FilterChip(selected = s.pendingOnly, onClick = { vm.setPendingOnly(!s.pendingOnly) }, label = { Text("On floor") })
                    }
                }
                s.error?.let { item { ErrorCard(it, onRetry = { vm.load() }) } }
                if (!s.loading && s.error == null && s.visible.isEmpty()) {
                    item { EmptyNote(if (s.jobs.isEmpty()) "No jobs in this period." else "No job matches the filter.") }
                }
                items(s.visible, key = { it.planId.ifBlank { it.planCode + it.machine } }) { job ->
                    JobCard(job) { if (job.planId.isNotBlank()) onOpenJob(job.planId) }
                }
            }
        }
    }
}

@Composable
private fun JobCard(job: Job, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(job.machine.ifBlank { "—" }, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
                    Text(
                        job.itemName.ifBlank { job.mouldName }.ifBlank { "—" },
                        fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        listOf(job.orderNo, job.jcNo).filter { it.isNotBlank() }.joinToString(" · "),
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(Modifier.width(8.dp))
                if (job.isRunning) Pill("Running", Good.copy(alpha = 0.15f), Good)
                else Pill(job.status.ifBlank { "Closed" }, Steel.copy(alpha = 0.15f), Steel)
            }
            MetricRow(
                Triple("Produced", qty(job.produced), Color.Unspecified),
                Triple("Shifted", qty(job.shifted), MaterialTheme.colorScheme.primary),
                Triple("On floor", qty(job.floorBalance), if (job.floorBalance > 0) Warn else Color.Unspecified)
            )
        }
    }
}
