package com.jmsocean.qc.ui.team

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

/**
 * QC shift team per line. With [gate] = true it is the full-screen lock shown right
 * after login (nothing else is reachable until the user's own lines are saved);
 * otherwise it is the normal "QC Shift Team" screen from the menu.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShiftTeamScreen(
    vm: ShiftTeamViewModel,
    gate: Boolean,
    onMenu: () -> Unit = {},
    onLogout: () -> Unit = {}
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
                title = { Text("QC Shift Team", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    if (!gate) IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, contentDescription = "Menu") }
                    else Icon(Icons.Default.Groups, null, Modifier.padding(start = 14.dp), tint = MaterialTheme.colorScheme.primary)
                },
                actions = {
                    IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh") }
                    if (gate) TextButton(onClick = onLogout) { Text("Log out") }
                }
            )
        }
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp)
        ) {
            if (gate) {
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                        .background(Warn.copy(alpha = 0.14f)).padding(12.dp)
                ) {
                    Text(
                        "Save the QC Supervisor and QC Incharge for your line(s) to start. " +
                            "Inspection, FPA, Memo and Verify stay locked until then.",
                        color = Warn, fontSize = 13.sp, fontWeight = FontWeight.SemiBold
                    )
                }
                Spacer(Modifier.size(10.dp))
            }
            Text(
                "${s.shift} shift · ${s.date} · ${if (s.shift == "Night") "08:00 PM – 08:00 AM" else "08:00 AM – 08:00 PM"}",
                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (s.allAccess) {
                Text(
                    "All-lines access: saving is optional for you.",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Spacer(Modifier.size(10.dp))

            when {
                s.loading && s.rows.isEmpty() -> Box(Modifier.fillMaxWidth().padding(32.dp), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                s.error != null && s.rows.isEmpty() -> {
                    Text(s.error!!, color = Crit, fontSize = 13.sp)
                    Spacer(Modifier.size(8.dp))
                    OutlinedButton(onClick = { vm.load() }) { Text("Try again") }
                }
                s.rows.isEmpty() -> Text(
                    "No lines found for your line access.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                else -> s.rows.forEach { row ->
                    LineCard(row, required = row.line in s.required, vm = vm)
                    Spacer(Modifier.size(10.dp))
                }
            }

            if (gate) {
                Spacer(Modifier.size(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    listOf("Inspect", "FPA", "Memo", "Verify").forEach {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Lock, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(" $it", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LineCard(row: LineTeamRow, required: Boolean, vm: ShiftTeamViewModel) {
    val border = when {
        row.saved -> BorderStroke(1.dp, Good.copy(alpha = 0.5f))
        required -> BorderStroke(1.5.dp, Warn)
        else -> BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = border,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.line, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                Text(
                    if (row.saved) "Saved" else if (required) "Pending" else "Not entered",
                    color = if (row.saved) Good else if (required) Warn else MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp, fontWeight = FontWeight.SemiBold
                )
            }
            if (row.saved) {
                Text("QC Supervisor: ${row.supervisor}", fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                Text("QC Incharge: ${row.incharge}", fontSize = 13.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (row.savedBy.isNotBlank()) {
                        Text(
                            "Saved by ${row.savedBy}", fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f)
                        )
                    } else Spacer(Modifier.weight(1f))
                    TextButton(onClick = { vm.edit(row.line) }) { Text("Edit") }
                }
            } else {
                Spacer(Modifier.size(6.dp))
                OutlinedTextField(
                    value = row.supervisor, onValueChange = { vm.setSupervisor(row.line, it) },
                    label = { Text("QC Supervisor name") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.size(6.dp))
                OutlinedTextField(
                    value = row.incharge, onValueChange = { vm.setIncharge(row.line, it) },
                    label = { Text("QC Incharge name") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                row.error?.let { Text(it, color = Crit, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) }
                Spacer(Modifier.size(8.dp))
                Button(onClick = { vm.save(row.line) }, enabled = !row.saving, modifier = Modifier.fillMaxWidth()) {
                    if (row.saving) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    else Text("Save shift team", color = MaterialTheme.colorScheme.onPrimary)
                }
            }
        }
    }
}
