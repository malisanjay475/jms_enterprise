package com.jmsocean.shifting.ui.scan

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.shifting.data.ScanFeedback
import com.jmsocean.shifting.data.ShiftClock
import com.jmsocean.shifting.data.remote.LabelInfo
import com.jmsocean.shifting.ui.common.AppTopBar
import com.jmsocean.shifting.ui.common.JobAvailabilityCard
import com.jmsocean.shifting.ui.common.MetricRow
import com.jmsocean.shifting.ui.common.Pill
import com.jmsocean.shifting.ui.common.PickerField
import com.jmsocean.shifting.ui.common.WeightQtyFields
import com.jmsocean.shifting.ui.common.qty
import com.jmsocean.shifting.ui.theme.Crit
import com.jmsocean.shifting.ui.theme.Good
import com.jmsocean.shifting.ui.theme.Warn

@Composable
fun ScanScreen(onMenu: () -> Unit, vm: ScanViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var showCamera by remember { mutableStateOf(false) }

    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) showCamera = true
    }
    fun openCamera() {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) showCamera = true
        else cameraPermission.launch(Manifest.permission.CAMERA)
    }

    // Beep / buzz on every result.
    LaunchedEffect(Unit) {
        vm.feedback.collect { if (it == Feedback.SUCCESS) ScanFeedback.success(ctx) else ScanFeedback.error(ctx) }
    }
    // Keep the scan box focused so a hardware scanner can fire straight into it,
    // without the soft keyboard covering the screen (tap the box to type by hand).
    LaunchedEffect(s.label == null, s.submitting, s.lookingUp) {
        if (s.label == null && !s.submitting && !s.lookingUp) {
            runCatching { focus.requestFocus() }
            keyboard?.hide()
        }
    }

    if (showCamera) {
        CameraScannerDialog(
            onResult = { code -> showCamera = false; vm.onCameraCode(code) },
            onDismiss = { showCamera = false }
        )
    }

    val slot = ShiftClock.current()
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Scan & Shift",
                subtitle = "${slot.shift} shift · ${ShiftClock.prettyDate(slot.date)}",
                onMenu = onMenu
            )
        }
    ) { pad ->
        Column(
            Modifier
                .padding(pad)
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            s.update?.let { v ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary)) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.SystemUpdate, null, tint = Color.White)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text("Update available · v${v.versionName}", color = Color.White, fontWeight = FontWeight.Bold)
                            s.updateError?.let { Text(it, color = Color.White, fontSize = 12.sp) }
                        }
                        if (s.downloadingUpdate) {
                            CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
                        } else {
                            TextButton(onClick = { vm.dismissUpdate() }) { Text("Later", color = Color.White) }
                            OutlinedButton(onClick = { vm.installUpdate(ctx) }) { Text("Update", color = Color.White) }
                        }
                    }
                }
            }

            // ── What was scanned: always at the top ─────────────────────────
            s.result?.let { ResultBanner(it, onClose = { vm.clear() }) }

            if (s.lookingUp || s.submitting) {
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(if (s.submitting) "Saving shift…" else "Checking label…")
                }
            }

            s.label?.let { label ->
                LabelCard(label)
                s.jobAvail?.let { JobAvailabilityCard(it) }
                if (!label.blocked) {
                    ShiftForm(
                        s = s,
                        label = label,
                        onLocation = vm::setLocation,
                        onRetryLocations = { vm.loadLocations() },
                        onWeight = vm::setWeight,
                        onQuantity = vm::setQuantity,
                        onConfirm = { keyboard?.hide(); vm.confirm() },
                        onCancel = { vm.clear() }
                    )
                }
            }

            // ── Scan box (below the scanned label) ──────────────────────────
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = s.input,
                            onValueChange = vm::onInput,
                            label = { Text(if (s.label == null) "Scan label or type code" else "Scan next label") },
                            singleLine = true,
                            leadingIcon = { Icon(Icons.Default.QrCodeScanner, null) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { vm.submitInput() }, onDone = { vm.submitInput() }),
                            enabled = !s.submitting,
                            modifier = Modifier
                                .weight(1f)
                                .focusRequester(focus)
                                .onPreviewKeyEvent { e ->
                                    // Hardware scanners finish with Enter.
                                    if (e.type == KeyEventType.KeyUp && (e.key == Key.Enter || e.key == Key.NumPadEnter)) {
                                        vm.submitInput(); true
                                    } else false
                                }
                        )
                        Spacer(Modifier.width(8.dp))
                        Button(
                            onClick = { openCamera() },
                            enabled = !s.submitting,
                            modifier = Modifier.height(56.dp),
                            shape = RoundedCornerShape(14.dp)
                        ) { Icon(Icons.Default.CameraAlt, contentDescription = "Scan with camera") }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Quick shift", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                            Text(
                                "Shift the full label to the last Send To right after each good scan",
                                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(checked = s.quickShift, onCheckedChange = vm::setQuickShift)
                    }
                }
            }

            if (s.shiftedThisSession > 0) {
                Text(
                    "Labels shifted since the app was opened: ${s.shiftedThisSession}",
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
                )
            }
        }
    }
}

@Composable
private fun ResultBanner(result: ScanResult, onClose: () -> Unit) {
    if (!result.ok && result.title.isNotBlank()) {
        // Refusals (not produced / not verified / hold / already shifted) in big letters.
        Card(colors = CardDefaults.cardColors(containerColor = Crit)) {
            Column(Modifier.fillMaxWidth().padding(18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.Block, null, tint = Color.White, modifier = Modifier.size(44.dp))
                Spacer(Modifier.height(6.dp))
                Text(result.title, color = Color.White, fontWeight = FontWeight.Black, fontSize = 30.sp, lineHeight = 34.sp,
                    textAlign = TextAlign.Center)
                Spacer(Modifier.height(6.dp))
                Text(result.text, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = onClose) { Text("Scan next label", color = Color.White, fontWeight = FontWeight.Bold) }
            }
        }
        return
    }
    val bg = if (result.ok) Good else Crit
    Card(colors = CardDefaults.cardColors(containerColor = bg)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (result.ok) Icons.Default.CheckCircle else Icons.Default.ErrorOutline, null, tint = Color.White)
            Spacer(Modifier.width(10.dp))
            Text(result.text, Modifier.weight(1f), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, contentDescription = "Dismiss", tint = Color.White) }
        }
    }
}

/** The scanned label and its job: produced, shifted and still on the shop floor. */
@Composable
private fun LabelCard(label: LabelInfo) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text("SCANNED", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(label.colour.ifBlank { "—" }, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
                    Text(label.itemName.ifBlank { "—" }, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text(
                        "${label.machine.ifBlank { "—" }} · Label ${label.labelNo}/${label.totalLabels}",
                        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        listOf(label.orderNo, label.jcNo, label.planCode).filter { it.isNotBlank() }.joinToString(" · "),
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                when {
                    label.alreadyShifted -> Pill("Already shifted", Crit.copy(alpha = 0.15f), Crit)
                    label.qcHold != null -> Pill("QC HOLD", Crit.copy(alpha = 0.15f), Crit)
                    else -> Pill("Ready", Good.copy(alpha = 0.15f), Good)
                }
            }

            if (label.qcHold != null) {
                Text(
                    label.qcHoldMessage.ifBlank { "QC HOLD: ${label.qcHold.reason}" },
                    color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                    modifier = Modifier.fillMaxWidth().background(Crit, RoundedCornerShape(10.dp)).padding(10.dp)
                )
            }

            Text("THIS JOB", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            MetricRow(
                Triple("Produced", qty(label.totalProduced), Color.Unspecified),
                Triple("Shifted", qty(label.totalShifted), MaterialTheme.colorScheme.primary),
                Triple("On floor", qty(label.shopFloorQty), if (label.shopFloorQty > 0) Warn else Color.Unspecified)
            )
            Text("THIS COLOUR", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            MetricRow(
                Triple("Produced", qty(label.colourProduced), Color.Unspecified),
                Triple("QC verified", qty(label.colourVerified), Good),
                Triple("Not verified", qty(label.colourNotVerified), if (label.colourNotVerified > 0) Crit else Color.Unspecified)
            )
            MetricRow(
                Triple("Ready to shift", qty(label.colourReady), MaterialTheme.colorScheme.primary),
                Triple("Label left", qty(label.labelPendingQty), Color.Unspecified),
                Triple("On QC hold", qty(label.holdQty), if (label.holdQty > 0 || label.qcHold != null) Crit else Color.Unspecified)
            )

            if (label.colours.size > 1) {
                HorizontalDivider()
                Text("All colours of this job", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                label.colours.forEach { c ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            c.colour + if (c.isScannedColour) "  ◀" else "",
                            Modifier.weight(1f), fontSize = 13.sp,
                            fontWeight = if (c.isScannedColour) FontWeight.Bold else FontWeight.Normal
                        )
                        Text("Shifted ${qty(c.shiftedQty)} / ${qty(c.planQty)}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/** Send To → weight / quantity → Shift. */
@Composable
private fun ShiftForm(
    s: ScanUiState,
    label: LabelInfo,
    onLocation: (String) -> Unit,
    onRetryLocations: () -> Unit,
    onWeight: (String) -> Unit,
    onQuantity: (String) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit
) {
    val max = label.maxShiftQty
    val q = s.quantity.toIntOrNull() ?: 0
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (s.locations.isEmpty()) {
                Text(
                    s.locationsError ?: "Loading locations…",
                    fontSize = 13.sp,
                    color = if (s.locationsError != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (s.locationsError != null) TextButton(onClick = onRetryLocations) { Text("Retry") }
            } else {
                PickerField(
                    label = "Send To",
                    options = s.locations,
                    selected = s.location,
                    onSelect = onLocation,
                    placeholder = "Select location",
                    modifier = Modifier.fillMaxWidth()
                )
            }
            WeightQtyFields(
                weight = s.weight,
                quantity = s.quantity,
                unitWeightKg = label.unitWeightKg,
                onWeight = onWeight,
                onQuantity = onQuantity,
                maxQty = max
            )
            Button(
                onClick = onConfirm,
                enabled = !s.submitting && s.location.isNotBlank() && q in 1..max,
                modifier = Modifier.fillMaxWidth().height(54.dp)
            ) {
                Text(
                    when {
                        s.location.isBlank() -> "Pick Send To first"
                        q <= 0 -> "Enter weight or quantity"
                        q > max -> "Max ${qty(max.toDouble())} pcs ready"
                        else -> "Shift ${qty(q.toDouble())} pcs → ${s.location}"
                    },
                    fontWeight = FontWeight.Bold, fontSize = 16.sp
                )
            }
            TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Cancel") }
        }
    }
}
