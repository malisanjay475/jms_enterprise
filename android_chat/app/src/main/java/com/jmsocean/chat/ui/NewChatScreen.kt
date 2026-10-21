package com.jmsocean.chat.ui

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.ChatUser
import kotlinx.coroutines.launch

/** Pick a person to message, or (group = true) people and a name for a new group. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewChatScreen(group: Boolean, onBack: () -> Unit, onNewGroup: () -> Unit, onOpen: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var users by remember { mutableStateOf<List<ChatUser>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var query by remember { mutableStateOf("") }
    var groupName by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val picked = remember { mutableStateListOf<String>() }

    LaunchedEffect(Unit) {
        runCatching { Api.users() }.onSuccess { users = it }.onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
        loading = false
    }

    val shown = users.filter { query.isBlank() || it.username.contains(query, true) || it.role.contains(query, true) || it.line.contains(query, true) }
        .sortedWith(compareByDescending<ChatUser> { it.online }.thenBy { it.username.lowercase() })

    fun open(u: ChatUser) {
        if (busy) return
        busy = true
        scope.launch {
            runCatching { Api.openDirect(u.username) }
                .onSuccess { onOpen(it.sync_id) }
                .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
            busy = false
        }
    }

    fun create() {
        if (busy) return
        if (groupName.isBlank()) { Toast.makeText(ctx, "Give the group a name.", Toast.LENGTH_SHORT).show(); return }
        if (picked.isEmpty()) { Toast.makeText(ctx, "Add at least one person.", Toast.LENGTH_SHORT).show(); return }
        busy = true
        scope.launch {
            runCatching { Api.createGroup(groupName.trim(), picked.toList()) }
                .onSuccess { onOpen(it.sync_id) }
                .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
            busy = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = {
                    Column {
                        Text(if (group) "New group" else "Select contact", fontWeight = FontWeight.SemiBold)
                        Text(if (group) "${picked.size} selected" else "${users.size} people", fontSize = 12.sp)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Teal, titleContentColor = Color.White, navigationIconContentColor = Color.White)
            )
        },
        floatingActionButton = {
            if (group) ExtendedFloatingActionButton(
                onClick = { create() }, containerColor = Color(0xFF00A884), contentColor = Color.White,
                icon = { Icon(Icons.Default.Check, null) }, text = { Text("Create") }
            )
        }
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (loading || busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Green)
            if (group) OutlinedTextField(
                value = groupName, onValueChange = { groupName = it.take(80) }, label = { Text("Group name") }, singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
            )
            OutlinedTextField(
                value = query, onValueChange = { query = it }, placeholder = { Text("Search name, role or line") }, singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
            )
            LazyColumn(Modifier.fillMaxSize()) {
                if (!group && query.isBlank()) item {
                    Row(
                        Modifier.fillMaxWidth().clickable(onClick = onNewGroup).padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.GroupAdd, null, Modifier.size(48.dp).padding(10.dp), tint = Color(0xFF00A884))
                        Spacer(Modifier.width(14.dp))
                        Text("New group", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    }
                }
                items(shown, key = { it.username }) { u ->
                    val sel = u.username in picked
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            if (group) { if (sel) picked.remove(u.username) else picked.add(u.username) } else open(u)
                        }.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Avatar(u.username, 46.dp, online = u.online, photoUrl = Api.avatarUrl(u.username, u.photo_v))
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(u.username, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                            val sub = listOf(u.role.replace('_', ' '), u.line).filter { it.isNotBlank() }.joinToString(" · ")
                            Text(if (u.online) "online${if (sub.isNotEmpty()) " · $sub" else ""}" else sub, fontSize = 13.sp,
                                color = if (u.online) Color(0xFF00A884) else MaterialTheme.colorScheme.onSurfaceVariant)
                            if (u.about.isNotBlank()) Text(u.about, fontSize = 13.sp, maxLines = 1,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (group) Checkbox(checked = sel, onCheckedChange = { if (it) picked.add(u.username) else picked.remove(u.username) })
                    }
                }
            }
        }
    }
}
