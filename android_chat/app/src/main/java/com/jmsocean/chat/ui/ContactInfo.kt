package com.jmsocean.chat.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Factory
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.jmsocean.chat.call.CallActivity
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Profile
import com.jmsocean.chat.data.Session
import com.jmsocean.chat.data.SharedReply
import kotlinx.coroutines.launch

private val Accent = Color(0xFF00A884)

/**
 * Contact info like WhatsApp: big photo (tap = full screen), name, designation |
 * department, last seen, Message / Voice / Mute, About, media, groups in common, details.
 */
@Composable
fun ContactDetails(p: Profile, shared: SharedReply?, convId: String, onBack: () -> Unit, onOpenChat: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var viewing by remember { mutableStateOf<String?>(null) }   // image URL in the full-screen viewer
    var muteMenu by remember { mutableStateOf(false) }
    val photo = Api.avatarUrl(p.username, p.photo_v)

    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        Column(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.clip(androidx.compose.foundation.shape.CircleShape).clickable(enabled = photo != null) { viewing = photo }) {
                Avatar(p.shownName, 150.dp, online = p.online, photoUrl = photo)
            }
            Spacer(Modifier.height(14.dp))
            Text(p.shownName, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Text("~ @${p.username}", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val dd = listOf(p.designation, p.department).filter { it.isNotBlank() }.joinToString("  |  ")
            if (dd.isNotEmpty()) Text(dd, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Accent, modifier = Modifier.padding(top = 6.dp))
            val seen = lastSeenText(p.online, p.last_seen_at)
            if (seen.isNotEmpty()) Text(seen, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
        }

        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ActionTile(Icons.AutoMirrored.Filled.Chat, "Message", Modifier.weight(1f), onBack)
            ActionTile(Icons.Default.Call, "Voice", Modifier.weight(1f)) { CallActivity.call(ctx, p.username) }
            Box(Modifier.weight(1f)) {
                ActionTile(Icons.Default.NotificationsOff, "Mute", Modifier.fillMaxWidth()) { muteMenu = true }
                DropdownMenu(expanded = muteMenu, onDismissRequest = { muteMenu = false }) {
                    listOf("8h" to "8 hours", "1w" to "1 week", "always" to "Always", "off" to "Unmute").forEach { (k, label) ->
                        DropdownMenuItem(text = { Text(label) }, onClick = {
                            muteMenu = false
                            scope.launch {
                                runCatching { Api.mute(convId, k) }
                                    .onSuccess { Toast.makeText(ctx, if (k == "off") "Unmuted" else "Muted", Toast.LENGTH_SHORT).show() }
                                    .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                            }
                        })
                    }
                }
            }
        }

        Card("About") {
            Text(p.about.ifBlank { "Hey there! I am using JMS Chat." }, fontSize = 16.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            Spacer(Modifier.height(10.dp))
        }

        val media = shared?.media ?: emptyList()
        Card(null) {
            CardRow(Icons.Default.PhotoLibrary, "Media, links and docs", if (shared == null) "…" else if (media.isEmpty()) "None" else "${media.size}")
            if (media.isNotEmpty()) Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                media.take(30).forEach { a ->
                    Box(
                        Modifier.size(84.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.background)
                            .clickable {
                                if (a.kind == "image") viewing = Api.fileUrl(a.sync_id)
                                else download(ctx, a.sync_id, a.file_name, a.mime)
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        if (a.kind == "image") AsyncImage(
                            model = ImageRequest.Builder(ctx).data(Api.fileUrl(a.sync_id))
                                .addHeader("Authorization", "Bearer ${Session.token}").crossfade(true).build(),
                            contentDescription = a.file_name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()
                        ) else Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(4.dp)) {
                            Text(when (a.kind) { "pdf" -> "📄"; "xlsx" -> "📊"; "audio" -> "🎤"; "video" -> "🎬"; else -> "📎" }, fontSize = 24.sp)
                            Text(a.file_name, fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                        }
                    }
                }
            }
        }

        Card(null) {
            CardRow(Icons.Default.Lock, "Privacy", null, sub = "Messages stay on the JMS server and may be reviewed by administrators.")
        }

        val groups = shared?.groups ?: emptyList()
        if (groups.isNotEmpty()) Card("${groups.size} ${if (groups.size == 1) "group" else "groups"} in common") {
            groups.forEach { g ->
                Row(
                    Modifier.fillMaxWidth().clickable { onOpenChat(g.sync_id) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Avatar(g.title ?: "Group", 40.dp, group = true)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(g.title ?: "Group", fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${g.members} members", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        val roleLine = listOf(p.role.replace('_', ' '), p.line).filter { it.isNotBlank() }.joinToString(" · ")
        if (p.mobile != null || roleLine.isNotEmpty() || p.admin_view) Card("Details") {
            p.mobile?.let { CardRow(Icons.Default.PhoneAndroid, it, null, sub = "Mobile") }
            if (roleLine.isNotEmpty()) CardRow(Icons.Default.Factory, roleLine, null, sub = "JMS role")
            // Admins / superadmins see who this really is and every earlier name.
            if (p.admin_view) {
                CardRow(Icons.Default.Badge, p.username, null, sub = "Login ID (admin view)")
                p.pending_name?.let { CardRow(Icons.Default.HourglassTop, it, null, sub = "Requested name — waiting for approval") }
                val old = p.name_history.filter { it.status == "approved" }.mapNotNull { it.old_name }.distinct()
                if (old.isNotEmpty()) CardRow(Icons.Default.History, old.joinToString(", "), null, sub = "Earlier names")
            }
        }
    }

    viewing?.let { url ->
        Dialog(onDismissRequest = { viewing = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black).clickable { viewing = null }) {
                AsyncImage(
                    model = ImageRequest.Builder(ctx).data(url).addHeader("Authorization", "Bearer ${Session.token}").crossfade(true).build(),
                    contentDescription = p.shownName, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize()
                )
                Text(p.shownName, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.TopStart).padding(20.dp))
                IconButton(onClick = { viewing = null }, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)) {
                    Icon(Icons.Default.Close, "Close", tint = Color.White)
                }
            }
        }
    }
}

@Composable
private fun ActionTile(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onClick).padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(icon, null, tint = Accent)
        Spacer(Modifier.height(4.dp))
        Text(label, fontSize = 13.sp)
    }
}

@Composable
private fun Card(title: String?, content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp)
            .clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
    ) {
        if (title != null) Text(title, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp, end = 16.dp, bottom = 4.dp))
        content()
    }
}

@Composable
private fun CardRow(icon: ImageVector, label: String, value: String?, sub: String? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 16.sp)
            if (sub != null) Text(sub, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (value != null) {
            Text(value, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
