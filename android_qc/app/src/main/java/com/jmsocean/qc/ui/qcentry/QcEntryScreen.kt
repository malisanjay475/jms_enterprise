package com.jmsocean.qc.ui.qcentry

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jmsocean.qc.ui.theme.Crit
import com.jmsocean.qc.ui.theme.Good
import com.jmsocean.qc.ui.theme.Warn

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QcEntryScreen(
    onBack: () -> Unit,
    onDoFpa: () -> Unit,
    vm: QcEntryViewModel = viewModel()
) {
    val s by vm.state.collectAsStateWithLifecycle()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                ),
                title = { Text("QC Entry", fontWeight = FontWeight.Bold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Back") }
                }
            )
        }
    ) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp)
        ) {
            val job = s.job
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(12.dp)) {
                    Text(job?.productName ?: "—", fontWeight = FontWeight.Bold)
                    Text(
                        buildString {
                            job?.clientName?.let { append(it) }
                            job?.orderNumber?.takeIf { it.isNotBlank() }?.let { append(if (isEmpty()) "OR $it" else " · OR $it") }
                            job?.JobCardNo?.let { append(" · JC $it") }
                        },
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (s.balances.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Colour balance", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        Spacer(Modifier.height(6.dp))
                        Row(Modifier.fillMaxWidth()) {
                            Text("Colour", Modifier.weight(1.4f), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Plan", Modifier.weight(1f), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Made", Modifier.weight(1f), fontSize = 11.sp, color = Good)
                            Text("Pend", Modifier.weight(1f), fontSize = 11.sp, color = Warn)
                        }
                        s.balances.forEach { b ->
                            Spacer(Modifier.height(4.dp))
                            Row(Modifier.fillMaxWidth()) {
                                Text(b.colour, Modifier.weight(1.4f), fontSize = 12.sp, fontWeight = FontWeight.Medium)
                                Text("${b.planQty}", Modifier.weight(1f), fontSize = 12.sp)
                                Text("${b.produced}", Modifier.weight(1f), fontSize = 12.sp, color = Good, fontWeight = FontWeight.SemiBold)
                                Text("${b.balance}", Modifier.weight(1f), fontSize = 12.sp, color = Warn, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            when {
                s.checkingFpa -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                !s.fpaDone -> Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text("FPA required first", color = Warn, fontWeight = FontWeight.Bold)
                        Text(
                            "First Piece Approval must be submitted before QC hourly entry for this job.",
                            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = onDoFpa, modifier = Modifier.fillMaxWidth()) {
                            Text("Do FPA now", color = MaterialTheme.colorScheme.onPrimary)
                        }
                    }
                }
                else -> {
                    // Shift
                    Text("Shift", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("Day", "Night").forEach {
                            FilterChip(selected = s.shift == it, onClick = { vm.setShift(it) }, label = { Text(it) })
                        }
                    }
                    Spacer(Modifier.height(12.dp))

                    // Hour slot
                    Text("Hour slot", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        HOUR_SLOTS.forEach {
                            FilterChip(selected = s.slot == it, onClick = { vm.setSlot(it) }, label = { Text(it) })
                        }
                    }
                    Spacer(Modifier.height(12.dp))

                    // Colours
                    if (s.colours.isNotEmpty()) {
                        Text("Colour", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(
                            Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            s.colours.forEach { c ->
                                FilterChip(
                                    selected = s.colour == c.colour,
                                    onClick = { vm.setColour(c.colour) },
                                    label = { Text("${c.colour} (${c.planQty})") }
                                )
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                    }

                    // Shots / Reject / Downtime
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        NumField("Shots", s.shots, vm::setShots, Modifier.weight(1f))
                        NumField("Reject", s.reject, vm::setReject, Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        NumField("Downtime (min)", s.downtime, vm::setDowntime, Modifier.weight(1f))
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Good.copy(alpha = 0.12f)),
                            shape = RoundedCornerShape(10.dp), modifier = Modifier.weight(1f)
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Text("Good qty", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("${s.goodQty}", fontWeight = FontWeight.Bold, fontSize = 20.sp, color = Good)
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = s.remarks, onValueChange = vm::setRemarks,
                        label = { Text("Remarks (optional)") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    if (s.error != null) {
                        Spacer(Modifier.height(8.dp))
                        Text(s.error!!, color = Crit, fontSize = 13.sp)
                    }
                    if (s.message != null) {
                        Spacer(Modifier.height(8.dp))
                        Text(s.message!!, color = Good, fontSize = 13.sp)
                    }

                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = vm::submit, enabled = s.canSubmit,
                        modifier = Modifier.fillMaxWidth().height(50.dp)
                    ) {
                        if (s.submitting) CircularProgressIndicator(
                            Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary
                        ) else Text("Save QC entry", color = MaterialTheme.colorScheme.onPrimary)
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
                        Text("Back to Queue")
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun NumField(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier) {
    OutlinedTextField(
        value = value, onValueChange = onChange,
        label = { Text(label) }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = modifier
    )
}
