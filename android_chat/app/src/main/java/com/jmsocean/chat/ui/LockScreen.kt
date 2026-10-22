package com.jmsocean.chat.ui

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.jmsocean.chat.R
import com.jmsocean.chat.data.AppLock

private const val PIN_LEN = 4

/**
 * Full-screen passcode pad. mode "unlock": checks the PIN (or fingerprint);
 * "set": asks twice and saves it. [onSignOut] is the way out when the PIN is forgotten.
 */
@Composable
fun LockScreen(mode: String = "unlock", onDone: () -> Unit, onCancel: (() -> Unit)? = null, onSignOut: (() -> Unit)? = null) {
    val ctx = LocalContext.current
    var pin by remember { mutableStateOf("") }
    var first by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf(if (mode == "set") "Choose a 4-digit passcode" else "Enter passcode") }
    var error by remember { mutableStateOf(false) }

    fun biometric() {
        val act = ctx as? FragmentActivity ?: return
        val ok = BiometricManager.from(ctx).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS
        if (!ok) return
        val prompt = BiometricPrompt(act, ContextCompat.getMainExecutor(ctx), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { AppLock.unlock(); onDone() }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder().setTitle("Unlock JMS Chat").setNegativeButtonText("Use passcode")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK).build()
        )
    }

    LaunchedEffect(Unit) { if (mode == "unlock" && AppLock.useBiometric) biometric() }

    fun complete(p: String) {
        if (mode == "unlock") {
            if (AppLock.check(p)) { AppLock.unlock(); onDone() } else { error = true; message = "Wrong passcode, try again"; pin = "" }
            return
        }
        val f = first
        if (f == null) { first = p; pin = ""; message = "Enter the same passcode again"; error = false }
        else if (f == p) { AppLock.setPin(p); onDone() }
        else { first = null; pin = ""; error = true; message = "Passcodes did not match. Choose again" }
    }

    fun press(d: String) {
        if (pin.length >= PIN_LEN) return
        pin += d
        error = false
        if (pin.length == PIN_LEN) complete(pin)
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF075E54))) {
        Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(Modifier.size(72.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.jms_logo), null, Modifier.size(48.dp))
            }
            Spacer(Modifier.height(14.dp))
            Text("JMS Chat is locked".takeIf { mode == "unlock" } ?: "App lock", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text(message, color = if (error) Color(0xFFFFCDD2) else Color.White.copy(alpha = 0.85f), fontSize = 15.sp)
            Spacer(Modifier.height(22.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                repeat(PIN_LEN) { i ->
                    Box(Modifier.size(16.dp).clip(CircleShape)
                        .background(if (i < pin.length) Color.White else Color.Transparent)
                        .border(2.dp, Color.White, CircleShape))
                }
            }
            Spacer(Modifier.height(32.dp))
            listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("bio", "0", "del")).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(22.dp), modifier = Modifier.padding(vertical = 8.dp)) {
                    row.forEach { k ->
                        Box(
                            Modifier.size(72.dp).clip(CircleShape)
                                .background(if (k.length == 1) Color.White.copy(alpha = 0.12f) else Color.Transparent)
                                .clickable {
                                    when (k) {
                                        "del" -> pin = pin.dropLast(1)
                                        "bio" -> if (mode == "unlock" && AppLock.useBiometric) biometric()
                                        else -> press(k)
                                    }
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            when (k) {
                                "del" -> Icon(Icons.AutoMirrored.Filled.Backspace, "Delete", tint = Color.White)
                                "bio" -> if (mode == "unlock" && AppLock.useBiometric) Icon(Icons.Default.Fingerprint, "Fingerprint", tint = Color.White, modifier = Modifier.size(30.dp))
                                else -> Text(k, color = Color.White, fontSize = 28.sp)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            if (onCancel != null) TextButton(onClick = onCancel) { Text("Cancel", color = Color.White) }
            if (onSignOut != null) TextButton(onClick = onSignOut) { Text("Forgot passcode? Sign out", color = Color.White.copy(alpha = 0.8f)) }
        }
    }
}

/** Profile section: turn the lock on / off, change passcode, auto-lock time, fingerprint. */
@Composable
fun AppLockSection() {
    var enabled by remember { mutableStateOf(AppLock.enabled) }
    var setting by remember { mutableStateOf(false) }
    var timeout by remember { mutableStateOf(AppLock.timeoutMs) }
    var bio by remember { mutableStateOf(AppLock.useBiometric) }
    var pickTime by remember { mutableStateOf(false) }

    Column(Modifier.padding(horizontal = 16.dp)) {
        Text("App lock", color = Color(0xFF00A884), fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(8.dp))
        Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("🔒  Lock with passcode", modifier = Modifier.weight(1f), fontSize = 15.sp)
            androidx.compose.material3.Switch(checked = enabled, onCheckedChange = { on ->
                if (on) setting = true else { AppLock.disable(); enabled = false }
            })
        }
        if (enabled) {
            Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp).clickable { pickTime = true }, verticalAlignment = Alignment.CenterVertically) {
                Text("⏱  Lock automatically", modifier = Modifier.weight(1f), fontSize = 15.sp)
                Text(AppLock.TIMEOUTS.firstOrNull { it.first == timeout }?.second ?: "After 1 minute", color = Color(0xFF00A884))
            }
            Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("👆  Unlock with fingerprint", modifier = Modifier.weight(1f), fontSize = 15.sp)
                androidx.compose.material3.Switch(checked = bio, onCheckedChange = { bio = it; AppLock.useBiometric = it })
            }
            TextButton(onClick = { setting = true }) { Text("Change passcode") }
        }
    }
    if (setting) androidx.compose.ui.window.Dialog(
        onDismissRequest = { setting = false },
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)
    ) {
        LockScreen(mode = "set", onDone = { setting = false; enabled = true }, onCancel = { setting = false })
    }
    if (pickTime) androidx.compose.material3.AlertDialog(
        onDismissRequest = { pickTime = false },
        title = { Text("Lock automatically") },
        text = {
            Column {
                AppLock.TIMEOUTS.forEach { (ms, label) ->
                    Row(Modifier.clickable { timeout = ms; AppLock.timeoutMs = ms; pickTime = false }.padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(selected = timeout == ms, onClick = { timeout = ms; AppLock.timeoutMs = ms; pickTime = false })
                        Spacer(Modifier.width(8.dp))
                        Text(label)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { pickTime = false }) { Text("Close") } }
    )
}
