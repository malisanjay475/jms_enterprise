package com.jmsocean.qc.ui.issues

import android.content.Intent
import android.net.Uri
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.jmsocean.qc.data.remote.QueueJob
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssuesScreen(
    onMenu: () -> Unit,
    vm: IssuesViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val ctx = LocalContext.current

    // Mic → speech-to-text (Hinglish). Falls back silently if no recognizer.
    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { res ->
        val text = res.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!text.isNullOrBlank()) vm.appendSpeech(text)
    }
    fun startSpeech() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN")
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Bolo… (Hindi / English)")
        }
        try { speechLauncher.launch(intent) } catch (_: Exception) {}
    }

    // Camera capture — photo + video to a FileProvider uri under cacheDir.
    var pendingPhoto by remember { mutableStateOf<File?>(null) }
    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) pendingPhoto?.let { vm.addImage(it) }
    }
    fun capturePhoto() {
        val dir = File(ctx.cacheDir, "images").apply { mkdirs() }
        val f = File(dir, "memo_${System.currentTimeMillis()}.jpg")
        pendingPhoto = f
        val uri: Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
        photoLauncher.launch(uri)
    }
    var pendingVideo by remember { mutableStateOf<File?>(null) }
    val videoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CaptureVideo()) { ok ->
        if (ok) pendingVideo?.let { vm.setVideo(it) }
    }
    fun captureVideo() {
        val dir = File(ctx.cacheDir, "videos").apply { mkdirs() }
        val f = File(dir, "memo_${System.currentTimeMillis()}.mp4")
        pendingVideo = f
        val uri: Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
        videoLauncher.launch(uri)
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                ),
                title = { Text("Raised Memo", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onMenu) { Icon(Icons.Default.ArrowBack, contentDescription = "Menu") }
                }
            )
        }
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp)
        ) {
            // 1 — Machine
            MemoCard {
                Label("1 · Machine")
                if (s.machines.isEmpty()) {
                    Text("Loading machines…", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        s.machines.forEach { m ->
                            FilterChip(selected = s.machine == m, onClick = { vm.setMachine(m) }, label = { Text(m) })
                        }
                    }
                }
            }

            // 2 — Active plans on that machine (running highlighted)
            if (s.machine.isNotBlank()) {
                Spacer(Modifier.size(10.dp))
                MemoCard {
                    Label("2 · Select job / active plan")
                    when {
                        s.loadingJobs -> Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        }
                        s.jobs.isEmpty() -> Text("No active plans on ${s.machine}.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            s.jobs.forEach { job -> JobRow(job, selected = s.job === job) { vm.selectJob(job) } }
                        }
                    }
                }
            }

            // 3 — Job info + colour balance
            s.job?.let { job ->
                Spacer(Modifier.size(10.dp))
                MemoCard {
                    Label("3 · Job info")
                    Text(job.productName, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text(
                        buildString {
                            append("OR ${job.orderNumber.ifBlank { "—" }}")
                            job.JobCardNo?.takeIf { it.isNotBlank() }?.let { append("  |  JC $it") }
                        },
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    job.Mould?.takeIf { it.isNotBlank() }?.let {
                        Text("Mould: $it", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (s.balances.isNotEmpty()) {
                        Spacer(Modifier.size(8.dp))
                        Row(Modifier.fillMaxWidth()) {
                            HCell("Colour", 1.4f); HCell("Plan", 1f); HCell("Made", 1f, Good); HCell("Bal", 1f, Warn)
                        }
                        s.balances.forEach { b ->
                            Row(Modifier.fillMaxWidth().padding(top = 3.dp)) {
                                VCell(b.colour, 1.4f, bold = true); VCell("${b.planQty}", 1f)
                                VCell("${b.produced}", 1f, Good); VCell("${b.balance}", 1f, Warn)
                            }
                        }
                    }
                }
            }

            // 4 — What's the problem + severity
            Spacer(Modifier.size(10.dp))
            MemoCard {
                Label("4 · Memo")
                OutlinedTextField(
                    value = s.description, onValueChange = vm::setDescription,
                    label = { Text("What is the problem?") }, modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.size(8.dp))
                Text("Severity", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("Low", "Medium", "High", "Critical").forEach {
                        FilterChip(selected = s.severity == it, onClick = { vm.setSeverity(it) }, label = { Text(it) })
                    }
                }
                Spacer(Modifier.size(10.dp))
                // Remarks with mic (speech-to-text)
                OutlinedTextField(
                    value = s.remarks, onValueChange = vm::setRemarks,
                    label = { Text("Remarks") }, modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        IconButton(onClick = { startSpeech() }) {
                            Icon(Icons.Default.Mic, contentDescription = "Speak", tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                )
                Text("Tap the mic to dictate (Hindi/English).", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // 5 — Media
            Spacer(Modifier.size(10.dp))
            MemoCard {
                Label("5 · Photos / video")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { capturePhoto() }, modifier = Modifier.weight(1f)) { Text("📷 Add photo") }
                    OutlinedButton(onClick = { captureVideo() }, modifier = Modifier.weight(1f)) {
                        Text(if (s.video != null) "🎬 Video ✓" else "🎬 Add video")
                    }
                }
                if (s.images.isNotEmpty()) {
                    Spacer(Modifier.size(8.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        s.images.forEach { f ->
                            Box {
                                AsyncImage(
                                    model = f, contentDescription = null,
                                    modifier = Modifier.size(72.dp)
                                )
                                IconButton(onClick = { vm.removeImage(f) }, modifier = Modifier.size(22.dp)) {
                                    Icon(Icons.Default.Close, contentDescription = "Remove", tint = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                    }
                }
                if (s.video != null) {
                    Spacer(Modifier.size(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Video attached", fontSize = 12.sp, color = Good)
                        Spacer(Modifier.size(8.dp))
                        Text("Remove", fontSize = 12.sp, color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(2.dp).clickable { vm.setVideo(null) })
                    }
                }
            }

            // 6 — Mention a Moulding person
            Spacer(Modifier.size(10.dp))
            MemoCard {
                Label("6 · Send to (Moulding)")
                if (s.people.isEmpty()) {
                    Text("No Moulding people found for this factory.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        s.people.forEach { p ->
                            FilterChip(
                                selected = s.mentioned?.username == p.username,
                                onClick = { vm.setMentioned(if (s.mentioned?.username == p.username) null else p) },
                                label = { Text("${p.name} · ${p.role_code}") }
                            )
                        }
                    }
                }
            }

            s.error?.let { Spacer(Modifier.size(10.dp)); Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
            s.message?.let { Spacer(Modifier.size(10.dp)); Text(it, color = Good, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }

            Spacer(Modifier.size(14.dp))
            Button(
                onClick = { vm.submit { } },
                enabled = s.canSubmit,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (s.submitting) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text("Raise Memo", fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.size(24.dp))
        }
    }
}

@Composable
private fun JobRow(job: QueueJob, selected: Boolean, onClick: () -> Unit) {
    val running = job.Status?.contains("run", ignoreCase = true) == true
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface
        ),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().clickable { onClick() }
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Text(job.productName, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.weight(1f))
                if (running) Text("● RUNNING", color = Good, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                else job.Status?.takeIf { it.isNotBlank() }?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp) }
            }
            Text(
                buildString {
                    append("OR ${job.orderNumber.ifBlank { "—" }}")
                    job.JobCardNo?.takeIf { it.isNotBlank() }?.let { append("  |  JC $it") }
                    job.Mould?.takeIf { it.isNotBlank() }?.let { append("  |  ${it}") }
                },
                fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun MemoCard(content: @Composable () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth()
    ) { Column(Modifier.padding(14.dp)) { content() } }
}

@Composable
private fun Label(text: String) {
    Text(text, fontWeight = FontWeight.Bold, fontSize = 12.sp,
        color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.HCell(text: String, weight: Float, color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Text(text, Modifier.weight(weight), color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.VCell(text: String, weight: Float, color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface, bold: Boolean = false) {
    Text(text, Modifier.weight(weight), color = color, fontSize = 12.sp, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal)
}
