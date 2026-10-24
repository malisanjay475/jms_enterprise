package com.jmsocean.chat.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.CancellationSignal
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat

/** 🔁 Shift handover: running jobs, problems, pending QC, notes. */
@Composable
fun HandoverDialog(onPost: (running: String, problems: String, pendingQc: String, notes: String) -> Unit, onClose: () -> Unit) {
    var running by remember { mutableStateOf("") }
    var problems by remember { mutableStateOf("") }
    var qc by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("🔁 Shift handover") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(value = running, onValueChange = { running = it.take(800) }, label = { Text("▶ Running jobs") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = problems, onValueChange = { problems = it.take(800) }, label = { Text("⚠ Problems") }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                OutlinedTextField(value = qc, onValueChange = { qc = it.take(800) }, label = { Text("🧪 Pending QC") }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                OutlinedTextField(value = notes, onValueChange = { notes = it.take(800) }, label = { Text("📝 Notes") }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
                Text("The next shift taps \"✓ I read it\".", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (listOf(running, problems, qc, notes).any { it.isNotBlank() }) onPost(running.trim(), problems.trim(), qc.trim(), notes.trim())
            }) { Text("Post") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } }
    )
}

/** A translation or voice-note text under a bubble. */
@Composable
fun ExtraText(label: String, text: String) {
    Column(Modifier.padding(top = 6.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x1400A884)).padding(8.dp)) {
        Text(label, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(2.dp))
        Text(text, fontSize = 14.sp)
    }
}

fun hasLocation(ctx: Context) =
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

/** One current location fix (GPS, else network), or the last known one. */
@SuppressLint("MissingPermission")
fun currentLocation(ctx: Context, done: (Location?) -> Unit) {
    if (!hasLocation(ctx)) { done(null); return }
    val lm = ctx.getSystemService(LocationManager::class.java)
    val provider = when {
        lm.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        else -> null
    }
    if (provider == null) { done(null); return }
    LocationManagerCompat.getCurrentLocation(lm, provider, CancellationSignal(), ContextCompat.getMainExecutor(ctx)) { loc ->
        done(loc ?: runCatching { lm.getLastKnownLocation(provider) }.getOrNull())
    }
}
