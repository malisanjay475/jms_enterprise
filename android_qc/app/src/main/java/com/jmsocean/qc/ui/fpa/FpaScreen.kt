package com.jmsocean.qc.ui.fpa

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import com.jmsocean.qc.ui.theme.Good
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

    LaunchedEffect(s.submitted) { if (s.submitted) { /* stay on view mode */ } }

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
                    Text(job?.productName ?: "—", fontWeight = FontWeight.Bold)
                    Text(
                        buildString {
                            job?.JobCardNo?.let { append("JC $it") }
                            if (s.machine.isNotBlank()) append(" · ${s.machine}")
                            job?.Mould?.let { append(" · Mould $it") }
                        },
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
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
                        )
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

                else -> {
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
private fun SectionLabel(text: String) {
    Text(
        text,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = Modifier.padding(bottom = 8.dp)
    )
}

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
