package com.jmsocean.chat.call

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.ui.Avatar
import com.jmsocean.chat.ui.JmsChatTheme
import kotlinx.coroutines.delay

/** Group call screen: start or join the group's call (EXTRA_CONV), or reopen the one going on. */
class GroupCallActivity : ComponentActivity() {
    private var pending: Pair<String, String>? = null

    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val p = pending
        pending = null
        if (!ok || p == null) {
            Toast.makeText(this, "Allow the microphone to join the call.", Toast.LENGTH_LONG).show()
            finish()
            return@registerForActivityResult
        }
        GroupCallEngine.join(this, p.first, p.second)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        handle(intent)
        setContent { JmsChatTheme { GroupCallScreen(onClose = { finish() }) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(i: Intent?) {
        val conv = i?.getStringExtra(EXTRA_CONV) ?: return
        if (GroupCallEngine.active) return // already in a call: just show it
        val title = i.getStringExtra(EXTRA_TITLE) ?: "Group"
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            GroupCallEngine.join(this, conv, title)
        } else {
            pending = conv to title
            askMic.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    companion object {
        const val EXTRA_CONV = "conversation_sync_id"
        const val EXTRA_TITLE = "title"

        fun intent(ctx: Context, convId: String, title: String) = Intent(ctx, GroupCallActivity::class.java)
            .putExtra(EXTRA_CONV, convId).putExtra(EXTRA_TITLE, title)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

        fun join(ctx: Context, convId: String, title: String) {
            if (CallEngine.busy) { Toast.makeText(ctx, "End your other call first.", Toast.LENGTH_SHORT).show(); return }
            ctx.startActivity(intent(ctx, convId, title))
        }
    }
}

@Composable
private fun GroupCallScreen(onClose: () -> Unit) {
    val s by GroupCallEngine.state.collectAsState()
    val now = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(s.phase) {
        while (s.phase == GroupCallState.Phase.LIVE) { now.longValue = System.currentTimeMillis(); delay(1000) }
        if (s.phase == GroupCallState.Phase.ENDED || s.phase == GroupCallState.Phase.IDLE) {
            delay(1500)
            GroupCallEngine.reset()
            onClose()
        }
    }
    val others = s.people.count { !it.me }
    val status = when (s.phase) {
        GroupCallState.Phase.JOINING -> "Joining…"
        GroupCallState.Phase.LIVE -> {
            val sec = ((now.longValue - s.startedAt) / 1000).coerceAtLeast(0)
            (if (others == 0) "Waiting for others · " else "${others + 1} in the call · ") + "%d:%02d".format(sec / 60, sec % 60)
        }
        GroupCallState.Phase.ENDED -> s.message ?: "Call ended"
        GroupCallState.Phase.IDLE -> ""
    }
    Box(Modifier.fillMaxSize().background(Color(0xFF0B141A))) {
        Column(Modifier.fillMaxSize().padding(top = 56.dp, bottom = 170.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🔒 JMS Chat group call", color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp)
            Spacer(Modifier.height(10.dp))
            Text(s.title, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(6.dp))
            Text(status, color = Color.White.copy(alpha = 0.8f), fontSize = 15.sp)
            Spacer(Modifier.height(24.dp))
            LazyVerticalGrid(
                columns = GridCells.Fixed(if (s.people.size <= 4) 2 else 3),
                contentPadding = PaddingValues(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(s.people, key = { it.name.lowercase() }) { p ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Avatar(p.name, 76.dp, photoUrl = Api.avatarUrl(p.name, "0"))
                        Spacer(Modifier.height(6.dp))
                        Text(if (p.me) "You" else p.name, color = Color.White, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            when { p.me && s.muted -> "🔇 muted"; p.me -> ""; p.connected -> "🔊"; else -> "connecting…" },
                            color = Color.White.copy(alpha = 0.65f), fontSize = 12.sp
                        )
                    }
                }
            }
        }
        if (s.phase == GroupCallState.Phase.LIVE || s.phase == GroupCallState.Phase.JOINING) Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 64.dp),
            horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically
        ) {
            GroupButton(Icons.AutoMirrored.Filled.VolumeUp, if (s.speaker) "Speaker on" else "Speaker",
                if (s.speaker) Color.White.copy(alpha = 0.35f) else Color.White.copy(alpha = 0.12f)) { GroupCallEngine.toggleSpeaker() }
            GroupButton(Icons.Default.CallEnd, "Leave", Color(0xFFE53935)) { GroupCallEngine.leave() }
            GroupButton(if (s.muted) Icons.Default.MicOff else Icons.Default.Mic, if (s.muted) "Unmute" else "Mute",
                if (s.muted) Color.White.copy(alpha = 0.35f) else Color.White.copy(alpha = 0.12f)) { GroupCallEngine.toggleMute() }
        }
    }
}

@Composable
private fun GroupButton(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(color).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
            Icon(icon, label, tint = Color.White, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(label, color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
    }
}
