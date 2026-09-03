package com.jmsocean.qc.ui.issues

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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.AlertDialog
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
import com.jmsocean.qc.data.remote.MaterialIssue
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssuesScreen(
    onMenu: () -> Unit,
    vm: IssuesViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()
    var showCreate by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                ),
                title = { Text("Material Issues", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, contentDescription = "Menu") }
                },
                actions = {
                    IconButton(onClick = { showCreate = true }) {
                        Icon(Icons.Default.Add, contentDescription = "New issue")
                    }
                }
            )
        }
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).padding(horizontal = 16.dp)
        ) {
            Spacer(Modifier.size(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("all" to "All", "OPEN" to "Open", "ACKNOWLEDGED" to "Ack", "RESOLVED" to "Resolved")
                    .forEach { (key, label) ->
                        FilterChip(
                            selected = s.filter == key,
                            onClick = { if (s.filter != key) vm.setFilter(key) },
                            label = { Text(label) }
                        )
                    }
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
                s.issues.isEmpty() -> Text(
                    "No issues found.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(s.issues) { issue -> IssueCard(issue) }
                }
            }
        }
    }

    if (showCreate) {
        NewIssueDialog(
            busy = s.creating,
            error = s.createError,
            onDismiss = { showCreate = false },
            onCreate = { desc, sev, role, name ->
                vm.create(desc, sev, role, name) { showCreate = false }
            }
        )
    }
}

@Composable
private fun IssueCard(issue: MaterialIssue) {
    val statusColor = when (issue.status?.uppercase()) {
        "RESOLVED" -> Good
        "ACKNOWLEDGED" -> Warn
        else -> Crit
    }
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
                    issue.issue_description ?: "—",
                    fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.size(8.dp))
                Text(
                    (issue.status ?: "OPEN").uppercase(),
                    color = statusColor, fontWeight = FontWeight.Bold, fontSize = 11.sp
                )
            }
            Spacer(Modifier.size(4.dp))
            Text(
                buildString {
                    issue.machine?.let { append(it) }
                    issue.assigned_to_role?.let { append(" · → $it") }
                    issue.severity?.let { append(" · $it") }
                },
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            issue.created_by?.let {
                Text("By $it", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun NewIssueDialog(
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onCreate: (desc: String, severity: String, role: String, name: String) -> Unit
) {
    var desc by remember { mutableStateOf("") }
    var severity by remember { mutableStateOf("Medium") }
    var role by remember { mutableStateOf("Supervisor") }
    var name by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New material issue") },
        text = {
            Column {
                OutlinedTextField(
                    value = desc, onValueChange = { desc = it },
                    label = { Text("Description") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.size(10.dp))
                Text("Severity", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("Low", "Medium", "High").forEach {
                        FilterChip(selected = severity == it, onClick = { severity = it }, label = { Text(it) })
                    }
                }
                Spacer(Modifier.size(10.dp))
                Text("Assign to", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("Supervisor", "Incharge", "Manager").forEach {
                        FilterChip(selected = role == it, onClick = { role = it }, label = { Text(it) })
                    }
                }
                Spacer(Modifier.size(10.dp))
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("Assignee name (optional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (error != null) {
                    Spacer(Modifier.size(8.dp))
                    Text(error, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            Button(onClick = { onCreate(desc.trim(), severity, role, name.trim()) }, enabled = !busy) {
                if (busy) CircularProgressIndicator(
                    Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary
                ) else Text("Raise issue")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
