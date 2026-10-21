package com.jmsocean.chat.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Conversation
import com.jmsocean.chat.data.Message
import com.jmsocean.chat.data.MessageInfo
import com.jmsocean.chat.data.Reaction
import com.jmsocean.chat.data.Session
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

val QuickReactions = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

/** The emoji row at the top of the long-press menu. */
@Composable
fun ReactionBar(current: String?, onPick: (String) -> Unit) {
    Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        QuickReactions.forEach { e ->
            Box(
                Modifier.size(40.dp).clip(CircleShape)
                    .background(if (e == current) Color(0x3300A884) else Color.Transparent)
                    .clickable { onPick(if (e == current) "" else e) },
                contentAlignment = Alignment.Center
            ) { Text(e, fontSize = 22.sp) }
        }
    }
}

/** Little emoji chips under a bubble: "❤️ 2  👍". Tap to see who reacted. */
@Composable
fun ReactionChips(reactions: List<Reaction>, alignEnd: Boolean) {
    var who by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().padding(top = 0.dp),
        horizontalArrangement = if (alignEnd) Arrangement.End else Arrangement.Start
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp,
            modifier = Modifier.padding(horizontal = 6.dp).clickable { who = true }
        ) {
            Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                reactions.take(3).forEach { Text(it.emoji, fontSize = 14.sp) }
                val total = reactions.sumOf { it.users.size }
                if (total > 1) Text(" $total", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    if (who) AlertDialog(
        onDismissRequest = { who = false },
        title = { Text("Reactions") },
        text = {
            Column {
                reactions.forEach { r ->
                    r.users.forEach { u ->
                        Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(r.emoji, fontSize = 20.sp)
                            Spacer(Modifier.width(12.dp))
                            Text(if (Session.isMe(u)) "You" else u)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { who = false }) { Text("Close") } }
    )
}

private fun jstr(m: Message, key: String): String =
    (m.link?.get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()

/** A shared JMS page / problem, with its work status and Start work / Mark done. */
@Composable
fun LinkCard(m: Message, onStatus: (String) -> Unit) {
    val title = jstr(m, "title").ifBlank { "Shared page" }
    val excerpt = jstr(m, "excerpt")
    val factory = jstr(m, "factory_name")
    val urgent = jstr(m, "priority") == "urgent"
    val status = m.task?.status ?: "open"
    Column(
        Modifier.padding(vertical = 3.dp).clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.05f)).padding(8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (urgent) "⚠️" else "🔗", fontSize = 18.sp)
            Spacer(Modifier.width(6.dp))
            Text(title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (factory.isNotBlank()) Text(factory, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (excerpt.isNotBlank()) Text("“$excerpt”", fontSize = 13.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(6.dp))
        val (label, color) = when (status) {
            "done" -> "✅ Done" to Color(0xFF12A66A)
            "in_progress" -> "🔧 In progress" to Color(0xFFE0952B)
            else -> "⏳ Open" to MaterialTheme.colorScheme.onSurfaceVariant
        }
        Text(label + (m.task?.by?.let { " · $it" } ?: ""), color = color, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        if (status != "done") Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            if (status != "in_progress") OutlinedButton(onClick = { onStatus("in_progress") }) { Text("Start work", fontSize = 13.sp) }
            Button(onClick = { onStatus("done") }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00A884))) {
                Text("Mark done", fontSize = 13.sp)
            }
        }
        Text("Open it on the JMS website to see the page.", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp))
    }
}

/** Pick up to 5 chats to forward a message to. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForwardSheet(message: Message, onDone: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var chats by remember { mutableStateOf<List<Conversation>>(emptyList()) }
    val picked = remember { mutableStateListOf<String>() }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { Api.conversations() }.onSuccess { chats = it } }
    ModalBottomSheet(onDismissRequest = onDone) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Forward to…", fontWeight = FontWeight.SemiBold, fontSize = 18.sp, modifier = Modifier.weight(1f))
            Button(
                enabled = picked.isNotEmpty() && !busy,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00A884)),
                onClick = {
                    busy = true
                    scope.launch {
                        runCatching { Api.forward(message.sync_id, picked.toList()) }
                            .onSuccess { Toast.makeText(ctx, "Forwarded", Toast.LENGTH_SHORT).show(); onDone() }
                            .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                        busy = false
                    }
                }
            ) { Text(if (picked.isEmpty()) "Send" else "Send (${picked.size})") }
        }
        Text("Up to 5 chats", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 480.dp)) {
            items(chats, key = { it.sync_id }) { c ->
                val sel = c.sync_id in picked
                Row(
                    Modifier.fillMaxWidth().clickable {
                        if (sel) picked.remove(c.sync_id) else if (picked.size < 5) picked.add(c.sync_id)
                    }.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Avatar(c.name, 40.dp, group = c.isGroup, photoUrl = c.peer?.let { Api.avatarUrl(it, c.photo_v) })
                    Spacer(Modifier.width(12.dp))
                    Text(c.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Checkbox(checked = sel, onCheckedChange = null)
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

/** Who got and read my message, with times (groups especially). */
@Composable
fun MessageInfoDialog(messageId: String, onClose: () -> Unit) {
    var info by remember { mutableStateOf<MessageInfo?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(messageId) { runCatching { Api.messageInfo(messageId) }.onSuccess { info = it }.onFailure { err = it.message } }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Message info") },
        text = {
            val i = info
            when {
                err != null -> Text(err!!)
                i == null -> Text("Loading…")
                else -> LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    item { InfoHeader("Read by", Tick) }
                    if (i.read.isEmpty()) item { Text("—", Modifier.padding(4.dp)) }
                    items(i.read) { r -> InfoLine(r.username, dayLabel(r.at) + " " + timeOf(r.at)) }
                    item { HorizontalDivider(Modifier.padding(vertical = 6.dp)) }
                    item { InfoHeader("Delivered to", MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (i.delivered.isEmpty()) item { Text("—", Modifier.padding(4.dp)) }
                    items(i.delivered) { r -> InfoLine(r.username, dayLabel(r.at) + " " + timeOf(r.at)) }
                    if (i.pending.isNotEmpty()) {
                        item { HorizontalDivider(Modifier.padding(vertical = 6.dp)) }
                        item { InfoHeader("Not delivered yet", MaterialTheme.colorScheme.onSurfaceVariant) }
                        items(i.pending) { r -> InfoLine(r.username, "") }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Close") } }
    )
}

@Composable
private fun InfoHeader(text: String, color: Color) {
    Text(text, color = color, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 4.dp))
}

@Composable
private fun InfoLine(name: String, time: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(name, 30.dp)
        Spacer(Modifier.width(10.dp))
        Text(name, modifier = Modifier.weight(1f))
        Text(time, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
