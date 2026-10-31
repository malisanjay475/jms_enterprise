package com.jmsocean.chat.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.NameRequest
import com.jmsocean.chat.data.NameRequestsReply
import kotlinx.coroutines.launch

/** Admins / superadmins: approve or reject the names people asked for. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NameRequestsScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<NameRequestsReply?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf<String?>(null) }
    var rejecting by remember { mutableStateOf<NameRequest?>(null) }

    LaunchedEffect(reload) {
        runCatching { Api.nameRequests() }.onSuccess { data = it; error = null }.onFailure { error = it.message }
    }

    fun decide(r: NameRequest, approve: Boolean, note: String = "") {
        busy = r.username
        scope.launch {
            runCatching { Api.decideName(r.username, approve, note) }
                .onSuccess {
                    Toast.makeText(ctx, if (approve) "${r.requested_name} approved" else "Request rejected", Toast.LENGTH_SHORT).show()
                    reload++
                }
                .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
            busy = null
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = { Text("Name requests", fontWeight = FontWeight.SemiBold) },
                actions = { IconButton(onClick = { reload++ }) { Icon(Icons.Default.Refresh, "Refresh") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = headerColor(), titleContentColor = Color.White,
                    navigationIconContentColor = Color.White, actionIconContentColor = Color.White)
            )
        }
    ) { pad ->
        val d = data
        LazyColumn(Modifier.padding(pad).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
            error?.let { e -> item { Text(e, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(8.dp)) } }
            if (d == null && error == null) item { Text("Loading…", modifier = Modifier.padding(16.dp)) }
            if (d != null && d.requests.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("🎉", fontSize = 40.sp)
                    Spacer(Modifier.height(8.dp))
                    Text("No name changes waiting", fontWeight = FontWeight.SemiBold)
                }
            }
            items(d?.requests ?: emptyList(), key = { it.username }) { r ->
                Card(shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .5f))) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(r.current_name, 52.dp, photoUrl = Api.avatarUrl(r.username, r.photo_v))
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(r.current_name, textDecoration = TextDecoration.LineThrough, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                    Icon(Icons.AutoMirrored.Filled.ArrowForward, null, Modifier.padding(horizontal = 6.dp).height(16.dp), tint = Color(0xFF00A884))
                                    Text(r.requested_name, fontWeight = FontWeight.Bold, color = Color(0xFF00A884), maxLines = 1,
                                        overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                }
                                val sub = listOf("@" + r.username, r.role.replace('_', ' '), r.line).filter { it.isNotBlank() }.joinToString(" · ")
                                Text(sub, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(onClick = { rejecting = r }, enabled = busy == null, modifier = Modifier.weight(1f)) {
                                Icon(Icons.Default.Close, null, tint = MaterialTheme.colorScheme.error)
                                Spacer(Modifier.width(6.dp))
                                Text("Reject", color = MaterialTheme.colorScheme.error)
                            }
                            Button(onClick = { decide(r, true) }, enabled = busy == null, modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00A884))) {
                                Icon(Icons.Default.Check, null)
                                Spacer(Modifier.width(6.dp))
                                Text("Approve")
                            }
                        }
                    }
                }
            }
            if (d != null && d.recent.isNotEmpty()) {
                item { Text("Recent decisions", color = Color(0xFF00A884), fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp, start = 4.dp)) }
                items(d.recent) { h ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${h.old_name ?: h.username} → ${h.new_name}", fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("@${h.username}" + (h.reviewed_by?.let { " · by $it" } ?: "") + (h.note?.let { " · $it" } ?: ""),
                                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                        }
                        val ok = h.status == "approved"
                        Text(if (ok) "Approved" else "Rejected", fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                            color = if (ok) Color(0xFF15803D) else Color(0xFFB3261E),
                            modifier = Modifier.clip(RoundedCornerShape(10.dp))
                                .background(if (ok) Color(0xFFDCFCE7) else Color(0xFFFDE7E9)).padding(horizontal = 8.dp, vertical = 2.dp))
                    }
                }
            }
        }
    }

    rejecting?.let { r ->
        var note by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { rejecting = null },
            title = { Text("Reject \"${r.requested_name}\"?") },
            text = {
                OutlinedTextField(value = note, onValueChange = { note = it.take(140) }, label = { Text("Reason (optional)") })
            },
            confirmButton = { TextButton(onClick = { rejecting = null; decide(r, false, note.trim()) }) { Text("Reject") } },
            dismissButton = { TextButton(onClick = { rejecting = null }) { Text("Cancel") } }
        )
    }
}
