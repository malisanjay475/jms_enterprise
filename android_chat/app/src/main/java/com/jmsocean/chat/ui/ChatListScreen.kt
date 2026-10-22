package com.jmsocean.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.foundation.combinedClickable
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Conversation
import com.jmsocean.chat.data.Live
import com.jmsocean.chat.data.Session
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class ChatListViewModel(app: android.app.Application) : androidx.lifecycle.AndroidViewModel(app) {
    val chats = MutableStateFlow<List<Conversation>>(emptyList())
    val loading = MutableStateFlow(true)
    val error = MutableStateFlow<String?>(null)
    private var reloadJob: Job? = null

    init {
        load()
        viewModelScope.launch {
            Live.events.collect { ev ->
                when (ev.type) {
                    "message", "message_update", "conversation", "reconnect" -> reloadSoon()
                    "receipt" -> Unit
                }
            }
        }
    }

    fun load() {
        viewModelScope.launch {
            runCatching { Api.conversations() }
                .onSuccess {
                    chats.value = it; error.value = null
                    // Everything read (here or on the website): clear notifications and the icon badge.
                    if (it.none { c -> c.unread > 0 }) com.jmsocean.chat.push.Notifier.clearAll(getApplication())
                }
                .onFailure { error.value = it.message }
            loading.value = false
        }
    }

    fun pin(c: Conversation) = viewModelScope.launch {
        runCatching { Api.pin(c.sync_id, !c.pinned) }.onSuccess { load() }.onFailure { error.value = it.message }
    }

    fun archive(c: Conversation) = viewModelScope.launch {
        runCatching { Api.archive(c.sync_id, !c.archived) }.onSuccess { load() }.onFailure { error.value = it.message }
    }

    /** Many events at once (a busy group) make one reload. */
    private fun reloadSoon() {
        if (reloadJob?.isActive == true) return
        reloadJob = viewModelScope.launch { delay(400); load() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    onOpen: (String) -> Unit,
    onNewChat: () -> Unit,
    onNewGroup: () -> Unit,
    onSignOut: () -> Unit,
    onProfile: () -> Unit,
    onStarred: () -> Unit,
    vm: ChatListViewModel = viewModel()
) {
    val chats by vm.chats.collectAsState()
    val loading by vm.loading.collectAsState()
    val error by vm.error.collectAsState()
    val connected by Live.connected.collectAsState()
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.load() }
    LaunchedEffect(loading) { if (!loading) refreshing = false }

    var showArchived by remember { mutableStateOf(false) }
    val archivedCount = chats.count { it.archived }
    var tab by remember { mutableStateOf(0) }          // 0 = Chats, 1 = Calls
    var filter by remember { mutableStateOf("all") }   // all / unread / groups
    val base = (if (query.isNotBlank()) chats else chats.filter { it.archived == showArchived })
        .filter { c -> when (filter) { "unread" -> c.unread > 0; "groups" -> c.isGroup; else -> true } }
    val unreadChats = chats.count { it.unread > 0 && !it.archived }
    val shown = if (query.isBlank()) base else base.filter {
        it.name.contains(query, true) || (it.last_body ?: "").contains(query, true) ||
            it.members.any { m -> m.contains(query, true) }
    }

    Scaffold(
        topBar = {
            if (searching) {
                TopAppBar(
                    navigationIcon = { IconButton(onClick = { searching = false; query = "" }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                    title = {
                        TextField(
                            value = query, onValueChange = { query = it }, placeholder = { Text("Search…") }, singleLine = true,
                            colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent),
                            modifier = Modifier.fillMaxWidth()
                        )
                    },
                    actions = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Default.Close, "Clear") } }
                )
            } else {
                TopAppBar(
                    title = {
                        Column {
                            Text("JMS Chat", fontWeight = FontWeight.SemiBold)
                            if (!connected) Text("Connecting…", fontSize = 12.sp, color = Color.White.copy(alpha = 0.8f))
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Teal, titleContentColor = Color.White, actionIconContentColor = Color.White),
                    actions = {
                        IconButton(onClick = { searching = true }) { Icon(Icons.Default.Search, "Search") }
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Menu") }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text("Profile") }, onClick = { menu = false; onProfile() })
                                DropdownMenuItem(text = { Text("New group") }, onClick = { menu = false; onNewGroup() })
                                DropdownMenuItem(text = { Text("Starred messages") }, onClick = { menu = false; onStarred() })
                                DropdownMenuItem(text = { Text("Signed in as ${Session.username}") }, onClick = { menu = false }, enabled = false)
                                DropdownMenuItem(text = { Text("Sign out") }, onClick = { menu = false; onSignOut() })
                            }
                        }
                    }
                )
            }
        },
        floatingActionButton = {
            if (tab == 0) FloatingActionButton(onClick = onNewChat, containerColor = Color(0xFF00A884), contentColor = Color.White) {
                Icon(Icons.AutoMirrored.Filled.Chat, "New chat")
            }
        },
        bottomBar = {
            androidx.compose.material3.NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                NavigationBarItem(
                    selected = tab == 0, onClick = { tab = 0 }, label = { Text("Chats") },
                    icon = {
                        androidx.compose.material3.BadgedBox(badge = {
                            if (unreadChats > 0) androidx.compose.material3.Badge(containerColor = Color(0xFF25D366)) { Text("$unreadChats") }
                        }) { Icon(Icons.AutoMirrored.Filled.Chat, null) }
                    },
                    colors = androidx.compose.material3.NavigationBarItemDefaults.colors(indicatorColor = Color(0x3300A884))
                )
                NavigationBarItem(
                    selected = tab == 1, onClick = { tab = 1 }, label = { Text("Calls") },
                    icon = { Icon(Icons.Default.Call, null) },
                    colors = androidx.compose.material3.NavigationBarItemDefaults.colors(indicatorColor = Color(0x3300A884))
                )
            }
        }
    ) { pad ->
        if (tab == 1) CallsTab(Modifier.padding(pad).fillMaxSize()) else PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { refreshing = true; vm.load() },
            modifier = Modifier.padding(pad).fillMaxSize()
        ) {
            when {
                loading -> LinearProgressIndicator(Modifier.fillMaxWidth(), color = Green)
                shown.isEmpty() && filter == "all" -> Column(
                    Modifier.fillMaxSize().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
                ) {
                    Text("💬", fontSize = 48.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        error ?: if (query.isBlank()) "No chats yet. Tap the green button to message anyone." else "Nothing found.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    if (query.isBlank() && !showArchived) item {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("all" to "All", "unread" to "Unread", "groups" to "Groups").forEach { (k, label) ->
                                androidx.compose.material3.FilterChip(
                                    selected = filter == k, onClick = { filter = k }, label = { Text(label) },
                                    shape = RoundedCornerShape(20.dp),
                                    colors = androidx.compose.material3.FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = Color(0x3300A884), selectedLabelColor = Color(0xFF00785F)
                                    )
                                )
                            }
                        }
                    }
                    if (query.isBlank() && (archivedCount > 0 || showArchived)) item {
                        Row(
                            Modifier.fillMaxWidth().clickable { showArchived = !showArchived }.padding(horizontal = 28.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(if (showArchived) Icons.AutoMirrored.Filled.ArrowBack else Icons.Default.Archive, null, tint = Color(0xFF00A884))
                            Spacer(Modifier.width(24.dp))
                            Text(if (showArchived) "Back to chats" else "Archived", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            if (!showArchived) Text("$archivedCount", color = Color(0xFF00A884))
                        }
                    }
                    items(shown, key = { it.sync_id }) { c ->
                        ChatRow(c, onPin = { vm.pin(c) }, onArchive = { vm.archive(c) }) { onOpen(c.sync_id) }
                        HorizontalDivider(Modifier.padding(start = 80.dp), thickness = 0.5.dp)
                    }
                }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ChatRow(c: Conversation, onPin: () -> Unit, onArchive: () -> Unit, onClick: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
        DropdownMenuItem(text = { Text(if (c.pinned) "Unpin chat" else "Pin chat") }, onClick = { menu = false; onPin() })
        DropdownMenuItem(text = { Text(if (c.archived) "Unarchive chat" else "Archive chat") }, onClick = { menu = false; onArchive() })
    }
    Row(
        Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = { menu = true })
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Avatar(c.name, 52.dp, group = c.isGroup, online = c.online, photoUrl = c.peer?.let { Api.avatarUrl(it, c.photo_v) })
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(c.name, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(
                    listTime(c.last_message_at), fontSize = 12.sp,
                    color = if (c.unread > 0) Color(0xFF00A884) else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val who = when {
                    c.last_sender.isNullOrBlank() -> ""
                    Session.isMe(c.last_sender) -> "You: "
                    c.isGroup -> "${c.last_sender}: "
                    else -> ""
                }
                Text(
                    who + (c.last_body ?: ""), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f)
                )
                if (c.muted_until != null) Icon(Icons.Default.NotificationsOff, "Muted", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                if (c.pinned) Icon(Icons.Default.PushPin, "Pinned", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                if (c.unread > 0) {
                    Spacer(Modifier.width(6.dp))
                    Box(
                        Modifier.widthIn(min = 22.dp).height(22.dp).clip(RoundedCornerShape(11.dp)).background(Color(0xFF25D366)).padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center
                    ) { Text(if (c.unread > 99) "99+" else "${c.unread}", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
    }
}
