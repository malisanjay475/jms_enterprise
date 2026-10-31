package com.jmsocean.chat.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Message
import com.jmsocean.chat.data.Poll
import com.jmsocean.chat.data.Session
import com.jmsocean.chat.data.Todo
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

private val Accent = Color(0xFF00A884)

/** Date then time pickers; returns the chosen moment as an ISO instant. */
fun pickDateTime(ctx: Context, onPicked: (String) -> Unit) {
    val now = LocalDateTime.now().plusHours(1)
    DatePickerDialog(ctx, { _, y, m, d ->
        TimePickerDialog(ctx, { _, h, min ->
            val t = LocalDateTime.of(y, m + 1, d, h, min).atZone(ZoneId.systemDefault()).toInstant()
            onPicked(t.toString())
        }, now.hour, now.minute, false).show()
    }, now.year, now.monthValue - 1, now.dayOfMonth).show()
}

/** 📊 A poll inside a bubble: tap an option to vote (tap again to take it back). */
@Composable
fun PollCard(p: Poll, onVote: (List<Int>) -> Unit) {
    Column(Modifier.widthIn(min = 230.dp).padding(vertical = 2.dp)) {
        Text("📊 ${p.question}", fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        val max = maxOf(1, p.total)
        p.options.forEachIndexed { i, o ->
            val mine = i in p.mine
            Box(
                Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(8.dp))
                    .border(if (mine) 1.5.dp else 1.dp, if (mine) Accent else Color.Black.copy(alpha = 0.12f), RoundedCornerShape(8.dp))
                    .clickable {
                        val picks = if (p.multi) (if (mine) p.mine - i else p.mine + i) else (if (mine) emptyList() else listOf(i))
                        onVote(picks)
                    }
            ) {
                Box(Modifier.matchParentSizeCompat(o.votes.toFloat() / max).background(Accent.copy(alpha = 0.16f)))
                Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp)) {
                    Text((if (mine) "✓ " else "") + o.text, modifier = Modifier.weight(1f), fontWeight = if (mine) FontWeight.SemiBold else FontWeight.Normal)
                    Text("${o.votes}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Text("${p.total} voted" + if (p.multi) " · more than one answer" else "", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun Modifier.matchParentSizeCompat(fraction: Float) = this.then(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(38.dp))

@Composable
fun PollDialog(onSend: (question: String, options: List<String>, multi: Boolean) -> Unit, onClose: () -> Unit) {
    var q by remember { mutableStateOf("") }
    val opts = remember { mutableStateListOf("", "") }
    var multi by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("📊 New poll") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = q, onValueChange = { q = it.take(300) }, label = { Text("Question") }, modifier = Modifier.fillMaxWidth())
                opts.forEachIndexed { i, o ->
                    OutlinedTextField(value = o, onValueChange = { opts[i] = it.take(100) }, label = { Text("Option ${i + 1}") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                }
                if (opts.size < 10) TextButton(onClick = { opts.add("") }) { Text("+ Add option") }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = multi, onCheckedChange = { multi = it })
                    Text("Allow more than one answer")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val o = opts.map { it.trim() }.filter { it.isNotEmpty() }
                if (q.isNotBlank() && o.size >= 2) onSend(q.trim(), o, multi)
            }) { Text("Send poll") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}

@Composable
fun TaskDialog(m: Message, members: List<String>, onCreate: (title: String, assignee: String, dueAt: String?) -> Unit, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var title by remember { mutableStateOf(m.body.ifBlank { m.attachment?.file_name ?: "" }.take(300)) }
    var assignee by remember { mutableStateOf(if (Session.isMe(m.sender)) Session.username ?: "" else m.sender) }
    var due by remember { mutableStateOf<String?>(null) }
    var pick by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("📋 Make task") },
        text = {
            Column {
                OutlinedTextField(value = title, onValueChange = { title = it.take(300) }, label = { Text("Task") }, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Box {
                    OutlinedButton(onClick = { pick = true }, modifier = Modifier.fillMaxWidth()) {
                        Text("Assign to: " + if (Session.isMe(assignee)) "me" else assignee)
                    }
                    DropdownMenu(expanded = pick, onDismissRequest = { pick = false }) {
                        members.forEach { u ->
                            DropdownMenuItem(text = { Text(if (Session.isMe(u)) "$u (me)" else u) }, onClick = { assignee = u; pick = false })
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                OutlinedButton(onClick = { pickDateTime(ctx) { due = it } }, modifier = Modifier.fillMaxWidth()) {
                    Text(due?.let { "Due " + dayLabel(it) + " " + timeOf(it) } ?: "Add due time (optional)")
                }
            }
        },
        confirmButton = { TextButton(onClick = { if (title.isNotBlank()) onCreate(title.trim(), assignee, due) }) { Text("Create") } },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}

/** My tasks (assigned to me or by me), with done ticks. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(onBack: () -> Unit, onOpen: (String) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var todos by remember { mutableStateOf<List<Todo>?>(null) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(reload) { todos = runCatching { Api.todos() }.getOrDefault(emptyList()) }
    Scaffold(topBar = {
        TopAppBar(
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            title = { Text("My tasks", fontWeight = FontWeight.SemiBold) },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = headerColor(), titleContentColor = Color.White, navigationIconContentColor = Color.White)
        )
    }) { pad ->
        val list = todos
        if (list == null) LinearProgressIndicator(Modifier.padding(pad).fillMaxWidth(), color = Green)
        else LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            if (list.isEmpty()) item {
                Text("No tasks. Long-press a message → Make task.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(list, key = { it.id }) { t ->
                val done = t.done_at != null
                val overdue = !done && t.due_at != null && (parseTs(t.due_at)?.toInstant()?.isBefore(Instant.now()) == true)
                Row(Modifier.fillMaxWidth().clickable { onOpen(t.conversation_sync_id) }.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = done, onCheckedChange = { on ->
                        scope.launch {
                            runCatching { Api.todoDone(t.id, on) }.onSuccess { reload++ }
                                .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                        }
                    })
                    Column(Modifier.weight(1f)) {
                        Text(t.title, textDecoration = if (done) TextDecoration.LineThrough else null,
                            color = if (done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                        val who = if (Session.isMe(t.assignee)) "For me" else "For ${t.assignee}"
                        val due = t.due_at?.let { " · due ${dayLabel(it)} ${timeOf(it)}" } ?: ""
                        Text(who + due + (if (overdue) " · ⚠ overdue" else "") + " · ${t.conv_title ?: "chat"}", fontSize = 12.sp,
                            color = if (overdue) Color(0xFFE53935) else MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                HorizontalDivider(Modifier.padding(start = 60.dp), thickness = 0.5.dp)
            }
        }
    }
}

/** 📌 bar under the chat header: tap to cycle through pinned messages. */
@Composable
fun PinnedBar(pins: List<Message>, onShow: (Message) -> Unit) {
    if (pins.isEmpty()) return
    var i by remember(pins) { mutableStateOf(0) }
    val p = pins[i.coerceIn(0, pins.size - 1)]
    Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth().clickable {
        onShow(p); i = (i + 1) % pins.size
    }) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(3.dp).height(28.dp).background(Accent))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("📌 Pinned" + if (pins.size > 1) " ${i + 1}/${pins.size}" else "", fontSize = 12.sp, color = Accent, fontWeight = FontWeight.SemiBold)
                Text(p.body.ifBlank { p.attachment?.file_name ?: "" }, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Profile: 🌙 quiet hours (no notifications, except URGENT and @mentions). */
@Composable
fun QuietHoursSection() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { runCatching { Api.chatSettings() }.onSuccess { from = it.quiet_from; to = it.quiet_to } }
    fun save(f: String, t: String) {
        scope.launch {
            runCatching { Api.saveQuiet(f, t) }.onSuccess { from = it.quiet_from; to = it.quiet_to }
                .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
        }
    }
    fun pickTime(initial: String, done: (String) -> Unit) {
        val (h, m) = initial.split(":").let { (it.getOrNull(0)?.toIntOrNull() ?: 22) to (it.getOrNull(1)?.toIntOrNull() ?: 0) }
        TimePickerDialog(ctx, { _, hh, mm -> done("%02d:%02d".format(hh, mm)) }, h, m, true).show()
    }
    Column(Modifier.padding(horizontal = 16.dp)) {
        Text("Quiet hours", color = Accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(8.dp))
        Text("No notifications in this time, except ⚠ URGENT messages and @mentions.", fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 8.dp))
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { pickTime(from.ifBlank { "22:00" }) { f -> pickTime(to.ifBlank { "07:00" }) { t -> save(f, t) } } }) {
                Text(if (from.isNotBlank()) "🌙 $from – $to" else "🌙 Set quiet hours")
            }
            if (from.isNotBlank()) TextButton(onClick = { save("", "") }) { Text("Turn off") }
        }
    }
}
