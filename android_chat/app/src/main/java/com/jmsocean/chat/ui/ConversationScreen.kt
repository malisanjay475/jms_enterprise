package com.jmsocean.chat.ui

import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Message
import com.jmsocean.chat.data.Session
import com.jmsocean.chat.push.Notifier

private val nameColors = listOf(
    Color(0xFF1FA855), Color(0xFF6B5BD2), Color(0xFFE5486B), Color(0xFF02A6C6),
    Color(0xFFD9822B), Color(0xFF8B5E3C), Color(0xFF3B82F6), Color(0xFFB4479A)
)

private fun nameColor(n: String) = nameColors[(n.lowercase().hashCode() and 0x7fffffff) % nameColors.size]

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(convId: String, onBack: () -> Unit, vm: ConversationViewModel = viewModel(key = convId)) {
    val ctx = LocalContext.current
    LaunchedEffect(convId) { vm.start(convId) }
    DisposableEffect(convId) {
        Notifier.openChat = convId
        Notifier.clear(ctx, convId)
        onDispose { if (Notifier.openChat == convId) Notifier.openChat = null }
    }

    val messages by vm.messages.collectAsState()
    val title by vm.title.collectAsState()
    val isGroup by vm.isGroup.collectAsState()
    val members by vm.members.collectAsState()
    val online by vm.online.collectAsState()
    val typing by vm.typing.collectAsState()
    val loading by vm.loading.collectAsState()
    val older by vm.loadingOlder.collectAsState()
    val error by vm.error.collectAsState()
    val replyTo by vm.replyTo.collectAsState()
    var text by remember { mutableStateOf("") }
    var viewing by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(error) {
        error?.let { Toast.makeText(ctx, it, Toast.LENGTH_SHORT).show(); vm.clearError() }
    }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) { vm.sendFile(uri, text); text = "" }
    }

    val subtitle = when {
        typing != null -> if (isGroup) "$typing is typing…" else "typing…"
        isGroup -> members.joinToString(", ") { if (Session.isMe(it)) "You" else it }
        online -> "online"
        else -> ""
    }

    // newest at the bottom: the list is reversed
    val reversed = remember(messages) { messages.asReversed() }
    val listState = rememberLazyListState()
    val atTop by remember { derivedStateOf { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= reversed.size - 3 } ?: false } }
    LaunchedEffect(atTop, reversed.size) { if (atTop && reversed.isNotEmpty()) vm.loadOlder() }
    LaunchedEffect(messages.lastOrNull()?.sync_id) {
        if (listState.firstVisibleItemIndex <= 2) listState.animateScrollToItem(0)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(title, 38.dp, group = isGroup)
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (subtitle.isNotEmpty()) Text(subtitle, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                color = Color.White.copy(alpha = 0.85f))
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Teal, titleContentColor = Color.White, navigationIconContentColor = Color.White
                )
            )
        },
        containerColor = if (dark()) ChatBgDark else ChatBg
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (loading) CircularProgressIndicator(Modifier.align(Alignment.Center), color = Green)
                LazyColumn(
                    state = listState, reverseLayout = true, modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                ) {
                    itemsIndexed(reversed, key = { _, m -> m.sync_id }) { i, m ->
                        val prev = reversed.getOrNull(i + 1) // older neighbour
                        Column {
                            if (prev == null || dayKey(prev.server_ts) != dayKey(m.server_ts)) DayChip(dayLabel(m.server_ts))
                            if (m.kind == "system") SystemLine(m.body)
                            else Bubble(
                                m, isGroup = isGroup, members = members.size,
                                firstOfRun = prev == null || prev.sender != m.sender || prev.kind == "system" || dayKey(prev.server_ts) != dayKey(m.server_ts),
                                onReply = { vm.setReply(m) },
                                onRetry = { vm.retry(m) },
                                onImage = { viewing = it }
                            )
                        }
                    }
                    if (older) item { Box(Modifier.fillMaxWidth().padding(8.dp), Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) } }
                }
            }
            Composer(
                text = text,
                onText = { text = it; if (it.isNotBlank()) vm.onTyping() },
                replyTo = replyTo,
                onCancelReply = { vm.setReply(null) },
                onAttach = { pick.launch("*/*") },
                onSend = { vm.sendText(text); text = "" }
            )
        }
    }

    viewing?.let { id -> ImageViewer(id) { viewing = null } }
}

@Composable
private fun DayChip(label: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(8.dp), color = if (dark()) Color(0xFF182229) else Color(0xFFE1F3FB), shadowElevation = 1.dp) {
            Text(label, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
    }
}

@Composable
private fun SystemLine(text: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(8.dp), color = if (dark()) Color(0xFF182229) else Color(0xFFFFF5C4)) {
            Text(text, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Bubble(
    m: Message, isGroup: Boolean, members: Int, firstOfRun: Boolean,
    onReply: () -> Unit, onRetry: () -> Unit, onImage: (String) -> Unit
) {
    val ctx = LocalContext.current
    val mine = Session.isMe(m.sender)
    var menu by remember { mutableStateOf(false) }
    val bg = when {
        mine && dark() -> BubbleOutDark
        mine -> BubbleOut
        dark() -> BubbleInDark
        else -> BubbleIn
    }
    val shape = RoundedCornerShape(
        topStart = if (!mine && firstOfRun) 2.dp else 10.dp, topEnd = if (mine && firstOfRun) 2.dp else 10.dp,
        bottomStart = 10.dp, bottomEnd = 10.dp
    )
    Row(
        Modifier.fillMaxWidth().padding(top = if (firstOfRun) 6.dp else 2.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start
    ) {
        Box {
            Surface(
                shape = shape, color = bg, shadowElevation = 1.dp,
                modifier = Modifier.widthIn(max = 300.dp).clip(shape).combinedClickable(
                    onClick = { if (m.failed) onRetry() },
                    onLongClick = { menu = true },
                    onDoubleClick = onReply
                )
            ) {
                Column(Modifier.padding(horizontal = 8.dp, vertical = 5.dp)) {
                    if (isGroup && !mine && firstOfRun) Text(m.sender, color = nameColor(m.sender), fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    m.reply_to?.let { q ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(6.dp))
                                .background(Color.Black.copy(alpha = 0.06f))
                        ) {
                            Box(Modifier.width(4.dp).heightIn(min = 36.dp).background(nameColor(q.sender)))
                            Column(Modifier.padding(6.dp)) {
                                Text(if (Session.isMe(q.sender)) "You" else q.sender, color = nameColor(q.sender), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                Text(if (q.deleted) "Original message deleted" else q.text, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    val att = m.attachment
                    when {
                        m.deleted || m.purged -> Text(if (m.purged) "This message was removed" else "🚫 This message was deleted",
                            fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        att != null && att.kind == "image" -> AsyncImage(
                            model = authImage(ctx, att.sync_id), contentDescription = att.file_name, contentScale = ContentScale.Crop,
                            modifier = Modifier.padding(vertical = 2.dp).size(240.dp).clip(RoundedCornerShape(8.dp)).clickable { onImage(att.sync_id) }
                        )
                        att != null -> Row(
                            Modifier.padding(vertical = 2.dp).clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.05f))
                                .clickable { download(ctx, att.sync_id, att.file_name, att.mime) }.padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(when (att.kind) { "pdf" -> "📄"; "xlsx" -> "📊"; "audio" -> "🎤"; else -> "📎" }, fontSize = 26.sp)
                            Spacer(Modifier.width(8.dp))
                            Column(Modifier.widthIn(max = 200.dp)) {
                                Text(att.file_name, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                                Text("${att.kind.uppercase()} · ${fileSize(att.size)}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, Modifier.padding(start = 6.dp).size(20.dp))
                        }
                    }
                    if (!(m.deleted || m.purged) && m.body.isNotBlank()) {
                        Text(m.body, fontSize = 15.sp)
                    }
                    Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                        if (m.edited_at != null && !m.deleted) Text("edited ", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(timeOf(m.server_ts), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (mine && !m.deleted) {
                            Spacer(Modifier.width(3.dp))
                            Ticks(m, members)
                        }
                    }
                }
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Reply") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.Reply, null) }, onClick = { menu = false; onReply() })
                if (m.body.isNotBlank()) DropdownMenuItem(text = { Text("Copy") }, onClick = {
                    menu = false
                    (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("message", m.body))
                    Toast.makeText(ctx, "Copied", Toast.LENGTH_SHORT).show()
                })
                if (m.failed) DropdownMenuItem(text = { Text("Send again") }, onClick = { menu = false; onRetry() })
            }
        }
    }
}

@Composable
private fun Ticks(m: Message, members: Int) {
    val others = (members - 1).coerceAtLeast(1)
    val read = (m.read_by?.size ?: 0) >= others
    val delivered = (m.delivered_to?.size ?: 0) >= others
    val grey = MaterialTheme.colorScheme.onSurfaceVariant
    when {
        m.failed -> Icon(Icons.Default.ErrorOutline, "Not sent — tap to retry", Modifier.size(15.dp), tint = Color(0xFFD32F2F))
        m.pending -> Icon(Icons.Default.Schedule, "Sending", Modifier.size(14.dp), tint = grey)
        read -> Icon(Icons.Default.DoneAll, "Read", Modifier.size(16.dp), tint = Tick)
        delivered -> Icon(Icons.Default.DoneAll, "Delivered", Modifier.size(16.dp), tint = grey)
        else -> Icon(Icons.Default.Done, "Sent", Modifier.size(16.dp), tint = grey)
    }
}

@Composable
private fun Composer(
    text: String, onText: (String) -> Unit, replyTo: Message?, onCancelReply: () -> Unit,
    onAttach: () -> Unit, onSend: () -> Unit
) {
    Row(Modifier.fillMaxWidth().padding(6.dp).navigationBarsPadding(), verticalAlignment = Alignment.Bottom) {
        Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp, modifier = Modifier.weight(1f)) {
            Column {
                replyTo?.let { r ->
                    Row(
                        Modifier.fillMaxWidth().padding(start = 8.dp, end = 4.dp, top = 8.dp).clip(RoundedCornerShape(8.dp))
                            .background(Color.Black.copy(alpha = 0.06f)),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(Modifier.width(4.dp).height(44.dp).background(nameColor(r.sender)))
                        Column(Modifier.weight(1f).padding(6.dp)) {
                            Text(if (Session.isMe(r.sender)) "You" else r.sender, color = nameColor(r.sender), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Text(r.body.ifBlank { r.attachment?.file_name ?: "" }, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                        }
                        IconButton(onClick = onCancelReply) { Icon(Icons.Default.Close, "Cancel reply", Modifier.size(18.dp)) }
                    }
                }
                Row(verticalAlignment = Alignment.Bottom) {
                    TextField(
                        value = text, onValueChange = onText, placeholder = { Text("Message") },
                        maxLines = 6, modifier = Modifier.weight(1f),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent
                        )
                    )
                    IconButton(onClick = onAttach) { Icon(Icons.Default.AttachFile, "Send a photo or file") }
                }
            }
        }
        Spacer(Modifier.width(6.dp))
        Box(
            Modifier.size(50.dp).clip(CircleShape).background(Color(0xFF00A884)).clickable(enabled = text.isNotBlank(), onClick = onSend),
            contentAlignment = Alignment.Center
        ) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = Color.White) }
    }
}

@Composable
private fun ImageViewer(attachmentId: String, onClose: () -> Unit) {
    val ctx = LocalContext.current
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black).clickable(onClick = onClose)) {
            AsyncImage(
                model = authImage(ctx, attachmentId), contentDescription = null, contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
            )
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)) {
                Icon(Icons.Default.Close, "Close", tint = Color.White)
            }
        }
    }
}

private fun authImage(ctx: Context, attachmentId: String) =
    ImageRequest.Builder(ctx)
        .data(Api.fileUrl(attachmentId))
        .addHeader("Authorization", "Bearer ${Session.token}")
        .memoryCacheKey(attachmentId)
        .diskCacheKey(attachmentId)
        .crossfade(true)
        .build()

private fun download(ctx: Context, attachmentId: String, name: String, mime: String) {
    runCatching {
        val req = DownloadManager.Request(Uri.parse(Api.fileUrl(attachmentId)))
            .addRequestHeader("Authorization", "Bearer ${Session.token}")
            .setMimeType(mime)
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        (ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
        Toast.makeText(ctx, "Downloading $name", Toast.LENGTH_SHORT).show()
    }.onFailure { Toast.makeText(ctx, "Download failed: ${it.message}", Toast.LENGTH_LONG).show() }
}
