package com.jmsocean.chat.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.automirrored.filled.CallMade
import androidx.compose.material.icons.automirrored.filled.CallMissed
import androidx.compose.material.icons.automirrored.filled.CallReceived
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.call.CallActivity
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.CallInfo

/** Recent voice calls (newest first): who, in / out / missed, when, how long. Tap to call back. */
@Composable
fun CallsTab(modifier: Modifier) {
    val ctx = LocalContext.current
    var calls by remember { mutableStateOf<List<CallInfo>?>(null) }
    LaunchedEffect(Unit) { calls = runCatching { Api.callLog() }.getOrDefault(emptyList()) }
    val list = calls
    if (list == null) { LinearProgressIndicator(modifier.fillMaxWidth().height(2.dp), color = Green); return }
    LazyColumn(modifier) {
        if (list.isEmpty()) item {
            Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center) {
                Text("📞", fontSize = 44.sp)
                Spacer(Modifier.height(8.dp))
                Text("No calls yet. Open a chat and tap 📞 to call.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        items(list, key = { it.id }) { c ->
            val missed = c.incoming && (c.status == "missed" || c.status == "declined")
            Row(
                Modifier.fillMaxWidth().clickable { CallActivity.call(ctx, c.peer) }.padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Avatar(c.peer, 48.dp, photoUrl = Api.avatarUrl(c.peer, "0"))
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(c.peer, fontWeight = FontWeight.SemiBold, fontSize = 16.sp,
                        color = if (missed) Color(0xFFE53935) else MaterialTheme.colorScheme.onSurface)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val (icon, tint) = when {
                            missed -> Icons.AutoMirrored.Filled.CallMissed to Color(0xFFE53935)
                            c.incoming -> Icons.AutoMirrored.Filled.CallReceived to Color(0xFF00A884)
                            else -> Icons.AutoMirrored.Filled.CallMade to Color(0xFF00A884)
                        }
                        Icon(icon, null, tint = tint, modifier = Modifier.padding(end = 4.dp).height(16.dp))
                        val len = if (c.answered_at != null && c.ended_at != null)
                            durationText(c.answered_at, c.ended_at) else null
                        Text(listOfNotNull(dayLabel(c.created_at) + " " + timeOf(c.created_at), len).joinToString(" · "),
                            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                IconButton(onClick = { CallActivity.call(ctx, c.peer) }) { Icon(Icons.Default.Call, "Call ${c.peer}", tint = Color(0xFF00A884)) }
            }
            HorizontalDivider(Modifier.padding(start = 78.dp), thickness = 0.5.dp)
        }
    }
}

private fun durationText(from: String, to: String): String? {
    val a = parseTs(from) ?: return null
    val b = parseTs(to) ?: return null
    val s = java.time.Duration.between(a, b).seconds.coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}
