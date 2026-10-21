package com.jmsocean.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Member
import com.jmsocean.chat.data.Profile
import com.jmsocean.chat.data.Session
import androidx.compose.foundation.layout.heightIn
import kotlinx.coroutines.launch

/** Contact info (a direct chat) or group info (members with photos and last seen). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InfoScreen(convId: String, onBack: () -> Unit, onMessage: (String) -> Unit, onLeft: () -> Unit = onBack) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var reload by remember { mutableStateOf(0) }
    var renaming by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    var memberMenu by remember { mutableStateOf<String?>(null) }
    fun act(done: String, block: suspend () -> Unit) {
        scope.launch {
            runCatching { block() }
                .onSuccess { android.widget.Toast.makeText(ctx, done, android.widget.Toast.LENGTH_SHORT).show(); reload++ }
                .onFailure { android.widget.Toast.makeText(ctx, it.message, android.widget.Toast.LENGTH_LONG).show() }
        }
    }
    var title by remember { mutableStateOf("") }
    var group by remember { mutableStateOf(false) }
    var members by remember { mutableStateOf<List<Member>>(emptyList()) }
    var peer by remember { mutableStateOf<Profile?>(null) }

    LaunchedEffect(convId, reload) {
        runCatching { Api.messages(convId) }.onSuccess { r ->
            group = r.type == "group"
            members = r.member_roles
            title = r.title ?: r.members.firstOrNull { !Session.isMe(it) } ?: ""
            if (!group) r.members.firstOrNull { !Session.isMe(it) }?.let { p -> runCatching { Api.profileOf(p) }.onSuccess { peer = it } }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = { Text(if (group) "Group info" else "Contact info", fontWeight = FontWeight.SemiBold) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Teal, titleContentColor = Color.White, navigationIconContentColor = Color.White)
            )
        }
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            item {
                Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    val p = peer
                    Avatar(title, 140.dp, group = group, photoUrl = if (group || p == null) null else Api.avatarUrl(p.username, p.photo_v))
                    Spacer(Modifier.height(12.dp))
                    Text(title, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                    val sub = if (group) "Group · ${members.size} members"
                    else p?.let { lastSeenText(it.online, it.last_seen_at) } ?: ""
                    if (sub.isNotEmpty()) Text(sub, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider()
            }
            val p = peer
            if (!group && p != null) item {
                InfoRow(Icons.Default.Info, "About", p.about.ifBlank { "Hey there! I am using JMS Chat." }, null)
                val sub = listOf(p.role.replace('_', ' '), p.line).filter { it.isNotBlank() }.joinToString(" · ")
                if (sub.isNotEmpty()) InfoRow(Icons.Default.Info, "Role", sub, null)
            }
            if (group) {
                val iAmAdmin = members.any { Session.isMe(it.username) && it.role == "admin" }
                if (iAmAdmin) item {
                    InfoRow(androidx.compose.material.icons.Icons.Default.Edit, "Group name", title) { renaming = true }
                    Row(
                        Modifier.fillMaxWidth().clickable { adding = true }.padding(horizontal = 24.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(androidx.compose.material.icons.Icons.Default.PersonAdd, null, tint = Color(0xFF00A884))
                        Spacer(Modifier.width(24.dp))
                        Text("Add members", color = Color(0xFF00A884), fontWeight = FontWeight.SemiBold)
                    }
                    HorizontalDivider()
                }
                item {
                    Text("${members.size} members", color = Color(0xFF00A884), fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
                }
                items(members, key = { it.username }) { m ->
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !Session.isMe(m.username)) { memberMenu = m.username }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Avatar(m.username, 44.dp, online = m.online, photoUrl = Api.avatarUrl(m.username, m.photo_v))
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(if (Session.isMe(m.username)) "You" else m.username, fontWeight = FontWeight.SemiBold)
                            val seen = lastSeenText(m.online, m.last_seen_at)
                            if (seen.isNotEmpty()) Text(seen, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (m.role == "admin") Box(Modifier.padding(start = 8.dp)) {
                            Text("Group admin", fontSize = 12.sp, color = Color(0xFF00A884))
                        }
                        androidx.compose.material3.DropdownMenu(expanded = memberMenu == m.username, onDismissRequest = { memberMenu = null }) {
                            androidx.compose.material3.DropdownMenuItem(text = { Text("Message ${m.username}") },
                                onClick = { memberMenu = null; onMessage(m.username) })
                            if (iAmAdmin) androidx.compose.material3.DropdownMenuItem(
                                text = { Text("Remove ${m.username}", color = MaterialTheme.colorScheme.error) },
                                onClick = { memberMenu = null; act("Removed ${m.username}") { Api.removeMember(convId, m.username) } })
                        }
                    }
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().clickable { confirmLeave = true }.padding(horizontal = 24.dp, vertical = 18.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(androidx.compose.material.icons.Icons.AutoMirrored.Filled.Logout, null, tint = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.width(24.dp))
                        Text("Leave group", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }

    if (renaming) {
        var name by remember { mutableStateOf(title) }
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text("Group name") },
            text = { androidx.compose.material3.OutlinedTextField(value = name, onValueChange = { name = it.take(80) }, singleLine = true) },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    renaming = false
                    if (name.isNotBlank()) act("Group renamed") { Api.renameGroup(convId, name.trim()) }
                }) { Text("Save") }
            },
            dismissButton = { androidx.compose.material3.TextButton(onClick = { renaming = false }) { Text("Cancel") } }
        )
    }
    if (adding) AddMembersSheet(already = members.map { it.username }) { picked ->
        adding = false
        if (picked.isNotEmpty()) act("Added ${picked.size}") { Api.addMembers(convId, picked) }
    }
    if (confirmLeave) androidx.compose.material3.AlertDialog(
        onDismissRequest = { confirmLeave = false },
        title = { Text("Leave \"$title\"?") },
        text = { Text("You will stop getting messages from this group.") },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = {
                confirmLeave = false
                scope.launch {
                    runCatching { Api.leaveGroup(convId) }
                        .onSuccess { onLeft() }
                        .onFailure { android.widget.Toast.makeText(ctx, it.message, android.widget.Toast.LENGTH_LONG).show() }
                }
            }) { Text("Leave", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { androidx.compose.material3.TextButton(onClick = { confirmLeave = false }) { Text("Cancel") } }
    )
}

/** People not yet in the group, to add (admins only). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddMembersSheet(already: List<String>, onDone: (List<String>) -> Unit) {
    var users by remember { mutableStateOf<List<com.jmsocean.chat.data.ChatUser>>(emptyList()) }
    var q by remember { mutableStateOf("") }
    val picked = androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateListOf<String>() }
    LaunchedEffect(Unit) {
        users = runCatching { Api.users() }.getOrDefault(emptyList()).filter { u -> already.none { it.equals(u.username, true) } }
    }
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = { onDone(emptyList()) }) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Add members", fontWeight = FontWeight.SemiBold, fontSize = 18.sp, modifier = Modifier.weight(1f))
            androidx.compose.material3.Button(
                enabled = picked.isNotEmpty(), onClick = { onDone(picked.toList()) },
                colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Color(0xFF00A884))
            ) { Text("Add (${picked.size})") }
        }
        androidx.compose.material3.OutlinedTextField(
            value = q, onValueChange = { q = it }, placeholder = { Text("Search") }, singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)
        )
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
            items(users.filter { q.isBlank() || it.username.contains(q, true) }, key = { it.username }) { u ->
                val sel = u.username in picked
                Row(
                    Modifier.fillMaxWidth().clickable { if (sel) picked.remove(u.username) else picked.add(u.username) }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Avatar(u.username, 40.dp, online = u.online, photoUrl = Api.avatarUrl(u.username, u.photo_v))
                    Spacer(Modifier.width(12.dp))
                    Text(u.username, modifier = Modifier.weight(1f))
                    androidx.compose.material3.Checkbox(checked = sel, onCheckedChange = null)
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
