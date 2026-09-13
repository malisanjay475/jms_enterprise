package com.jmsocean.qc.ui.fpa

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.jmsocean.qc.ui.theme.Accent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FpaScreen(
    onBack: () -> Unit,
    vm: FpaViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val ctx = LocalContext.current

    // Camera plumbing: capture to a file in cacheDir/images, handed out via FileProvider.
    fun newImageFile(): File {
        val dir = File(ctx.cacheDir, "images").apply { mkdirs() }
        return File(dir, "fpa_${System.currentTimeMillis()}.jpg")
    }
    fun uriFor(f: File): Uri =
        FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)

    var pendingForm by remember { mutableStateOf<File?>(null) }
    var pendingProduct by remember { mutableStateOf<File?>(null) }

    val formLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { ok -> if (ok) pendingForm?.let { vm.setFormImage(it) } }

    val productLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { ok -> if (ok) pendingProduct?.let { vm.addProductImage(it) } }

    var zoomModel by remember { mutableStateOf<Any?>(null) }

    LaunchedEffect(s.submitted) { if (s.submitted) { /* stay on view mode */ } }

    if (zoomModel != null) {
        ZoomImageDialog(model = zoomModel!!, onDismiss = { zoomModel = null })
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                ),
                title = { Text("First Piece Approval", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { pad ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(pad)
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            // Job context banner
            val job = s.job
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        "Mould: ${job?.Mould?.takeIf { it.isNotBlank() } ?: "—"}",
                        fontWeight = FontWeight.Bold, fontSize = 14.sp
                    )
                    Text(
                        buildString {
                            append("OR ${job?.orderNumber?.ifBlank { "—" } ?: "—"}")
                            job?.JobCardNo?.takeIf { it.isNotBlank() }?.let { append("  |  JC $it") }
                        },
                        fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    job?.mouldNo?.takeIf { it.isNotBlank() }?.let {
                        Text("Mould No: $it", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            // Colour balance
            if (s.balances.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(12.dp)) {
                        SectionLabel("Colour balance")
                        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                            BalHead("Colour", 1.4f); BalHead("Plan", 1f); BalHead("Made", 1f, Good); BalHead("Bal", 1f, Warn)
                        }
                        s.balances.forEach { b ->
                            Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
                                BalCell(b.colour, 1.4f, bold = true); BalCell("${b.planQty}", 1f)
                                BalCell("${b.produced}", 1f, Good); BalCell("${b.balance}", 1f, Warn)
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(14.dp))

            when {
                s.checking -> Box(Modifier.fillMaxWidth().padding(30.dp), Alignment.Center) {
                    CircularProgressIndicator(color = Accent)
                }

                s.alreadyDone -> Column {
                    DoneBanner(submittedNow = s.submitted, by = s.doneBy, at = s.doneAt)
                    Spacer(Modifier.height(14.dp))
                    if (s.savedFormUrl != null) {
                        SectionLabel("📋 Saved FPA form")
                        AsyncImage(
                            model = s.savedFormUrl,
                            contentDescription = "Saved FPA form",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(200.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .clickable { zoomModel = s.savedFormUrl }
                        )
                        Text("Tap to zoom", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                        Spacer(Modifier.height(14.dp))
                    }
                    if (s.savedProductUrls.isNotEmpty()) {
                        SectionLabel("🖼 Saved product photos")
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(3),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height((((s.savedProductUrls.size + 2) / 3) * 116).dp)
                        ) {
                            items(s.savedProductUrls) { url ->
                                AsyncImage(
                                    model = url,
                                    contentDescription = "Product",
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .aspectRatio(1f)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(MaterialTheme.colorScheme.surface)
                                        .clickable { zoomModel = url }
                                )
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                    Button(
                        onClick = onBack,
                        modifier = Modifier.fillMaxWidth().height(50.dp)
                    ) { Text("Back to Queue", color = MaterialTheme.colorScheme.onPrimary) }
                    Spacer(Modifier.height(24.dp))
                }

                s.pendingApproval -> Column {
                    Surface(
                        color = Color(0xFFFFFBEB),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(16.dp)) {
                            Text("⏳ Pending Approval", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Color(0xFFB45309))
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "Your FPA has been submitted and is waiting for QC HOD approval. It will appear in the DPR Compliance Summary only after it is approved.",
                                fontSize = 13.sp, color = Color(0xFF92400E)
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    if (s.savedFormUrl != null) {
                        SectionLabel("📋 Submitted FPA form")
                        AsyncImage(
                            model = s.savedFormUrl,
                            contentDescription = "Submitted FPA form",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxWidth().height(200.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .clickable { zoomModel = s.savedFormUrl }
                        )
                        Spacer(Modifier.height(16.dp))
                    }
                    Button(
                        onClick = onBack,
                        modifier = Modifier.fillMaxWidth().height(50.dp)
                    ) { Text("Back to Queue", color = MaterialTheme.colorScheme.onPrimary) }
                    Spacer(Modifier.height(24.dp))
                }

                else -> {
                    if (s.rejected) {
                        Surface(
                            color = Color(0xFFFEF2F2),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                Text("❌ FPA Rejected — please correct & re-upload", fontWeight = FontWeight.Bold, fontSize = 15.sp, color = Color(0xFFB91C1C))
                                if (!s.rejectReason.isNullOrBlank()) {
                                    Spacer(Modifier.height(6.dp))
                                    Text("Reason: ${s.rejectReason}", fontSize = 13.sp, color = Color(0xFF991B1B))
                                }
                                if (!s.reviewedBy.isNullOrBlank()) {
                                    Spacer(Modifier.height(2.dp))
                                    Text("By: ${s.reviewedBy}", fontSize = 12.sp, color = Color(0xFFB91C1C))
                                }
                            }
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                    if (s.error != null) {
                        Text(s.error!!, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                        Spacer(Modifier.height(8.dp))
                    }

                    // FPA form photo
                    SectionLabel("📋 FPA form photo")
                    CaptureTile(
                        file = s.formImage,
                        hint = "Tap to photograph the physical FPA sheet",
                        onClick = {
                            val f = newImageFile(); pendingForm = f; formLauncher.launch(uriFor(f))
                        }
                    )

                    Spacer(Modifier.height(16.dp))

                    // Product references
                    SectionLabel("🖼 Product reference photos — min 2")
                    Text(
                        "${s.productCount} / 6 photos",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                    ProductGrid(
                        files = s.productImages,
                        onAdd = {
                            val f = newImageFile(); pendingProduct = f; productLauncher.launch(uriFor(f))
                        },
                        onRemove = vm::removeProductImage
                    )

                    Spacer(Modifier.height(16.dp))

                    OutlinedTextField(
                        value = s.remarks,
                        onValueChange = vm::onRemarks,
                        label = { Text("Remarks (optional)") },
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(Modifier.height(20.dp))

                    Button(
                        onClick = vm::submit,
                        enabled = s.canSubmit,
                        modifier = Modifier.fillMaxWidth().height(50.dp)
                    ) {
                        if (s.submitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text("Submit FPA", color = MaterialTheme.colorScheme.onPrimary)
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun ZoomImageDialog(model: Any, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        var scale by remember { mutableStateOf(1f) }
        var offset by remember { mutableStateOf(Offset.Zero) }
        val tState = rememberTransformableState { zoom, pan, _ ->
            scale = (scale * zoom).coerceIn(1f, 5f)
            offset += pan
        }
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.93f)).clickable(onClick = onDismiss),
            contentAlignment = Alignment.Center
        ) {
            AsyncImage(
                model = model, contentDescription = "Zoomed image", contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
                    .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y)
                    .transformable(tState)
            )
            Text(
                "Pinch to zoom · tap to close", color = Color.White, fontSize = 12.sp,
                modifier = Modifier.align(Alignment.TopCenter).padding(16.dp)
            )
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = Modifier.padding(bottom = 8.dp)
    )
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.BalHead(
    t: String, w: Float, color: androidx.compose.ui.graphics.Color? = null
) = Text(t, Modifier.weight(w), fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold,
    color = color ?: MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun androidx.compose.foundation.layout.RowScope.BalCell(
    t: String, w: Float, color: androidx.compose.ui.graphics.Color? = null, bold: Boolean = false
) = Text(t, Modifier.weight(w), fontSize = 12.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium,
    color = color ?: MaterialTheme.colorScheme.onSurface)

@Composable
private fun DoneBanner(submittedNow: Boolean, by: String?, at: String?) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().border(1.dp, Good, RoundedCornerShape(12.dp))
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("✅", fontSize = 22.sp)
            Spacer(Modifier.size(12.dp))
            Column {
                Text(
                    if (submittedNow) "FPA submitted" else "FPA already submitted",
                    fontWeight = FontWeight.Bold, color = Good
                )
                val meta = buildString {
                    if (!by.isNullOrBlank()) append("By $by")
                    if (!at.isNullOrBlank()) append(if (isEmpty()) at else " · $at")
                }
                Text(
                    meta.ifBlank { "This job's first piece approval is on record." },
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun CaptureTile(file: File?, hint: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(170.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        if (file != null) {
            AsyncImage(
                model = file,
                contentDescription = "FPA form",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("📷", fontSize = 32.sp)
                Spacer(Modifier.height(6.dp))
                Text(
                    hint,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun ProductGrid(files: List<File>, onAdd: () -> Unit, onRemove: (File) -> Unit) {
    // Height is bounded so it can live inside the outer vertical scroll.
    val rows = ((files.size + 1) + 2) / 3
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height((rows * 116).dp)
    ) {
        items(files) { f ->
            Box(
                Modifier
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surface)
            ) {
                AsyncImage(
                    model = f,
                    contentDescription = "Product",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
                IconButton(
                    onClick = { onRemove(f) },
                    modifier = Modifier.align(Alignment.TopEnd).size(28.dp)
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Remove",
                        tint = MaterialTheme.colorScheme.error
                    )
                }
            }
        }
        if (files.size < 6) {
            item {
                Box(
                    Modifier
                        .aspectRatio(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surface)
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                        .clickable(onClick = onAdd),
                    contentAlignment = Alignment.Center
                ) {
                    Text("＋", fontSize = 26.sp, color = Accent)
                }
            }
        }
    }
}
