package com.jmsocean.chat.ui

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Work
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.BuildConfig
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Media
import com.jmsocean.chat.data.Profile
import com.jmsocean.chat.data.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * My profile, like WhatsApp: photo (camera or gallery), name, About line, sign out.
 * A new name waits for an admin's approval; until then others see the current one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(onBack: () -> Unit, onSignOut: () -> Unit, onNameRequests: () -> Unit = {}) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf(Profile(username = Session.username ?: "")) }
    var busy by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf(false) }
    var editAbout by remember { mutableStateOf<String?>(null) }
    var editName by remember { mutableStateOf<String?>(null) }
    var editWork by remember { mutableStateOf(false) }
    var cameraFile by remember { mutableStateOf<File?>(null) }

    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current
    var resumed by remember { mutableStateOf(0) }
    androidx.compose.runtime.DisposableEffect(lifecycle) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) resumed++ }
        lifecycle.lifecycle.addObserver(obs)
        onDispose { lifecycle.lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(resumed) { runCatching { Api.myProfile() }.onSuccess { profile = it } }

    fun upload(read: suspend () -> File?) {
        busy = true
        scope.launch {
            val src = withContext(Dispatchers.IO) { read() }
            val small = src?.let { withContext(Dispatchers.IO) { Media.shrinkPhoto(it, File(ctx.cacheDir, "avatar-${System.nanoTime()}.jpg"), 800, 85) } }
            if (small == null) {
                Toast.makeText(ctx, "Could not read that photo.", Toast.LENGTH_SHORT).show()
            } else {
                runCatching { Api.uploadPhoto(small, "image/jpeg") }
                    .onSuccess { profile = it; Toast.makeText(ctx, "Profile photo updated", Toast.LENGTH_SHORT).show() }
                    .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                small.delete()
            }
            if (src != cameraFile) src?.delete()
            busy = false
        }
    }

    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri != null) upload {
            val f = File(ctx.cacheDir, "pick-${System.nanoTime()}")
            ctx.contentResolver.openInputStream(uri)?.use { i -> f.outputStream().use { i.copyTo(it) } }
            f
        }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = cameraFile
        if (ok && f != null) upload { f }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = { Text("Profile", fontWeight = FontWeight.SemiBold) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = headerColor(), titleContentColor = Color.White, navigationIconContentColor = Color.White)
            )
        }
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box {
                    Avatar(profile.username, 150.dp, photoUrl = Api.avatarUrl(profile.username, profile.photo_v))
                    Box(
                        Modifier.align(Alignment.BottomEnd).size(48.dp).clip(CircleShape).background(Color(0xFF00A884))
                            .clickable { sheet = true },
                        contentAlignment = Alignment.Center
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
                        else Icon(Icons.Default.CameraAlt, "Change photo", tint = Color.White)
                    }
                }
                Spacer(Modifier.height(14.dp))
                Text(profile.shownName, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                Text("@${profile.username}", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            profile.pending_name?.let { pending ->
                Banner(Color(0xFFFFF4CE), Color(0xFF7A5B00), Icons.Default.HourglassTop,
                    "\"$pending\" is waiting for admin approval. Others still see \"${profile.shownName}\".", "Withdraw") {
                    scope.launch { runCatching { Api.cancelName() }.onSuccess { profile = it } }
                }
            }
            if (profile.pending_name == null) profile.name_note?.let { note ->
                Banner(Color(0xFFFDE7E9), Color(0xFFB3261E), Icons.Default.Info, "Name change not approved: $note", null) {}
            }
            InfoRow(Icons.Default.Person, "Name", profile.shownName) { editName = profile.pending_name ?: profile.shownName }
            Text("This is the name your colleagues see. A new name is shown after an admin approves it.",
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 72.dp, end = 24.dp, bottom = 8.dp))
            HorizontalDivider(Modifier.padding(start = 72.dp))
            InfoRow(Icons.Default.Info, "About", profile.about.ifBlank { "Hey there! I am using JMS Chat." }) { editAbout = profile.about }
            HorizontalDivider(Modifier.padding(start = 72.dp))
            val work = listOf(profile.designation, profile.department).filter { it.isNotBlank() }.joinToString("  |  ")
            InfoRow(Icons.Default.Work, "Designation | Department", work.ifBlank { "Add your designation and department" }) { editWork = true }
            HorizontalDivider(Modifier.padding(start = 72.dp))
            InfoRow(Icons.Default.Badge, "Login ID", profile.username, null)
            val sub = listOf(profile.role.replace('_', ' '), profile.line).filter { it.isNotBlank() }.joinToString(" · ")
            if (sub.isNotEmpty()) {
                HorizontalDivider(Modifier.padding(start = 72.dp))
                InfoRow(Icons.Default.Info, "JMS role", sub, null)
            }
            if (profile.can_approve_names) {
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier.fillMaxWidth().clickable(onClick = onNameRequests).padding(horizontal = 24.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Badge, null, tint = Color(0xFF00A884))
                    Spacer(Modifier.width(24.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Name requests", fontSize = 16.sp)
                        Text("Approve or reject new names", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (profile.name_requests > 0) Box(
                        Modifier.clip(CircleShape).background(Color(0xFF25D366)).padding(horizontal = 8.dp, vertical = 2.dp)
                    ) { Text("${profile.name_requests}", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                }
            }
            Spacer(Modifier.height(8.dp))
            NotificationsSection()
            Spacer(Modifier.height(8.dp))
            QuietHoursSection()
            Spacer(Modifier.height(8.dp))
            AppLockSection()
            Spacer(Modifier.height(16.dp))
            Row(
                Modifier.fillMaxWidth().clickable(onClick = onSignOut).padding(horizontal = 24.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, null, tint = MaterialTheme.colorScheme.error)
                Spacer(Modifier.width(24.dp))
                Text("Sign out", color = MaterialTheme.colorScheme.error, fontSize = 16.sp)
            }
            Text("JMS Chat ${BuildConfig.VERSION_NAME}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(24.dp))
        }
    }

    if (sheet) ModalBottomSheet(onDismissRequest = { sheet = false }) {
        Text("Profile photo", fontWeight = FontWeight.SemiBold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
        SheetItem(Icons.Default.CameraAlt, "Camera") {
            sheet = false
            val (f, uri) = Media.newCameraTarget(ctx)
            cameraFile = f
            camera.launch(uri)
        }
        SheetItem(Icons.Default.PhotoLibrary, "Gallery") {
            sheet = false
            gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }
        if (profile.photo_v != null) SheetItem(Icons.Default.Delete, "Remove photo") {
            sheet = false
            scope.launch { runCatching { Api.removePhoto() }.onSuccess { profile = it } }
        }
        Spacer(Modifier.height(24.dp))
    }

    if (editWork) {
        var des by remember { mutableStateOf(profile.designation) }
        var dep by remember { mutableStateOf(profile.department) }
        AlertDialog(
            onDismissRequest = { editWork = false },
            title = { Text("Designation | Department") },
            text = {
                Column {
                    OutlinedTextField(value = des, onValueChange = { des = it.take(60) }, singleLine = true, label = { Text("Designation") },
                        placeholder = { Text("e.g. Supervisor, Operator") })
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = dep, onValueChange = { dep = it.take(60) }, singleLine = true, label = { Text("Department") },
                        placeholder = { Text("e.g. Moulding, QC, Store") })
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    editWork = false
                    scope.launch {
                        runCatching { Api.saveWork(des.trim(), dep.trim()) }.onSuccess { profile = it }
                            .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                    }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { editWork = false }) { Text("Cancel") } }
        )
    }

    editName?.let { current ->
        var text by remember { mutableStateOf(current) }
        val len = text.trim().length
        AlertDialog(
            onDismissRequest = { editName = null },
            title = { Text("Enter your name") },
            text = {
                Column {
                    OutlinedTextField(value = text, onValueChange = { text = it.take(40) }, singleLine = true,
                        supportingText = { Text("${text.length}/40") }, isError = len in 1..1)
                    Text("Your current name stays until an admin approves the new one.", fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            confirmButton = {
                TextButton(enabled = len >= 2, onClick = {
                    editName = null
                    scope.launch {
                        runCatching { Api.saveName(text.trim()) }
                            .onSuccess { r ->
                                r.profile?.let { profile = it }
                                if (r.message.isNotBlank()) Toast.makeText(ctx, r.message, Toast.LENGTH_LONG).show()
                            }
                            .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                    }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { editName = null }) { Text("Cancel") } }
        )
    }

    editAbout?.let { current ->
        var text by remember { mutableStateOf(current) }
        AlertDialog(
            onDismissRequest = { editAbout = null },
            title = { Text("About") },
            text = { OutlinedTextField(value = text, onValueChange = { text = it.take(140) }, singleLine = false, supportingText = { Text("${text.length}/140") }) },
            confirmButton = {
                TextButton(onClick = {
                    editAbout = null
                    scope.launch {
                        runCatching { Api.saveAbout(text) }.onSuccess { profile = it }
                            .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                    }
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { editAbout = null }) { Text("Cancel") } }
        )
    }
}

/**
 * Why a phone gets no notifications, in plain words, with a button to fix each one:
 * server push set up, this phone registered, notification permission, and background
 * (battery) restriction — Xiaomi / Oppo / Vivo / Realme block background apps by default.
 */
@Composable
private fun NotificationsSection() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<com.jmsocean.chat.data.PushStatus?>(null) }
    var checking by remember { mutableStateOf(true) }
    var tick by remember { mutableStateOf(0) }
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycle) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, e -> if (e == androidx.lifecycle.Lifecycle.Event.ON_RESUME) tick++ }
        lifecycle.lifecycle.addObserver(obs)
        onDispose { lifecycle.lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(tick) {
        checking = true
        com.jmsocean.chat.push.Push.register()
        status = runCatching { Api.pushStatus() }.getOrNull()
        checking = false
    }
    val permOk = android.os.Build.VERSION.SDK_INT < 33 ||
        androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED
    val enabledOk = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
    val batteryOk = pm.isIgnoringBatteryOptimizations(ctx.packageName)
    val appOk = com.jmsocean.chat.push.Push.configured
    val serverOk = status?.server == true
    val phoneOk = (status?.devices?.size ?: 0) > 0

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Text("Notifications", color = Color(0xFF00A884), fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(8.dp))
        if (checking && status == null) Text("Checking…", modifier = Modifier.padding(8.dp))
        CheckRow("App built with push", appOk, if (appOk) null else "Update the app") {}
        CheckRow("Server push set up", serverOk, if (serverOk) null else "Ask the admin") {}
        CheckRow("This phone registered", phoneOk, if (phoneOk || !serverOk || !appOk) null else "Retry") { tick++ }
        CheckRow("Notifications allowed", permOk && enabledOk, if (permOk && enabledOk) null else "Allow") {
            ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.packageName))
        }
        CheckRow("Runs in background (battery)", batteryOk, if (batteryOk) null else "Allow") {
            runCatching {
                ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    android.net.Uri.parse("package:${ctx.packageName}")))
            }.onFailure {
                ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.parse("package:${ctx.packageName}")))
            }
        }
        Text(
            "On Xiaomi, Redmi, Oppo, Vivo, Realme also turn on Autostart for JMS Chat in the phone's settings, or messages arrive only when the app is open.",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)
        )
        androidx.compose.material3.OutlinedButton(
            onClick = {
                scope.launch {
                    runCatching { Api.pushTest() }
                        .onSuccess { Toast.makeText(ctx, "Test sent. Close the app — it should pop up in a few seconds.", Toast.LENGTH_LONG).show() }
                        .onFailure { Toast.makeText(ctx, it.message, Toast.LENGTH_LONG).show() }
                }
            },
            modifier = Modifier.padding(8.dp)
        ) { Text("Send test notification") }
        TextButton(onClick = {
            ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:${ctx.packageName}")))
        }) { Text("Open app settings (Autostart, battery)") }
    }
}

@Composable
private fun CheckRow(label: String, ok: Boolean, action: String?, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(if (ok) "✅" else "⚠️", fontSize = 16.sp)
        Spacer(Modifier.width(12.dp))
        Text(label, modifier = Modifier.weight(1f), fontSize = 15.sp)
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable
fun InfoRow(icon: ImageVector, label: String, value: String, onEdit: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().let { if (onEdit != null) it.clickable(onClick = onEdit) else it }.padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(24.dp))
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, fontSize = 16.sp)
        }
        if (onEdit != null) Icon(Icons.Default.Edit, "Edit", tint = Color(0xFF00A884))
    }
}

@Composable
private fun Banner(bg: Color, fg: Color, icon: ImageVector, text: String, action: String?, onAction: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
            .background(bg).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(text, color = fg, fontSize = 14.sp, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action, color = fg, fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
private fun SheetItem(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = Color(0xFF00A884))
        Spacer(Modifier.width(20.dp))
        Text(label, fontSize = 16.sp)
    }
}
