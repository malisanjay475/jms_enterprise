package com.jmsocean.chat.ui

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.data.AlertInfo
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.ApprovalItem
import com.jmsocean.chat.data.Message
import com.jmsocean.chat.data.Session
import kotlinx.coroutines.launch

/** "✋ I'm on it" under a JMS Alerts message (stops it escalating), or who took it. */
@Composable
fun AlertAck(a: AlertInfo, onAck: () -> Unit) {
    val handover = a.kind == "handover"
    if (a.acked_by != null) {
        Text(if (handover) "✓ Read by ${if (Session.isMe(a.acked_by)) "you" else a.acked_by}"
            else "✋ ${if (Session.isMe(a.acked_by)) "You are" else "${a.acked_by} is"} on it", color = Color(0xFF12A66A),
            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
    } else {
        Button(onClick = onAck, colors = ButtonDefaults.buttonColors(containerColor = if (handover) Color(0xFF00A884) else Color(0xFFE53935)),
            shape = RoundedCornerShape(16.dp), modifier = Modifier.padding(top = 6.dp).height(34.dp)) {
            Text(if (handover) "✓ I read it" else "✋ I'm on it", fontSize = 13.sp)
        }
        if (a.escalated > 0) Text("⏫ Escalated to ${if (a.escalated > 1) "superadmins" else "managers"}",
            color = Color(0xFFE53935), fontSize = 11.sp)
    }
}

@Composable
fun TicketDialog(m: Message, onRaise: (machine: String, problem: String, priority: String) -> Unit, onClose: () -> Unit) {
    var machine by remember { mutableStateOf(Regex("""\bM[- ]?\d+\b""", RegexOption.IGNORE_CASE).find(m.body)?.value ?: "") }
    var problem by remember { mutableStateOf(m.body.take(500)) }
    var priority by remember { mutableStateOf("high") }
    var pick by remember { mutableStateOf(false) }
    val labels = mapOf("breakdown" to "🛑 Breakdown (machine stopped)", "high" to "High", "normal" to "Normal", "low" to "Low")
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("🔧 Raise maintenance ticket") },
        text = {
            Column {
                OutlinedTextField(value = machine, onValueChange = { machine = it.take(100) }, label = { Text("Machine (e.g. M-07)") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(6.dp))
                OutlinedTextField(value = problem, onValueChange = { problem = it.take(1000) }, label = { Text("Problem") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(6.dp))
                androidx.compose.foundation.layout.Box {
                    OutlinedButton(onClick = { pick = true }, modifier = Modifier.fillMaxWidth()) { Text("Priority: ${labels[priority]}") }
                    DropdownMenu(expanded = pick, onDismissRequest = { pick = false }) {
                        labels.forEach { (k, v) -> DropdownMenuItem(text = { Text(v) }, onClick = { priority = k; pick = false }) }
                    }
                }
                if (m.attachment?.kind == "image") Text("📷 The photo stays in this chat; the ticket says so.", fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
        },
        confirmButton = { TextButton(onClick = { if (machine.isNotBlank() && problem.isNotBlank()) onRaise(machine.trim(), problem.trim(), priority) }) { Text("Raise ticket") } },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}

/** Job-card approvals waiting for me (full JMS access only). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalsScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<ApprovalItem>?>(null) }
    var allowed by remember { mutableStateOf(true) }
    var reload by remember { mutableStateOf(0) }
    var rejecting by remember { mutableStateOf<ApprovalItem?>(null) }
    LaunchedEffect(reload) {
        runCatching { Api.approvals() }.onSuccess { allowed = it.allowed; items = it.items.filter { a -> a.can_approve != false } }
            .onFailure { items = emptyList(); Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
    }
    fun act(a: ApprovalItem, action: String, remarks: String) {
        scope.launch {
            runCatching { Api.approvalAction(a.id, action, remarks) }
                .onSuccess { Toast.makeText(ctx, if (action == "APPROVED") "✅ Approved" else "❌ Rejected", Toast.LENGTH_SHORT).show(); reload++ }
                .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
        }
    }
    Scaffold(topBar = {
        TopAppBar(
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            title = { Text("Approvals", fontWeight = FontWeight.SemiBold) },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = headerColor(), titleContentColor = Color.White, navigationIconContentColor = Color.White)
        )
    }) { pad ->
        val list = items
        when {
            list == null -> LinearProgressIndicator(Modifier.padding(pad).fillMaxWidth(), color = Green)
            !allowed -> Text("Approvals from chat need full JMS access (global login). Use the Planning page on the website.",
                Modifier.padding(pad).padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> LazyColumn(Modifier.padding(pad).fillMaxSize()) {
                if (list.isEmpty()) item { Text("Nothing waiting for you. ✅", Modifier.padding(24.dp)) }
                items(list, key = { it.id }) { a ->
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                        Text(listOfNotNull(a.job_card_no?.let { "JC $it" }, a.plan_id).joinToString(" · "), fontWeight = FontWeight.SemiBold)
                        Text(listOfNotNull(a.item_name ?: a.product_name, a.machine?.let { "Machine $it" }, a.order_no?.let { "Order $it" },
                            a.approval_stage_label).joinToString(" · "), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                            OutlinedButton(onClick = { rejecting = a }) { Text("Reject") }
                            Button(onClick = { act(a, "APPROVED", "") }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00A884))) { Text("Approve") }
                        }
                    }
                    HorizontalDivider()
                }
            }
        }
    }
    rejecting?.let { a ->
        var why by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { rejecting = null },
            title = { Text("Reject — reason") },
            text = { OutlinedTextField(value = why, onValueChange = { why = it.take(500) }, label = { Text("Reason (required)") }) },
            confirmButton = { TextButton(onClick = { if (why.isNotBlank()) { rejecting = null; act(a, "REJECTED", why.trim()) } }) { Text("Reject") } },
            dismissButton = { TextButton(onClick = { rejecting = null }) { Text("Cancel") } }
        )
    }
}
