package com.jmsocean.chat.ui

import android.Manifest
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Environment
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Media
import com.jmsocean.chat.data.Message
import com.jmsocean.chat.data.Session
import com.jmsocean.chat.push.Notifier
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.util.Locale

private val nameColors = listOf(
    Color(0xFF1FA855), Color(0xFF6B5BD2), Color(0xFFE5486B), Color(0xFF02A6C6),
    Color(0xFFD9822B), Color(0xFF8B5E3C), Color(0xFF3B82F6), Color(0xFFB4479A)
)

private fun nameColor(n: String) = nameColors[(n.lowercase().hashCode() and 0x7fffffff) % nameColors.size]

private val Accent = Color(0xFF00A884)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(convId: String, onBack: () -> Unit, onInfo: () -> Unit, vm: ConversationViewModel = viewModel(key = convId)) {
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
    val editing by vm.editing.collectAsState()
    val peer by vm.peer.collectAsState()
    val peerPhoto by vm.peerPhoto.collectAsState()
    val lastSeen by vm.lastSeen.collectAsState()
    val mutedUntil by vm.mutedUntil.collectAsState()
    var text by remember { mutableStateOf("") }
    var viewing by remember { mutableStateOf<String?>(null) }
    var topMenu by remember { mutableStateOf(false) }
    var forwarding by remember { mutableStateOf<Message?>(null) }
    var attachSheet by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf<String?>(null) }
    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { uris ->
        if (uris.isNotEmpty()) vm.sendMany(uris)
    }
    val uiScope = androidx.compose.runtime.rememberCoroutineScope()
    var infoFor by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val found by vm.searchResults.collectAsState()
    var cameraFile by remember { mutableStateOf<File?>(null) }
    var recording by remember { mutableStateOf(false) }
    val recorder = remember { Media.Recorder(ctx) }

    LaunchedEffect(error) {
        error?.let { Toast.makeText(ctx, it, Toast.LENGTH_SHORT).show(); vm.clearError() }
    }
    LaunchedEffect(editing) { editing?.let { text = it.body } }
    DisposableEffect(Unit) { onDispose { recorder.cancel(); Media.Player.stop() } }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) { vm.sendFile(uri, text); text = "" }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = cameraFile
        if (ok && f != null) vm.sendCameraPhoto(f)
    }
    val askMic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        Toast.makeText(ctx, if (granted) "Now hold the mic to record." else "Allow the microphone to send voice messages.", Toast.LENGTH_LONG).show()
    }

    val subtitle = when {
        typing != null -> if (isGroup) "$typing is typing…" else "typing…"
        isGroup -> members.joinToString(", ") { if (Session.isMe(it)) "You" else it }
        else -> lastSeenText(online, lastSeen)
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
            if (searching) TopAppBar(
                navigationIcon = {
                    IconButton(onClick = { searching = false; query = ""; vm.search("") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                },
                title = {
                    TextField(
                        value = query, onValueChange = { query = it; vm.search(it) }, placeholder = { Text("Search this chat…") },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                        colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent)
                    )
                }
            ) else TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = {
                    Row(Modifier.clickable(onClick = onInfo), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(title, 38.dp, group = isGroup, photoUrl = peer?.let { Api.avatarUrl(it, peerPhoto) })
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (subtitle.isNotEmpty()) Text(subtitle, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                color = Color.White.copy(alpha = 0.85f))
                        }
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { topMenu = true }) { Icon(Icons.Default.MoreVert, "Menu") }
                        DropdownMenu(expanded = topMenu, onDismissRequest = { topMenu = false }) {
                            DropdownMenuItem(text = { Text(if (isGroup) "Group info" else "Contact info") }, onClick = { topMenu = false; onInfo() })
                            DropdownMenuItem(text = { Text("Search") }, onClick = { topMenu = false; searching = true })
                            if (mutedUntil != null) DropdownMenuItem(text = { Text("Unmute notifications") }, onClick = { topMenu = false; vm.mute("off") })
                            else {
                                DropdownMenuItem(text = { Text("Mute for 8 hours") }, onClick = { topMenu = false; vm.mute("8h") })
                                DropdownMenuItem(text = { Text("Mute for 1 week") }, onClick = { topMenu = false; vm.mute("1w") })
                                DropdownMenuItem(text = { Text("Mute always") }, onClick = { topMenu = false; vm.mute("always") })
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Teal, titleContentColor = Color.White,
                    navigationIconContentColor = Color.White, actionIconContentColor = Color.White
                )
            )
        },
        containerColor = if (dark()) ChatBgDark else ChatBg
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (loading) CircularProgressIndicator(Modifier.align(Alignment.Center), color = Green)
                found?.let { results ->
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                        LazyColumn(Modifier.fillMaxSize()) {
                            if (results.isEmpty()) item { Text("No messages found.", Modifier.padding(16.dp)) }
                            itemsIndexed(results, key = { _, m -> "s" + m.sync_id }) { _, m ->
                                Column(Modifier.fillMaxWidth().clickable {
                                    val idx = reversed.indexOfFirst { it.sync_id == m.sync_id }
                                    searching = false; query = ""; vm.search("")
                                    if (idx >= 0) uiScope.launch { listState.scrollToItem(idx) }
                                }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                                    Text("${if (Session.isMe(m.sender)) "You" else m.sender} · ${dayLabel(m.server_ts)} ${timeOf(m.server_ts)}",
                                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(m.body, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
                LazyColumn(
                    state = listState, reverseLayout = true, modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
                ) {
                    itemsIndexed(reversed, key = { _, m -> m.sync_id }) { i, m ->
                        val prev = reversed.getOrNull(i + 1) // older neighbour
                        Column {
                            if (prev == null || dayKey(prev.server_ts) != dayKey(m.server_ts)) DayChip(dayLabel(m.server_ts))
                            if (m.kind == "system") SystemLine(m.body)
                            else Bubble(
                                m, isGroup = isGroup, members = members.size,
                                firstOfRun = prev == null || prev.sender != m.sender || prev.kind == "system" || dayKey(prev.server_ts) != dayKey(m.server_ts),
                                canEdit = vm.canEdit(m),
                                myReaction = vm.myReaction(m),
                                onReact = { e -> vm.react(m, e) },
                                onForward = { forwarding = m },
                                onStar = { vm.star(m) },
                                onInfo = { infoFor = m.sync_id },
                                onTask = { st -> vm.setTask(m, st) },
                                onEdit = { vm.startEdit(m) },
                                onDelete = { vm.delete(m) },
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
                editing = editing,
                onCancelReply = { vm.setReply(null) },
                onCancelEdit = { vm.startEdit(null); text = "" },
                onAttach = { attachSheet = true },
                onCamera = {
                    val (f, uri) = Media.newCameraTarget(ctx)
                    cameraFile = f
                    camera.launch(uri)
                },
                recording = recording,
                onMicDown = {
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        askMic.launch(Manifest.permission.RECORD_AUDIO)
                        false
                    } else recorder.start().also { recording = it }
                },
                onMicUp = { send ->
                    recording = false
                    if (send) {
                        val f = recorder.stop()
                        if (f != null) vm.sendVoice(f, recorder.mime)
                        else Toast.makeText(ctx, "Hold the mic to record", Toast.LENGTH_SHORT).show()
                    } else recorder.cancel()
                },
                onSend = { vm.sendText(text); text = "" }
            )
        }
    }

    viewing?.let { id ->
        if (id.startsWith("video:")) { playing = id.removePrefix("video:"); viewing = null }
        else ImageViewer(id) { viewing = null }
    }
    forwarding?.let { m -> ForwardSheet(m) { forwarding = null } }
    playing?.let { id -> VideoPlayerDialog(id) { playing = null } }
    if (attachSheet) AttachSheet(
        onDismiss = { attachSheet = false },
        onMedia = {
            attachSheet = false
            pickMedia.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
        },
        onCamera = {
            attachSheet = false
            val (f, uri) = Media.newCameraTarget(ctx)
            cameraFile = f
            camera.launch(uri)
        },
        onDocument = { attachSheet = false; pick.launch("*/*") }
    )
    infoFor?.let { id -> MessageInfoDialog(id) { infoFor = null } }
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
    canEdit: Boolean, onEdit: () -> Unit, onDelete: () -> Unit,
    myReaction: String?, onReact: (String) -> Unit, onForward: () -> Unit, onStar: () -> Unit,
    onInfo: () -> Unit, onTask: (String) -> Unit,
    onReply: () -> Unit, onRetry: () -> Unit, onImage: (String) -> Unit
) {
    val ctx = LocalContext.current
    val mine = Session.isMe(m.sender)
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
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
    Column(Modifier.fillMaxWidth()) {
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
                    if (m.forwarded && !m.deleted) Text("↪ Forwarded", fontSize = 12.sp, fontStyle = FontStyle.Italic,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (m.kind == "link" && !m.deleted && !m.purged) LinkCard(m, onTask)
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
                        att != null && att.kind == "audio" -> VoiceNote(att.sync_id)
                        att != null && att.kind == "video" -> VideoTile(att) { onImage("video:" + att.sync_id) }
                        att != null -> Row(
                            Modifier.padding(vertical = 2.dp).clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.05f))
                                .clickable { download(ctx, att.sync_id, att.file_name, att.mime) }.padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(when (att.kind) { "pdf" -> "📄"; "xlsx" -> "📊"; else -> "📎" }, fontSize = 26.sp)
                            Spacer(Modifier.width(8.dp))
                            Column(Modifier.widthIn(max = 200.dp)) {
                                Text(att.file_name, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                                Text("${att.kind.uppercase()} · ${fileSize(att.size)}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, Modifier.padding(start = 6.dp).size(20.dp))
                        }
                    }
                    val hideBody = (att?.kind == "audio" && m.body.startsWith("🎤")) || (att?.kind == "video" && m.body.startsWith("🎥"))
                    if (!(m.deleted || m.purged) && m.body.isNotBlank() && !hideBody) {
                        Text(m.body, fontSize = 15.sp)
                    }
                    Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                        if (m.starred) Text("★ ", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                if (!m.deleted && !m.pending && !m.failed) ReactionBar(myReaction) { e -> menu = false; onReact(e) }
                if (!m.deleted && !m.pending && !m.failed) {
                    DropdownMenuItem(text = { Text("Forward") }, onClick = { menu = false; onForward() })
                    DropdownMenuItem(text = { Text(if (m.starred) "Unstar" else "Star") }, onClick = { menu = false; onStar() })
                    if (mine) DropdownMenuItem(text = { Text("Info") }, onClick = { menu = false; onInfo() })
                }
                DropdownMenuItem(text = { Text("Reply") }, leadingIcon = { Icon(Icons.AutoMirrored.Filled.Reply, null) }, onClick = { menu = false; onReply() })
                if (m.body.isNotBlank() && !m.deleted) DropdownMenuItem(text = { Text("Copy") }, onClick = {
                    menu = false
                    (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("message", m.body))
                    Toast.makeText(ctx, "Copied", Toast.LENGTH_SHORT).show()
                })
                if (canEdit) DropdownMenuItem(text = { Text("Edit") }, onClick = { menu = false; onEdit() })
                if (mine && !m.deleted && !m.pending && !m.failed) DropdownMenuItem(
                    text = { Text("Delete for everyone", color = MaterialTheme.colorScheme.error) },
                    onClick = { menu = false; confirmDelete = true }
                )
                if (m.failed) DropdownMenuItem(text = { Text("Send again") }, onClick = { menu = false; onRetry() })
            }
            if (confirmDelete) AlertDialog(
                onDismissRequest = { confirmDelete = false },
                title = { Text("Delete message?") },
                text = { Text("It will be deleted for everyone in this chat.") },
                confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete() }) { Text("Delete for everyone") } },
                dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } }
            )
        }
    }
    val rx = m.reactions
    if (!rx.isNullOrEmpty() && !m.deleted) ReactionChips(rx, alignEnd = mine)
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
    text: String, onText: (String) -> Unit, replyTo: Message?, editing: Message?,
    onCancelReply: () -> Unit, onCancelEdit: () -> Unit,
    onAttach: () -> Unit, onCamera: () -> Unit,
    recording: Boolean, onMicDown: () -> Boolean, onMicUp: (send: Boolean) -> Unit,
    onSend: () -> Unit
) {
    var recSeconds by remember { mutableStateOf(0) }
    LaunchedEffect(recording) {
        recSeconds = 0
        while (recording) { delay(1000); recSeconds++ }
    }
    Row(Modifier.fillMaxWidth().padding(6.dp).navigationBarsPadding(), verticalAlignment = Alignment.Bottom) {
        Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp, modifier = Modifier.weight(1f)) {
            Column {
                val bar: Pair<String, String>? = when {
                    editing != null -> "Editing" to editing.body
                    replyTo != null -> (if (Session.isMe(replyTo.sender)) "You" else replyTo.sender) to
                        replyTo.body.ifBlank { replyTo.attachment?.file_name ?: "" }
                    else -> null
                }
                if (bar != null) {
                    val barColor = if (editing != null) Accent else nameColor(bar.first)
                    Row(
                        Modifier.fillMaxWidth().padding(start = 8.dp, end = 4.dp, top = 8.dp).clip(RoundedCornerShape(8.dp))
                            .background(Color.Black.copy(alpha = 0.06f)),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(Modifier.width(4.dp).height(44.dp).background(barColor))
                        Column(Modifier.weight(1f).padding(6.dp)) {
                            Text(bar.first, color = barColor, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Text(bar.second, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                        }
                        IconButton(onClick = if (editing != null) onCancelEdit else onCancelReply) {
                            Icon(Icons.Default.Close, "Cancel", Modifier.size(18.dp))
                        }
                    }
                }
                if (recording) {
                    Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(CircleShape).background(Color(0xFFE53935)))
                        Spacer(Modifier.width(10.dp))
                        Text(String.format(Locale.ENGLISH, "%d:%02d", recSeconds / 60, recSeconds % 60), fontSize = 16.sp)
                        Spacer(Modifier.width(14.dp))
                        Text("Release to send · slide away to cancel", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else Row(verticalAlignment = Alignment.Bottom) {
                    TextField(
                        value = text, onValueChange = onText, placeholder = { Text("Message") },
                        maxLines = 6, modifier = Modifier.weight(1f),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent
                        )
                    )
                    if (editing == null) {
                        IconButton(onClick = onAttach) { Icon(Icons.Default.AttachFile, "Send a photo or file") }
                        if (text.isBlank()) IconButton(onClick = onCamera) { Icon(Icons.Default.CameraAlt, "Camera") }
                    }
                }
            }
        }
        Spacer(Modifier.width(6.dp))
        val micMode = text.isBlank() && editing == null
        val holdToRecord = Modifier.pointerInput(Unit) {
            // Hold to record, release to send; drag away (more than 120 px) to cancel.
            awaitEachGesture {
                val down = awaitFirstDown()
                if (!onMicDown()) return@awaitEachGesture
                var cancelled = false
                while (true) {
                    val ev = awaitPointerEvent()
                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                    if ((ch.position - down.position).getDistance() > 120f) cancelled = true
                    if (!ch.pressed) break
                }
                onMicUp(!cancelled)
            }
        }
        Box(
            Modifier.size(if (recording) 64.dp else 50.dp).clip(CircleShape).background(Accent)
                .then(if (micMode) holdToRecord else Modifier.clickable(enabled = text.isNotBlank(), onClick = onSend)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                when {
                    micMode -> Icons.Default.Mic
                    editing != null -> Icons.Default.Check
                    else -> Icons.AutoMirrored.Filled.Send
                },
                if (micMode) "Hold to record a voice message" else "Send", tint = Color.White
            )
        }
    }
}

/** 📎: photos & videos (up to 10 at once), camera, or a document. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AttachSheet(onDismiss: () -> Unit, onMedia: () -> Unit, onCamera: () -> Unit, onDocument: () -> Unit) {
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            AttachOption("🖼️", "Gallery", Color(0xFFBF59CF), onMedia)
            AttachOption("📷", "Camera", Color(0xFFE5486B), onCamera)
            AttachOption("📄", "Document", Color(0xFF5157AE), onDocument)
        }
        Text("Gallery: up to 10 photos and videos at once. Videos are made smaller (about 1 minute max).",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 24.dp))
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun AttachOption(icon: String, label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable(onClick = onClick).padding(8.dp)) {
        Box(Modifier.size(56.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) { Text(icon, fontSize = 24.sp) }
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 13.sp)
    }
}

/** A voice note: play / pause with a progress bar (streams from the server). */
@Composable
private fun VoiceNote(attachmentId: String) {
    val ctx = LocalContext.current
    var playing by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf(0f) }
    var label by remember { mutableStateOf("Voice message") }
    LaunchedEffect(playing) {
        while (playing) {
            val (pos, dur) = Media.Player.position()
            if (dur > 0) {
                progress = pos.toFloat() / dur
                label = String.format(Locale.ENGLISH, "%d:%02d / %d:%02d", pos / 60000, pos / 1000 % 60, dur / 60000, dur / 1000 % 60)
            }
            delay(250)
        }
        progress = 0f
    }
    Row(Modifier.widthIn(min = 220.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(42.dp).clip(CircleShape).background(Accent).clickable {
                if (playing) Media.Player.stop()
                else {
                    playing = true
                    Media.Player.play(ctx, attachmentId, Api.fileUrl(attachmentId)) { playing = false }
                }
            },
            contentAlignment = Alignment.Center
        ) { Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow, if (playing) "Pause" else "Play", tint = Color.White) }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            LinearProgressIndicator(
                progress = { progress }, modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)),
                color = Accent
            )
            Spacer(Modifier.height(4.dp))
            Text("🎤 $label", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
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
