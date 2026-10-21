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
import androidx.compose.material.icons.filled.Info
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

/** My profile: photo (camera or gallery), About line, sign out. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(onBack: () -> Unit, onSignOut: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var profile by remember { mutableStateOf(Profile(username = Session.username ?: "")) }
    var busy by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf(false) }
    var editAbout by remember { mutableStateOf<String?>(null) }
    var cameraFile by remember { mutableStateOf<File?>(null) }

    LaunchedEffect(Unit) { runCatching { Api.myProfile() }.onSuccess { profile = it } }

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
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Teal, titleContentColor = Color.White, navigationIconContentColor = Color.White)
            )
        }
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
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
            }
            InfoRow(Icons.Default.Person, "Name", profile.username, null)
            HorizontalDivider(Modifier.padding(start = 72.dp))
            InfoRow(Icons.Default.Info, "About", profile.about.ifBlank { "Hey there! I am using JMS Chat." }) { editAbout = profile.about }
            HorizontalDivider(Modifier.padding(start = 72.dp))
            val sub = listOf(profile.role.replace('_', ' '), profile.line).filter { it.isNotBlank() }.joinToString(" · ")
            if (sub.isNotEmpty()) InfoRow(Icons.Default.Info, "Role", sub, null)
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
