package com.jmsocean.chat.call

import android.Manifest
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Call
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.ui.Avatar
import com.jmsocean.chat.ui.JmsChatTheme
import kotlinx.coroutines.delay

/**
 * Full-screen call: outgoing (EXTRA_PEER), or incoming from the ringing notification
 * (EXTRA_CALL + EXTRA_CALLER, EXTRA_ACCEPT when "Answer" was tapped). Shows over the
 * lock screen.
 */
class CallActivity : ComponentActivity() {
    private var pendingAccept = false
    private var pendingPeer: String? = null

    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (!ok) {
            Toast.makeText(this, "Allow the microphone to make calls.", Toast.LENGTH_LONG).show()
            if (CallEngine.state.value.incoming) CallEngine.decline(this)
            finish()
            return@registerForActivityResult
        }
        pendingPeer?.let { CallEngine.startOutgoing(this, it) }
        if (pendingAccept) CallEngine.accept(this)
        pendingPeer = null; pendingAccept = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            getSystemService(KeyguardManager::class.java)?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        handle(intent)
        setContent { JmsChatTheme { CallScreen(onClose = { finish() }) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun micOk() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun handle(i: Intent?) {
        i ?: return
        val peer = i.getStringExtra(EXTRA_PEER)
        val callId = i.getStringExtra(CallNotifications.EXTRA_CALL)
        if (peer != null && !CallEngine.busy) {
            if (micOk()) CallEngine.startOutgoing(this, peer) else { pendingPeer = peer; askMic.launch(Manifest.permission.RECORD_AUDIO) }
        } else if (callId != null) {
            CallEngine.ringing(callId, i.getStringExtra(CallNotifications.EXTRA_CALLER) ?: "")
            if (i.getBooleanExtra(CallNotifications.EXTRA_ACCEPT, false)) {
                if (micOk()) CallEngine.accept(this) else { pendingAccept = true; askMic.launch(Manifest.permission.RECORD_AUDIO) }
            }
        }
    }

    companion object {
        const val EXTRA_PEER = "peer"

        fun call(ctx: android.content.Context, peer: String) {
            ctx.startActivity(Intent(ctx, CallActivity::class.java).putExtra(EXTRA_PEER, peer).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

@Composable
private fun CallScreen(onClose: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val s by CallEngine.state.collectAsState()
    val now = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(s.phase) {
        while (s.phase == CallState.Phase.ACTIVE) { now.longValue = System.currentTimeMillis(); delay(1000) }
        if (s.phase == CallState.Phase.ENDED || s.phase == CallState.Phase.IDLE) {
            delay(1500)
            CallEngine.reset()
            onClose()
        }
    }
    val status = when (s.phase) {
        CallState.Phase.CALLING -> "Calling…"
        CallState.Phase.RINGING -> "Incoming voice call"
        CallState.Phase.CONNECTING -> "Connecting…"
        CallState.Phase.ACTIVE -> {
            val sec = ((now.longValue - s.answeredAt) / 1000).coerceAtLeast(0)
            "%d:%02d".format(sec / 60, sec % 60)
        }
        CallState.Phase.ENDED -> s.message ?: "Call ended"
        CallState.Phase.IDLE -> ""
    }
    Box(Modifier.fillMaxSize().background(Color(0xFF0B141A))) {
        Column(Modifier.fillMaxWidth().padding(top = 96.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🔒 JMS Chat voice call", color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp)
            Spacer(Modifier.height(24.dp))
            Avatar(s.peer.ifBlank { "?" }, 120.dp, photoUrl = Api.avatarUrl(s.peer, "0").takeIf { s.peer.isNotBlank() })
            Spacer(Modifier.height(16.dp))
            Text(s.peer, color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Text(status, color = Color.White.copy(alpha = 0.8f), fontSize = 16.sp)
        }
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 72.dp),
            horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically
        ) {
            when (s.phase) {
                CallState.Phase.RINGING -> {
                    RoundButton(Icons.Default.CallEnd, "Decline", Color(0xFFE53935)) { CallEngine.decline(ctx) }
                    RoundButton(Icons.Default.Call, "Answer", Color(0xFF00A884)) {
                        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            CallEngine.accept(ctx)
                        } else {
                            ctx.startActivity(Intent(ctx, CallActivity::class.java)
                                .putExtra(CallNotifications.EXTRA_CALL, s.callId).putExtra(CallNotifications.EXTRA_CALLER, s.peer)
                                .putExtra(CallNotifications.EXTRA_ACCEPT, true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP))
                        }
                    }
                }
                CallState.Phase.ENDED, CallState.Phase.IDLE -> Unit
                else -> {
                    RoundButton(if (s.speaker) Icons.AutoMirrored.Filled.VolumeUp else Icons.AutoMirrored.Filled.VolumeUp,
                        if (s.speaker) "Speaker on" else "Speaker", if (s.speaker) Color.White.copy(alpha = 0.35f) else Color.White.copy(alpha = 0.12f)) {
                        CallEngine.toggleSpeaker()
                    }
                    RoundButton(Icons.Default.CallEnd, "End", Color(0xFFE53935)) { CallEngine.hangUp() }
                    RoundButton(if (s.muted) Icons.Default.MicOff else Icons.Default.Mic, if (s.muted) "Unmute" else "Mute",
                        if (s.muted) Color.White.copy(alpha = 0.35f) else Color.White.copy(alpha = 0.12f)) {
                        CallEngine.toggleMute()
                    }
                }
            }
        }
    }
}

@Composable
private fun RoundButton(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(68.dp).clip(CircleShape).background(color).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
            Icon(icon, label, tint = Color.White, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(label, color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
    }
}
