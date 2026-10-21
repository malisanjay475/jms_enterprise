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

/** Contact info (a direct chat) or group info (members with photos and last seen). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InfoScreen(convId: String, onBack: () -> Unit, onMessage: (String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var group by remember { mutableStateOf(false) }
    var members by remember { mutableStateOf<List<Member>>(emptyList()) }
    var peer by remember { mutableStateOf<Profile?>(null) }

    LaunchedEffect(convId) {
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
                item {
                    Text("${members.size} members", color = Color(0xFF00A884), fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
                }
                items(members, key = { it.username }) { m ->
                    Row(
                        Modifier.fillMaxWidth().clickable(enabled = !Session.isMe(m.username)) { onMessage(m.username) }
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
                    }
                }
            }
        }
    }
}
