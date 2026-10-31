package com.jmsocean.chat.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
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
import com.jmsocean.chat.data.ChatFolder
import com.jmsocean.chat.data.Conversation
import com.jmsocean.chat.data.Device
import kotlinx.coroutines.launch

/** True inside a protected chat: no download, save or forward. */
val LocalProtected = compositionLocalOf { false }

val DISAPPEAR_OPTIONS = listOf(0 to "Off", 86400 to "24 hours", 604800 to "7 days", 7776000 to "90 days")
fun disappearLabel(s: Int) = DISAPPEAR_OPTIONS.firstOrNull { it.first == s }?.second ?: "Off"

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/** Screenshots and screen recording show black while this is on screen. */
@Composable
fun SecureWindow(on: Boolean) {
    val ctx = LocalContext.current
    DisposableEffect(on) {
        val w = ctx.activity()?.window
        if (on) w?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (on) w?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

/** Disappearing messages + protected chat, for a group admin or either person in a direct chat. */
@Composable
fun SecurityDialog(c: Conversation, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var secs by remember { mutableStateOf(c.disappear_seconds) }
    var prot by remember { mutableStateOf(c.protected) }
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text("🔒 Chat security") },
        text = {
            Column {
                Text("⏳ Disappearing messages", fontWeight = FontWeight.SemiBold)
                Text("New messages are deleted for everyone after:", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                DISAPPEAR_OPTIONS.forEach { (v, label) ->
                    Row(Modifier.fillMaxWidth().clickable { secs = v }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = secs == v, onClick = { secs = v }); Text(label)
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Protected chat", fontWeight = FontWeight.SemiBold)
                        Text("No screenshots, downloads or forwarding", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(checked = prot, onCheckedChange = { prot = it })
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                scope.launch {
                    runCatching { Api.setSecurity(c.sync_id, secs, prot) }
                        .onSuccess { onDone() }
                        .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDone) { Text("Cancel") } }
    )
}

/** 📱 My devices: sign out a lost phone, or all others. */
@Composable
fun DevicesDialog(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<Device>?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) {
        runCatching { Api.devices() }.onSuccess { devices = it }.onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
    }
    fun act(block: suspend () -> Unit) = scope.launch {
        runCatching { block() }.onSuccess { tick++ }.onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
    }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("📱 My devices") },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                val list = devices
                if (list == null) Text("Loading…")
                else if (list.isEmpty()) Text("No sign-ins yet.")
                list?.forEach { d ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text((if (d.platform == "android-app") "📱 " else "💻 ") + (d.name ?: "Device") + if (d.current) "  (this phone)" else "",
                                fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            Text(
                                (if (!d.approved) "⏳ Waiting for approval" else if (d.signed_in) "Signed in" else "Signed out") +
                                    (d.last_seen_at?.let { " · last used ${listTime(it)}" } ?: ""),
                                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (d.signed_in && !d.current) TextButton(onClick = { act { Api.signOutDevice(d.id) } }) { Text("Sign out") }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Close") } },
        dismissButton = {
            TextButton(onClick = {
                act { val n = Api.signOutOthers(); Toast.makeText(ctx, "Signed out $n device(s)", Toast.LENGTH_SHORT).show() }
            }) { Text("Sign out others", color = Color(0xFFD33333)) }
        }
    )
}

/** Make / rename / delete chat folders. */
@Composable
fun FoldersDialog(folders: List<ChatFolder>, onChanged: () -> Unit, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    fun act(block: suspend () -> Unit) = scope.launch {
        runCatching { block() }.onSuccess { onChanged() }.onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
    }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("📁 Chat folders") },
        text = {
            Column {
                folders.forEach { f ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("📁 ${f.name}  (${f.conversations.size})", modifier = Modifier.weight(1f))
                        TextButton(onClick = { act { Api.deleteFolder(f.id) } }) { Text("Delete", color = Color(0xFFD33333)) }
                    }
                }
                Spacer(Modifier.width(4.dp))
                OutlinedTextField(value = name, onValueChange = { name = it.take(30) }, label = { Text("New folder name") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth())
                Text("Long-press a chat → Add to folder.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp))
            }
        },
        confirmButton = {
            TextButton(onClick = { if (name.isNotBlank()) { val n = name.trim(); name = ""; act { Api.createFolder(n) } } }) { Text("Add") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Close") } }
    )
}
