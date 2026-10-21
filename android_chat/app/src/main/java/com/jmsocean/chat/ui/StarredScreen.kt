package com.jmsocean.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.FoundMessage
import com.jmsocean.chat.data.Session

/** All messages I starred, newest first. Tap one to open its chat. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StarredScreen(onBack: () -> Unit, onOpen: (String) -> Unit) {
    var items by remember { mutableStateOf<List<FoundMessage>?>(null) }
    LaunchedEffect(Unit) { items = runCatching { Api.starred() }.getOrDefault(emptyList()) }
    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = { Text("Starred messages", fontWeight = FontWeight.SemiBold) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Teal, titleContentColor = Color.White, navigationIconContentColor = Color.White)
            )
        }
    ) { pad ->
        val list = items
        if (list == null) LinearProgressIndicator(Modifier.padding(pad).fillMaxWidth(), color = Green)
        else LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            if (list.isEmpty()) item {
                Text("No starred messages. Long-press a message and tap Star to keep it here.", Modifier.padding(24.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(list, key = { it.message.sync_id }) { f ->
                val m = f.message
                Column(Modifier.fillMaxWidth().clickable { onOpen(m.conversation_sync_id) }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text("${if (Session.isMe(m.sender)) "You" else m.sender} → ${f.conversation_title}", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Text(m.body.ifBlank { m.attachment?.file_name ?: "" }, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    Text("★ ${dayLabel(m.server_ts)} ${timeOf(m.server_ts)}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider()
            }
        }
    }
}
