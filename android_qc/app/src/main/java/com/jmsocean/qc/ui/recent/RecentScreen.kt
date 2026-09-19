package com.jmsocean.qc.ui.recent

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
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
import com.jmsocean.qc.data.remote.RecentSlot
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecentScreen(
    onMenu: () -> Unit,
    vm: RecentViewModel = viewModel()
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
                title = { Text("Recent Entries", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, contentDescription = "Menu") }
                },
                actions = {
                    IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh") }
                }
            )
        }
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(horizontal = 16.dp)) {
            Spacer(Modifier.size(12.dp))
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
            Text(
                "What you filled on this machine, newest first.",
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp)
            )
            Spacer(Modifier.size(12.dp))

            when {
                s.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                s.error != null -> Text(s.error!!, color = MaterialTheme.colorScheme.error)
                s.entries.isEmpty() -> Text(
                    "No recent entries for this machine.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(s.entries) { e -> RecentCard(e) }
                }
            }
        }
    }
}

@Composable
private fun RecentCard(e: RecentSlot) {
    val checks = buildList {
        e.visual_status?.let { add(Triple("Visual", it, e.visual_problem)) }
        e.colour_status?.let { add(Triple("Colour", it, e.colour_problem)) }
        e.ff_status?.let { add(Triple("F/F", it, e.ff_problem)) }
    }
    val allOk = checks.isNotEmpty() && checks.all { it.second.equals("OK", ignoreCase = true) }
    val problem = e.visual_problem ?: e.colour_problem ?: e.ff_problem

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (allOk) Good.copy(alpha = 0.5f) else MaterialTheme.colorScheme.outline
        ),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(e.slot, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    e.entered_at?.let {
                        Text(timeOf(it), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (checks.isNotEmpty()) {
                    Pill(if (allOk) "All OK" else "Check", if (allOk) Good else Crit)
                }
            }
            if (checks.isNotEmpty()) {
                Spacer(Modifier.size(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    checks.forEach { (label, status, _) ->
                        val ok = status.equals("OK", ignoreCase = true)
                        CheckChip("$label ${if (ok) "✓" else "✕"}", ok)
                    }
                }
            }
            problem?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.size(6.dp))
                Text(
                    buildString { append("Problem: ") },
                    fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(it, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
            }
            e.entered_by?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.size(4.dp))
                Text("By $it", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun Pill(text: String, color: Color) {
    Box(Modifier.border(1.dp, color, RoundedCornerShape(999.dp)).padding(horizontal = 10.dp, vertical = 2.dp)) {
        Text(text, color = color, fontWeight = FontWeight.Bold, fontSize = 11.sp)
    }
}

@Composable
private fun CheckChip(text: String, ok: Boolean) {
    val c = if (ok) Good else Crit
    Box(
        Modifier.background(c.copy(alpha = 0.12f), RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Text(text, color = c, fontWeight = FontWeight.Bold, fontSize = 11.sp)
    }
}

/** Pulls "hh:mm am/pm" out of an ISO/text timestamp; falls back to raw. */
private fun timeOf(ts: String): String {
    return runCatching {
        val t = ts.substringAfter('T', "").ifBlank { return ts }
        val hh = t.substring(0, 2).toInt()
        val mm = t.substring(3, 5)
        val ap = if (hh < 12) "am" else "pm"
        val h12 = when { hh == 0 -> 12; hh > 12 -> hh - 12; else -> hh }
        "$h12:$mm $ap"
    }.getOrDefault(ts)
}
