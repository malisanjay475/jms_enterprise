package com.jmsocean.qc.ui.compliance

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.data.remote.ComplianceRow
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComplianceScreen(
    onMenu: () -> Unit,
    vm: ComplianceViewModel = viewModel()
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
                title = { Text("Compliance", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, contentDescription = "Menu") }
                },
                actions = {
                    IconButton(onClick = { vm.load() }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh") }
                }
            )
        }
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Day", "Night").forEach {
                    FilterChip(selected = s.shift == it, onClick = { vm.setShift(it) }, label = { Text(it) })
                }
            }
            Legend()
            Spacer(Modifier.height(8.dp))

            when {
                s.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                s.error != null -> Text(s.error!!, color = MaterialTheme.colorScheme.error)
                s.grid == null || s.grid!!.lines.isEmpty() -> Text(
                    "No compliance data for this shift.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                else -> {
                    val grid = s.grid!!
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        grid.lines.forEach { line ->
                            Text(
                                line.name,
                                fontWeight = FontWeight.Bold, fontSize = 14.sp,
                                modifier = Modifier.padding(top = 12.dp, bottom = 6.dp)
                            )
                            Row(Modifier.horizontalScroll(rememberScrollState())) {
                                Column {
                                    HeaderRow(grid.slots)
                                    line.rows.forEach { row -> MatrixRow(row, grid.slots) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeaderRow(slots: List<String>) {
    Row {
        Cell("Machine", 120.dp, header = true, align = TextAlign.Start)
        slots.forEach { Cell(it, 66.dp, header = true) }
    }
}

@Composable
private fun MatrixRow(row: ComplianceRow, slots: List<String>) {
    Row {
        Cell(row.machine, 120.dp, align = TextAlign.Start)
        slots.forEach { slot ->
            val status = row.cells[slot] ?: "MISSING"
            StatusCell(status)
        }
    }
}

@Composable
private fun Cell(text: String, w: androidx.compose.ui.unit.Dp, header: Boolean = false, align: TextAlign = TextAlign.Center) {
    Box(
        Modifier.width(w).height(38.dp).padding(1.dp)
            .background(if (header) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text, fontSize = 11.sp, textAlign = align,
            fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 4.dp)
        )
    }
}

@Composable
private fun StatusCell(status: String) {
    val (bg, fg, label) = when (status.uppercase()) {
        "FILLED" -> Triple(Good.copy(alpha = 0.16f), Good, "✓")
        "LATE" -> Triple(Warn.copy(alpha = 0.16f), Warn, "L")
        "MISSING" -> Triple(Crit.copy(alpha = 0.14f), Crit, "✕")
        else -> Triple(Color.Transparent, MaterialTheme.colorScheme.onSurfaceVariant, "·")
    }
    Box(
        Modifier.width(66.dp).height(38.dp).padding(1.dp).clip(RoundedCornerShape(4.dp)).background(bg),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = fg, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

@Composable
private fun Legend() {
    Row(
        Modifier.padding(top = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        LegendItem(Good, "✓ Filled")
        LegendItem(Warn, "L Late")
        LegendItem(Crit, "✕ Missing")
        LegendItem(MaterialTheme.colorScheme.onSurfaceVariant, "· Pending")
    }
}

@Composable
private fun LegendItem(c: Color, label: String) {
    Text(label, color = c, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
}
