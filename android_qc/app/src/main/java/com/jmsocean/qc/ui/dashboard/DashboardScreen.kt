package com.jmsocean.qc.ui.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

private data class Tile(val label: String, val value: String, val color: Color?)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    onMenu: () -> Unit,
    vm: DashboardViewModel = viewModel()
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
                title = { Text("Quality Dashboard", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, contentDescription = "Menu") }
                },
                actions = {
                    IconButton(onClick = { vm.load() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        }
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad).padding(16.dp)) {
            when {
                s.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                s.error != null -> Text(s.error!!, color = MaterialTheme.colorScheme.error)
                s.kpis != null -> {
                    val k = s.kpis!!
                    val rate = k.rejectionRate.toDoubleOrNull() ?: 0.0
                    val rateColor = when {
                        rate > 2 -> Crit
                        rate > 1 -> Warn
                        else -> Good
                    }
                    val tiles = listOf(
                        Tile("Produced", k.production.toString(), null),
                        Tile("Accepted", k.accepted.toString(), Good),
                        Tile("Rejected", k.rejected.toString(), Crit),
                        Tile("Reject rate", "${k.rejectionRate}%", rateColor),
                        Tile("FPA done", k.fpaDone.toString(), null),
                        Tile("Active holds", k.activeHolds.toString(), if (k.activeHolds > 0) Crit else null),
                        Tile("Held machines", k.heldMachines.toString(), if (k.heldMachines > 0) Warn else null),
                        Tile("Active issues", k.activeIssues.toString(), if (k.activeIssues > 0) Warn else null)
                    )
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(tiles) { t -> KpiTile(t) }
                    }
                }
            }
        }
    }
}

@Composable
private fun KpiTile(t: Tile) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                t.value,
                fontSize = 28.sp, fontWeight = FontWeight.Bold,
                color = t.color ?: MaterialTheme.colorScheme.onSurface
            )
            Text(
                t.label.uppercase(),
                fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
